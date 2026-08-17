/**
 * Base44 SDK compatibility layer, backed by Supabase.
 * ---------------------------------------------------------------------------
 * Drop this in at src/api/base44Client.js, delete @base44/sdk, and every
 * existing call site keeps working unchanged:
 *
 *     base44.entities.Product.list('-created_date', 100)
 *     base44.entities.CarrierRate.filter({ carrier_name: c })
 *     base44.entities.PurchaseOrder.update(id, patch)
 *     base44.auth.me()
 *     base44.functions.invoke('sendInvoiceEmail', payload)
 *     base44.integrations.Core.UploadFile({ file })
 *
 * Deliberate behavioural notes:
 *
 *  - list()/filter() with no limit fetch EVERY row via keyset pagination.
 *    Supabase caps a single response at 1000 rows; Base44 did not. Without
 *    this loop any table past 1000 records silently truncates — the kind of
 *    bug that surfaces months later as "some old orders disappeared".
 *
 *  - Errors are thrown, never swallowed, and carry .status so the existing
 *    `error.status === 401` checks in AuthContext keep working.
 *
 *  - No API keys live in this file or anywhere else in the browser bundle.
 *    LLM and email calls go through Edge Functions that hold the secrets.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Lets several apps share one Supabase project, one schema each, without
// burning a free-tier project slot per app. Defaults to `public`.
const DB_SCHEMA = import.meta.env.VITE_SUPABASE_SCHEMA || 'public';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env.local and fill them in.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  db: { schema: DB_SCHEMA },
});

// `profiles` and auth always live in `public`, even when entities don't.
const publicDb =
  DB_SCHEMA === 'public'
    ? supabase
    : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        db: { schema: 'public' },
      });

/* ------------------------------------------------------------------ utils */

/** Base44 entity name (PurchaseOrder) -> Postgres table (purchase_order). */
const toTable = (entity) =>
  entity
    .replace(/(.)([A-Z][a-z]+)/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

/** Preserve Base44's error shape: message + numeric status. */
class Base44CompatError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'Base44CompatError';
    this.status = status ?? 500;
    this.details = details;
  }
}

const raise = (error, context) => {
  if (!error) return;
  const status =
    Number(error.status) ||
    ({ PGRST301: 401, '42501': 403, '23505': 409, '23503': 409 }[error.code] ?? 500);
  throw new Base44CompatError(`${context}: ${error.message}`, status, error);
};

/**
 * Base44 sort strings: 'field' ascending, '-field' descending.
 * Base44's implicit default was newest-first.
 */
const applySort = (query, sort) => {
  const spec = sort || '-created_date';
  for (const raw of String(spec).split(',')) {
    const field = raw.trim();
    if (!field) continue;
    const desc = field.startsWith('-');
    query = query.order(desc ? field.slice(1) : field, {
      ascending: !desc,
      nullsFirst: false,
    });
  }
  return query;
};

/** Mongo-ish operators Base44 accepted in filter(). */
const applyWhere = (query, where) => {
  for (const [field, condition] of Object.entries(where || {})) {
    if (condition === null) {
      query = query.is(field, null);
    } else if (Array.isArray(condition)) {
      query = query.in(field, condition);
    } else if (typeof condition === 'object') {
      for (const [op, value] of Object.entries(condition)) {
        switch (op) {
          case '$in':       query = query.in(field, value); break;
          case '$nin':      query = query.not(field, 'in', `(${value.join(',')})`); break;
          case '$ne':       query = query.neq(field, value); break;
          case '$gt':       query = query.gt(field, value); break;
          case '$gte':      query = query.gte(field, value); break;
          case '$lt':       query = query.lt(field, value); break;
          case '$lte':      query = query.lte(field, value); break;
          case '$contains': query = query.ilike(field, `%${value}%`); break;
          case '$exists':   query = value ? query.not(field, 'is', null) : query.is(field, null); break;
          default:
            throw new Base44CompatError(`Unsupported filter operator "${op}"`, 400);
        }
      }
    } else {
      query = query.eq(field, condition);
    }
  }
  return query;
};

const PAGE_SIZE = 1000; // Supabase hard cap per response

/** Fetch every matching row, not just the first page. */
async function fetchAll(build, limit, context) {
  if (limit && limit <= PAGE_SIZE) {
    const { data, error } = await build().range(0, limit - 1);
    raise(error, context);
    return data ?? [];
  }
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, limit ?? Infinity) - 1;
    const { data, error } = await build().range(from, to);
    raise(error, context);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE || (limit && rows.length >= limit)) break;
  }
  return limit ? rows.slice(0, limit) : rows;
}

/* --------------------------------------------------------------- entities */

function entityApi(entityName) {
  const table = toTable(entityName);
  const ctx = `${entityName}`;

  return {
    /** list(sort?, limit?) — Base44 signature, both optional. */
    list: (sort, limit) =>
      fetchAll(() => applySort(supabase.from(table).select('*'), sort), limit, `${ctx}.list`),

    /** filter(where, sort?, limit?) */
    filter: (where, sort, limit) =>
      fetchAll(
        () => applySort(applyWhere(supabase.from(table).select('*'), where), sort),
        limit,
        `${ctx}.filter`
      ),

    async get(id) {
      const { data, error } = await supabase.from(table).select('*').eq('id', id).maybeSingle();
      raise(error, `${ctx}.get`);
      if (!data) throw new Base44CompatError(`${entityName} ${id} not found`, 404);
      return data;
    },

    async create(values) {
      const { data, error } = await supabase.from(table).insert(values).select().single();
      raise(error, `${ctx}.create`);
      return data;
    },

    /** Base44 accepted any array length; Postgres is happier in batches. */
    async bulkCreate(records) {
      if (!Array.isArray(records) || records.length === 0) return [];
      const created = [];
      for (let i = 0; i < records.length; i += 500) {
        const { data, error } = await supabase
          .from(table)
          .insert(records.slice(i, i + 500))
          .select();
        raise(error, `${ctx}.bulkCreate`);
        created.push(...(data ?? []));
      }
      return created;
    },

    async update(id, values) {
      const { data, error } = await supabase
        .from(table)
        .update(values)
        .eq('id', id)
        .select()
        .single();
      raise(error, `${ctx}.update`);
      return data;
    },

    async delete(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      raise(error, `${ctx}.delete`);
      return { success: true };
    },
  };
}

/** Any base44.entities.Anything resolves lazily — no registry to keep in sync. */
const entities = new Proxy(
  {},
  {
    get: (cache, name) => {
      if (typeof name !== 'string') return undefined;
      if (!cache[name]) cache[name] = entityApi(name);
      return cache[name];
    },
  }
);

/* ------------------------------------------------------------------- auth */

const auth = {
  /** Shaped like Base44's user: { id, email, full_name, role, ... }. */
  async me() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw new Base44CompatError(error.message, error.status ?? 401);
    if (!user) throw new Base44CompatError('Not authenticated', 401);

    const { data: profile } = await publicDb
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    return {
      id: user.id,
      email: user.email,
      full_name: profile?.full_name ?? user.user_metadata?.full_name ?? '',
      role: profile?.role ?? 'user',
      created_date: user.created_at,
      ...profile,
    };
  },

  async logout(redirectTo) {
    await supabase.auth.signOut();
    window.location.href = redirectTo || '/login';
  },

  async redirectToLogin(returnTo) {
    const next = encodeURIComponent(returnTo || window.location.href);
    window.location.href = `/login?next=${next}`;
  },

  /** Extra: used by the new login page. */
  signInWithGoogle: (returnTo) =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: returnTo || `${window.location.origin}/` },
    }),

  onChange: (cb) => supabase.auth.onAuthStateChange((_e, session) => cb(session)),
};

/* -------------------------------------------------------------- functions */

const invokeFunction = async (name, body) => {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const detail = await error.context?.text?.().catch(() => '');
    throw new Base44CompatError(
      `Function ${name} failed: ${detail || error.message}`,
      error.context?.status ?? 500
    );
  }
  if (data?.error) throw new Base44CompatError(`Function ${name}: ${data.error}`, 400);
  return data;
};

/**
 * Supports both call styles found in the codebase:
 *   base44.functions.invoke('sendInvoiceEmail', payload)
 *   base44.functions.getCurrentFuel(payload)
 */
const functions = new Proxy(
  { invoke: invokeFunction },
  {
    get: (target, name) =>
      name === 'invoke'
        ? target.invoke
        : typeof name === 'string'
          ? (body) => invokeFunction(name, body)
          : undefined,
  }
);

/* ----------------------------------------------------------- integrations */

const STORAGE_BUCKET = import.meta.env.VITE_SUPABASE_BUCKET || 'uploads';

const Core = {
  /** Returns { file_url } exactly like Base44 did. */
  async UploadFile({ file }) {
    if (!file) throw new Base44CompatError('UploadFile: no file provided', 400);
    const safe = (file.name || 'file')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safe}`;

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    raise(error, 'UploadFile');

    // Private bucket: hand back a signed URL the rest of the app can read.
    const { data, error: signError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 days, renewable
    raise(signError, 'UploadFile.sign');

    return { file_url: data.signedUrl, storage_path: path, filename: file.name, size_bytes: file.size };
  },

  /** Re-sign a stored object. Use instead of persisting decade-long URLs. */
  SignFile: async (storagePath, seconds = 3600) => {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, seconds);
    raise(error, 'SignFile');
    return { file_url: data.signedUrl };
  },

  /** Provider key stays server-side in the `llm` Edge Function. */
  InvokeLLM: (params) => invokeFunction('llm', { action: 'invoke', ...params }),

  ExtractDataFromUploadedFile: (params) =>
    invokeFunction('llm', { action: 'extract', ...params }),
};

/* ------------------------------------------------------------------ shell */

export const base44 = {
  entities,
  auth,
  functions,
  integrations: { Core },
  // Base44 telemetry; harmless no-op so NavigationTracker keeps compiling.
  appLogs: { logUserInApp: async () => {} },
};

export { Base44CompatError };
export default base44;
