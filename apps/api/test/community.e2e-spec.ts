/**
 * Phase 4: portals, communication, HR, dashboards and exports.
 * Module 12 AC: a guardian sees only linked students; access can be revoked without deleting
 * the record; notification failures are visible and retryable; delivery ≠ creation.
 * Module 11 AC: HR and compensation data are restricted; leave approvals keep a history.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { addDays, addMember, type Client, client, createApp, owner, provisionSchool, today } from './helpers';

const run = randomUUID().slice(0, 8);
const t = today();
let app: NestExpressApplication;
let tenantId: string;
let director: Client;
let hr: Client;
let teacher: Client;
let parent: Client;
let pupil: Client;
const ids: Record<string, string> = {};
const parentEmail = `parent-${run}@e2e.local`;

beforeAll(async () => {
  app = await createApp();
  const school = await provisionSchool(run, 'com');
  tenantId = school.tenantId;
  director = await client(app, school.email, tenantId);
  const h = await addMember(tenantId, `hr-${run}@e2e.local`, ['hr_manager']);
  const te = await addMember(tenantId, `teacher-${run}@e2e.local`, ['teacher']);
  hr = await client(app, h.email, tenantId);
  teacher = await client(app, te.email, tenantId);

  ids.year = (await director.post('/academic-years', { name: `C-${run}`, startDate: addDays(t, -100), endDate: addDays(t, 200) }).expect(201)).body.id;
  ids.campus = (await director.get('/campuses').expect(200)).body[0].id;
  ids.level = (await director.post('/education-levels', { code: '6E', nameFr: '6e', nameEn: 'F1', cycle: 'SECONDARY_FIRST' }).expect(201)).body.id;
  const cls = { academicYearId: ids.year, campusId: ids.campus, levelId: ids.level };
  ids.classA = (await director.post('/classes', { ...cls, code: 'A', name: '6e A' }).expect(201)).body.id;
  ids.classB = (await director.post('/classes', { ...cls, code: 'B', name: '6e B' }).expect(201)).body.id;

  const kid1 = (
    await director
      .post('/students', { firstName: 'Kid', lastName: `One${run}`, dateOfBirth: '2015-01-01', guardians: [{ guardian: { firstName: 'Mama', lastName: `One${run}` }, relationship: 'MOTHER', isPrimary: true }] })
      .expect(201)
  ).body.id;
  ids.guardian = (await director.get(`/students/${kid1}`).expect(200)).body.guardians[0].guardianId;
  const kid2 = (await director.post('/students', { firstName: 'Kid', lastName: `Two${run}`, dateOfBirth: '2016-01-01', guardians: [{ guardianId: ids.guardian, relationship: 'MOTHER' }] }).expect(201)).body.id;
  const stranger = (await director.post('/students', { firstName: 'Other', lastName: `Child${run}`, dateOfBirth: '2015-05-05' }).expect(201)).body.id;
  Object.assign(ids, { kid1, kid2, stranger });
  for (const [s, c] of [[kid1, ids.classA], [kid2, ids.classA], [stranger, ids.classB]] as const) {
    await director.post('/enrollments', { studentId: s, classId: c, enrolledOn: addDays(t, -90) }).expect(201);
  }

  ids.teacherStaff = (await director.post('/staff', { firstName: 'Tea', lastName: 'Cher', position: 'Prof', isTeacher: true, employmentType: 'PERMANENT', membershipId: te.membershipId }).expect(201)).body.id;
  ids.hrStaff = (await director.post('/staff', { firstName: 'Hu', lastName: 'Res', position: 'RH', employmentType: 'PERMANENT', membershipId: h.membershipId }).expect(201)).body.id;
  const subject = (await director.post('/subjects', { code: 'FRA', nameFr: 'Français', nameEn: 'French' }).expect(201)).body.id;
  const cs = (await director.post(`/classes/${ids.classA}/subjects`, { subjectId: subject, coefficient: 3, weeklyHours: 4 }).expect(201)).body.id;
  await director.post('/teaching-assignments', { classSubjectId: cs, staffId: ids.teacherStaff, startDate: addDays(t, -90) }).expect(201);
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('portal access', () => {
  it('grants a parent account with a one-time password and the parent role', async () => {
    const res = await director.post(`/guardians/${ids.guardian}/portal-access`, { email: parentEmail }).expect(201);
    expect(res.body.temporaryPassword).toHaveLength(16);
    parent = await client(app, parentEmail, tenantId, res.body.temporaryPassword);
    expect((await director.post(`/guardians/${ids.guardian}/portal-access`, { email: `x-${parentEmail}` }).expect(409)).body.error.code).toBe('PORTAL_ALREADY_ENABLED');
  });

  it('shows a parent only their linked children', async () => {
    const children = (await parent.get('/portal/children').expect(200)).body;
    expect(children.map((c: { id: string }) => c.id).sort()).toEqual([ids.kid1, ids.kid2].sort());
    await parent.get(`/portal/children/${ids.stranger}`).expect(404);
    await parent.get(`/portal/children/${randomUUID()}`).expect(404);
    const summary = (await parent.get(`/portal/children/${ids.kid1}`).expect(200)).body;
    expect(summary).toMatchObject({ student: { id: ids.kid1 }, class: { name: '6e A' } });
    expect(summary.fees).toBeDefined();
  });

  it('gives parents no staff access', async () => {
    await parent.get('/students').expect(403);
    await parent.get(`/students/${ids.kid1}`).expect(403);
    await parent.get('/finance/reports/summary?from=2026-01-01&to=2026-12-31').expect(403);
  });

  it('shows a student only themself, not a sibling', async () => {
    const res = await director.post(`/students/${ids.kid1}/portal-access`, { email: `kid1-${run}@e2e.local` }).expect(201);
    pupil = await client(app, `kid1-${run}@e2e.local`, tenantId, res.body.temporaryPassword);
    expect((await pupil.get('/portal/children').expect(200)).body.map((c: { id: string }) => c.id)).toEqual([ids.kid1]);
    await pupil.get(`/portal/children/${ids.kid2}`).expect(404);
    await pupil.get(`/portal/children/${ids.kid1}`).expect(200);
  });
});

describe('notifications', () => {
  it('alerts linked parents of an absence once per day (ATT-006)', async () => {
    const register = (status: string, baseVersion: number, reason?: string) =>
      teacher.post('/attendance/submit', {
        operationId: randomUUID(),
        classId: ids.classA,
        date: t,
        baseVersion,
        ...(reason && { correctionReason: reason }),
        records: [
          { studentId: ids.kid1, status },
          { studentId: ids.kid2, status: 'PRESENT' },
        ],
      });
    await register('ABSENT', 0).expect(200);
    const inbox = (await parent.get('/notifications').expect(200)).body;
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0]).toMatchObject({ kind: 'attendance.absence', link: `/portal/children/${ids.kid1}` });
    expect(inbox.items[0].deliveries).toEqual([{ channel: 'EMAIL', status: 'PENDING' }]);
    // Correcting to present and back to absent the same day does not alert twice.
    await register('PRESENT', 1, 'Erreur').expect(200);
    await register('ABSENT', 2, 'Finalement absent').expect(200);
    expect((await parent.get('/notifications').expect(200)).body.items.filter((n: { kind: string }) => n.kind === 'attendance.absence')).toHaveLength(1);
  });

  it('marks notifications read', async () => {
    await parent.post('/notifications/read-all').expect(200);
    expect((await parent.get('/notifications').expect(200)).body.unread).toBe(0);
  });

  it('keeps failed email deliveries visible and retryable (COM-008)', async () => {
    delete process.env.EMAIL_PROVIDER;
    expect((await director.post('/notification-deliveries/process').expect(200)).body.failed).toBeGreaterThan(0);
    const failed = (await director.get('/notification-deliveries?status=FAILED').expect(200)).body;
    expect(failed.items[0]).toMatchObject({ status: 'FAILED', lastError: 'NO_EMAIL_PROVIDER', attempts: 1 });
    expect(failed.items[0].destination).toMatch(/\*/);
    await director.post(`/notification-deliveries/${failed.items[0].id}/retry`).expect(200);
    process.env.EMAIL_PROVIDER = 'log';
    expect((await director.post('/notification-deliveries/process').expect(200)).body.sent).toBe(1);
    delete process.env.EMAIL_PROVIDER;
    await parent.get('/notification-deliveries').expect(403);
  });
});

describe('announcements (COM-003, COM-012)', () => {
  it('targets class, staff and family audiences', async () => {
    await director.post('/announcements', { title: 'Sortie 6e B', body: 'Sortie au musée pour la 6e B.', audience: 'CLASS', classId: ids.classB }).expect(201);
    await director.post('/announcements', { title: 'Réunion parents 6e A', body: 'Réunion vendredi à 16 h.', audience: 'CLASS', classId: ids.classA }).expect(201);
    await director.post('/announcements', { title: 'Conseil pédagogique', body: 'Réunion des enseignants lundi.', audience: 'STAFF' }).expect(201);
    const parentFeed = (await parent.get('/announcements').expect(200)).body.map((x: { title: string }) => x.title);
    expect(parentFeed).toEqual(['Réunion parents 6e A']);
    const teacherFeed = (await teacher.get('/announcements').expect(200)).body.map((x: { title: string }) => x.title);
    expect(teacherFeed).toContain('Conseil pédagogique');
    expect(teacherFeed).not.toContain('Sortie 6e B');
    const notes = (await parent.get('/notifications').expect(200)).body.items.map((n: { title: string }) => n.title);
    expect(notes).toContain('Réunion parents 6e A');
    expect(notes).not.toContain('Sortie 6e B');
    await parent.post('/announcements', { title: 'Hack', body: 'Nope nope', audience: 'ALL' }).expect(403);
  });
});

describe('HR (Module 11)', () => {
  it('reports contracts that expire soon', async () => {
    await hr.post('/hr/contracts', { staffId: ids.teacherStaff, type: 'CONTRACT', position: 'Professeur', startDate: addDays(t, -300), endDate: addDays(t, 30) }).expect(201);
    const expiring = (await hr.get('/hr/contracts/expiring?days=60').expect(200)).body;
    expect(expiring).toEqual([expect.objectContaining({ daysLeft: 30, staff: expect.objectContaining({ id: ids.teacherStaff }) })]);
  });

  it('restricts compensation and keeps amounts out of the audit log and staff export', async () => {
    await hr.post('/hr/compensation', { staffId: ids.teacherStaff, effectiveFrom: addDays(t, -30), currency: 'XAF', baseSalary: '250000', allowances: [{ label: 'Transport', amount: '25000' }] }).expect(201);
    await teacher.get(`/hr/compensation/${ids.teacherStaff}`).expect(403);
    await director.get(`/hr/compensation/${ids.teacherStaff}`).expect(200);
    const log = await owner.auditLog.findFirstOrThrow({ where: { tenantId, action: 'compensation.recorded' } });
    expect(JSON.stringify(log.metadata)).not.toContain('250000');
    const staffCsv = (await hr.get('/exports/staff.csv').expect(200)).text;
    expect(staffCsv).not.toContain('250000');
    await teacher.get('/exports/compensation.csv').expect(403);
    expect((await hr.get('/exports/compensation.csv').expect(200)).text).toContain('250000');
  });

  it('checks annual-leave balance and keeps the decision away from the requester', async () => {
    const year = Number(t.slice(0, 4));
    await hr.put('/hr/leave/entitlements', { staffId: ids.teacherStaff, year, days: 10 }).expect(200);
    await hr.put('/hr/leave/entitlements', { staffId: ids.hrStaff, year, days: 10 }).expect(200);
    // A Monday-to-Friday week = 5 working days (start on the next Monday at least 7 days ahead).
    const monday = nextMonday(addDays(t, 7));
    const leave = (await teacher.post('/hr/leave', { type: 'ANNUAL', startDate: monday, endDate: addDays(monday, 4) }).expect(201)).body;
    expect(leave.days).toBe(5);
    const tooMuch = await teacher.post('/hr/leave', { type: 'ANNUAL', startDate: addDays(monday, 14), endDate: addDays(monday, 25) }).expect(422);
    expect(tooMuch.body.error).toMatchObject({ code: 'INSUFFICIENT_LEAVE_BALANCE', details: { remaining: 5 } });
    await teacher.post(`/hr/leave/${leave.id}/decision`, { approve: true }).expect(403);
    const own = (await hr.post('/hr/leave', { type: 'SICK', startDate: monday, endDate: monday }).expect(201)).body;
    await hr.post(`/hr/leave/${own.id}/decision`, { approve: true }).expect(403);
    await hr.post(`/hr/leave/${leave.id}/decision`, { approve: true, note: 'Bon congé' }).expect(200);
    const inbox = (await teacher.get('/notifications').expect(200)).body.items;
    expect(inbox[0]).toMatchObject({ kind: 'leave.decided', title: 'Congé approuvé' });
    const balances = (await hr.get(`/hr/leave/balances?year=${year}`).expect(200)).body;
    expect(balances.find((b: { staff: { id: string } }) => b.staff.id === ids.teacherStaff)).toMatchObject({ entitled: 10, approved: 5, remaining: 5 });
  });
});

describe('dashboards, comparisons and exports', () => {
  it('builds each role its own dashboard', async () => {
    const tDash = (await teacher.get('/dashboard').expect(200)).body;
    expect(tDash.teaching).toBeDefined();
    expect(tDash.finance).toBeUndefined();
    const dDash = (await director.get('/dashboard').expect(200)).body;
    expect(dDash.school).toMatchObject({ enrolled: 3 });
    expect(dDash.approvals).toBeDefined();
    expect(dDash.finance).toBeDefined();
    const pDash = (await parent.get('/dashboard').expect(200)).body;
    expect(Object.keys(pDash)).toEqual(['unreadNotifications']);
  });

  it('compares academic years', async () => {
    const res = (await director.get('/reports/annual-comparison').expect(200)).body;
    expect(res.years.find((y: { id: string }) => y.id === ids.year)).toMatchObject({ enrolled: 3, complete: false });
  });

  it('exports Excel-friendly CSV, neutralises formulas and audits the export', async () => {
    await director.post('/students', { firstName: 'X', lastName: '=HYPERLINK("http://evil")', dateOfBirth: '2015-01-01' }).expect(201);
    const res = await director.get('/exports/students.csv').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('matricule;nom;prenom');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    await teacher.get('/exports/students.csv').expect(403);
    expect(await owner.auditLog.count({ where: { tenantId, action: 'export.students' } })).toBe(1);
  });
});

describe('revocation', () => {
  it('cuts portal access without touching the student record', async () => {
    await director.del(`/guardians/${ids.guardian}/portal-access`).expect(200);
    await parent.get('/portal/children').expect(403);
    await director.get(`/students/${ids.kid1}`).expect(200);
  });
});

function nextMonday(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
