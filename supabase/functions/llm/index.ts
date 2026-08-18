/**
 * The `llm` Edge Function backs base44.integrations.Core.InvokeLLM and
 * .ExtractDataFromUploadedFile from the browser.
 *
 * Why it exists: the Base44 app called Gemini directly from the browser with a
 * key kept in localStorage (src/lib/aiClient.js). That key was readable by any
 * script on the page and by anyone with the user's device, and it could not be
 * rotated centrally. Moving the call server-side keeps the key in Edge Function
 * env, adds a per-user rate limit, and lets the model be swapped without a
 * frontend deploy.
 */

import { createClientFromRequest, json, serve, HttpError } from '../_shared/base44-compat.ts';

/**
 * Cheap in-memory throttle. Two honest caveats:
 *  - It is per-isolate, so the real ceiling is MAX_PER_WINDOW x live isolates.
 *    It blunts a runaway client loop; it is not a billing control. For a hard
 *    cap, count in Postgres.
 *  - The map is swept so a user who calls once doesn't leave an entry pinned
 *    for the isolate's lifetime.
 */
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const MAX_TRACKED_USERS = 5_000;
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS && hits.size < MAX_TRACKED_USERS) return;
  lastSweep = now;
  for (const [key, times] of hits) {
    if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
  }
}

function rateLimit(userId: string) {
  const now = Date.now();
  sweep(now);
  const recent = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    throw new HttpError('Too many AI requests — wait a minute and try again.', 429);
  }
  recent.push(now);
  hits.set(userId, recent);
}

serve(async (req) => {
  if (req.method !== 'POST') throw new HttpError('Method not allowed', 405);

  const base44 = await createClientFromRequest(req);
  const user = await base44.auth.me(); // throws 401 if the JWT is missing/expired
  rateLimit(user.id);

  const { action = 'invoke', prompt, response_json_schema, file_urls, file_url } =
    await req.json();

  if (!prompt && action === 'invoke') throw new HttpError('prompt is required', 400);

  const urls = file_urls ?? (file_url ? [file_url] : []);

  const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt:
      action === 'extract'
        ? prompt ??
          'Extract the structured data described by the response schema from the attached document. Return only fields you can read; leave anything uncertain null.'
        : prompt,
    response_json_schema,
    file_urls: urls,
  });

  // Base44's ExtractDataFromUploadedFile resolved to { status, output }.
  return action === 'extract'
    ? json(req, { status: 'success', output: result })
    : json(req, result);
});
