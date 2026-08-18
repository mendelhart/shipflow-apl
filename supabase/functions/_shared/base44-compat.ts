/**
 * Server-side Base44 SDK shim for Supabase Edge Functions.
 *
 * Base44 functions were already Deno (`Deno.serve`), so the port is a one-line
 * import swap per function:
 *
 *   - import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
 *   + import { createClientFromRequest, cors, json } from '../_shared/base44-compat.ts';
 *
 * The surface reproduced here is exactly what the three ShipFlow functions use:
 *   base44.auth.me()
 *   base44.asServiceRole.entities.<Entity>.list() / .filter() / .create() / .update()
 *   base44.asServiceRole.integrations.Core.InvokeLLM({ prompt, response_json_schema, file_urls })
 *
 * Security posture, which is where this differs from the original:
 *   - The caller's JWT is verified before anything runs. The Base44 version
 *     called auth.me() and checked for null; a thrown error there would have
 *     fallen through to the generic 500 handler instead of a clean 401.
 *   - service_role stays in Edge Function env, never in a database row and
 *     never in the browser.
 *   - Provider API keys (Gemini) come from Deno.env, not from a settings table
 *     that any authenticated user could read.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash';

/* ------------------------------------------------------------------ CORS */

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (ALLOWED_ORIGINS.length === 0) {
  // Emitting an empty Access-Control-Allow-Origin blocks every browser
  // caller including the app itself, and surfaces as an inscrutable CORS
  // error rather than a configuration problem. Say so loudly at boot.
  console.error(
    '[cors] ALLOWED_ORIGINS is not set — browser requests will be rejected. ' +
      'Set it to your site origin, e.g. https://shipflow-apl.pages.dev',
  );
}

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  // Only echo an origin we actually trust; otherwise omit the header
  // entirely rather than sending a value the browser will reject anyway.
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json' },
  });

export const preflight = (req: Request) =>
  req.method === 'OPTIONS' ? new Response('ok', { headers: cors(req) }) : null;

/* --------------------------------------------------------------- errors */

export class HttpError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}


/* ----------------------------------------------------- outbound fetch */

/**
 * Server-side fetch of a client-supplied URL is an SSRF primitive: the
 * function runs inside the platform's network, so a caller can aim it at
 * cloud metadata endpoints or internal services and have the response
 * relayed back (transcribed by the model, or mailed as an attachment).
 *
 * Only this project's own Supabase storage is fetchable.
 */
const STORAGE_HOST = (() => {
  try { return new URL(SUPABASE_URL).host; } catch { return ''; }
})();

const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|::1$|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.|0\.)/i;

export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError('Attachment URL is not a valid URL.', 400);
  }
  if (url.protocol !== 'https:') {
    throw new HttpError('Attachment URLs must use https.', 400);
  }
  if (PRIVATE_HOST.test(url.hostname)) {
    throw new HttpError('Attachment URL host is not permitted.', 400);
  }
  if (url.host !== STORAGE_HOST) {
    throw new HttpError(
      'Attachment URLs must point at this project\'s Supabase storage.',
      400,
    );
  }
  return url;
}

const MAX_FETCH_BYTES = 25 * 1024 * 1024; // 25 MB
const FETCH_TIMEOUT_MS = 20_000;

/** Fetch with a timeout, a size cap, and no redirect-following. */
export async function fetchBounded(raw: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const url = assertFetchableUrl(raw);
  const res = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(`Could not read attachment (${res.status}).`, 400);

  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_FETCH_BYTES) {
    throw new HttpError('Attachment is too large.', 413);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_FETCH_BYTES) {
    throw new HttpError('Attachment is too large.', 413);
  }
  return {
    bytes: new Uint8Array(buf),
    contentType: res.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/** Escape text that will be interpolated into an HTML email body. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* -------------------------------------------------------- entity helpers */

const toTable = (entity: string) =>
  entity
    .replace(/(.)([A-Z][a-z]+)/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

function entities(db: SupabaseClient) {
  return new Proxy({} as Record<string, any>, {
    get: (_t, entity: string) => {
      const table = toTable(entity);
      return {
        async list(sort = '-created_date', limit?: number) {
          const desc = sort.startsWith('-');
          let q = db.from(table).select('*')
            .order(desc ? sort.slice(1) : sort, { ascending: !desc });
          if (limit) q = q.limit(limit);
          const { data, error } = await q;
          if (error) throw new HttpError(`${entity}.list: ${error.message}`, 500);
          return data ?? [];
        },
        async filter(where: Record<string, unknown>, sort = '-created_date', limit?: number) {
          let q = db.from(table).select('*');
          for (const [k, v] of Object.entries(where)) {
            q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v as never);
          }
          const desc = sort.startsWith('-');
          q = q.order(desc ? sort.slice(1) : sort, { ascending: !desc });
          if (limit) q = q.limit(limit);
          const { data, error } = await q;
          if (error) throw new HttpError(`${entity}.filter: ${error.message}`, 500);
          return data ?? [];
        },
        async create(values: unknown) {
          const { data, error } = await db.from(table).insert(values as never).select().single();
          if (error) throw new HttpError(`${entity}.create: ${error.message}`, 500);
          return data;
        },
        async update(id: string, values: unknown) {
          const { data, error } = await db.from(table).update(values as never)
            .eq('id', id).select().single();
          if (error) throw new HttpError(`${entity}.update: ${error.message}`, 500);
          return data;
        },
        async delete(id: string) {
          const { data, error } = await db.from(table).delete().eq('id', id).select('id');
          if (error) throw new HttpError(`${entity}.delete: ${error.message}`, 500);
          if (!data || data.length === 0) {
            throw new HttpError(`${entity} ${id} was not deleted.`, 404);
          }
          return { success: true };
        },
      };
    },
  });
}

/* ------------------------------------------------------------------ LLM */

type LLMParams = {
  prompt: string;
  response_json_schema?: Record<string, unknown>;
  file_urls?: string[];
  /** Accepted for call-site compatibility; the provider model is env-driven. */
  model?: string;
};

async function InvokeLLM({ prompt, response_json_schema, file_urls }: LLMParams) {
  if (!GEMINI_API_KEY) {
    throw new HttpError('GEMINI_API_KEY is not set on this function.', 503);
  }

  const urls = file_urls ?? [];
  if (urls.length > 10) {
    throw new HttpError('Too many attachments in one request (max 10).', 400);
  }

  const parts: unknown[] = [{ text: prompt }];
  for (const url of urls) {
    const { bytes, contentType } = await fetchBounded(url);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    parts.push({ inlineData: { mimeType: contentType, data: btoa(binary) } });
  }

  const body: Record<string, unknown> = { contents: [{ parts }] };
  if (response_json_schema) {
    body.generationConfig = {
      responseMimeType: 'application/json',
      responseSchema: response_json_schema,
    };
  }

  // Retry on the provider's transient codes; a single 429 shouldn't fail a
  // user's document run.
  const backoff = [0, 4000, 12000];
  let lastError = 'unknown error';
  for (const wait of backoff) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) {
      const data = await res.json();
      const candidate = data?.candidates?.[0];
      const blocked = data?.promptFeedback?.blockReason;
      if (blocked) {
        throw new HttpError(`The model declined this document (${blocked}).`, 422);
      }
      // Long answers arrive split across several parts; reading only [0]
      // truncates them and then fails JSON.parse for no visible reason.
      const text = (candidate?.content?.parts ?? [])
        .map((p: { text?: string }) => p?.text ?? '')
        .join('');
      if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        throw new HttpError(
          `The model stopped early (${candidate.finishReason}). Try a smaller document.`,
          422,
        );
      }
      if (!response_json_schema) return text;
      try {
        return JSON.parse(text);
      } catch {
        throw new HttpError('Model returned malformed JSON.', 502);
      }
    }
    lastError = await res.text().catch(() => `HTTP ${res.status}`);
    // 502/504 are transient backend errors and worth retrying too.
    if (![429, 500, 502, 503, 504].includes(res.status)) break;
  }
  // Log the provider's message server-side; return a generic one. The raw
  // text carries quota metrics and project identifiers, and doubles as an
  // oracle for probing.
  console.error('[llm] provider failure:', lastError.slice(0, 500));
  throw new HttpError('The AI provider is unavailable right now. Please retry.', 502);
}

/* --------------------------------------------------------------- client */

export async function createClientFromRequest(req: Request) {
  const authHeader = req.headers.get('Authorization') ?? '';
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const asService = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  return {
    auth: {
      /** Throws 401 rather than returning null — callers already branch on it. */
      async me() {
        const { data: { user } } = await asUser.auth.getUser();
        if (!user) throw new HttpError('Unauthorized', 401);
        const { data: profile } = await asService
          .from('profiles').select('*').eq('id', user.id).maybeSingle();
        return {
          ...profile,
          id: user.id,
          email: user.email,
          role: profile?.role || 'user',
          is_active: profile?.is_active ?? false,
        };
      },
    },
    entities: entities(asUser),
    asServiceRole: {
      entities: entities(asService),
      integrations: { Core: { InvokeLLM } },
      db: asService,
    },
  };
}

/** Wrap a handler so thrown HttpErrors become clean responses, not 500s. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    try {
      return await handler(req);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const ref = crypto.randomUUID().slice(0, 8);
      // Log everything, including 4xx — auth and configuration failures were
      // previously invisible server-side.
      console.error(`[${ref}] ${status}`, (error as Error).stack ?? error);
      return json(
        req,
        status >= 500
          ? { error: 'Something went wrong on the server.', ref }
          : { error: (error as Error).message, ref },
        status,
      );
    }
  });
}
