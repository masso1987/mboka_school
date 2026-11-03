import { checkSql, SQL_ROW_CAP } from './sql-guard';

describe('SQL console guard', () => {
  it('wraps reads to cap their rows', () => {
    expect(checkSql('  select id from tenants;  ', false)).toEqual({ ok: true, sql: `SELECT * FROM (select id from tenants) AS console_result LIMIT ${SQL_ROW_CAP + 1}`, readOnly: true, capped: true });
    expect(checkSql('WITH t AS (SELECT 1) SELECT * FROM t', false)).toMatchObject({ ok: true, capped: true });
    expect(checkSql('EXPLAIN SELECT 1', false)).toEqual({ ok: true, sql: 'EXPLAIN SELECT 1', readOnly: true, capped: false });
    expect(checkSql('show server_version', false)).toMatchObject({ ok: true, capped: false });
  });

  it('refuses several statements, writes in read-only mode and server-side functions', () => {
    expect(checkSql('', false)).toEqual({ ok: false, code: 'SQL_EMPTY' });
    expect(checkSql('select 1; drop table users', false)).toEqual({ ok: false, code: 'SQL_MULTIPLE' });
    expect(checkSql('delete from sessions', false)).toEqual({ ok: false, code: 'SQL_READ_ONLY' });
    expect(checkSql('select pg_terminate_backend(42)', false)).toEqual({ ok: false, code: 'SQL_FORBIDDEN' });
    expect(checkSql('SELECT PG_SLEEP(30)', true)).toEqual({ ok: false, code: 'SQL_FORBIDDEN' });
    expect(checkSql("select set_config('app.tenant_id', 'x', false)", false)).toEqual({ ok: false, code: 'SQL_FORBIDDEN' });
    expect(checkSql('copy users to stdout', true)).toEqual({ ok: false, code: 'SQL_FORBIDDEN' });
  });

  it('lets writes through only when write mode is on', () => {
    expect(checkSql("update users set full_name = 'x' where id = '…'", true)).toMatchObject({ ok: true, readOnly: false, capped: false });
  });
});
