// Shared AI client.
//
// PREVIOUSLY: this called the Google Gemini API directly from the browser with
// an API key kept in localStorage. That key was readable by any script on the
// page and by anyone with access to the machine, it was per-user so it could
// not be rotated centrally, and it was billed to the company with no per-user
// limit. Meanwhile the `llm` Edge Function written to solve exactly this had
// zero call sites.
//
// NOW: every request goes through the `llm` Edge Function, which holds the key
// in server env, verifies the caller's session, and rate-limits per user.
//
// The exported API is unchanged, so the nine call sites did not move.

import { base44 } from "@/api/base44Client";

const LEGACY_GEMINI_KEY = "b44_gemini_key_v1";
const MIN_GAP_MS = 1500; // politeness gap; the server owns real rate limiting

// One-time hygiene: purge any key this browser still holds from the old build.
try {
  if (localStorage.getItem(LEGACY_GEMINI_KEY)) {
    localStorage.removeItem(LEGACY_GEMINI_KEY);
    // eslint-disable-next-line no-console
    console.info(
      "[aiClient] Removed the locally stored Gemini key. AI requests now run " +
        "server-side. If this key was ever in use, rotate it."
    );
  }
} catch {
  // localStorage can be unavailable (private mode, blocked cookies). Non-fatal.
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Retained for API compatibility with the Settings page.
 * The key no longer lives in the browser, so these are inert.
 */
export function getGeminiKey() {
  return "";
}

export function setGeminiKey() {
  // Intentionally a no-op. The key is an Edge Function secret:
  //   supabase secrets set GEMINI_API_KEY=...
}

/**
 * Whether AI features should be offered. The browser cannot see the server's
 * key, so this is optimistic: if the key is missing the Edge Function returns
 * a clear 503 and the error surfaces normally.
 */
export function isGeminiConfigured() {
  return true;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Real upload to Supabase Storage.
 *
 * This used to return a base64 data URL — a fake upload. Two consequences:
 * the TJX invoice archive stored an empty `pdf_url` for every record (the only
 * audit trail in the app held no documents), and whole PDFs sat in React state
 * as base64 strings for the life of the session.
 *
 * Returns { file_url, storage_path, filename, size_bytes }; `file_url` is a
 * signed https URL on the project's own storage host, which is the only thing
 * the Edge Functions will fetch.
 */
export async function uploadFile({ file }) {
  return base44.integrations.Core.UploadFile({ file });
}

// Serialisation queue — requests are not fired in parallel, with a short gap
// between them. The Edge Function enforces the real per-user limit.
let queueTail = Promise.resolve();
let lastRequestTime = 0;

function enqueue(task, onStatus) {
  const run = queueTail.then(async () => {
    const wait = MIN_GAP_MS - (Date.now() - lastRequestTime);
    if (wait > 0) {
      onStatus?.({ phase: "queued", message: "Waiting in queue…" });
      await sleep(wait);
    }
    const result = await task();
    lastRequestTime = Date.now();
    return result;
  });
  queueTail = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * invokeLLM({ prompt, response_json_schema, file_urls, onStatus, filename })
 *
 * `file_urls` accepts what uploadFile returns (signed storage URLs). Retries
 * and backoff are handled server-side; doing it here as well produced up to
 * twelve upstream calls for one user action during a provider outage.
 */
export async function invokeLLM(params) {
  const { prompt, response_json_schema, file_urls, onStatus } = params || {};

  const files = Array.isArray(file_urls) ? file_urls : file_urls ? [file_urls] : [];

  // A data: URL here means something still calls the old fake uploadFile.
  // Fail with a message that says what to fix rather than a server 400.
  const inlineData = files.find((f) => typeof f === "string" && f.startsWith("data:"));
  if (inlineData) {
    throw new Error(
      "This document was not uploaded to storage. Re-upload it and try again."
    );
  }

  return enqueue(async () => {
    onStatus?.({ phase: "sending", message: "Analysing document…" });
    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema,
      file_urls: files,
    });
    onStatus?.({ phase: "done", message: "Done" });

    // The function returns parsed JSON when a schema was supplied, and raw
    // text otherwise. Some prompts wrap JSON in a ``` fence.
    if (typeof result !== "string") return result;
    const cleaned = result
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      return cleaned;
    }
  }, onStatus);
}
