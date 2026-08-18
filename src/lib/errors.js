/**
 * Single error classifier for the whole app.
 *
 * There were six near-identical copies of this, all reading `err.response.status`
 * and `err.response.data.error` — the axios shape of the retired Base44 SDK.
 * The Supabase adapter throws Base44CompatError with `.status` and `.details`
 * and no `.response` at all, so every branch in every copy was dead code: users
 * fell through to raw Postgres text, and the one message that did fire told
 * them to check their billing in a product the company no longer uses.
 */

/** Postgres/PostgREST codes worth translating into something a human can act on. */
const PG_MESSAGES = {
  '23505': 'That already exists — the value has to be unique.',
  '23503': 'Something this record depends on is missing or still in use.',
  '23514': "That value isn't allowed for this field.",
  '22007': "A date field couldn't be read. Check the date format.",
  '22P02': 'A number field contains something that is not a number.',
  '42501': "You don't have permission to do that.",
  PGRST204: 'The app tried to save a field that does not exist in the database. This is a bug — please report it.',
  PGRST301: 'Your session has expired. Sign in again.',
};

export function errorStatus(err) {
  return err?.status ?? err?.details?.status ?? null;
}

export function isAuthError(err) {
  const status = errorStatus(err);
  return status === 401 || status === 403 || err?.details?.code === 'PGRST301';
}

export function isNetworkError(err) {
  if (errorStatus(err)) return false;
  const msg = String(err?.message ?? '').toLowerCase();
  return (
    err?.name === 'TypeError' ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed')
  );
}

/**
 * Kept because six call sites import it. The Base44 credit system is gone, so
 * this now only reports a genuine 402 from a payment-backed provider.
 */
export function isOutOfCredits(err) {
  return errorStatus(err) === 402;
}

export function friendlyErrorMessage(err, fallback = 'Something went wrong.') {
  if (!err) return fallback;

  if (isNetworkError(err)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  if (isAuthError(err)) {
    return 'Your session has expired or you do not have access. Sign in again.';
  }

  const code = err?.details?.code;
  if (code && PG_MESSAGES[code]) return PG_MESSAGES[code];

  const status = errorStatus(err);
  if (status === 429) return 'Too many requests in a row. Wait a moment and try again.';
  if (status === 413) return 'That file is too large to send.';
  if (status === 503) {
    return 'A required service is not configured or is temporarily unavailable.';
  }
  if (status >= 500) {
    const ref = err?.details?.ref ? ` (ref ${err.details.ref})` : '';
    return `The server had a problem handling that${ref}. Please try again.`;
  }

  return err?.message || fallback;
}
