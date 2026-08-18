/**
 * Pure, dependency-free core of the Base44 compatibility adapter.
 *
 * Extracted so it can be imported and tested normally. The previous test
 * harness read base44Client.js as TEXT, regex-replaced identifiers and eval'd
 * the result with `new Function` — which runs sloppy-mode (the real module is
 * strict ESM), breaks whenever a comment banner is reformatted, and cannot
 * reach anything that touches the Supabase client. It could pass while the
 * shipped module threw.
 *
 * Nothing here imports Supabase; every function takes a query builder.
 */



/** Preserve Base44's error shape: message + numeric status. */
export class Base44CompatError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'Base44CompatError';
    this.status = status ?? 500;
    this.details = details;
  }
}

/** Turn a PostgREST error into a thrown Base44CompatError with a real status. */
export const raise = (error, context) => {
  if (!error) return;
  const status =
    Number(error.status) ||
    ({ PGRST301: 401, '42501': 403, '23505': 409, '23503': 409 }[error.code] ?? 500);
  throw new Base44CompatError(`${context}: ${error.message}`, status, error);
};

export const PAGE_SIZE = 1000; // Supabase hard cap per response


/** Base44 entity name (PurchaseOrder) -> Postgres table (purchase_order). */
export const toTable = (entity) =>
  entity
    .replace(/(.)([A-Z][a-z]+)/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

/** Preserve Base44's error shape: message + numeric status. */


/**
 * Base44 sort strings: 'field' ascending, '-field' descending.
 * Base44's implicit default was newest-first.
 */
export const applySort = (query, sort) => {
  const spec = sort || '-created_date';
  const fields = [];
  for (const raw of String(spec).split(',')) {
    const field = raw.trim();
    if (!field) continue;
    const desc = field.startsWith('-');
    const name = desc ? field.slice(1) : field;
    fields.push(name);
    query = query.order(name, { ascending: !desc, nullsFirst: false });
  }
  // Offset paging across separate requests needs a TOTAL order. Sorting only
  // by created_date leaves ties unordered, and Postgres may resolve them
  // differently per page — so a row can appear on two pages or on none.
  // bulkCreate makes ties routine: every row in a batch shares now().
  if (!fields.includes('id')) {
    query = query.order('id', { ascending: true });
  }
  return query;
};

/**
 * Base44's document store accepted "" for an unset value of any type.
 * Postgres rejects it for date, numeric, boolean and jsonb columns, so a
 * form that leaves a date blank fails the ENTIRE row with a 22007. Blank
 * always meant "no value", so map it to null on the way in.
 */
export const nullifyBlanks = (values) => {
  if (Array.isArray(values)) return values.map(nullifyBlanks);
  if (values === null || typeof values !== 'object') return values;
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = v === '' ? null : v;
  }
  return out;
};

/** Mongo-ish operators Base44 accepted in filter(). */
export const applyWhere = (query, where) => {
  for (const [field, condition] of Object.entries(where || {})) {
    if (condition === null) {
      query = query.is(field, null);
    } else if (Array.isArray(condition)) {
      query = query.in(field, condition);
    } else if (condition instanceof Date) {
      query = query.eq(field, condition.toISOString());
    } else if (typeof condition === 'object') {
      for (const [op, value] of Object.entries(condition)) {
        switch (op) {
          case '$in':  query = query.in(field, value); break;
          // Mongo's $ne/$nin MATCH rows where the field is null; SQL's
          // three-valued logic excludes them. Emit an explicit or-is-null so
          // filter({status:{$ne:'cancelled'}}) doesn't silently drop every
          // row with no status set.
          case '$nin':
            query = query.or(
              `${field}.not.in.(${value.map(quoteForIn).join(',')}),${field}.is.null`
            );
            break;
          case '$ne':
            query = query.or(`${field}.neq.${escapeForOr(value)},${field}.is.null`);
            break;
          case '$gt':  query = query.gt(field, value); break;
          case '$gte': query = query.gte(field, value); break;
          case '$lt':  query = query.lt(field, value); break;
          case '$lte': query = query.lte(field, value); break;
          // Escape LIKE metacharacters, otherwise searching for "50%"
          // matches every row.
          case '$contains':
            query = query.ilike(field, `%${escapeLike(String(value))}%`);
            break;
          case '$exists':
            query = value ? query.not(field, 'is', null) : query.is(field, null);
            break;
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

/** PostgREST in-list values need quoting if they contain a delimiter. */
export function quoteForIn(v) {
  const s = String(v);
  return /[,."'()\s]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}
export function escapeForOr(v) {
  const s = String(v);
  return /[,.()]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}
export function escapeLike(s) {
  return s.replace(/([%_\\])/g, '\\$1');
}


/** Fetch every matching row, not just the first page. */
export async function fetchAll(build, limit, context) {
  if (limit === 0) return [];
  if (limit != null && limit <= PAGE_SIZE) {
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
    if (!data || data.length < PAGE_SIZE || (limit != null && rows.length >= limit)) break;
  }
  return limit != null ? rows.slice(0, limit) : rows;
}

