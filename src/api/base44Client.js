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
 *  - list()/filter() with no limit fetch EVERY row by paging. Supabase caps a
 *    single response at 1000 rows; Base44 did not. Without this loop any table
 *    past 1000 records silently truncates — the kind of bug that surfaces
 *    months later as "some old orders disappeared".
 *
 *    It is OFFSET paging (.range), not keyset. That is only safe because
 *    applySort appends `id` as a tiebreaker, giving a total order; without it,
 *    rows sharing a created_date could appear on two pages or on none.
 *
 *  - Errors are thrown, never swallowed, and carry .status so the existing
 *    `error.status === 401` checks in AuthContext keep working.
 *
 *  - No API keys live in this file or anywhere else in the browser bundle.
 *    LLM and email calls go through Edge Functions that hold the secrets.
 */

import { createClient } from '@supabase/supabase-js';
import {
  Base44CompatError,
  raise,
  toTable,
  applySort,
  applyWhere,
  nullifyBlanks,
  fetchAll,
} from '@/api/adapterCore';

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
      const { data, error } = await supabase
        .from(table)
        .insert(nullifyBlanks(values))
        .select()
        .single();
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
          .insert(nullifyBlanks(records.slice(i, i + 500)))
          .select();
        raise(error, `${ctx}.bulkCreate`);
        created.push(...(data ?? []));
      }
      return created;
    },

    async update(id, values) {
      const { data, error } = await supabase
        .from(table)
        .update(nullifyBlanks(values))
        .eq('id', id)
        .select()
        .single();
      raise(error, `${ctx}.update`);
      return data;
    },

    async delete(id) {
      // Without .select() a delete that matched nothing — because RLS
      // filtered the row out, or it was already gone — returns no error,
      // and the UI happily confirms a deletion that never happened.
      const { data, error } = await supabase
        .from(table)
        .delete()
        .eq('id', id)
        .select('id');
      raise(error, `${ctx}.delete`);
      if (!data || data.length === 0) {
        throw new Base44CompatError(
          `${entityName} ${id} was not deleted — it no longer exists, or you do not have permission.`,
          404
        );
      }
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

    // Spread the profile FIRST: the computed fields below are fallbacks and
    // must not be clobbered by null columns on the profile row.
    return {
      ...profile,
      id: user.id,
      email: user.email,
      full_name: profile?.full_name || user.user_metadata?.full_name || '',
      role: profile?.role || 'user',
      is_active: profile?.is_active ?? false,
      created_date: user.created_at,
    };
  },

  /**
   * The profile directory, for the admin Users screen.
   *
   * Not exposed through `entities` because `profiles` lives in the `public`
   * schema (auth needs it there) while entities may be namespaced elsewhere,
   * and because toTable('Profile') would look for a table called `profile`.
   * RLS returns only your own row unless you are an admin, so listing is safe
   * to call from anywhere.
   */
  async listProfiles(sort = 'email') {
    const { data, error } = await publicDb.from('profiles').select('*').order(sort, { ascending: true });
    raise(error, 'profiles.list');
    return data ?? [];
  },

  /**
   * Column-level rules are enforced in the database, not here: the
   * guard_profile_privileges trigger rejects a non-admin touching role or
   * is_active, and guard_last_admin refuses to strip the final admin.
   */
  async updateProfile(id, patch) {
    const { data, error } = await publicDb
      .from('profiles')
      .update(nullifyBlanks(patch))
      .eq('id', id)
      .select('id');
    raise(error, 'profiles.update');
    if (!data || data.length === 0) {
      throw new Base44CompatError('That user no longer exists, or you do not have permission to change them.', 404);
    }
    return data[0];
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
  // A partial multi-batch send answers 207 with { error, emails_sent,
  // failed_batch, resume_from_batch } — deliberately, so the caller can say
  // which invoices already went out and not send them twice. Throwing on any
  // response carrying `.error` destroyed all of that: the "do not resend"
  // branch in EmailAplDialog was unreachable, the delivered batches were never
  // archived, and a retry re-sent invoices customers already had.
  if (data?.error && data?.emails_sent === undefined) {
    throw new Base44CompatError(`Function ${name}: ${data.error}`, 400);
  }
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

  /**
   * Turn whatever is stored in the database into a URL that works right now.
   *
   * UploadFile hands back a signed URL that expires in 7 days, and callers
   * persisted it. SignFile existed to re-sign and had ZERO call sites, so on
   * day 8 every "Open" link in the invoice archive and the company logo on
   * every generated document started returning an error — indistinguishable
   * from the file having been deleted.
   *
   * The object path is recoverable from the stored URL, so this also repairs
   * rows written before the fix. Anything that is not one of our signed URLs
   * (an external image, a data: URL) is returned untouched.
   */
  async ResolveFileUrl(stored, seconds = 60 * 60) {
    const value = String(stored || '');
    if (!value) return '';
    if (value.startsWith('data:') || value.startsWith('blob:')) return value;

    let path = value;
    if (/^https?:\/\//i.test(value)) {
      const m = value.match(/\/storage\/v1\/object\/(?:sign|public)\/([^/]+)\/([^?]+)/);
      if (!m) return value;                    // someone else's URL
      if (m[1] !== STORAGE_BUCKET) return value;
      path = decodeURIComponent(m[2]);
    }

    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, seconds);
    if (error) return value;                   // fall back rather than break the page
    return data.signedUrl;
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
