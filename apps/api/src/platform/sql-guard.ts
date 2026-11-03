/**
 * Checks a statement typed in the platform's SQL console before it runs (Phase 7). The database is the real
 * guard — the console runs inside a READ ONLY transaction with a statement timeout — this refuses the obvious
 * mistakes early and with a clear message, and caps the rows a SELECT returns.
 */
export const SQL_ROW_CAP = 500;

const READ_STARTS = new Set(['select', 'with', 'explain', 'show', 'table', 'values']);
const WRAPPABLE = new Set(['select', 'with', 'table', 'values']);
/** Functions that act on the server even inside a read-only transaction, and COPY, which can read or write files. */
const FORBIDDEN = /\b(pg_terminate_backend|pg_cancel_backend|pg_sleep\w*|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink\w*|set_config)\b|^\s*copy\b/i;

export type SqlCheck = { ok: true; sql: string; readOnly: boolean; capped: boolean } | { ok: false; code: 'SQL_EMPTY' | 'SQL_MULTIPLE' | 'SQL_READ_ONLY' | 'SQL_FORBIDDEN' };

export function checkSql(input: string, allowWrite: boolean): SqlCheck {
  const sql = input.trim().replace(/;\s*$/, '').trim();
  if (!sql) return { ok: false, code: 'SQL_EMPTY' };
  // One statement only (a ";" inside a string literal is refused too: rare, and safer than parsing SQL here).
  if (sql.includes(';')) return { ok: false, code: 'SQL_MULTIPLE' };
  if (FORBIDDEN.test(sql)) return { ok: false, code: 'SQL_FORBIDDEN' };
  const first = (/^\(*\s*([a-z]+)/i.exec(sql)?.[1] ?? '').toLowerCase();
  const reading = READ_STARTS.has(first);
  if (!reading && !allowWrite) return { ok: false, code: 'SQL_READ_ONLY' };
  if (reading && WRAPPABLE.has(first)) {
    return { ok: true, sql: `SELECT * FROM (${sql}) AS console_result LIMIT ${SQL_ROW_CAP + 1}`, readOnly: true, capped: true };
  }
  return { ok: true, sql, readOnly: reading, capped: false };
}
