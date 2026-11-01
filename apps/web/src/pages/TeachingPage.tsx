import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table, Tabs } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import { useCurrentYear, useDateFormat, useLabel, useSchoolToday, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { Assignment, ClassDetail, Page, Room, SchoolClass, StaffRow, TimetableEntry } from '../lib/types';

type Tab = 'timetable' | 'assignments' | 'rooms';
const WEEKDAYS = [1, 2, 3, 4, 5, 6];

export function TeachingPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('timetable');
  const items: { key: Tab; label: string }[] = [{ key: 'timetable', label: t('teaching.tabs.timetable') }];
  if (can('academics.years.read')) items.push({ key: 'assignments', label: t('teaching.tabs.assignments') });
  if (can('timetable.read')) items.push({ key: 'rooms', label: t('teaching.tabs.rooms') });
  return (
    <div>
      <PageHeader title={t('nav.teaching')} />
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === 'timetable' && <TimetableTab />}
      {tab === 'assignments' && <AssignmentsTab />}
      {tab === 'rooms' && <RoomsTab />}
    </div>
  );
}

function useYearClasses() {
  const { current } = useCurrentYear();
  const classes = useTenantQuery<SchoolClass[]>(['classes', current?.id], current ? `/classes?academicYearId=${current.id}` : null);
  return { year: current, classes };
}

function TimetableTab() {
  const { t } = useTranslation();
  const { can } = useSession();
  const { year, classes } = useYearClasses();
  const [classId, setClassId] = useState('');
  const active = classId || classes.data?.[0]?.id || '';
  const entries = useTenantQuery<TimetableEntry[]>(
    ['timetable', active],
    year && active ? `/timetable?academicYearId=${year.id}&classId=${active}` : null,
  );
  const teachers = useTenantQuery<Page<StaffRow>>(['staff', 'teachers'], can('hr.staff.read') ? '/staff?teachersOnly=true&pageSize=100' : null);
  const rooms = useTenantQuery<Room[]>(['rooms'], '/rooms');
  const empty = { weekday: '1', startTime: '07:30', endTime: '08:25', subjectLabel: '', staffId: '', roomId: '' };
  const [f, setF] = useState(empty);
  const create = useTenantMutation<object>('POST', '/timetable', [['timetable']]);
  const remove = useTenantMutation<string>('DELETE', (id) => `/timetable/${id}`, [['timetable']]);
  const conflicts =
    create.error instanceof ApiRequestError && create.error.code === 'TIMETABLE_CONFLICT'
      ? ((create.error.details as { conflicts: { on: string[]; subjectLabel?: string; class?: { name: string } }[] }).conflicts ?? [])
      : [];

  return (
    <div className="space-y-6">
      <Field label={t('students.class')} className="max-w-xs">
        <Select value={active} onChange={(e) => setClassId(e.target.value)}>
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>

      <Card>
        {entries.isPending ? (
          <Loading />
        ) : entries.data?.length === 0 ? (
          <Empty>{t('teaching.noLessons')}</Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {WEEKDAYS.map((d) => {
              const day = entries.data?.filter((e) => e.weekday === d) ?? [];
              return (
                <div key={d} className="rounded-md border border-slate-200">
                  <h3 className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-sm font-semibold">{t(`teaching.weekdays.${d}`)}</h3>
                  {day.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-400">—</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {day.map((e) => (
                        <li key={e.id} className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
                          <div>
                            <p className="tabular text-xs text-slate-500">
                              {e.startTime}–{e.endTime}
                            </p>
                            <p className="font-medium">{e.subjectLabel}</p>
                            <p className="text-xs text-slate-600">
                              {e.staff && `${e.staff.firstName} ${e.staff.lastName}`}
                              {e.room && ` · ${e.room.name}`}
                            </p>
                          </div>
                          {can('timetable.manage') && (
                            <button
                              type="button"
                              aria-label={t('common.delete')}
                              className="text-slate-400 hover:text-danger-600"
                              onClick={() => window.confirm(t('teaching.deleteConfirm')) && remove.mutate(e.id)}
                            >
                              ✕
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {can('timetable.manage') && year && active && (
        <Card title={t('teaching.newLesson')}>
          <form
            className="grid gap-4 sm:grid-cols-6"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(
                {
                  academicYearId: year.id,
                  classId: active,
                  weekday: Number(f.weekday),
                  startTime: f.startTime,
                  endTime: f.endTime,
                  subjectLabel: f.subjectLabel,
                  ...(f.staffId && { staffId: f.staffId }),
                  ...(f.roomId && { roomId: f.roomId }),
                },
                { onSuccess: () => setF({ ...f, subjectLabel: '' }) },
              );
            }}
          >
            <Field label={t('teaching.day')}>
              <Select value={f.weekday} onChange={(e) => setF({ ...f, weekday: e.target.value })}>
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>
                    {t(`teaching.weekdays.${d}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('teaching.start')}>
              <Input type="time" required value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} />
            </Field>
            <Field label={t('teaching.end')}>
              <Input type="time" required value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} />
            </Field>
            <Field label={t('classes.subject')}>
              <Input required value={f.subjectLabel} onChange={(e) => setF({ ...f, subjectLabel: e.target.value })} />
            </Field>
            <Field label={t('teaching.teacher')}>
              <Select value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
                <option value="" />
                {teachers.data?.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.lastName} {s.firstName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('teaching.room')}>
              <Select value={f.roomId} onChange={(e) => setF({ ...f, roomId: e.target.value })}>
                <option value="" />
                {rooms.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-6 space-y-2">
              {conflicts.length > 0 ? (
                <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-danger-600">
                  <p className="font-medium">{t('errors.TIMETABLE_CONFLICT')}</p>
                  <ul className="mt-1 list-inside list-disc">
                    {conflicts.map((c, i) => (
                      <li key={i}>
                        {c.on.map((o) => t(`teaching.conflictOn.${o}`)).join(', ')}
                        {c.subjectLabel && ` — ${c.subjectLabel}${c.class ? ` (${c.class.name})` : ''}`}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <ErrorMessage error={create.error} />
              )}
              <Button type="submit" disabled={create.isPending}>
                {t('common.add')}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function AssignmentsTab() {
  const { t } = useTranslation();
  const label = useLabel();
  const fmt = useDateFormat();
  const today = useSchoolToday();
  const { can } = useSession();
  const { year, classes } = useYearClasses();
  const assignments = useTenantQuery<Assignment[]>(['assignments', year?.id], year ? `/teaching-assignments?academicYearId=${year.id}` : null);
  const teachers = useTenantQuery<Page<StaffRow>>(['staff', 'teachers'], can('hr.staff.read') ? '/staff?teachersOnly=true&pageSize=100' : null);
  const [f, setF] = useState({ classId: '', classSubjectId: '', staffId: '', role: 'MAIN' });
  const classDetail = useTenantQuery<ClassDetail>(['class', f.classId], f.classId ? `/classes/${f.classId}` : null);
  const assign = useTenantMutation<object>('POST', '/teaching-assignments', [['assignments']]);
  const end = useTenantMutation<{ id: string; endDate: string }>('POST', (b) => `/teaching-assignments/${b.id}/end`, [['assignments']]);

  return (
    <div className="space-y-6">
      {can('academics.assignments.manage') && (
        <Card title={t('teaching.newAssignment')}>
          <form
            className="grid gap-4 sm:grid-cols-5"
            onSubmit={(e) => {
              e.preventDefault();
              assign.mutate({ classSubjectId: f.classSubjectId, staffId: f.staffId, role: f.role, startDate: today });
            }}
          >
            <Field label={t('students.class')}>
              <Select required value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value, classSubjectId: '' })}>
                <option value="" />
                {classes.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('classes.subject')}>
              <Select required value={f.classSubjectId} onChange={(e) => setF({ ...f, classSubjectId: e.target.value })}>
                <option value="" />
                {classDetail.data?.subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {label(s.subject)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('teaching.teacher')}>
              <Select required value={f.staffId} onChange={(e) => setF({ ...f, staffId: e.target.value })}>
                <option value="" />
                {teachers.data?.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.lastName} {s.firstName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('teaching.role')}>
              <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                {['MAIN', 'CO_TEACHER', 'REPLACEMENT'].map((r) => (
                  <option key={r} value={r}>
                    {t(`teaching.roles.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={assign.isPending} className="w-full">
                {t('teaching.assign')}
              </Button>
            </div>
            <div className="sm:col-span-5">
              <ErrorMessage error={assign.error} />
            </div>
          </form>
        </Card>
      )}
      <Card>
        {assignments.isPending ? (
          <Loading />
        ) : assignments.data?.length === 0 ? (
          <Empty>{t('teaching.noAssignments')}</Empty>
        ) : (
          <Table head={[t('teaching.teacher'), t('students.class'), t('classes.subject'), t('teaching.role'), t('teaching.period'), '']}>
            {assignments.data?.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.staff.lastName} {a.staff.firstName}
                </td>
                <td>{a.class.name}</td>
                <td>{label(a.subject)}</td>
                <td>
                  <Badge tone={a.role === 'MAIN' ? 'blue' : 'slate'}>{t(`teaching.roles.${a.role}`)}</Badge>
                </td>
                <td className="tabular text-xs">
                  {fmt(a.startDate)} → {a.endDate ? fmt(a.endDate) : t('teaching.ongoing')}
                </td>
                <td className="text-right">
                  {!a.endDate && can('academics.assignments.manage') && (
                    <Button variant="ghost" onClick={() => window.confirm(t('teaching.endConfirm')) && end.mutate({ id: a.id, endDate: today })}>
                      {t('teaching.endAssignment')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function RoomsTab() {
  const { t } = useTranslation();
  const { can, context } = useSession();
  const rooms = useTenantQuery<Room[]>(['rooms'], '/rooms');
  const empty = { code: '', name: '', capacity: '' };
  const [f, setF] = useState(empty);
  const create = useTenantMutation<object>('POST', '/rooms', [['rooms']]);

  return (
    <div className="space-y-6">
      {can('timetable.manage') && (
        <Card title={t('teaching.newRoom')}>
          <form
            className="grid gap-4 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(
                { campusId: context!.tenant.campuses[0]!.id, code: f.code, name: f.name, ...(f.capacity && { capacity: Number(f.capacity) }) },
                { onSuccess: () => setF(empty) },
              );
            }}
          >
            <Field label={t('common.code')}>
              <Input required value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
            </Field>
            <Field label={t('common.name')}>
              <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label={t('classes.capacity')}>
              <Input type="number" min={1} value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending} className="w-full">
                {t('common.add')}
              </Button>
            </div>
            <div className="sm:col-span-4">
              <ErrorMessage error={create.error} />
            </div>
          </form>
        </Card>
      )}
      <Card>
        {rooms.isPending ? (
          <Loading />
        ) : rooms.data?.length === 0 ? (
          <Empty>{t('teaching.noRooms')}</Empty>
        ) : (
          <Table head={[t('common.code'), t('common.name'), t('classes.capacity')]}>
            {rooms.data?.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.code}</td>
                <td>{r.name}</td>
                <td className="tabular">{r.capacity ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
