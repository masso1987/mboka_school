import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { GUARDIAN_RELATIONSHIPS } from '@mboka/shared';
import { Badge, Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table } from '../components/ui';
import { ApiRequestError } from '../lib/api';
import { useCurrentYear, useDateFormat, useSchoolToday, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { Page, SchoolClass, StudentFile, StudentRow } from '../lib/types';

const statusTone = (s: string) =>
  s === 'ACTIVE' || s === 'ENROLLED' ? 'green' : s === 'TRANSFERRED' || s === 'WITHDRAWN' ? 'amber' : s === 'ARCHIVED' ? 'slate' : 'blue';

export function StudentsPage() {
  const { t } = useTranslation();
  const { can } = useSession();
  const fmt = useDateFormat();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const students = useTenantQuery<Page<StudentRow>>(
    ['students', q, page],
    `/students?page=${page}&pageSize=25${q ? `&q=${encodeURIComponent(q)}` : ''}`,
  );
  const pages = students.data ? Math.max(1, Math.ceil(students.data.total / students.data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('nav.students')}
        actions={can('students.create') && <Button onClick={() => setCreating((v) => !v)}>{creating ? t('common.cancel') : t('students.new')}</Button>}
      />
      {creating && <NewStudentForm onDone={() => setCreating(false)} />}
      <Card>
        <Input
          type="search"
          placeholder={t('students.search')}
          aria-label={t('students.search')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          className="mb-4 max-w-md"
        />
        {students.isPending ? (
          <Loading />
        ) : students.isError ? (
          <ErrorMessage error={students.error} />
        ) : students.data.items.length === 0 ? (
          <Empty>{q ? t('students.noMatch') : t('students.empty')}</Empty>
        ) : (
          <>
            <Table head={[t('students.matricule'), t('students.name'), t('students.dateOfBirth'), t('students.class'), t('common.status')]}>
              {students.data.items.map((s) => (
                <tr key={s.id}>
                  <td className="tabular">{s.matricule}</td>
                  <td>
                    <Link to={`/students/${s.id}`} className="font-medium text-accent-700 hover:underline">
                      {s.lastName} {s.firstName}
                    </Link>
                  </td>
                  <td className="tabular">{fmt(s.dateOfBirth)}</td>
                  <td>{s.currentClass?.name ?? '—'}</td>
                  <td>
                    <Badge tone={statusTone(s.status)}>{t(`students.statuses.${s.status}`)}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
            <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
              <span>{t('common.total', { count: students.data.total })}</span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  ←
                </Button>
                <span className="tabular">
                  {page} / {pages}
                </span>
                <Button variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                  →
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function NewStudentForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const empty = {
    firstName: '',
    lastName: '',
    gender: '',
    dateOfBirth: '',
    placeOfBirth: '',
    gFirstName: '',
    gLastName: '',
    gPhone: '',
    relationship: 'MOTHER',
  };
  const [f, setF] = useState(empty);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const create = useTenantMutation<object, StudentRow>('POST', '/students', [['students']]);
  const duplicate = create.error instanceof ApiRequestError && create.error.code === 'POSSIBLE_DUPLICATE';

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        firstName: f.firstName,
        lastName: f.lastName,
        dateOfBirth: f.dateOfBirth,
        ...(f.gender && { gender: f.gender }),
        ...(f.placeOfBirth && { placeOfBirth: f.placeOfBirth }),
        confirmDuplicate,
        guardians: f.gLastName
          ? [
              {
                guardian: { firstName: f.gFirstName, lastName: f.gLastName, ...(f.gPhone && { phone: f.gPhone }) },
                relationship: f.relationship,
                isPrimary: true,
                isEmergencyContact: true,
                canPickUp: true,
              },
            ]
          : [],
      },
      {
        onSuccess: (s) => {
          onDone();
          void navigate(`/students/${s.id}`);
        },
      },
    );
  }

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <Card title={t('students.new')}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('students.lastName')}>
            <Input required value={f.lastName} onChange={set('lastName')} />
          </Field>
          <Field label={t('students.firstName')}>
            <Input required value={f.firstName} onChange={set('firstName')} />
          </Field>
          <Field label={t('students.gender')}>
            <Select value={f.gender} onChange={set('gender')}>
              <option value="" />
              <option value="F">{t('students.genders.F')}</option>
              <option value="M">{t('students.genders.M')}</option>
            </Select>
          </Field>
          <Field label={t('students.dateOfBirth')}>
            <Input type="date" required value={f.dateOfBirth} onChange={set('dateOfBirth')} />
          </Field>
          <Field label={t('students.placeOfBirth')}>
            <Input value={f.placeOfBirth} onChange={set('placeOfBirth')} />
          </Field>
        </div>
        <fieldset className="rounded-md border border-slate-200 p-4">
          <legend className="px-1 text-sm font-medium">{t('students.guardian')}</legend>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label={t('students.lastName')}>
              <Input value={f.gLastName} onChange={set('gLastName')} />
            </Field>
            <Field label={t('students.firstName')}>
              <Input required={Boolean(f.gLastName)} value={f.gFirstName} onChange={set('gFirstName')} />
            </Field>
            <Field label={t('students.phone')}>
              <Input type="tel" placeholder="+237 6XX XX XX XX" value={f.gPhone} onChange={set('gPhone')} />
            </Field>
            <Field label={t('students.relationship')}>
              <Select value={f.relationship} onChange={set('relationship')}>
                {GUARDIAN_RELATIONSHIPS.map((r) => (
                  <option key={r} value={r}>
                    {t(`students.relationships.${r}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </fieldset>
        {duplicate ? (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p>{t('students.possibleDuplicate')}</p>
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={confirmDuplicate} onChange={(e) => setConfirmDuplicate(e.target.checked)} />
              {t('students.confirmDifferent')}
            </label>
          </div>
        ) : (
          <ErrorMessage error={create.error} />
        )}
        <p className="text-xs text-slate-500">{t('students.matriculeAuto')}</p>
        <Button type="submit" disabled={create.isPending || (duplicate && !confirmDuplicate)}>
          {t('common.save')}
        </Button>
      </form>
    </Card>
  );
}

export function StudentDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const fmt = useDateFormat();
  const { can } = useSession();
  const file = useTenantQuery<StudentFile>(['student', id], `/students/${id}`);

  if (file.isPending) return <Loading />;
  if (file.isError) return <ErrorMessage error={file.error} />;
  const s = file.data;
  const active = s.enrollments.find((e) => ['ENROLLED', 'REPEATING', 'PENDING'].includes(e.status));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${s.lastName} ${s.firstName}`}
        actions={<Link to="/students" className="text-sm text-accent-700 hover:underline">← {t('nav.students')}</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t('students.identity')}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">{t('students.matricule')}</dt>
            <dd className="tabular font-medium">{s.matricule}</dd>
            <dt className="text-slate-500">{t('students.dateOfBirth')}</dt>
            <dd>{fmt(s.dateOfBirth)}</dd>
            <dt className="text-slate-500">{t('students.placeOfBirth')}</dt>
            <dd>{s.placeOfBirth ?? '—'}</dd>
            <dt className="text-slate-500">{t('students.gender')}</dt>
            <dd>{s.gender ? t(`students.genders.${s.gender}`) : '—'}</dd>
            <dt className="text-slate-500">{t('common.status')}</dt>
            <dd>
              <Badge tone={statusTone(s.status)}>{t(`students.statuses.${s.status}`)}</Badge>
            </dd>
          </dl>
        </Card>

        <Card title={t('students.guardians')}>
          {s.guardians.length === 0 ? (
            <Empty>{t('students.noGuardians')}</Empty>
          ) : (
            <ul className="space-y-3 text-sm">
              {s.guardians.map((g) => (
                <li key={g.guardianId}>
                  <p className="font-medium">
                    {g.firstName} {g.lastName} {g.isPrimary && <Badge tone="blue">{t('students.primary')}</Badge>}
                  </p>
                  <p className="text-slate-600">
                    {t(`students.relationships.${g.relationship}`)}
                    {g.phone && <> · <a href={`tel:${g.phone}`} className="tabular hover:underline">{g.phone}</a></>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {can('enrollments.manage') && s.status !== 'ARCHIVED' && (
          <Card title={active ? t('students.currentEnrollment') : t('students.enroll')}>
            {active ? <ExitForm enrollmentId={active.id} studentId={s.id} /> : <EnrollForm studentId={s.id} />}
          </Card>
        )}
      </div>

      <Card title={t('students.history')}>
        {s.enrollments.length === 0 ? (
          <Empty>{t('students.noEnrollments')}</Empty>
        ) : (
          <Table head={[t('common.academicYear'), t('students.class'), t('students.enrolledOn'), t('students.leftOn'), t('common.status')]}>
            {s.enrollments.map((e) => (
              <tr key={e.id}>
                <td>{e.academicYear.name}</td>
                <td>{e.class.name}</td>
                <td className="tabular">{fmt(e.enrolledOn)}</td>
                <td className="tabular">
                  {fmt(e.leftOn)}
                  {e.leftReason && <span className="block text-xs text-slate-500">{e.leftReason}</span>}
                </td>
                <td>
                  <Badge tone={statusTone(e.status)}>{t(`enrollments.statuses.${e.status}`)}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function EnrollForm({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  const today = useSchoolToday();
  const { current } = useCurrentYear();
  const classes = useTenantQuery<SchoolClass[]>(['classes', current?.id], current ? `/classes?academicYearId=${current.id}` : null);
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('ENROLLED');
  const enroll = useTenantMutation<object>('POST', '/enrollments', [['student', studentId], ['students'], ['classes']]);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        enroll.mutate({ studentId, classId, enrolledOn: today, status });
      }}
    >
      <Field label={`${t('students.class')} (${current?.name ?? ''})`}>
        <Select required value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="" />
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} — {c.studentCount}/{c.capacity ?? '∞'}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('common.status')}>
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="ENROLLED">{t('enrollments.statuses.ENROLLED')}</option>
          <option value="REPEATING">{t('enrollments.statuses.REPEATING')}</option>
        </Select>
      </Field>
      <ErrorMessage error={enroll.error} />
      <Button type="submit" disabled={enroll.isPending}>
        {t('students.enroll')}
      </Button>
    </form>
  );
}

function ExitForm({ enrollmentId, studentId }: { enrollmentId: string; studentId: string }) {
  const { t } = useTranslation();
  const today = useSchoolToday();
  const [f, setF] = useState({ status: 'TRANSFERRED', leftOn: today, reason: '' });
  const exit = useTenantMutation<object>('POST', `/enrollments/${enrollmentId}/exit`, [['student', studentId], ['students'], ['classes']]);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (window.confirm(t('students.exitConfirm'))) exit.mutate(f);
      }}
    >
      <p className="text-sm text-slate-600">{t('students.exitHelp')}</p>
      <Field label={t('students.exitType')}>
        <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          {['TRANSFERRED', 'WITHDRAWN', 'COMPLETED'].map((s) => (
            <option key={s} value={s}>
              {t(`enrollments.statuses.${s}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('students.leftOn')}>
        <Input type="date" required value={f.leftOn} onChange={(e) => setF({ ...f, leftOn: e.target.value })} />
      </Field>
      <Field label={t('common.reason')}>
        <Input required minLength={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
      <ErrorMessage error={exit.error} />
      <Button type="submit" variant="danger" disabled={exit.isPending}>
        {t('students.exit')}
      </Button>
    </form>
  );
}
