import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { EDUCATION_CYCLES } from '@mboka/shared';
import { Button, Card, Empty, ErrorMessage, Field, Input, Loading, PageHeader, Select, Table, Tabs } from '../components/ui';
import { useCurrentYear, useLabel, useTenantMutation, useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';
import type { ClassDetail, EducationLevel, SchoolClass, Subject } from '../lib/types';

type Tab = 'classes' | 'levels' | 'subjects';

export function ClassesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('classes');
  return (
    <div>
      <PageHeader title={t('nav.classes')} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'classes', label: t('classes.tabs.classes') },
          { key: 'levels', label: t('classes.tabs.levels') },
          { key: 'subjects', label: t('classes.tabs.subjects') },
        ]}
      />
      {tab === 'classes' && <ClassesTab />}
      {tab === 'levels' && <LevelsTab />}
      {tab === 'subjects' && <SubjectsTab />}
    </div>
  );
}

function ClassesTab() {
  const { t } = useTranslation();
  const label = useLabel();
  const { can, context } = useSession();
  const { years, current } = useCurrentYear();
  const [yearId, setYearId] = useState<string>();
  const activeYear = yearId ?? current?.id;
  const classes = useTenantQuery<SchoolClass[]>(['classes', activeYear], activeYear ? `/classes?academicYearId=${activeYear}` : null);
  const levels = useTenantQuery<EducationLevel[]>(['levels'], '/education-levels');
  const empty = { code: '', name: '', levelId: '', capacity: '' };
  const [form, setForm] = useState(empty);
  const create = useTenantMutation<object>('POST', '/classes', [['classes']]);

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate(
      {
        academicYearId: activeYear,
        campusId: context!.tenant.campuses[0]!.id,
        levelId: form.levelId,
        code: form.code,
        name: form.name,
        ...(form.capacity && { capacity: Number(form.capacity) }),
      },
      { onSuccess: () => setForm(empty) },
    );
  }

  return (
    <div className="space-y-6">
      <Field label={t('common.academicYear')} className="max-w-xs">
        <Select value={activeYear ?? ''} onChange={(e) => setYearId(e.target.value)}>
          {years.data?.map((y) => (
            <option key={y.id} value={y.id}>
              {y.name}
            </option>
          ))}
        </Select>
      </Field>

      {can('academics.structure.manage') && activeYear && (
        <Card title={t('classes.new')}>
          {levels.data?.length === 0 ? (
            <p className="text-sm text-slate-600">{t('classes.needLevels')}</p>
          ) : (
            <form onSubmit={submit} className="grid gap-4 sm:grid-cols-5">
              <Field label={t('common.code')}>
                <Input required value={form.code} placeholder="6EA" onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </Field>
              <Field label={t('common.name')}>
                <Input required value={form.name} placeholder="6e A" onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label={t('classes.level')}>
                <Select required value={form.levelId} onChange={(e) => setForm({ ...form, levelId: e.target.value })}>
                  <option value="" />
                  {levels.data?.map((l) => (
                    <option key={l.id} value={l.id}>
                      {label(l)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('classes.capacity')}>
                <Input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </Field>
              <div className="flex items-end">
                <Button type="submit" disabled={create.isPending} className="w-full">
                  {t('common.add')}
                </Button>
              </div>
              <div className="sm:col-span-5">
                <ErrorMessage error={create.error} />
              </div>
            </form>
          )}
        </Card>
      )}

      <Card>
        {classes.isPending ? (
          <Loading />
        ) : classes.isError ? (
          <ErrorMessage error={classes.error} />
        ) : classes.data.length === 0 ? (
          <Empty>{t('classes.empty')}</Empty>
        ) : (
          <Table head={[t('common.code'), t('common.name'), t('classes.level'), t('classes.students'), t('classes.capacity')]}>
            {classes.data.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">
                  <Link to={`/classes/${c.id}`} className="text-accent-700 hover:underline">
                    {c.code}
                  </Link>
                </td>
                <td>{c.name}</td>
                <td>{c.level && label(c.level)}</td>
                <td className="tabular">{c.studentCount}</td>
                <td className="tabular">{c.capacity ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

export function ClassDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const label = useLabel();
  const { can } = useSession();
  const detail = useTenantQuery<ClassDetail>(['class', id], `/classes/${id}`);
  const roster = useTenantQuery<{ id: string; student: { id: string; matricule: string; firstName: string; lastName: string } }[]>(
    ['roster', id],
    `/classes/${id}/enrollments`,
  );
  const subjects = useTenantQuery<Subject[]>(['subjects'], '/subjects');
  const [form, setForm] = useState({ subjectId: '', coefficient: '1', weeklyHours: '2' });
  const add = useTenantMutation<object>('POST', `/classes/${id}/subjects`, [['class', id]]);

  if (detail.isPending) return <Loading />;
  if (detail.isError) return <ErrorMessage error={detail.error} />;
  const c = detail.data;
  const taken = new Set(c.subjects.map((s) => s.subjectId));

  return (
    <div className="space-y-6">
      <PageHeader title={`${c.name} (${c.code})`} actions={<Link to="/classes" className="text-sm text-accent-700 hover:underline">← {t('nav.classes')}</Link>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('classes.subjects')}>
          {c.subjects.length === 0 ? (
            <Empty>{t('classes.noSubjects')}</Empty>
          ) : (
            <Table head={[t('classes.subject'), t('classes.coefficient'), t('classes.weeklyHours')]}>
              {c.subjects.map((s) => (
                <tr key={s.id}>
                  <td>{label(s.subject)}</td>
                  <td className="tabular">{s.coefficient}</td>
                  <td className="tabular">{s.weeklyHours}</td>
                </tr>
              ))}
            </Table>
          )}
          {can('academics.structure.manage') && (
            <form
              className="mt-4 grid gap-3 sm:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                add.mutate(
                  { subjectId: form.subjectId, coefficient: Number(form.coefficient), weeklyHours: Number(form.weeklyHours) },
                  { onSuccess: () => setForm({ ...form, subjectId: '' }) },
                );
              }}
            >
              <Field label={t('classes.subject')} className="sm:col-span-2">
                <Select required value={form.subjectId} onChange={(e) => setForm({ ...form, subjectId: e.target.value })}>
                  <option value="" />
                  {subjects.data
                    ?.filter((s) => !taken.has(s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {label(s)}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label={t('classes.coefficient')}>
                <Input type="number" min={0.5} step={0.5} required value={form.coefficient} onChange={(e) => setForm({ ...form, coefficient: e.target.value })} />
              </Field>
              <Field label={t('classes.weeklyHours')}>
                <Input type="number" min={0} step={0.5} required value={form.weeklyHours} onChange={(e) => setForm({ ...form, weeklyHours: e.target.value })} />
              </Field>
              <div className="sm:col-span-4 flex items-center gap-3">
                <Button type="submit" disabled={add.isPending}>
                  {t('common.add')}
                </Button>
                <ErrorMessage error={add.error} />
              </div>
            </form>
          )}
        </Card>

        <Card title={`${t('classes.students')} (${roster.data?.length ?? 0})`}>
          {roster.isPending ? (
            <Loading />
          ) : roster.data?.length === 0 ? (
            <Empty>{t('classes.noStudents')}</Empty>
          ) : (
            <Table head={[t('students.matricule'), t('students.name')]}>
              {roster.data?.map((e) => (
                <tr key={e.id}>
                  <td className="tabular">{e.student.matricule}</td>
                  <td>
                    <Link to={`/students/${e.student.id}`} className="text-accent-700 hover:underline">
                      {e.student.lastName} {e.student.firstName}
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

function LevelsTab() {
  const { t } = useTranslation();
  const label = useLabel();
  const { can } = useSession();
  const levels = useTenantQuery<EducationLevel[]>(['levels'], '/education-levels');
  const empty = { code: '', nameFr: '', nameEn: '', cycle: 'SECONDARY_FIRST', position: '' };
  const [form, setForm] = useState(empty);
  const create = useTenantMutation<object>('POST', '/education-levels', [['levels']]);

  return (
    <div className="space-y-6">
      {can('academics.structure.manage') && (
        <Card title={t('classes.newLevel')}>
          <form
            className="grid gap-4 sm:grid-cols-6"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate({ ...form, position: Number(form.position || 0) }, { onSuccess: () => setForm(empty) });
            }}
          >
            <Field label={t('common.code')}>
              <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label={t('common.nameFr')}>
              <Input required value={form.nameFr} onChange={(e) => setForm({ ...form, nameFr: e.target.value })} />
            </Field>
            <Field label={t('common.nameEn')}>
              <Input required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
            </Field>
            <Field label={t('classes.cycle')}>
              <Select value={form.cycle} onChange={(e) => setForm({ ...form, cycle: e.target.value })}>
                {EDUCATION_CYCLES.map((c) => (
                  <option key={c} value={c}>
                    {t(`classes.cycles.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('classes.order')}>
              <Input type="number" min={0} value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={create.isPending} className="w-full">
                {t('common.add')}
              </Button>
            </div>
            <div className="sm:col-span-6">
              <ErrorMessage error={create.error} />
            </div>
          </form>
        </Card>
      )}
      <Card>
        {levels.isPending ? (
          <Loading />
        ) : levels.data?.length === 0 ? (
          <Empty>{t('classes.noLevels')}</Empty>
        ) : (
          <Table head={[t('common.code'), t('common.name'), t('classes.cycle')]}>
            {levels.data?.map((l) => (
              <tr key={l.id}>
                <td className="font-medium">{l.code}</td>
                <td>{label(l)}</td>
                <td>{t(`classes.cycles.${l.cycle}`)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function SubjectsTab() {
  const { t } = useTranslation();
  const label = useLabel();
  const { can } = useSession();
  const subjects = useTenantQuery<Subject[]>(['subjects'], '/subjects');
  const empty = { code: '', nameFr: '', nameEn: '' };
  const [form, setForm] = useState(empty);
  const create = useTenantMutation<object>('POST', '/subjects', [['subjects']]);

  return (
    <div className="space-y-6">
      {can('academics.structure.manage') && (
        <Card title={t('classes.newSubject')}>
          <form
            className="grid gap-4 sm:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(form, { onSuccess: () => setForm(empty) });
            }}
          >
            <Field label={t('common.code')}>
              <Input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </Field>
            <Field label={t('common.nameFr')}>
              <Input required value={form.nameFr} onChange={(e) => setForm({ ...form, nameFr: e.target.value })} />
            </Field>
            <Field label={t('common.nameEn')}>
              <Input required value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} />
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
        {subjects.isPending ? (
          <Loading />
        ) : subjects.data?.length === 0 ? (
          <Empty>{t('classes.noSubjects')}</Empty>
        ) : (
          <Table head={[t('common.code'), t('common.name')]}>
            {subjects.data?.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.code}</td>
                <td>{label(s)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
