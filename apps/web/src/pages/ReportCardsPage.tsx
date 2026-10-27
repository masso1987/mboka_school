import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PROMOTION_OUTCOMES, type GradingRules } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table, Tabs } from '../components/ui';
import { ApiRequestError, openBlob } from '../lib/api';
import type { CardDetail, CardRow, Period } from '../lib/grades-types';
import { useCurrentYear, useDateFormat, useLabel, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { Bilingual, SchoolClass } from '../lib/types';

type Tab = 'cards' | 'promotions' | 'statistics' | 'rules';
const cardTone = (s: string) => (s === 'PUBLISHED' ? 'green' : s === 'DRAFT' ? 'amber' : 'slate');

export function ReportCardsPage() {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const { current } = useCurrentYear();
  const classes = useTenantQuery<SchoolClass[]>(['classes', current?.id], current ? `/classes?academicYearId=${current.id}` : null);
  const periods = useTenantQuery<Period[]>(['periods', current?.id], current ? `/academic-years/${current.id}/periods` : null);
  const [tab, setTab] = useState<Tab>('cards');
  const [classId, setClassId] = useState('');
  const [scope, setScope] = useState('');
  const activeClass = classId || classes.data?.[0]?.id || '';
  const scopes = [...(periods.data ?? []).map((p) => ({ id: p.id, name: p.name })), { id: 'ANNUAL', name: t('reportCards.annual') }];
  const activeScope = scope || scopes[0]?.id || '';
  const lang = i18n.resolvedLanguage === 'en' ? 'en' : 'fr';

  const items: { key: Tab; label: string }[] = [
    { key: 'cards', label: t('reportCards.tabs.cards') },
    { key: 'promotions', label: t('reportCards.tabs.promotions') },
    { key: 'statistics', label: t('reportCards.tabs.statistics') },
  ];
  if (can('academics.structure.manage')) items.push({ key: 'rules', label: t('reportCards.tabs.rules') });

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.reportCards')} />
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab !== 'rules' && (
        <div className="flex flex-wrap items-end gap-4">
          <Field label={t('students.class')} className="min-w-48">
            <Select value={activeClass} onChange={(e) => setClassId(e.target.value)}>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {tab !== 'promotions' && (
            <Field label={t('reportCards.scope')} className="min-w-48">
              <Select value={activeScope} onChange={(e) => setScope(e.target.value)}>
                {scopes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}
      {tab === 'cards' && activeClass && activeScope && <CardsTab classId={activeClass} scope={activeScope} lang={lang} />}
      {tab === 'promotions' && activeClass && <PromotionsTab classId={activeClass} />}
      {tab === 'statistics' && activeClass && activeScope && <StatisticsTab classId={activeClass} scope={activeScope} />}
      {tab === 'rules' && <RulesTab />}
    </div>
  );
}

function CardsTab({ classId, scope, lang }: { classId: string; scope: string; lang: 'fr' | 'en' }) {
  const { t, i18n } = useTranslation();
  const { can } = useSession();
  const cards = useTenantQuery<CardRow[]>(['report-cards', classId, scope], `/report-cards?classId=${classId}&scope=${scope}`);
  const generate = useTenantMutation<object, { created: number; unchanged: number; rulesVersion: number }>('POST', '/report-cards/generate', [['report-cards', classId, scope]]);
  const publish = useTenantMutation<object, { published: number }>('POST', '/report-cards/publish', [['report-cards', classId, scope]]);
  const [open, setOpen] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<unknown>(null);
  const pending =
    generate.error instanceof ApiRequestError && generate.error.code === 'GRADES_NOT_APPROVED'
      ? (generate.error.details as { pending: { subject: string; status: string }[] }).pending
      : null;
  const drafts = cards.data?.filter((c) => c.status === 'DRAFT').length ?? 0;

  if (open) return <CardView id={open} lang={lang} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => generate.mutate({ classId, scope })} disabled={generate.isPending}>
          {generate.isPending ? t('common.loading') : t('reportCards.generate')}
        </Button>
        {can('reportcards.publish') && drafts > 0 && (
          <Button variant="secondary" onClick={() => window.confirm(t('reportCards.publishConfirm', { count: drafts })) && publish.mutate({ classId, scope })}>
            {t('reportCards.publish', { count: drafts })}
          </Button>
        )}
        {(cards.data?.length ?? 0) > 0 && (
          <Button variant="ghost" onClick={() => openBlob(`/report-cards/class.pdf?classId=${classId}&scope=${scope}&lang=${lang}`).catch(setPdfError)}>
            {t('reportCards.pdfAll')}
          </Button>
        )}
      </div>
      {generate.data && (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-success-600">
          {t('reportCards.generated', { created: generate.data.created, unchanged: generate.data.unchanged, version: generate.data.rulesVersion })}
        </p>
      )}
      {publish.data && <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-success-600">{t('reportCards.published', { count: publish.data.published })}</p>}
      {pending ? (
        <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{t('errors.GRADES_NOT_APPROVED')}</p>
          <ul className="mt-1 list-inside list-disc">
            {pending.map((p, i) => (
              <li key={i}>
                {p.subject} — {t(`grades.statuses.${p.status}`)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ErrorMessage error={generate.error ?? publish.error ?? pdfError} />
      )}
      <Card>
        {cards.isPending ? (
          <Loading />
        ) : cards.data?.length === 0 ? (
          <Empty>{t('reportCards.empty')}</Empty>
        ) : (
          <Table head={[t('reportCards.rank'), t('students.name'), t('reportCards.average'), t('reportCards.mention'), t('common.status'), '']}>
            {cards.data?.map((c) => (
              <tr key={c.id}>
                <td className="tabular">{c.rank ? `${c.rank} / ${c.ranked}` : '—'}</td>
                <td className="font-medium">
                  {c.student.lastName} {c.student.firstName}
                </td>
                <td className="tabular font-semibold">{c.average ?? '—'}</td>
                <td>{c.mention ? (i18n.resolvedLanguage === 'en' ? c.mention.labelEn : c.mention.labelFr) : '—'}</td>
                <td>
                  <Badge tone={cardTone(c.status)}>{t(`reportCards.statuses.${c.status}`)} · v{c.version}</Badge>
                </td>
                <td className="text-right">
                  <Button variant="ghost" onClick={() => setOpen(c.id)}>
                    {t('grades.open')}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function CardView({ id, lang, onBack }: { id: string; lang: 'fr' | 'en'; onBack: () => void }) {
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const card = useTenantQuery<CardDetail>(['report-card', id], `/report-cards/${id}`);
  const [pdfError, setPdfError] = useState<unknown>(null);
  if (card.isPending) return <Loading />;
  if (card.isError) return <ErrorMessage error={card.error} />;
  const { content: c } = card.data;
  const name = (s: Bilingual) => (lang === 'en' ? s.nameEn : s.nameFr);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={onBack} className="text-sm text-accent-700 hover:underline">
          ← {t('reportCards.back')}
        </button>
        <Button variant="secondary" onClick={() => openBlob(`/report-cards/${id}/pdf?lang=${lang}`).catch(setPdfError)}>
          PDF
        </Button>
      </div>
      <ErrorMessage error={pdfError} />
      <Card
        title={`${c.student.lastName} ${c.student.firstName} — ${c.class.name} — ${c.scope.label}`}
        actions={<Badge tone={cardTone(card.data.status)}>{t(`reportCards.statuses.${card.data.status}`)} · v{card.data.version}</Badge>}
      >
        <Table head={[t('classes.subject'), t('reportCards.coef'), t('reportCards.average'), t('reportCards.points'), t('reportCards.rank'), t('reportCards.classAverage'), t('grades.comment')]}>
          {c.subjects.map((s) => (
            <tr key={s.code}>
              <td>
                <span className="font-medium">{name(s)}</span>
                {s.teacher && <span className="block text-xs text-slate-500">{s.teacher}</span>}
              </td>
              <td className="tabular">{s.coefficient}</td>
              <td className="tabular font-semibold">{s.average ?? '—'}</td>
              <td className="tabular">{s.points ?? '—'}</td>
              <td className="tabular">{s.rank ?? '—'}</td>
              <td className="tabular text-slate-600">{s.classAverage ?? '—'}</td>
              <td className="text-sm">{s.comment ?? ''}</td>
            </tr>
          ))}
          <tr className="bg-slate-50 font-medium">
            <td>{t('reportCards.totals')}</td>
            <td className="tabular">{c.totals.coefficients}</td>
            <td />
            <td className="tabular">{c.totals.points}</td>
            <td colSpan={3} />
          </tr>
        </Table>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <Stat label={t('reportCards.general')} value={`${c.average ?? '—'} / ${c.rules.maxScore}`} strong />
          <Stat label={t('reportCards.rank')} value={c.rank ? `${c.rank} / ${c.ranked}` : '—'} />
          <Stat label={t('reportCards.mention')} value={c.mention ? (lang === 'en' ? c.mention.labelEn : c.mention.labelFr) : '—'} />
          <Stat label={t('reportCards.attendance')} value={t('reportCards.attendanceValue', { abs: c.attendance.absences, exc: c.attendance.excused, late: c.attendance.lates })} />
        </div>
        <p className="mt-4 text-xs text-slate-500">
          {t('reportCards.rulesLine', { version: c.rules.version, max: c.rules.maxScore, pass: c.rules.passMark })} · {t('reportCards.code')} {card.data.verificationCode}
        </p>
        {card.data.versions.length > 1 && (
          <p className="mt-1 text-xs text-slate-500">
            {t('reportCards.versions')}: {card.data.versions.map((v) => `v${v.version} (${t(`reportCards.statuses.${v.status}`)}, ${fmt(v.generatedAt.slice(0, 10))})`).join(' · ')}
          </p>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-md bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`tabular ${strong ? 'text-xl font-semibold' : 'font-medium'}`}>{value}</p>
    </div>
  );
}

function PromotionsTab({ classId }: { classId: string }) {
  const { t } = useTranslation();
  const rows = useTenantQuery<
    { enrollmentId: string; student: { matricule: string; firstName: string; lastName: string }; annualAverage: string | null; rank: number | null; proposed: string; decision: string | null; note: string | null }[]
  >(['promotions', classId], `/promotions?classId=${classId}`);
  const save = useTenantMutation<object>('PUT', '/promotions', [['promotions', classId]]);
  const [decisions, setDecisions] = useState<Record<string, { decision: string; note: string }>>({});
  useEffect(() => {
    if (rows.data) setDecisions(Object.fromEntries(rows.data.map((r) => [r.enrollmentId, { decision: r.decision ?? r.proposed, note: r.note ?? '' }])));
  }, [rows.data]);

  if (rows.isPending) return <Loading />;
  if (rows.isError) return <ErrorMessage error={rows.error} />;
  return (
    <Card title={t('reportCards.council')}>
      <Table head={[t('students.name'), t('reportCards.annualAverage'), t('reportCards.rank'), t('reportCards.proposed'), t('reportCards.decision'), t('grades.comment')]}>
        {rows.data.map((r) => {
          const d = decisions[r.enrollmentId] ?? { decision: r.proposed, note: '' };
          return (
            <tr key={r.enrollmentId} className={d.decision !== r.proposed ? 'bg-amber-50' : ''}>
              <td className="font-medium">
                {r.student.lastName} {r.student.firstName}
              </td>
              <td className="tabular">{r.annualAverage ?? '—'}</td>
              <td className="tabular">{r.rank ?? '—'}</td>
              <td>{t(`reportCards.outcomes.${r.proposed}`)}</td>
              <td>
                <Select value={d.decision} onChange={(e) => setDecisions({ ...decisions, [r.enrollmentId]: { ...d, decision: e.target.value } })} aria-label={t('reportCards.decision')}>
                  {PROMOTION_OUTCOMES.map((o) => (
                    <option key={o} value={o}>
                      {t(`reportCards.outcomes.${o}`)}
                    </option>
                  ))}
                </Select>
              </td>
              <td>
                <Input value={d.note} maxLength={300} onChange={(e) => setDecisions({ ...decisions, [r.enrollmentId]: { ...d, note: e.target.value } })} aria-label={t('grades.comment')} />
              </td>
            </tr>
          );
        })}
      </Table>
      <div className="mt-4 space-y-2">
        <ErrorMessage error={save.error} />
        {save.isSuccess && <p className="text-sm text-success-600">{t('reportCards.decisionsSaved')}</p>}
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              classId,
              decisions: Object.entries(decisions).map(([enrollmentId, d]) => ({ enrollmentId, decision: d.decision, ...(d.note && { note: d.note }) })),
            })
          }
        >
          {t('reportCards.saveDecisions')}
        </Button>
      </div>
    </Card>
  );
}

function StatisticsTab({ classId, scope }: { classId: string; scope: string }) {
  const { t } = useTranslation();
  const label = useLabel();
  const stats = useTenantQuery<{
    status: 'FINAL' | 'PROVISIONAL';
    pending: number;
    passMark: number;
    class: { average: string | null; min: string | null; max: string | null; passRate: number | null; ranked: number };
    subjects: { subjectId: string; subject: Bilingual & { code: string }; coefficient: string; average: string | null; min: string | null; max: string | null; passRate: number | null }[];
    belowPassMark: { studentId: string; firstName: string; lastName: string; average: string | null; rank: number | null }[];
  }>(['grade-stats', classId, scope], `/grading/statistics?classId=${classId}&scope=${scope}`);
  if (stats.isPending) return <Loading />;
  if (stats.isError) return <ErrorMessage error={stats.error} />;
  const s = stats.data;
  return (
    <div className="space-y-4">
      <Badge tone={s.status === 'FINAL' ? 'green' : 'amber'}>{s.status === 'FINAL' ? t('reportCards.final') : t('reportCards.provisional', { count: s.pending })}</Badge>
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label={t('reportCards.classAverage')} value={s.class.average ?? '—'} strong />
        <Stat label="Min" value={s.class.min ?? '—'} />
        <Stat label="Max" value={s.class.max ?? '—'} />
        <Stat label={t('reportCards.passRate')} value={s.class.passRate === null ? '—' : `${s.class.passRate} %`} />
      </div>
      <Card title={t('reportCards.bySubject')}>
        <Table head={[t('classes.subject'), t('reportCards.coef'), t('reportCards.average'), 'Min', 'Max', t('reportCards.passRate')]}>
          {s.subjects.map((x) => (
            <tr key={x.subjectId}>
              <td>{label(x.subject)}</td>
              <td className="tabular">{x.coefficient}</td>
              <td className="tabular font-medium">{x.average ?? '—'}</td>
              <td className="tabular">{x.min ?? '—'}</td>
              <td className="tabular">{x.max ?? '—'}</td>
              <td className="tabular">{x.passRate === null ? '—' : `${x.passRate} %`}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title={t('reportCards.below', { mark: s.passMark })}>
        {s.belowPassMark.length === 0 ? (
          <Empty>—</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {s.belowPassMark.map((b) => (
              <li key={b.studentId} className="flex justify-between py-1.5">
                <span>
                  {b.lastName} {b.firstName}
                </span>
                <span className="tabular font-medium text-danger-600">{b.average}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function RulesTab() {
  const { t } = useTranslation();
  const scheme = useTenantQuery<{ name: string; version: number; rules: GradingRules; history: { version: number; createdAt: string; reportCards: number }[] }>(['grading-scheme'], '/grading/scheme');
  const save = useTenantMutation<object>('PUT', '/grading/scheme', [['grading-scheme']]);
  const [rules, setRules] = useState<GradingRules | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    if (scheme.data) {
      setRules(scheme.data.rules);
      setName(scheme.data.name);
    }
  }, [scheme.data]);
  if (scheme.isPending || !rules) return <Loading />;
  if (scheme.isError) return <ErrorMessage error={scheme.error} />;
  return (
    <Card title={`${scheme.data.name} — v${scheme.data.version}`}>
      <p className="mb-4 text-sm text-slate-600">{t('reportCards.rulesHelp')}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('common.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('reportCards.scale')}>
          <Input type="number" min={1} value={rules.maxScore} onChange={(e) => setRules({ ...rules, maxScore: Number(e.target.value) })} />
        </Field>
        <Field label={t('reportCards.passMark')}>
          <Input type="number" min={0} step={0.5} value={rules.passMark} onChange={(e) => setRules({ ...rules, passMark: Number(e.target.value) })} />
        </Field>
        <Field label={t('reportCards.decimals')}>
          <Input type="number" min={0} max={4} value={rules.decimals} onChange={(e) => setRules({ ...rules, decimals: Number(e.target.value) })} />
        </Field>
        <Field label={t('reportCards.missing')}>
          <Select value={rules.missingPolicy} onChange={(e) => setRules({ ...rules, missingPolicy: e.target.value as GradingRules['missingPolicy'] })}>
            <option value="EXCLUDE">{t('reportCards.missingExclude')}</option>
            <option value="ZERO">{t('reportCards.missingZero')}</option>
          </Select>
        </Field>
        <Field label={t('reportCards.ranking')}>
          <Select value={rules.ranking} onChange={(e) => setRules({ ...rules, ranking: e.target.value as GradingRules['ranking'] })}>
            <option value="COMPETITION">1, 2, 2, 4</option>
            <option value="DENSE">1, 2, 2, 3</option>
          </Select>
        </Field>
      </div>
      <h3 className="mt-6 text-sm font-semibold">{t('reportCards.mentions')}</h3>
      <div className="mt-2 space-y-2">
        {rules.mentions.map((m, i) => (
          <div key={i} className="grid grid-cols-3 gap-2">
            <Input type="number" step={0.5} value={m.min} aria-label="min" onChange={(e) => setRules({ ...rules, mentions: rules.mentions.map((x, j) => (j === i ? { ...x, min: Number(e.target.value) } : x)) })} />
            <Input value={m.labelFr} aria-label="FR" onChange={(e) => setRules({ ...rules, mentions: rules.mentions.map((x, j) => (j === i ? { ...x, labelFr: e.target.value } : x)) })} />
            <Input value={m.labelEn} aria-label="EN" onChange={(e) => setRules({ ...rules, mentions: rules.mentions.map((x, j) => (j === i ? { ...x, labelEn: e.target.value } : x)) })} />
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-2">
        <ErrorMessage error={save.error} />
        <Button disabled={save.isPending} onClick={() => window.confirm(t('reportCards.saveRulesConfirm')) && save.mutate({ name, rules })}>
          {t('reportCards.saveRules')}
        </Button>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        {scheme.data.history.map((h) => t('reportCards.historyLine', { version: h.version, count: h.reportCards })).join(' · ')}
      </p>
    </Card>
  );
}
