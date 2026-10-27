import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_STATUSES, type AttendanceSubmitInput } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { useCurrentYear, useDateFormat, useSchoolToday, useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { Assignment, AttendanceStatus, Register, SchoolClass } from '../lib/types';

type SyncState = 'idle' | 'saving' | 'saved' | 'pending' | 'conflict' | 'error';

const tone: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-green-600 text-white',
  ABSENT: 'bg-danger-600 text-white',
  LATE: 'bg-amber-500 text-white',
  EXCUSED: 'bg-slate-600 text-white',
};

/**
 * Pending submissions are kept in localStorage with their operation id until the server
 * confirms them, so a reload or a dropped connection never loses or duplicates a register (§10).
 */
function pendingKey(tenantId: string, classId: string, date: string) {
  return `mboka.attendance.pending.${tenantId}.${classId}.${date}`;
}
function readPending(key: string): AttendanceSubmitInput | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as AttendanceSubmitInput) : null;
  } catch {
    return null;
  }
}
function writePending(key: string, value: AttendanceSubmitInput | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    // Storage unavailable: the in-memory retry still works for this page.
  }
}

export function AttendancePage() {
  const { t } = useTranslation();
  const { can, tenantId } = useSession();
  const today = useSchoolToday();
  const fmt = useDateFormat();
  const qc = useQueryClient();
  const seesAllClasses = can('attendance.correct') || can('attendance.read');
  const { current } = useCurrentYear();
  const allClasses = useTenantQuery<SchoolClass[]>(['classes', current?.id], seesAllClasses && current ? `/classes?academicYearId=${current.id}` : null);
  const mine = useTenantQuery<{ assignments: Assignment[] }>(['my-assignments'], seesAllClasses ? null : '/me/assignments');

  const classOptions = useMemo(() => {
    if (seesAllClasses) return allClasses.data?.map((c) => ({ id: c.id, name: c.name })) ?? [];
    const seen = new Map<string, string>();
    mine.data?.assignments.forEach((a) => seen.set(a.class.id, a.class.name));
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [seesAllClasses, allClasses.data, mine.data]);

  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(today);
  const activeClass = classId || classOptions[0]?.id || '';

  const register = useTenantQuery<Register>(
    ['register', activeClass, date],
    activeClass ? `/attendance/register?classId=${activeClass}&date=${date}` : null,
  );

  const [marks, setMarks] = useState<Record<string, { status: AttendanceStatus; arrivalTime?: string }>>({});
  const [reason, setReason] = useState('');
  const [sync, setSync] = useState<SyncState>('idle');
  const [error, setError] = useState<unknown>(null);
  const key = tenantId && activeClass ? pendingKey(tenantId, activeClass, date) : '';
  const loadedKey = useRef('');

  // Initialise local marks from the server register, or from an unsent pending submission.
  useEffect(() => {
    if (!register.data) return;
    const pending = key ? readPending(key) : null;
    const initial: typeof marks = {};
    for (const s of register.data.students) initial[s.studentId] = { status: s.status ?? 'PRESENT', arrivalTime: s.arrivalTime ?? undefined };
    if (pending) for (const r of pending.records) initial[r.studentId] = { status: r.status, arrivalTime: r.arrivalTime };
    setMarks(initial);
    setReason(pending?.correctionReason ?? '');
    // The refetch that follows a save must not hide the "saved" confirmation; a new class or date does.
    const sameRegister = loadedKey.current === key;
    loadedKey.current = key;
    setSync((s) => (pending ? 'pending' : sameRegister && s === 'saved' ? 'saved' : 'idle'));
    if (!sameRegister) setError(null);
  }, [register.data, key]);

  const send = useCallback(
    async (payload: AttendanceSubmitInput) => {
      setSync('saving');
      setError(null);
      try {
        await api('/attendance/submit', { method: 'POST', body: payload });
        writePending(key, null);
        setSync('saved');
        await qc.invalidateQueries({ queryKey: [tenantId, 'register', payload.classId, payload.date] });
      } catch (e) {
        if (!(e instanceof ApiRequestError)) {
          setSync('pending'); // network failure: keep the operation, retry later with the same id
          return;
        }
        writePending(key, null);
        setError(e);
        setSync(e.code === 'ATTENDANCE_CONFLICT' ? 'conflict' : 'error');
      }
    },
    [key, qc, tenantId],
  );

  // Retry automatically when connectivity returns.
  useEffect(() => {
    const retry = () => {
      const pending = key ? readPending(key) : null;
      if (pending) void send(pending);
    };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [key, send]);

  function save() {
    if (!register.data) return;
    const existing = key ? readPending(key) : null;
    const payload: AttendanceSubmitInput = {
      // Reuse the id of an unsent submission so a retry can never be applied twice.
      operationId: existing?.operationId ?? crypto.randomUUID(),
      classId: activeClass,
      date,
      slot: 'DAY',
      baseVersion: register.data.version,
      ...(reason && { correctionReason: reason }),
      records: register.data.students.map((s) => ({
        studentId: s.studentId,
        status: marks[s.studentId]?.status ?? 'PRESENT',
        ...(marks[s.studentId]?.status === 'LATE' && marks[s.studentId]?.arrivalTime && { arrivalTime: marks[s.studentId]!.arrivalTime }),
      })),
    };
    writePending(key, payload);
    void send(payload);
  }

  function reload() {
    writePending(key, null);
    void register.refetch();
  }

  const reg = register.data;
  const counts = Object.values(marks).reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.status]: (acc[m.status] ?? 0) + 1 }), {});
  const editable = Boolean(reg?.canRecord) && (reg?.isToday || reg?.canCorrect);

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.attendance')} />
      <div className="flex flex-wrap items-end gap-4">
        <Field label={t('students.class')} className="min-w-48">
          <Select value={activeClass} onChange={(e) => setClassId(e.target.value)}>
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('attendance.date')}>
          <Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value || today)} />
        </Field>
        <SyncBadge state={sync} />
      </div>

      {classOptions.length === 0 && !allClasses.isPending && !mine.isPending ? (
        <Card>
          <Empty>{t('attendance.noClasses')}</Empty>
        </Card>
      ) : register.isPending ? (
        <Loading />
      ) : register.isError ? (
        <ErrorMessage error={register.error} />
      ) : reg && reg.students.length === 0 ? (
        <Card>
          <Empty>{t('attendance.noStudents')}</Empty>
        </Card>
      ) : reg ? (
        <Card
          title={`${reg.class.name} — ${fmt(reg.date)}`}
          actions={
            <span className="text-sm text-slate-600">
              {reg.version > 0 ? t('attendance.recordedVersion', { version: reg.version }) : t('attendance.notYetTaken')}
            </span>
          }
        >
          <div className="mb-4 flex flex-wrap gap-2 text-sm">
            {ATTENDANCE_STATUSES.map((s) => (
              <span key={s} className="rounded-full bg-slate-100 px-3 py-1">
                {t(`attendance.statuses.${s}`)} : <span className="tabular font-medium">{counts[s] ?? 0}</span>
              </span>
            ))}
          </div>
          <ul className="divide-y divide-slate-100">
            {reg.students.map((s) => {
              const m = marks[s.studentId];
              return (
                <li key={s.studentId} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium">
                      {s.lastName} {s.firstName}
                    </p>
                    <p className="tabular text-xs text-slate-500">{s.matricule}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label={`${s.lastName} ${s.firstName}`}>
                    {ATTENDANCE_STATUSES.map((st) => (
                      <button
                        key={st}
                        type="button"
                        role="radio"
                        aria-checked={m?.status === st}
                        disabled={!editable}
                        onClick={() => setMarks({ ...marks, [s.studentId]: { status: st, arrivalTime: m?.arrivalTime } })}
                        className={`min-w-11 rounded-md px-2 py-2 text-xs font-semibold disabled:opacity-50 ${
                          m?.status === st ? tone[st] : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {t(`attendance.short.${st}`)}
                      </button>
                    ))}
                    {m?.status === 'LATE' && (
                      <input
                        type="time"
                        aria-label={t('attendance.arrival')}
                        value={m.arrivalTime ?? ''}
                        disabled={!editable}
                        onChange={(e) => setMarks({ ...marks, [s.studentId]: { status: 'LATE', arrivalTime: e.target.value } })}
                        className="ml-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {editable ? (
            <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
              {reg.version > 0 && (
                <Field label={t('attendance.correctionReason')} hint={t('attendance.correctionHint')}>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                </Field>
              )}
              {sync === 'conflict' ? (
                <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p>{t('attendance.conflict')}</p>
                  <Button variant="secondary" className="mt-2" onClick={reload}>
                    {t('attendance.reload')}
                  </Button>
                </div>
              ) : (
                <ErrorMessage error={error} />
              )}
              <div className="flex gap-2">
                <Button onClick={save} disabled={sync === 'saving'}>
                  {sync === 'saving' ? t('common.loading') : t('attendance.save')}
                </Button>
                {sync === 'pending' && (
                  <Button variant="secondary" onClick={() => readPending(key) && void send(readPending(key)!)}>
                    {t('common.retry')}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{reg.canRecord ? t('attendance.pastDayReadOnly') : t('attendance.readOnly')}</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function SyncBadge({ state }: { state: SyncState }) {
  const { t } = useTranslation();
  if (state === 'idle' || state === 'saving') return null;
  const tones = { saved: 'green', pending: 'amber', conflict: 'red', error: 'red' } as const;
  return (
    <span role="status" className="pb-2">
      <Badge tone={tones[state]}>{t(`attendance.sync.${state}`)}</Badge>
    </span>
  );
}
