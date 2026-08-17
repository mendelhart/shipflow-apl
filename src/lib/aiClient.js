// Shared AI client — calls the Google Gemini API directly for document
// parsing (Customer Documents, Commercial Invoice, TJX Canada). The Gemini
// API key is stored locally in the browser (Settings → Gemini API).
//
// No Base44 AI credits are consumed. The API key is never logged and never
// appears in any user-facing error message.

const GEMINI_KEY = "b44_gemini_key_v1";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";
const MAX_PAYLOAD_BYTES = 15 * 1024 * 1024; // 15 MB base64 payload cap
const REQUEST_TIMEOUT_MS = 120000; // 120 s per request
const MIN_GAP_MS = 5000; // minimum 5-second gap between requests
const BACKOFF_MS = [5000, 15000, 45000]; // exponential backoff for 429 / 503

export function getGeminiKey() {
  return localStorage.getItem(GEMINI_KEY) || "";
}

export function setGeminiKey(key) {
  localStorage.setItem(GEMINI_KEY, key || "");
}

export function isGeminiConfigured() {
  return Boolean(getGeminiKey());
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Drop-in replacement for base44.integrations.Core.UploadFile — returns a
// base64 data URL (no credits used). The Gemini helper converts it to an
// inlineData part.
export async function uploadFile({ file }) {
  const file_url = await fileToDataUrl(file);
  return { file_url, filename: file.name, size_bytes: file.size };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Pull the "error" field out of a non-2xx response body. Never includes the
// API key — only the remote error text is surfaced.
function parseErrorBody(text) {
  if (!text) return "Unknown error";
  try {
    const data = JSON.parse(text);
    return data?.error?.message || data?.error || data?.message || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

// Convert a base64 data URL into a Gemini inlineData part, stripping the
// `data:<mime>;base64,` prefix so only the raw base64 payload is sent.
function dataUrlToInlinePart(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (!match) {
    throw new Error("Unsupported file format (expected a base64 data URL).");
  }
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

// Serialization queue — parse requests are never fired in parallel and there
// is a minimum 5-second gap between requests.
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

async function geminiRequest({ prompt, response_json_schema, file_urls, onStatus, filename }) {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new Error("Gemini API key not configured. Open Settings → Gemini API to add it.");
  }

  // Build parts: one inlineData part per file, then the text prompt.
  const files = Array.isArray(file_urls) ? file_urls : file_urls ? [file_urls] : [];
  const parts = [];
  let payloadSize = 0;
  for (const f of files) {
    if (typeof f !== "string") continue;
    const part = dataUrlToInlinePart(f);
    payloadSize += part.inlineData.data.length;
    parts.push(part);
  }

  // File-size guard (requirement) — checked before any request is sent.
  if (payloadSize > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `"${filename || "upload"}" is ${formatBytes(payloadSize)} — over the 15 MB limit. Reduce the file size and try again.`
    );
  }
  parts.push({ text: prompt });

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      ...(response_json_schema ? { responseJsonSchema: response_json_schema } : {}),
    },
  };

  let lastErr;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = BACKOFF_MS[attempt - 1];
      onStatus?.({ phase: "retrying", attempt, message: `Rate limited, retrying in ${delay / 1000}s…` });
      await sleep(delay);
    } else {
      onStatus?.({ phase: "sending", message: "Contacting Gemini…" });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey, // pinned header — never in URL/logs/errors
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status === 503) {
        lastErr = new Error(parseErrorBody(await res.text().catch(() => "")));
        continue; // exponential backoff retry (max 3 attempts)
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(parseErrorBody(text));
      }

      const data = await res.json();
      const textParts = (data?.candidates?.[0]?.content?.parts || [])
        .map((p) => p?.text)
        .filter(Boolean);
      const joined = textParts.join("");
      const cleaned = joined
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      return JSON.parse(cleaned);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        throw new Error("Gemini request timed out after 120 seconds.");
      }
      throw err; // network / other errors fail immediately — no retry
    }
  }
  throw lastErr || new Error("Gemini request failed after retries.");
}

// Single shared helper used by every parse path.
export async function invokeLLM(params) {
  const { onStatus, filename, prompt, response_json_schema, file_urls } = params;
  const result = await enqueue(
    () => geminiRequest({ prompt, response_json_schema, file_urls, onStatus, filename }),
    onStatus
  );
  onStatus?.({ phase: "done", provider: "gemini" });
  return result;
}