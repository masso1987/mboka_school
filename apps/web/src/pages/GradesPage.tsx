import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ASSESSMENT_KINDS, formatMarkCell, parseMarkCell } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import type { GradeSheet, OverviewRow, Period } from '../lib/grades-types';
import { useCurrentYear, useLabel, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { marksDraftKey, readJson, writeJson } from '../lib/offline';
import { useSession } from '../lib/session';
import type { Assignment, SchoolClass } from '../lib/types';

const statusTone = (s: string) => (s === 'APPROVED' ? 'green' : s === 'SUBMITTED' ? 'blue' : s === 'REOPENED' ? 'amber' : 'slate');

export function GradesPage() {
  const { t } = useTranslation();
  const label = useLabel();
  const { can } = useSession();
  const reviewer = can('grades.approve');
  const { current } = useCurrentYear();
  const periods = useTenantQuery<Period[]>(['periods', current?.id], current ? `/academic-years/${current.id}/periods` : null);
  const mine = useTenantQuery<{ assignments: Assignment[] }>(['my-assignments'], '/me/assignments');
  const classes = useTenantQuery<SchoolClass[]>(['classes', current?.id], reviewer && current ? `/classes?academicYearId=${current.id}` : null);

  const [periodId, setPeriodId] = useState('');
  const [classId, setClassId] = useState('');
  const [sheetRef, setSheetRef] = useState<{ classSubjectId: string; periodId: string } | null>(null);
  const markPeriods = periods.data ?? [];
  const activePeriod = periodId || markPeriods[0]?.id || '';
  const activeClass = classId || classes.data?.[0]?.id || '';
  const overview = useTenantQuery<OverviewRow[]>(['grade-overview', activeClass, activePeriod], reviewer && activeClass && activePeriod ? `/grade-sheets/overview?classId=${activeClass}&periodId=${activePeriod}` : null);

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.grades')} />
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('grades.period')} className="min-w-48">
          <Select value={activePeriod} onChange={(e) => { setPeriodId(e.target.value); setSheetRef(null); }}>
            {markPeriods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        {reviewer && (
          <Field label={t('students.class')} className="min-w-48">
            <Select value={activeClass} onChange={(e) => { setClassId(e.target.value); setSheetRef(null); }}>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {markPeriods.length === 0 && !periods.isPending ? (
        <Card>
          <Empty>{t('grades.noPeriods')}</Empty>
        </Card>
      ) : sheetRef ? (
        <GradeSheetView refs={sheetRef} onBack={() => setSheetRef(null)} />
      ) : (
        <>
          {(mine.data?.assignments.length ?? 0) > 0 && (
            <Card title={t('grades.mySubjects')}>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {mine.data!.assignments.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSheetRef({ classSubjectId: a.classSubjectId, periodId: activePeriod })}
                      className="w-full rounded-md border border-slate-200 px-4 py-3 text-left hover:border-accent-500 hover:bg-accent-50"
                    >
                      <span className="block font-medium">{label(a.subject)}</span>
                      <span className="text-sm text-slate-600">{a.class.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {reviewer && (
            <Card title={t('grades.overview')}>
              {overview.isPending ? (
                <Loading />
              ) : overview.data?.length === 0 ? (
                <Empty>{t('classes.noSubjects')}</Empty>
              ) : (
                <Table head={[t('classes.subject'), t('classes.coefficient'), t('teaching.teacher'), t('grades.assessments'), t('common.status'), '']}>
                  {overview.data?.map((r) => (
                    <tr key={r.classSubjectId}>
                      <td className="font-medium">{label(r.subject)}</td>
                      <td className="tabular">{r.coefficient}</td>
                      <td>{r.teacher ?? '—'}</td>
                      <td className="tabular">{r.assessments}</td>
                      <td>
                        <Badge tone={statusTone(r.status)}>{t(`grades.statuses.${r.status}`)}</Badge>
                      </td>
                      <td className="text-right">
                        <Button variant="secondary" onClick={() => setSheetRef({ classSubjectId: r.classSubjectId, periodId: activePeriod })}>
                          {t('grades.open')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          )}
          {!reviewer && (mine.data?.assignments.length ?? 0) === 0 && !mine.isPending && (
            <Card>
              <Empty>{t('grades.noAssignments')}</Empty>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function GradeSheetView({ refs, onBack }: { refs: { classSubjectId: string; periodId: string }; onBack: () => void }) {
  const { t } = useTranslation();
  const label = useLabel();
  const q = `classSubjectId=${refs.classSubjectId}&periodId=${refs.periodId}`;
  const sheet = useTenantQuery<GradeSheet>(['grade-sheet', refs.classSubjectId, refs.periodId], `/grade-sheets?${q}`);
  const invalidate = [['grade-sheet', refs.classSubjectId, refs.periodId], ['grade-overview']];
  const saveMarks = useTenantMutation<object, { changed: number }>('PUT', '/grade-sheets/marks', invalidate);
  const saveComments = useTenantMutation<object>('PUT', '/grade-sheets/comments', invalidate);
  const addAssessment = useTenantMutation<object>('POST', '/assessments', invalidate);
  const importMarks = useTenantMutation<object, { changed: number }>('POST', '/grade-sheets/import', invalidate);
  const act = useTenantMutation<{ path: string; classSubjectId: string; periodId: string; reason?: string }>('POST', (b) => `/grade-sheets/${b.path}`, invalidate);

  const [cells, setCells] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [newA, setNewA] = useState({ name: '', kind: 'TEST', maxScore: '20', weight: '1' });
  const [csv, setCsv] = useState({ assessmentId: '', text: '' });
  // Unsaved marks survive a reload or a lost connection (§10.2 draft mark entry).
  const { tenantId } = useSession();
  const draftKey = tenantId ? marksDraftKey(tenantId, refs.classSubjectId, refs.periodId) : '';
  const [draftRestored, setDraftRestored] = useState(false);
  const ready = useRef(false);

  useEffect(() => {
    if (!sheet.data) return;
    const c: Record<string, string> = {};
    const cm: Record<string, string> = {};
    for (const s of sheet.data.students) {
      for (const a of sheet.data.assessments) c[`${s.studentId}:${a.id}`] = formatMarkCell(s.marks[a.id]);
      cm[s.studentId] = s.comment;
    }
    const draft = draftKey ? readJson<{ cells: Record<string, string>; comments: Record<string, string> }>(draftKey) : null;
    setCells(draft ? { ...c, ...draft.cells } : c);
    setComments(draft ? { ...cm, ...draft.comments } : cm);
    setDraftRestored(Boolean(draft));
    ready.current = true;
  }, [sheet.data, draftKey]);

  useEffect(() => {
    if (!ready.current || !draftKey || !sheet.data?.canEdit) return;
    const server = sheet.data;
    const changedCells = Object.fromEntries(
      Object.entries(cells).filter(([k, v]) => {
        const [studentId, assessmentId] = k.split(':');
        const st = server.students.find((x) => x.studentId === studentId);
        return st && v !== formatMarkCell(st.marks[assessmentId!]);
      }),
    );
    const changedComments = Object.fromEntries(Object.entries(comments).filter(([id, v]) => v !== (server.students.find((x) => x.studentId === id)?.comment ?? '')));
    const dirty = Object.keys(changedCells).length + Object.keys(changedComments).length > 0;
    writeJson(draftKey, dirty ? { cells: changedCells, comments: changedComments } : null);
  }, [cells, comments, draftKey, sheet.data]);

  const sh = sheet.data;
  const invalid = useMemo(() => {
    const bad = new Set<string>();
    if (!sh) return bad;
    for (const a of sh.assessments) {
      for (const s of sh.students) {
        const key = `${s.studentId}:${a.id}`;
        const v = cells[key] ?? '';
        if (v === '') continue;
        const p = parseMarkCell(v);
        if (!p || (p.score !== null && Number(p.score) > Number(a.maxScore))) bad.add(key);
      }
    }
    return bad;
  }, [cells, sh]);

  if (sheet.isPending) return <Loading />;
  if (sheet.isError) return <ErrorMessage error={sheet.error} />;
  const s = sheet.data;

  function save() {
    const marks = s.students.flatMap((st) =>
      s.assessments.flatMap((a) => {
        const key = `${st.studentId}:${a.id}`;
        const v = cells[key] ?? '';
        if (v === '' || v === formatMarkCell(st.marks[a.id])) return [];
        const p = parseMarkCell(v);
        return p ? [{ assessmentId: a.id, studentId: st.studentId, status: p.status, ...(p.score !== null && { score: p.score }) }] : [];
      }),
    );
    const changedComments = s.students.filter((st) => (comments[st.studentId] ?? '') !== st.comment).map((st) => ({ studentId: st.studentId, comment: comments[st.studentId] ?? '' }));
    const done = () => {
      writeJson(draftKey, null);
      setDraftRestored(false);
    };
    if (marks.length > 0) saveMarks.mutate({ ...refs, marks, ...(reason && { reason }) }, { onSuccess: done });
    if (changedComments.length > 0) saveComments.mutate({ ...refs, comments: changedComments }, { onSuccess: done });
  }

  function runImport() {
    const rows = csv.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [matricule = '', value = ''] = l.split(/[;\t,]/).map((x) => x.trim());
        return { matricule, value };
      })
      .filter((r) => !/^matricule$/i.test(r.matricule));
    importMarks.mutate({ assessmentId: csv.assessmentId, rows, ...(reason && { reason }) }, { onSuccess: () => setCsv({ ...csv, text: '' }) });
  }

  const askReason = (path: string) => {
    const r = window.prompt(t('grades.reasonPrompt'));
    if (r && r.trim().length >= 3) act.mutate({ path, ...refs, reason: r.trim() });
  };
  const importErrors =
    importMarks.error instanceof ApiRequestError && importMarks.error.code === 'IMPORT_REJECTED'
      ? (importMarks.error.details as { errors: { row: number; matricule: string; reason: string }[] }).errors
      : null;
  const incomplete =
    act.error instanceof ApiRequestError && act.error.code === 'INCOMPLETE_MARKS'
      ? (act.error.details as { missing: { assessment: string; name: string }[] }).missing
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="text-sm text-accent-700 hover:underline">
            ← {t('grades.back')}
          </button>
          <h2 className="mt-1 text-xl font-semibold">
            {label(s.subject)} — {s.class.name} — {s.period.name}
          </h2>
          <p className="text-sm text-slate-600">
            {t('classes.coefficient')} {s.coefficient} · <Badge tone={statusTone(s.submission.status)}>{t(`grades.statuses.${s.submission.status}`)}</Badge>
            {s.submission.reopenReason && <span className="ml-2 text-amber-700">{t('grades.reopenedFor', { reason: s.submission.reopenReason })}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.canSubmit && <Button onClick={() => window.confirm(t('grades.submitConfirm')) && act.mutate({ path: 'submit', ...refs })}>{t('grades.submit')}</Button>}
          {s.canApprove && (
            <>
              <Button variant="secondary" onClick={() => askReason('return')}>
                {t('grades.return')}
              </Button>
              <Button onClick={() => act.mutate({ path: 'approve', ...refs })}>{t('fees.approve')}</Button>
            </>
          )}
          {s.canReopen && (
            <Button variant="secondary" onClick={() => askReason('reopen')}>
              {t('grades.reopen')}
            </Button>
          )}
        </div>
      </div>
      {incomplete ? (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-danger-600">
          <p className="font-medium">{t('errors.INCOMPLETE_MARKS')}</p>
          <ul className="mt-1 list-inside list-disc">
            {incomplete.slice(0, 10).map((m, i) => (
              <li key={i}>
                {m.name} — {m.assessment}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ErrorMessage error={act.error} />
      )}

      {draftRestored && (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('grades.draftRestored')}</p>
      )}
      <Card title={t('grades.marks')}>
        {s.assessments.length === 0 ? (
          <Empty>{t('grades.noAssessments')}</Empty>
        ) : (
          <>
            <p className="mb-3 text-xs text-slate-500">{t('grades.cellHelp')}</p>
            <div className="-mx-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">{t('students.name')}</th>
                    {s.assessments.map((a) => (
                      <th key={a.id} className="px-2 py-2 text-center font-medium">
                        <span className="block">{a.name}</span>
                        <span className="tabular text-xs font-normal text-slate-500">
                          /{a.maxScore} · ×{a.weight}
                        </span>
                      </th>
                    ))}
                    <th className="px-5 py-2 text-left font-medium">{t('grades.comment')}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.students.map((st) => (
                    <tr key={st.studentId} className="border-b border-slate-100">
                      <td className="px-5 py-1.5">
                        <span className="font-medium">
                          {st.lastName} {st.firstName}
                        </span>
                        <span className="tabular block text-xs text-slate-500">{st.matricule}</span>
                      </td>
                      {s.assessments.map((a) => {
                        const key = `${st.studentId}:${a.id}`;
                        return (
                          <td key={a.id} className="px-2 py-1.5 text-center">
                            <input
                              aria-label={`${st.lastName} ${st.firstName} — ${a.name}`}
                              value={cells[key] ?? ''}
                              disabled={!s.canEdit}
                              onChange={(e) => setCells({ ...cells, [key]: e.target.value })}
                              className={`tabular w-16 rounded border px-2 py-1 text-center disabled:bg-slate-50 ${invalid.has(key) ? 'border-danger-600 bg-red-50' : 'border-slate-300'}`}
                            />
                          </td>
                        );
                      })}
                      <td className="px-5 py-1.5">
                        <input
                          aria-label={`${t('grades.comment')} — ${st.lastName}`}
                          value={comments[st.studentId] ?? ''}
                          disabled={!s.canEdit}
                          maxLength={300}
                          onChange={(e) => setComments({ ...comments, [st.studentId]: e.target.value })}
                          className="w-full min-w-40 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-50"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {s.canEdit && (
              <div className="mt-4 space-y-3">
                {s.submission.everApproved && (
                  <Field label={t('grades.changeReason')} hint={t('grades.changeReasonHint')}>
                    <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                  </Field>
                )}
                <ErrorMessage error={saveMarks.error ?? saveComments.error} />
                {saveMarks.isSuccess && !saveMarks.error && <p className="text-sm text-success-600">{t('grades.saved', { count: saveMarks.data?.changed ?? 0 })}</p>}
                <Button onClick={save} disabled={invalid.size > 0 || saveMarks.isPending}>
                  {t('common.save')}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {s.canEdit && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={t('grades.newAssessment')}>
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                addAssessment.mutate({ ...refs, ...newA }, { onSuccess: () => setNewA({ ...newA, name: '' }) });
              }}
            >
              <Field label={t('common.name')} className="sm:col-span-2">
                <Input required value={newA.name} onChange={(e) => setNewA({ ...newA, name: e.target.value })} />
              </Field>
              <Field label={t('grades.kind')}>
                <Select value={newA.kind} onChange={(e) => setNewA({ ...newA, kind: e.target.value })}>
                  {ASSESSMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`grades.kinds.${k}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('grades.maxScore')}>
                <Input required inputMode="decimal" value={newA.maxScore} onChange={(e) => setNewA({ ...newA, maxScore: e.target.value })} />
              </Field>
              <Field label={t('grades.weight')} hint={t('grades.weightHint')}>
                <Input required inputMode="decimal" value={newA.weight} onChange={(e) => setNewA({ ...newA, weight: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={addAssessment.isPending}>
                  {t('common.add')}
                </Button>
              </div>
              <div className="sm:col-span-2">
                <ErrorMessage error={addAssessment.error} />
              </div>
            </form>
          </Card>
          {s.assessments.length > 0 && (
            <Card title={t('grades.import')}>
              <div className="space-y-3">
                <Select value={csv.assessmentId} onChange={(e) => setCsv({ ...csv, assessmentId: e.target.value })} aria-label={t('grades.assessments')}>
                  <option value="" />
                  {s.assessments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
                <textarea
                  value={csv.text}
                  onChange={(e) => setCsv({ ...csv, text: e.target.value })}
                  rows={6}
                  placeholder={'2026-00001;14,5\n2026-00002;ABS'}
                  aria-label={t('grades.importText')}
                  className="tabular w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                {importErrors ? (
                  <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-danger-600">
                    <p className="font-medium">{t('errors.IMPORT_REJECTED')}</p>
                    <ul className="mt-1 list-inside list-disc">
                      {importErrors.map((er) => (
                        <li key={er.row}>{t('grades.importRowError', { row: er.row, matricule: er.matricule, reason: t(`grades.importReasons.${er.reason}`) })}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <ErrorMessage error={importMarks.error} />
                )}
                {importMarks.isSuccess && <p className="text-sm text-success-600">{t('grades.saved', { count: importMarks.data?.changed ?? 0 })}</p>}
                <Button variant="secondary" disabled={!csv.assessmentId || !csv.text.trim() || importMarks.isPending} onClick={runImport}>
                  {t('grades.importRun')}
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
