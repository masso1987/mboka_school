import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { COMPETENCE_COMPONENTS, type CompetenceComponent } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table, Tabs } from '../components/ui';
import { api, ApiRequestError, openBlob } from '../lib/api';
import { useCurrentYear, useLabel, useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { SchoolClass } from '../lib/types';

interface Competence {
  id: string;
  code: string;
  nameFr: string;
  nameEn: string;
  components: { kind: CompetenceComponent; max: string }[];
}
interface ClassCompetences {
  class: { id: string; name: string };
  markingSystem: 'SUBJECTS' | 'COMPETENCES';
  grandMax: number;
  competences: Competence[];
}
type Tab = 'marks' | 'setup' | 'results';

/**
 * Competence-based marking (MINEDUB 2018 primary curriculum): monthly marks per evaluation component, the scale of
 * each competence, results and the printed report booklet.
 */
export function CompetencesPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const { current } = useCurrentYear();
  const classes = useTenantQuery<SchoolClass[]>(['classes', current?.id], current ? `/classes?academicYearId=${current.id}` : null);
  const [classId, setClassId] = useState('');
  const [tab, setTab] = useState<Tab>('marks');
  useEffect(() => {
    if (!classId && classes.data?.[0]) setClassId(classes.data[0].id);
  }, [classes.data, classId]);
  const data = useTenantQuery<ClassCompetences>(['competences', classId], classId ? `/competences/classes/${classId}` : null);
  const tabs: Tab[] = ['marks', ...(can('academics.structure.manage') ? (['setup'] as Tab[]) : []), ...(can('grades.approve') ? (['results'] as Tab[]) : [])];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.competences')}
        description={t('competences.intro')}
        actions={
          <Select className="w-56" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label={t('nav.classes')}>
            {classes.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        }
      />
      {classes.isError && <ErrorMessage error={classes.error} />}
      {!classId ? null : data.isPending ? (
        <Loading />
      ) : data.isError ? (
        <ErrorMessage error={data.error} />
      ) : data.data.markingSystem !== 'COMPETENCES' ? (
        <SubjectClassNotice levelId={classes.data?.find((c) => c.id === classId)?.levelId} />
      ) : (
        <>
          <Tabs value={tab} onChange={setTab} items={tabs.map((k) => ({ key: k, label: t(`competences.tabs.${k}`) }))} />
          {tab === 'marks' && <MarksTab data={data.data} />}
          {tab === 'setup' && <SetupTab data={data.data} />}
          {tab === 'results' && <ResultsTab classId={classId} />}
        </>
      )}
    </div>
  );
}

function SubjectClassNotice({ levelId }: { levelId?: string }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const qc = useQueryClient();
  const switchLevel = useMutation({
    mutationFn: () => api(`/competences/levels/${levelId}`, { method: 'PUT', body: { markingSystem: 'COMPETENCES' } }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes('competences') }),
  });
  return (
    <Card>
      <p className="text-sm text-slate-700">{t('competences.subjectClass')}</p>
      {can('academics.structure.manage') && levelId && (
        <div className="mt-3">
          <Button variant="secondary" disabled={switchLevel.isPending} onClick={() => window.confirm(t('competences.switchConfirm')) && switchLevel.mutate()}>
            {t('competences.switchLevel')}
          </Button>
          <ErrorMessage error={switchLevel.error} />
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------ monthly marks

interface MonthSheet {
  competence: { id: string; code: string; nameFr: string; nameEn: string };
  month: number;
  components: { kind: CompetenceComponent; max: string }[];
  canEdit: boolean;
  rows: { enrollmentId: string; student: { matricule: string; firstName: string; lastName: string }; marks: Partial<Record<CompetenceComponent, string>> }[];
}

function MarksTab({ data }: { data: ClassCompetences }) {
  const { t } = useTranslation();
  const label = useLabel();
  const ready = data.competences.filter((c) => c.components.length > 0);
  const [competenceId, setCompetenceId] = useState(ready[0]?.id ?? '');
  const [month, setMonth] = useState(1);
  if (ready.length === 0) return <Empty>{t('competences.noScale')}</Empty>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Field label={t('competences.competence')} className="min-w-72 flex-1">
          <Select value={competenceId} onChange={(e) => setCompetenceId(e.target.value)}>
            {ready.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {label(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('competences.month')}>
          <Select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {Array.from({ length: 9 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {t('competences.monthOption', { month: m, term: Math.ceil(m / 3) })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {competenceId && <MonthGrid key={`${competenceId}-${month}`} competenceId={competenceId} month={month} />}
    </div>
  );
}

function MonthGrid({ competenceId, month }: { competenceId: string; month: number }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const sheet = useTenantQuery<MonthSheet>(['competence-month', competenceId, month], `/competences/class-subjects/${competenceId}/months/${month}`);
  const [cells, setCells] = useState<Record<string, Partial<Record<CompetenceComponent, string>>>>({});
  useEffect(() => {
    if (sheet.data) setCells(Object.fromEntries(sheet.data.rows.map((r) => [r.enrollmentId, { ...r.marks }])));
  }, [sheet.data]);
  const save = useMutation({
    mutationFn: () =>
      api<{ changed: number }>('/competences/marks', {
        method: 'PUT',
        body: { classSubjectId: competenceId, month, rows: Object.entries(cells).map(([enrollmentId, marks]) => ({ enrollmentId, marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, v?.trim() ? v.trim() : null])) })) },
      }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes('competence-month') || q.queryKey.includes('competence-results') }),
  });
  const rowErrors = new Set(
    save.error instanceof ApiRequestError ? ((save.error.details as { errors?: { enrollmentId: string; kind: string }[] } | undefined)?.errors ?? []).map((e) => `${e.enrollmentId}:${e.kind}`) : [],
  );
  if (sheet.isPending) return <Loading />;
  if (sheet.isError) return <ErrorMessage error={sheet.error} />;
  const s = sheet.data;
  const max = (kind: CompetenceComponent) => Number(s.components.find((c) => c.kind === kind)?.max ?? 0);
  const total = (id: string) => s.components.reduce((sum, c) => sum + (Number((cells[id]?.[c.kind] ?? '').replace(',', '.')) || 0), 0);
  const totalMax = s.components.reduce((sum, c) => sum + Number(c.max), 0);

  return (
    <Card>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Table head={[t('competences.pupil'), ...s.components.map((c) => `${t(`competences.components.${c.kind}`)} /${Number(c.max)}`), `${t('competences.total')} /${totalMax}`]}>
          {s.rows.map((r) => (
            <tr key={r.enrollmentId}>
              <td>
                <p className="font-medium">
                  {r.student.lastName} {r.student.firstName}
                </p>
                <p className="tabular text-xs text-slate-500">{r.student.matricule}</p>
              </td>
              {s.components.map((c) => {
                const v = cells[r.enrollmentId]?.[c.kind] ?? '';
                const over = Number(v.replace(',', '.')) > max(c.kind);
                const bad = over || rowErrors.has(`${r.enrollmentId}:${c.kind}`);
                return (
                  <td key={c.kind}>
                    <Input
                      inputMode="decimal"
                      disabled={!s.canEdit}
                      aria-label={`${r.student.lastName} ${t(`competences.components.${c.kind}`)}`}
                      aria-invalid={bad}
                      className={`tabular w-20 text-center ${bad ? 'border-danger-600 bg-red-50' : ''}`}
                      value={v}
                      onChange={(e) => setCells({ ...cells, [r.enrollmentId]: { ...cells[r.enrollmentId], [c.kind]: e.target.value } })}
                    />
                  </td>
                );
              })}
              <td className="tabular font-bold">{total(r.enrollmentId) || ''}</td>
            </tr>
          ))}
        </Table>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {s.canEdit ? (
            <Button type="submit" disabled={save.isPending}>
              {t('competences.saveMonth')}
            </Button>
          ) : (
            <p className="text-sm text-slate-600">{t('competences.notAssigned')}</p>
          )}
          {save.isSuccess && <span className="text-sm text-success-600">{t('competences.saved', { count: save.data.changed })}</span>}
        </div>
        <div className="mt-2">
          <ErrorMessage error={save.error} />
        </div>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------ scale of each competence

function SetupTab({ data }: { data: ClassCompetences }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('competences.setupHelp', { total: data.grandMax })}</p>
      {data.competences.map((c) => (
        <ComponentsEditor key={c.id} competence={c} />
      ))}
    </div>
  );
}

function ComponentsEditor({ competence }: { competence: Competence }) {
  const { t } = useTranslation();
  const label = useLabel();
  const qc = useQueryClient();
  const initial = Object.fromEntries(COMPETENCE_COMPONENTS.map((k) => [k, competence.components.find((c) => c.kind === k)?.max ?? ''])) as Record<CompetenceComponent, string>;
  const [f, setF] = useState(initial);
  const save = useMutation({
    mutationFn: () =>
      api(`/competences/class-subjects/${competence.id}/components`, {
        method: 'PUT',
        body: { components: COMPETENCE_COMPONENTS.filter((k) => Number(f[k]) > 0).map((k) => ({ kind: k, max: Number(f[k]) })) },
      }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes('competences') }),
  });
  const total = COMPETENCE_COMPONENTS.reduce((s, k) => s + (Number(f[k]) || 0), 0);
  return (
    <Card>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="min-w-60 flex-1">
          <p className="font-bold">
            {competence.code} — {label(competence)}
          </p>
          <p className="text-sm text-slate-600">{t('competences.marksTotal', { total })}</p>
        </div>
        {COMPETENCE_COMPONENTS.map((k) => (
          <Field key={k} label={t(`competences.components.${k}`)}>
            <Input type="number" min={0} max={100} step="0.5" className="w-24" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </Field>
        ))}
        <Button type="submit" variant="secondary" disabled={save.isPending || total === 0}>
          {t('common.save')}
        </Button>
        {save.isSuccess && <Badge tone="green">{t('platform.saved')}</Badge>}
      </form>
      <div className="mt-2">
        <ErrorMessage error={save.error} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------ results, remarks and booklets

interface Results {
  grandMax: string;
  classSize: number;
  students: {
    enrollmentId: string;
    student: { matricule: string; firstName: string; lastName: string };
    terms: Record<number, { total: string | null; max: string | null; average: string | null; rank: number | null }>;
    annual: { total: string | null; average: string | null; rank: number | null };
  }[];
}

function ResultsTab({ classId }: { classId: string }) {
  const { t, i18n } = useTranslation();
  const results = useTenantQuery<Results>(['competence-results', classId], `/competences/classes/${classId}/results`);
  const [lang, setLang] = useState<'fr' | 'en'>(i18n.resolvedLanguage === 'en' ? 'en' : 'fr');
  const [pdfError, setPdfError] = useState<unknown>(null);
  const [remarksFor, setRemarksFor] = useState<string | null>(null);
  if (results.isPending) return <Loading />;
  if (results.isError) return <ErrorMessage error={results.error} />;
  const r = results.data;
  const cell = (s: { total: string | null; average: string | null; rank: number | null } | undefined) =>
    s?.total ? (
      <span className="tabular">
        <span className="font-bold">{s.average}</span>
        <span className="block text-xs text-slate-500">
          {Number(s.total)} · {t('competences.rank', { rank: s.rank, size: r.classSize, context: s.rank === 1 ? 'first' : undefined })}
        </span>
      </span>
    ) : (
      <span className="text-slate-400">—</span>
    );
  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">{t('competences.resultsHelp', { max: Number(r.grandMax) })}</p>
          <div className="flex items-center gap-2">
            <Select className="w-32" value={lang} onChange={(e) => setLang(e.target.value as 'fr' | 'en')} aria-label={t('common.language')}>
              <option value="en">English</option>
              <option value="fr">Français</option>
            </Select>
            <Button onClick={() => openBlob(`/report-books/classes/${classId}.pdf?lang=${lang}`).catch(setPdfError)}>{t('competences.printClass')}</Button>
          </div>
        </div>
        <ErrorMessage error={pdfError} />
        <Table head={[t('competences.pupil'), ...[1, 2, 3].map((n) => t('competences.termN', { n })), t('competences.annual'), '']}>
          {r.students.map((s) => (
            <tr key={s.enrollmentId} className="align-top">
              <td>
                <p className="font-medium">
                  {s.student.lastName} {s.student.firstName}
                </p>
                <p className="tabular text-xs text-slate-500">{s.student.matricule}</p>
              </td>
              {[1, 2, 3].map((n) => (
                <td key={n}>{cell(s.terms[n])}</td>
              ))}
              <td>{cell(s.annual)}</td>
              <td className="space-x-2 whitespace-nowrap text-right">
                <Button variant="ghost" onClick={() => setRemarksFor(remarksFor === s.enrollmentId ? null : s.enrollmentId)}>
                  {t('competences.remarks')}
                </Button>
                <Button variant="ghost" onClick={() => openBlob(`/report-books/enrollments/${s.enrollmentId}.pdf?lang=${lang}`).catch(setPdfError)}>
                  {t('competences.printOne')}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      {remarksFor && <RemarksEditor key={remarksFor} enrollmentId={remarksFor} name={(() => { const s = r.students.find((x) => x.enrollmentId === remarksFor)!; return `${s.student.lastName} ${s.student.firstName}`; })()} />}
    </div>
  );
}

function RemarksEditor({ enrollmentId, name }: { enrollmentId: string; name: string }) {
  const { t } = useTranslation();
  const existing = useTenantQuery<Record<string, { teacherRemark: string | null; headRemark: string | null; conduct: string | null }>>(['report-remarks', enrollmentId], `/competences/report-books/${enrollmentId}/remarks`);
  const [term, setTerm] = useState(1);
  const [f, setF] = useState({ teacherRemark: '', headRemark: '', conduct: '' });
  useEffect(() => {
    const r = existing.data?.[term];
    setF({ teacherRemark: r?.teacherRemark ?? '', headRemark: r?.headRemark ?? '', conduct: r?.conduct ?? '' });
  }, [existing.data, term]);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      api(`/competences/report-books/${enrollmentId}/remarks/${term}`, {
        method: 'PUT',
        body: { teacherRemark: f.teacherRemark.trim() || null, headRemark: f.headRemark.trim() || null, conduct: f.conduct.trim() || null },
      }),
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes('report-remarks') }),
  });
  return (
    <Card title={t('competences.remarksFor', { name })}>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label={t('competences.term')}>
          <Select value={term} onChange={(e) => setTerm(Number(e.target.value))}>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {t('competences.termN', { n })}
              </option>
            ))}
            <option value={0}>{t('competences.annual')}</option>
          </Select>
        </Field>
        <Field label={t('competences.conduct')}>
          <Input maxLength={120} value={f.conduct} onChange={(e) => setF({ ...f, conduct: e.target.value })} />
        </Field>
        <Field label={t('competences.teacherRemark')}>
          <Input maxLength={500} value={f.teacherRemark} onChange={(e) => setF({ ...f, teacherRemark: e.target.value })} />
        </Field>
        <Field label={t('competences.headRemark')}>
          <Input maxLength={500} value={f.headRemark} onChange={(e) => setF({ ...f, headRemark: e.target.value })} />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
          {save.isSuccess && <span className="text-sm text-success-600">{t('platform.saved')}</span>}
        </div>
        <div className="sm:col-span-2">
          <ErrorMessage error={save.error} />
        </div>
      </form>
    </Card>
  );
}
