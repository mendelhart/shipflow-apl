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

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  // Default-deny: with ALLOWED_ORIGINS unset we echo nothing, so a stray site
  // can't call these functions with a user's credentials.
  const allow = ALLOWED_ORIGINS.length === 0
    ? ''
    : ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
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
          const { error } = await db.from(table).delete().eq('id', id);
          if (error) throw new HttpError(`${entity}.delete: ${error.message}`, 500);
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

  const parts: unknown[] = [{ text: prompt }];
  for (const url of file_urls ?? []) {
    const res = await fetch(url);
    if (!res.ok) throw new HttpError(`Could not read attachment: ${url}`, 400);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    parts.push({
      inlineData: {
        mimeType: res.headers.get('content-type') ?? 'application/pdf',
        data: btoa(binary),
      },
    });
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
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      if (!response_json_schema) return text;
      try {
        return JSON.parse(text);
      } catch {
        throw new HttpError('Model returned malformed JSON.', 502);
      }
    }
    lastError = await res.text().catch(() => `HTTP ${res.status}`);
    if (![429, 500, 503].includes(res.status)) break;
  }
  // Never echo the key back to the client.
  throw new HttpError(`LLM request failed: ${lastError.slice(0, 300)}`, 502);
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
        return { id: user.id, email: user.email, role: profile?.role ?? 'user', ...profile };
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
      if (status >= 500) console.error(error);
      return json(req, { error: (error as Error).message }, status);
    }
  });
}
