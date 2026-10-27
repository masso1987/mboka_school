import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PayItem } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, Select, Table } from '../components/ui';
import { openBlob } from '../lib/api';
import { useSchoolToday, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useMoney } from '../lib/money';
import { useSession } from '../lib/session';

interface RunRow {
  id: string;
  period: string;
  status: RunStatus;
  headcount: number;
  gross: string;
  net: string;
  employerCost: string;
}
type RunStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PAID';
interface PayslipRow {
  id: string;
  number: string;
  staffId: string;
  employee: { staffNumber: string; firstName: string; lastName: string; position: string };
  baseSalary: string;
  gross: string;
  net: string;
  employerCost: string;
  input: { allowances: PayItem[]; items: PayItem[]; unpaidDays: number };
}
interface RunDetail {
  id: string;
  period: string;
  status: RunStatus;
  rulesVersion: number | null;
  rulesLabel: string;
  submittedBy: string | null;
  payslips: PayslipRow[];
  totals: { headcount: number; gross: string; net: string; employerCost: string; lines: { code: string; label: string; base: string; employee: string; employer: string; total: string }[] };
  skipped?: { staffId: string; name: string; reason: string }[];
}

const tone = (s: RunStatus) => (s === 'PAID' ? 'green' : s === 'APPROVED' ? 'blue' : s === 'SUBMITTED' ? 'amber' : 'slate');

/** Monthly payroll (Phase 6): prepare, enter variables, submit, approve (someone else), pay. */
export function PayrollTab() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const { can } = useSession();
  const today = useSchoolToday();
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const manage = can('hr.payroll.manage');
  const runs = useTenantQuery<RunRow[]>(['payroll-runs'], '/payroll/runs');
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<RunDetail['skipped']>();
  const create = useTenantMutation<{ period: string }, RunDetail>('POST', '/payroll/runs', [['payroll-runs']]);
  const [fileError, setFileError] = useState<unknown>(null);

  return (
    <div className="space-y-6">
      {manage && (
        <Card title={t('payroll.prepare')}>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ period }, { onSuccess: (r) => (setSelected(r.id), setSkipped(r.skipped)) });
            }}
          >
            <Field label={t('payroll.period')}>
              <Input type="month" required value={period} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
            <Button type="submit" disabled={create.isPending}>
              {t('payroll.create')}
            </Button>
          </form>
          <div className="mt-3">
            <ErrorMessage error={create.error} />
          </div>
        </Card>
      )}

      <Card title={t('payroll.runs')}>
        {runs.isPending ? (
          <Loading />
        ) : !runs.data?.length ? (
          <Empty>{t('payroll.noRuns')}</Empty>
        ) : (
          <Table head={[t('payroll.period'), t('common.status'), t('payroll.headcount'), t('payroll.gross'), t('payroll.net'), t('payroll.employerCost'), '']}>
            {runs.data.map((r) => (
              <tr key={r.id} className={r.id === selected ? 'bg-accent-50' : undefined}>
                <td className="font-medium">{r.period}</td>
                <td>
                  <Badge tone={tone(r.status)}>{t(`payroll.statuses.${r.status}`)}</Badge>
                </td>
                <td className="tabular">{r.headcount}</td>
                <td className="tabular">{money(r.gross, 'XAF')}</td>
                <td className="tabular">{money(r.net, 'XAF')}</td>
                <td className="tabular">{money(r.employerCost, 'XAF')}</td>
                <td className="text-right">
                  <Button variant="ghost" onClick={() => (setSelected(r.id), setSkipped(undefined))}>
                    {t('payroll.open')}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {selected && <RunPanel id={selected} skipped={skipped} lang={lang} onDeleted={() => setSelected(null)} onError={setFileError} />}
      <ErrorMessage error={fileError} />
    </div>
  );
}

function RunPanel({ id, skipped, lang, onDeleted, onError }: { id: string; skipped?: RunDetail['skipped']; lang: string; onDeleted: () => void; onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const money = useMoney();
  const { can } = useSession();
  const run = useTenantQuery<RunDetail>(['payroll-run', id], `/payroll/runs/${id}`);
  const keys = [['payroll-run', id], ['payroll-runs']];
  const act = useTenantMutation<string, RunDetail>('POST', (action) => `/payroll/runs/${id}/${action}`, keys);
  const sendBack = useTenantMutation<{ reason: string }, RunDetail>('POST', `/payroll/runs/${id}/return`, keys);
  const remove = useTenantMutation<void>('DELETE', `/payroll/runs/${id}`, [['payroll-runs']]);
  const [refreshed, setRefreshed] = useState<RunDetail['skipped']>();
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  if (run.isPending) return <Loading />;
  if (run.isError) return <ErrorMessage error={run.error} />;
  const r = run.data;
  const left = refreshed ?? skipped;
  const manage = can('hr.payroll.manage');
  const approve = can('hr.payroll.approve');

  return (
    <div className="space-y-6">
      <Card
        title={`${t('payroll.runOf')} ${r.period}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => openBlob(`/payroll/runs/${id}/payslips.pdf?lang=${lang}`).catch(onError)}>
              {t('payroll.allPayslips')}
            </Button>
            <Button variant="ghost" onClick={() => openBlob(`/payroll/runs/${id}/declarations.csv`).catch(onError)}>
              {t('payroll.declarationsCsv')}
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={tone(r.status)}>{t(`payroll.statuses.${r.status}`)}</Badge>
          <span className="text-slate-600">{t('payroll.rules', { label: r.rulesLabel, version: r.rulesVersion ?? 0 })}</span>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          {(
            [
              ['headcount', String(r.totals.headcount)],
              ['gross', money(r.totals.gross, 'XAF')],
              ['net', money(r.totals.net, 'XAF')],
              ['employerCost', money(r.totals.employerCost, 'XAF')],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-md border border-slate-200 p-3">
              <dt className="text-xs text-slate-500">{t(`payroll.${k}`)}</dt>
              <dd className="tabular text-lg font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
        {left && left.length > 0 && (
          <div role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">{t('payroll.skippedTitle')}</p>
            <ul className="mt-1 list-disc pl-5">
              {left.map((s) => (
                <li key={s.staffId}>
                  {s.name} — {t(`payroll.skipReasons.${s.reason}`)}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {manage && r.status === 'DRAFT' && (
            <>
              <Button variant="ghost" disabled={act.isPending} onClick={() => act.mutate('refresh', { onSuccess: (d) => setRefreshed(d.skipped) })}>
                {t('payroll.refresh')}
              </Button>
              <Button disabled={act.isPending} onClick={() => act.mutate('submit')}>
                {t('payroll.submit')}
              </Button>
              <Button variant="ghost" disabled={remove.isPending} onClick={() => window.confirm(t('payroll.deleteConfirm')) && remove.mutate(undefined, { onSuccess: onDeleted })}>
                {t('payroll.delete')}
              </Button>
            </>
          )}
          {approve && r.status === 'SUBMITTED' && (
            <>
              <Button disabled={act.isPending} onClick={() => act.mutate('approve')}>
                {t('payroll.approve')}
              </Button>
              <Input className="max-w-xs" placeholder={t('payroll.returnReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="ghost" disabled={sendBack.isPending || reason.trim().length < 3} onClick={() => sendBack.mutate({ reason }, { onSuccess: () => setReason('') })}>
                {t('payroll.sendBack')}
              </Button>
            </>
          )}
          {manage && r.status === 'APPROVED' && (
            <Button disabled={act.isPending} onClick={() => act.mutate('paid')}>
              {t('payroll.markPaid')}
            </Button>
          )}
        </div>
        <div className="mt-3 space-y-2">
          <ErrorMessage error={act.error} />
          <ErrorMessage error={sendBack.error} />
          <ErrorMessage error={remove.error} />
        </div>
      </Card>

      <Card title={t('payroll.payslips')}>
        {r.payslips.length === 0 ? (
          <Empty>{t('payroll.noPayslips')}</Empty>
        ) : (
          <Table head={[t('payroll.employee'), t('payroll.baseSalary'), t('payroll.gross'), t('payroll.net'), t('payroll.employerCost'), '']}>
            {r.payslips.map((p) => (
              <PayslipRowView key={p.id} p={p} runId={id} editable={manage && r.status === 'DRAFT'} editing={editing === p.id} onEdit={setEditing} lang={lang} onError={onError} />
            ))}
          </Table>
        )}
      </Card>

      <Card title={t('payroll.declarations')}>
        <Table head={[t('payroll.item'), t('payroll.base'), t('payroll.employeeShare'), t('payroll.employerShare'), t('payroll.total')]}>
          {r.totals.lines.map((l) => (
            <tr key={l.code}>
              <td>{l.label}</td>
              <td className="tabular">{money(l.base, 'XAF')}</td>
              <td className="tabular">{money(l.employee, 'XAF')}</td>
              <td className="tabular">{money(l.employer, 'XAF')}</td>
              <td className="tabular font-medium">{money(l.total, 'XAF')}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function PayslipRowView({
  p,
  runId,
  editable,
  editing,
  onEdit,
  lang,
  onError,
}: {
  p: PayslipRow;
  runId: string;
  editable: boolean;
  editing: boolean;
  onEdit: (id: string | null) => void;
  lang: string;
  onError: (e: unknown) => void;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  return (
    <>
      <tr>
        <td>
          <p className="font-medium">
            {p.employee.lastName} {p.employee.firstName}
          </p>
          <p className="text-xs text-slate-500">
            {p.number} · {p.employee.position}
            {(p.input.items.length > 0 || p.input.unpaidDays > 0) && ` · ${t('payroll.variablesCount', { count: p.input.items.length + (p.input.unpaidDays > 0 ? 1 : 0) })}`}
          </p>
        </td>
        <td className="tabular">{money(p.baseSalary, 'XAF')}</td>
        <td className="tabular">{money(p.gross, 'XAF')}</td>
        <td className="tabular font-medium">{money(p.net, 'XAF')}</td>
        <td className="tabular">{money(p.employerCost, 'XAF')}</td>
        <td className="whitespace-nowrap text-right">
          {editable && (
            <Button variant="ghost" onClick={() => onEdit(editing ? null : p.id)}>
              {t('payroll.variables')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => openBlob(`/payroll/payslips/${p.id}/pdf?lang=${lang}`).catch(onError)}>
            PDF
          </Button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={6}>
            <VariablesEditor p={p} runId={runId} onDone={() => onEdit(null)} />
          </td>
        </tr>
      )}
    </>
  );
}

const blankItem: PayItem = { label: '', kind: 'EARNING', amount: '', taxable: true, cnps: true };

function VariablesEditor({ p, runId, onDone }: { p: PayslipRow; runId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<PayItem[]>(p.input.items);
  const [unpaidDays, setUnpaidDays] = useState(String(p.input.unpaidDays));
  const save = useTenantMutation<{ items: PayItem[]; unpaidDays: number }>('PUT', `/payroll/payslips/${p.id}`, [['payroll-run', runId], ['payroll-runs']]);
  const set = (i: number, patch: Partial<PayItem>) => setItems(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));

  return (
    <form
      className="space-y-3 rounded-md bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(
          { unpaidDays: Number(unpaidDays) || 0, items: items.filter((i) => i.label.trim() && i.amount).map((i) => ({ ...i, amount: i.amount.replace(/\D/g, ''), cnps: i.taxable })) },
          { onSuccess: onDone },
        );
      }}
    >
      {p.input.allowances.length > 0 && (
        <p className="text-xs text-slate-600">
          {t('payroll.recurring')}: {p.input.allowances.map((a) => `${a.label} ${a.amount}`).join(', ')}
        </p>
      )}
      {items.map((it, i) => (
        <div key={i} className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_auto_auto]">
          <Field label={t('payroll.item')}>
            <Input required value={it.label} onChange={(e) => set(i, { label: e.target.value })} />
          </Field>
          <Field label={t('payroll.kind')}>
            <Select value={it.kind} onChange={(e) => set(i, { kind: e.target.value as PayItem['kind'] })}>
              <option value="EARNING">{t('payroll.kinds.EARNING')}</option>
              <option value="DEDUCTION">{t('payroll.kinds.DEDUCTION')}</option>
            </Select>
          </Field>
          <Field label={t('payroll.amount')}>
            <Input required inputMode="numeric" className="tabular" value={it.amount} onChange={(e) => set(i, { amount: e.target.value })} />
          </Field>
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <input type="checkbox" checked={it.taxable} disabled={it.kind === 'DEDUCTION'} onChange={(e) => set(i, { taxable: e.target.checked })} />
            {t('payroll.taxable')}
          </label>
          <Button variant="ghost" onClick={() => setItems(items.filter((_, k) => k !== i))}>
            ✕
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-3">
        <Button variant="ghost" onClick={() => setItems([...items, { ...blankItem }])}>
          {t('payroll.addItem')}
        </Button>
        <Field label={t('payroll.unpaidDays')}>
          <Input type="number" min={0} max={31} className="w-24" value={unpaidDays} onChange={(e) => setUnpaidDays(e.target.value)} />
        </Field>
        <Button type="submit" disabled={save.isPending}>
          {t('common.save')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
      <ErrorMessage error={save.error} />
    </form>
  );
}

/** An employee's own approved payslips. */
export function MyPayslipsTab() {
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const mine = useTenantQuery<{ id: string; number: string; period: string; status: string; net: string }[]>(['my-payslips'], '/payroll/me/payslips');
  const [error, setError] = useState<unknown>(null);
  return (
    <Card title={t('payroll.myPayslips')}>
      {mine.isPending ? (
        <Loading />
      ) : !mine.data?.length ? (
        <Empty>{t('payroll.noMyPayslips')}</Empty>
      ) : (
        <Table head={[t('payroll.period'), t('payroll.number'), t('payroll.net'), '']}>
          {mine.data.map((p) => (
            <tr key={p.id}>
              <td className="font-medium">{p.period}</td>
              <td>{p.number}</td>
              <td className="tabular">{money(p.net, 'XAF')}</td>
              <td className="text-right">
                <Button variant="ghost" onClick={() => openBlob(`/payroll/me/payslips/${p.id}/pdf?lang=${lang}`).catch(setError)}>
                  PDF
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <ErrorMessage error={error} />
    </Card>
  );
}
