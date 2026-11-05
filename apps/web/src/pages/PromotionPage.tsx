import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Loading, PageHeader, Select, Table } from '../components/ui';
import { api } from '../lib/api';
import { useCurrentYear, useLabel, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { EducationLevel, SchoolClass } from '../lib/types';

const OUTCOMES = ['PROMOTED', 'REPEAT', 'GRADUATED', 'EXCLUDED'] as const;
type Outcome = (typeof OUTCOMES)[number];
type ClassMap = Record<string, { promotedTo: string; repeatIn: string }>;

interface PreviewRow {
  enrollmentId: string;
  student: { matricule: string; firstName: string; lastName: string };
  fromClass: string;
  decision: Outcome | null;
  action: string | null;
  targetClass: string | null;
  exception: 'NO_DECISION' | 'NO_TARGET_CLASS' | 'CLASS_FULL' | null;
}
interface Preview {
  summary: { students: number; promote: number; repeat: number; graduate: number; leave: number; alreadyEnrolled: number; exceptions: number };
  rows: PreviewRow[];
  canCommit: boolean;
}

/** Last word of a class name or code ("6e A" → "A"), used to suggest "5e A" for the promoted pupils of "6e A". */
const section = (s: string) => s.trim().split(/\s+/).pop()?.toUpperCase() ?? '';

/**
 * Year-end promotion: next year's classes, each pupil's decision (pre-filled by the class council), where each class
 * goes, then the move itself. Pupils then appear in their new class, and next year's class fees are billed.
 */
export function PromotionPage() {
  const { t } = useTranslation();
  const label = useLabel();
  const { tenantId } = useSession();
  const qc = useQueryClient();
  const { years, current } = useCurrentYear();
  const [sourceId, setSourceId] = useState('');
  const source = years.data?.find((y) => y.id === (sourceId || current?.id));
  const targets = (years.data ?? []).filter((y) => source && y.startDate > source.startDate && y.status !== 'CLOSED');
  const [targetId, setTargetId] = useState('');
  useEffect(() => {
    if (!targetId && targets[0]) setTargetId(targets[0].id);
  }, [targets, targetId]);
  const target = targets.find((y) => y.id === targetId);

  const levels = useTenantQuery<EducationLevel[]>(['levels'], '/education-levels');
  const sourceClasses = useTenantQuery<SchoolClass[]>(['classes', source?.id], source ? `/classes?academicYearId=${source.id}` : null);
  const targetClasses = useTenantQuery<SchoolClass[]>(['classes', target?.id], target ? `/classes?academicYearId=${target.id}` : null);

  // Suggested destinations: promoted pupils go to the next level's class with the same section, repeaters to the same class.
  const [map, setMap] = useState<ClassMap>({});
  const suggested = useMemo<ClassMap>(() => {
    const pos = new Map(levels.data?.map((l) => [l.id, l.position]) ?? []);
    const out: ClassMap = {};
    for (const c of sourceClasses.data ?? []) {
      // Only the level right above (never skipping one): 6e → 5e, CM1 → CM2.
      const own = pos.get(c.levelId) ?? 0;
      const nextLevel = [...(levels.data ?? [])].filter((l) => l.position > own).sort((a, b) => a.position - b.position)[0];
      const upper = (targetClasses.data ?? []).filter((x) => nextLevel && x.levelId === nextLevel.id);
      const promotedTo = upper.find((x) => section(x.name) === section(c.name)) ?? (upper.length === 1 ? upper[0] : undefined);
      const repeatIn = targetClasses.data?.find((x) => x.code === c.code);
      out[c.id] = { promotedTo: promotedTo?.id ?? '', repeatIn: repeatIn?.id ?? '' };
    }
    return out;
  }, [levels.data, sourceClasses.data, targetClasses.data]);
  const classMap = Object.fromEntries(Object.entries(suggested).map(([id, s]) => [id, map[id] ?? s]));
  const body = target && {
    targetYearId: target.id,
    classMap: Object.entries(classMap).map(([fromClassId, m]) => ({ fromClassId, ...(m.promotedTo && { promotedTo: m.promotedTo }), ...(m.repeatIn && { repeatIn: m.repeatIn }) })),
  };
  const preview = useQuery({
    queryKey: [tenantId, 'rollover-preview', source?.id, JSON.stringify(body)],
    queryFn: () => api<Preview>(`/academic-years/${source!.id}/rollover/preview`, { method: 'POST', body }),
    enabled: Boolean(source && body),
  });

  const copy = useTenantMutation<{ fromYearId: string }, { created: number; skipped: number }>('POST', `/academic-years/${target?.id}/copy-classes`, [['classes', target?.id]]);
  const [closeSource, setCloseSource] = useState(true);
  const commit = useTenantMutation<object, { promoted: number; repeating: number; graduated: number; left: number; billed: number }>('POST', `/academic-years/${source?.id}/rollover`, [
    ['classes'],
    ['students'],
    ['academic-years'],
  ]);

  if (years.isPending) return <Loading />;
  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.promotion')} description={t('promotion.intro')} />

      <Card title={t('promotion.step1')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('promotion.closingYear')}>
            <Select value={source?.id ?? ''} onChange={(e) => (setSourceId(e.target.value), setTargetId(''), setMap({}))}>
              {years.data?.filter((y) => y.status !== 'CLOSED').map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('promotion.nextYear')}>
            <Select value={target?.id ?? ''} onChange={(e) => (setTargetId(e.target.value), setMap({}))}>
              {targets.length === 0 && <option value="">—</option>}
              {targets.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {targets.length === 0 && (
          <p className="mt-3 text-sm text-slate-600">
            {t('promotion.noNextYear')}{' '}
            <Link to="/academic-years" className="text-accent-700 hover:underline">
              {t('nav.academicYears')}
            </Link>
          </p>
        )}
      </Card>

      {source && target && (
        <Card title={t('promotion.step2', { year: target.name })}>
          <p className="text-sm text-slate-600">
            {targetClasses.data?.length ? t('promotion.classesReady', { count: targetClasses.data.length }) : t('promotion.noClasses', { year: target.name })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant={targetClasses.data?.length ? 'secondary' : 'primary'} disabled={copy.isPending} onClick={() => copy.mutate({ fromYearId: source.id })}>
              {t('promotion.copyClasses', { year: source.name })}
            </Button>
            {copy.data && <span className="text-sm text-success-600">{t('promotion.copied', { created: copy.data.created, skipped: copy.data.skipped })}</span>}
          </div>
          <ErrorMessage error={copy.error} />
        </Card>
      )}

      {source && target && <Decisions yearId={source.id} rows={preview.data?.rows} onSaved={() => qc.invalidateQueries({ queryKey: [tenantId, 'rollover-preview'] })} />}

      {source && target && (targetClasses.data?.length ?? 0) > 0 && (
        <Card title={t('promotion.step4')}>
          <p className="mb-3 text-sm text-slate-600">{t('promotion.mapHelp')}</p>
          <Table head={[t('promotion.thisYearClass'), t('promotion.promotedTo'), t('promotion.repeatIn')]}>
            {sourceClasses.data?.map((c) => {
              const m = classMap[c.id] ?? { promotedTo: '', repeatIn: '' };
              const pick = (k: 'promotedTo' | 'repeatIn', v: string) => setMap({ ...map, [c.id]: { ...m, [k]: v } });
              return (
                <tr key={c.id}>
                  <td className="font-medium">
                    {c.name}
                    <span className="block text-xs font-normal text-slate-500">{label(levels.data?.find((l) => l.id === c.levelId))}</span>
                  </td>
                  {(['promotedTo', 'repeatIn'] as const).map((k) => (
                    <td key={k}>
                      <Select value={m[k]} onChange={(e) => pick(k, e.target.value)} aria-label={`${c.name} — ${t(`promotion.${k}`)}`}>
                        <option value="">{k === 'promotedTo' ? t('promotion.noUpperClass') : '—'}</option>
                        {targetClasses.data?.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                  ))}
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {source && target && preview.data && (
        <Card title={t('promotion.step5')}>
          <ul className="flex flex-wrap gap-2 text-sm">
            {(['promote', 'repeat', 'graduate', 'leave', 'alreadyEnrolled'] as const).map((k) => (
              <li key={k} className="rounded-md bg-slate-50 px-3 py-2">
                <span className="tabular text-lg font-bold">{preview.data.summary[k]}</span> {t(`promotion.summary.${k}`)}
              </li>
            ))}
          </ul>
          {preview.data.summary.exceptions > 0 && (
            <div role="alert" className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">{t('promotion.exceptions', { count: preview.data.summary.exceptions })}</p>
              <ul className="mt-1 list-inside list-disc">
                {preview.data.rows
                  .filter((r) => r.exception)
                  .slice(0, 12)
                  .map((r) => (
                    <li key={r.enrollmentId}>
                      {r.student.lastName} {r.student.firstName} ({r.fromClass}) — {t(`promotion.exception.${r.exception}`)}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          <label className="mt-4 flex items-center gap-3 text-sm">
            <input type="checkbox" checked={closeSource} onChange={(e) => setCloseSource(e.target.checked)} />
            {t('promotion.closeSource', { year: source.name })}
          </label>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              disabled={!preview.data.canCommit || commit.isPending || commit.isSuccess}
              onClick={() => window.confirm(t('promotion.confirm', { year: target.name })) && body && commit.mutate({ ...body, closeSourceYear: closeSource })}
            >
              {t('promotion.commit')}
            </Button>
          </div>
          {commit.data && (
            <p role="status" className="mt-3 text-sm text-success-600">
              {t('promotion.done', { ...commit.data, year: target.name })}
            </p>
          )}
          <ErrorMessage error={commit.error ?? preview.error} />
        </Card>
      )}
    </div>
  );
}

/** Step 3: each pupil's decision, grouped by class; saved ones come from the class council or this screen. */
function Decisions({ yearId, rows, onSaved }: { yearId: string; rows: PreviewRow[] | undefined; onSaved: () => void }) {
  const { t } = useTranslation();
  const [edits, setEdits] = useState<Record<string, Outcome>>({});
  const save = useTenantMutation<{ decisions: { enrollmentId: string; decision: Outcome }[] }, { changed: number }>('PUT', `/academic-years/${yearId}/promotion-decisions`);
  if (!rows) return null;
  const byClass = new Map<string, PreviewRow[]>();
  for (const r of rows) byClass.set(r.fromClass, [...(byClass.get(r.fromClass) ?? []), r]);
  const pending = Object.entries(edits).filter(([id, d]) => rows.find((r) => r.enrollmentId === id)?.decision !== d);
  const value = (r: PreviewRow) => edits[r.enrollmentId] ?? r.decision ?? '';

  return (
    <Card title={t('promotion.step3')}>
      <p className="mb-3 text-sm text-slate-600">{t('promotion.decisionsHelp')}</p>
      {rows.length === 0 ? (
        <Empty>{t('promotion.noPupils')}</Empty>
      ) : (
        <div className="space-y-5">
          {[...byClass].map(([cls, list]) => (
            <section key={cls}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {cls} <span className="text-sm font-normal text-slate-500">· {t('promotion.pupils', { count: list.length })}</span>
                </h3>
                <Button variant="ghost" onClick={() => setEdits({ ...edits, ...Object.fromEntries(list.filter((r) => !value(r)).map((r) => [r.enrollmentId, 'PROMOTED' as Outcome])) })}>
                  {t('promotion.allUndecidedPass')}
                </Button>
              </div>
              <Table head={[t('students.name'), t('reportCards.decision')]}>
                {list.map((r) => (
                  <tr key={r.enrollmentId} className={value(r) ? '' : 'bg-amber-50'}>
                    <td>
                      <p className="font-medium">
                        {r.student.lastName} {r.student.firstName}
                      </p>
                      <p className="tabular text-xs text-slate-500">{r.student.matricule}</p>
                    </td>
                    <td>
                      {r.action === 'ALREADY_ENROLLED' ? (
                        <Badge>{t('promotion.summary.alreadyEnrolled')}</Badge>
                      ) : (
                        <Select className="w-48" value={value(r)} onChange={(e) => setEdits({ ...edits, [r.enrollmentId]: e.target.value as Outcome })} aria-label={`${r.student.lastName} — ${t('reportCards.decision')}`}>
                          <option value="">{t('promotion.undecided')}</option>
                          {OUTCOMES.map((o) => (
                            <option key={o} value={o}>
                              {t(`reportCards.outcomes.${o}`)}
                            </option>
                          ))}
                        </Select>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            </section>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          disabled={pending.length === 0 || save.isPending}
          onClick={() =>
            save.mutate(
              { decisions: pending.map(([enrollmentId, decision]) => ({ enrollmentId, decision })) },
              {
                onSuccess: () => {
                  setEdits({});
                  onSaved();
                },
              },
            )
          }
        >
          {t('promotion.saveDecisions', { count: pending.length })}
        </Button>
        {save.data && <span className="text-sm text-success-600">{t('promotion.decisionsSaved', { count: save.data.changed })}</span>}
      </div>
      <ErrorMessage error={save.error} />
    </Card>
  );
}
