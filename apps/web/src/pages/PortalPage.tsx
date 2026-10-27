import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Badge, Card, Empty, ErrorMessage, Loading, PageHeader, Table } from '../components/ui';
import { openBlob } from '../lib/api';
import { useDateFormat, useTenantQuery } from '../lib/hooks';
import { useMoney } from '../lib/money';

interface ChildSummary {
  student: { id: string; matricule: string; firstName: string; lastName: string; dateOfBirth: string };
  class: { id: string; name: string } | null;
  attendance: { since: string; counts: Record<string, number>; recent: { date: string; status: string; arrivalTime: string | null }[] };
  reportCards: { id: string; scope: string; academicYear: string; average: string | null; rank: number | null; ranked: number; mention: { labelFr: string; labelEn: string } | null; publishedAt: string | null }[];
  timetable: { weekday: number; startTime: string; endTime: string; subject: string; teacher: string | null; room: string | null }[];
  fees: { balances: { currency: string; total: string; paid: string; balance: string }[]; payments: { id: string; receivedOn: string; amount: string; currency: string; receipt: string | null; status: string }[] };
}

/** Parent / student portal (COM-011): children list and one child's summary. */
export function PortalPage() {
  const { t } = useTranslation();
  const children = useTenantQuery<{ id: string; firstName: string; lastName: string; matricule: string; class: { name: string } | null }[]>(['portal-children'], '/portal/children');
  return (
    <div className="space-y-6">
      <PageHeader title={t('portal.children')} />
      {children.isPending ? (
        <Loading />
      ) : children.isError ? (
        <ErrorMessage error={children.error} />
      ) : children.data.length === 0 ? (
        <Card>
          <Empty>{t('portal.noChildren')}</Empty>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {children.data.map((c) => (
            <li key={c.id}>
              <Link to={`/portal/children/${c.id}`} className="block rounded-lg border border-slate-200 bg-white p-5 hover:border-accent-500">
                <span className="block text-lg font-medium">
                  {c.firstName} {c.lastName}
                </span>
                <span className="text-sm text-slate-600">
                  {c.class?.name ?? '—'} · {c.matricule}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PortalChildPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const money = useMoney();
  const fmt = useDateFormat();
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';
  const [pdfError, setPdfError] = useState<unknown>(null);
  const s = useTenantQuery<ChildSummary>(['portal-child', id], `/portal/children/${id}`);
  if (s.isPending) return <Loading />;
  if (s.isError) return <ErrorMessage error={s.error} />;
  const d = s.data;
  const days = [1, 2, 3, 4, 5, 6].filter((w) => d.timetable.some((e) => e.weekday === w));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${d.student.firstName} ${d.student.lastName}`}
        actions={<Link to="/portal" className="text-sm text-accent-700 hover:underline">← {t('portal.children')}</Link>}
      />
      <p className="-mt-4 text-sm text-slate-600">
        {d.class?.name ?? '—'} · {d.student.matricule}
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('portal.fees')}>
          {d.fees.balances.length === 0 ? (
            <Empty>{t('fees.noInvoices')}</Empty>
          ) : (
            d.fees.balances.map((b) => (
              <div key={b.currency} className="mb-3">
                <p className="text-xs text-slate-500">{t('fees.balanceDue')}</p>
                <p className="tabular text-2xl font-semibold">{money(b.balance, b.currency)}</p>
                <p className="tabular text-xs text-slate-500">{t('fees.paidOf', { paid: money(b.paid, b.currency), total: money(b.total, b.currency) })}</p>
              </div>
            ))
          )}
          {d.fees.payments.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {d.fees.payments.map((p) => (
                <li key={p.id} className="flex justify-between py-1.5">
                  <span className="tabular">
                    {fmt(p.receivedOn)} · {p.receipt ?? '—'}
                  </span>
                  <span className={`tabular ${p.status === 'REVERSED' ? 'text-slate-400 line-through' : ''}`}>{money(p.amount, p.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('portal.attendance', { date: fmt(d.attendance.since) })}>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            {(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const).map((k) => (
              <span key={k} className="rounded-full bg-slate-100 px-3 py-1">
                {t(`attendance.statuses.${k}`)} : <span className="tabular font-medium">{d.attendance.counts[k] ?? 0}</span>
              </span>
            ))}
          </div>
          {d.attendance.recent.length === 0 ? (
            <p className="text-sm text-slate-500">{t('portal.noAbsence')}</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {d.attendance.recent.map((r, i) => (
                <li key={i} className="flex justify-between py-1.5">
                  <span className="tabular">{fmt(r.date)}</span>
                  <Badge tone={r.status === 'ABSENT' ? 'red' : r.status === 'LATE' ? 'amber' : 'slate'}>
                    {t(`attendance.statuses.${r.status}`)}
                    {r.arrivalTime && ` ${r.arrivalTime}`}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t('portal.reportCards')}>
        <ErrorMessage error={pdfError} />
        {d.reportCards.length === 0 ? (
          <Empty>{t('portal.noReportCards')}</Empty>
        ) : (
          <Table head={[t('reportCards.scope'), t('reportCards.average'), t('reportCards.rank'), t('reportCards.mention'), '']}>
            {d.reportCards.map((c) => (
              <tr key={c.id}>
                <td>
                  {c.scope} <span className="text-xs text-slate-500">{c.academicYear}</span>
                </td>
                <td className="tabular font-semibold">{c.average ?? '—'}</td>
                <td className="tabular">{c.rank ? `${c.rank} / ${c.ranked}` : '—'}</td>
                <td>{c.mention ? (lang === 'en' ? c.mention.labelEn : c.mention.labelFr) : '—'}</td>
                <td className="text-right">
                  <button type="button" className="text-sm text-accent-700 hover:underline" onClick={() => openBlob(`/portal/children/${d.student.id}/report-cards/${c.id}/pdf?lang=${lang}`).catch(setPdfError)}>
                    PDF
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {days.length > 0 && (
        <Card title={t('portal.timetable')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {days.map((w) => (
              <div key={w} className="rounded-md border border-slate-200">
                <h3 className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-sm font-semibold">{t(`teaching.weekdays.${w}`)}</h3>
                <ul className="divide-y divide-slate-100 text-sm">
                  {d.timetable
                    .filter((e) => e.weekday === w)
                    .map((e, i) => (
                      <li key={i} className="px-3 py-2">
                        <span className="tabular text-xs text-slate-500">
                          {e.startTime}–{e.endTime}
                        </span>
                        <span className="block font-medium">{e.subject}</span>
                        <span className="text-xs text-slate-600">{[e.teacher, e.room].filter(Boolean).join(' · ')}</span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
