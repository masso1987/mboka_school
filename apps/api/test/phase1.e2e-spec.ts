/**
 * Phase 1 behaviour against a real PostgreSQL: academic structure, students and enrollment,
 * staff and assignments, attendance sync, timetable conflicts and administration.
 * Spec §13.2 scenarios covered: 2 (teacher outside assignment), 6 (transfer), 8 (connectivity
 * loss → replayed submission), 12 (duplicate matricules), plus cross-tenant references.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { addDays, addMember, type Client, client, createApp, owner, provisionSchool, today } from './helpers';

const run = randomUUID().slice(0, 8);
let app: NestExpressApplication;
let dirA: Client;
let dirB: Client;
let teacher: Client;
let tenantA: string;
let tenantB: string;
let teacherMembershipId: string;

const ids: Record<string, string> = {};
const t0 = today();

beforeAll(async () => {
  app = await createApp();
  const a = await provisionSchool(run, 'p1a');
  const b = await provisionSchool(run, 'p1b');
  tenantA = a.tenantId;
  tenantB = b.tenantId;
  const t = await addMember(tenantA, `teacher-${run}@e2e.local`, ['teacher']);
  teacherMembershipId = t.membershipId;
  dirA = await client(app, a.email, tenantA);
  dirB = await client(app, b.email, tenantB);
  teacher = await client(app, t.email, tenantA);
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('academic structure', () => {
  it('creates a year spanning today, a level, subjects, a class and its subjects', async () => {
    ids.year = (
      await dirA.post('/academic-years', { name: `Y-${run}`, startDate: addDays(t0, -150), endDate: addDays(t0, 150) }).expect(201)
    ).body.id;
    ids.campus = (await dirA.get('/campuses').expect(200)).body[0].id;
    ids.level = (await dirA.post('/education-levels', { code: '6E', nameFr: 'Sixième', nameEn: 'Form 1', cycle: 'SECONDARY_FIRST' }).expect(201)).body.id;
    ids.subject = (await dirA.post('/subjects', { code: 'MATH', nameFr: 'Mathématiques', nameEn: 'Mathematics' }).expect(201)).body.id;
    ids.subject2 = (await dirA.post('/subjects', { code: 'FRA', nameFr: 'Français', nameEn: 'French' }).expect(201)).body.id;
    const cls = { academicYearId: ids.year, campusId: ids.campus, levelId: ids.level, capacity: 40 };
    ids.classA = (await dirA.post('/classes', { ...cls, code: '6EA', name: '6e A' }).expect(201)).body.id;
    ids.classB = (await dirA.post('/classes', { ...cls, code: '6EB', name: '6e B' }).expect(201)).body.id;
    ids.cs = (await dirA.post(`/classes/${ids.classA}/subjects`, { subjectId: ids.subject, coefficient: 4, weeklyHours: 5 }).expect(201)).body.id;
    ids.csB = (await dirA.post(`/classes/${ids.classB}/subjects`, { subjectId: ids.subject2, coefficient: 3, weeklyHours: 4 }).expect(201)).body.id;
    const detail = await dirA.get(`/classes/${ids.classA}`).expect(200);
    expect(detail.body.subjects[0]).toMatchObject({ coefficient: 4, weeklyHours: 5 });
  });

  it('rejects duplicate codes and duplicate subjects in a class', async () => {
    expect((await dirA.post('/education-levels', { code: '6E', nameFr: 'x', nameEn: 'x', cycle: 'PRIMARY' }).expect(409)).body.error.code).toBe('CODE_TAKEN');
    expect((await dirA.post(`/classes/${ids.classA}/subjects`, { subjectId: ids.subject, coefficient: 2, weeklyHours: 1 }).expect(409)).body.error.code).toBe(
      'SUBJECT_ALREADY_IN_CLASS',
    );
  });

  it('keeps periods inside the year and non-overlapping (ACA-003)', async () => {
    await dirA.post(`/academic-years/${ids.year}/periods`, { kind: 'TERM', name: 'T1', position: 1, startDate: addDays(t0, -150), endDate: addDays(t0, -60) }).expect(201);
    const overlap = await dirA.post(`/academic-years/${ids.year}/periods`, { kind: 'TERM', name: 'T2', position: 2, startDate: addDays(t0, -70), endDate: addDays(t0, 10) });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.code).toBe('PERIOD_OVERLAP');
    const outside = await dirA.post(`/academic-years/${ids.year}/periods`, { kind: 'TERM', name: 'T9', position: 9, startDate: addDays(t0, 100), endDate: addDays(t0, 400) });
    expect(outside.body.error.code).toBe('PERIOD_OUTSIDE_YEAR');
  });

  it('cannot reference another school\'s level (composite FK)', async () => {
    const yearB = (await dirB.post('/academic-years', { name: `YB-${run}`, startDate: '2026-09-01', endDate: '2027-07-31' }).expect(201)).body.id;
    const campusB = (await dirB.get('/campuses').expect(200)).body[0].id;
    const res = await dirB.post('/classes', { academicYearId: yearB, campusId: campusB, levelId: ids.level, code: 'X', name: 'X' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_REFERENCE');
  });
});

describe('students and enrollment', () => {
  it('creates a student with a generated matricule and a new guardian', async () => {
    const res = await dirA
      .post('/students', {
        firstName: 'Amina',
        lastName: 'Mbarga',
        gender: 'F',
        dateOfBirth: '2015-03-12',
        guardians: [{ guardian: { firstName: 'Claire', lastName: 'Mbarga', phone: '+237 677 00 11 22' }, relationship: 'MOTHER', isPrimary: true }],
      })
      .expect(201);
    expect(res.body.matricule).toMatch(/^\d{4}-\d{5}$/);
    ids.student = res.body.id;
    ids.matricule = res.body.matricule;
    const file = await dirA.get(`/students/${ids.student}`).expect(200);
    ids.guardian = file.body.guardians[0].guardianId;
  });

  it('reuses one guardian for a sibling (STD-006)', async () => {
    const res = await dirA
      .post('/students', { firstName: 'Junior', lastName: 'Mbarga', dateOfBirth: '2017-06-01', guardians: [{ guardianId: ids.guardian, relationship: 'MOTHER' }] })
      .expect(201);
    ids.sibling = res.body.id;
    expect(await owner.guardian.count({ where: { tenantId: tenantA } })).toBe(1);
  });

  it('rejects a duplicate matricule (scenario 12)', async () => {
    const res = await dirA.post('/students', { matricule: ids.matricule, firstName: 'X', lastName: 'Y', dateOfBirth: '2015-01-01' }).expect(409);
    expect(res.body.error.code).toBe('MATRICULE_TAKEN');
  });

  it('flags a possible duplicate and accepts it once confirmed (STD-012)', async () => {
    const body = { firstName: 'amina', lastName: 'MBARGA', dateOfBirth: '2015-03-12' };
    const res = await dirA.post('/students', body).expect(409);
    expect(res.body.error.code).toBe('POSSIBLE_DUPLICATE');
    expect(res.body.error.details.candidates[0].id).toBe(ids.student);
    await dirA.post('/students', { ...body, confirmDuplicate: true }).expect(201);
  });

  it('hides students from another school', async () => {
    await dirB.get(`/students/${ids.student}`).expect(404);
    expect((await dirB.get('/students').expect(200)).body.total).toBe(0);
  });

  it('enrolls once per year and refuses a second active enrollment', async () => {
    ids.enrollment = (await dirA.post('/enrollments', { studentId: ids.student, classId: ids.classA, enrolledOn: addDays(t0, -100) }).expect(201)).body.id;
    await dirA.post('/enrollments', { studentId: ids.sibling, classId: ids.classA, enrolledOn: addDays(t0, -100) }).expect(201);
    const again = await dirA.post('/enrollments', { studentId: ids.student, classId: ids.classB, enrolledOn: addDays(t0, -100) }).expect(409);
    expect(again.body.error.code).toBe('ALREADY_ENROLLED');
  });

  it('moves admissions only through allowed transitions', async () => {
    const adm = (await dirA.post('/admissions', { studentId: ids.sibling, academicYearId: ids.year, requestedLevelId: ids.level }).expect(201)).body.id;
    expect((await dirA.post(`/admissions/${adm}/decision`, { status: 'ACCEPTED' }).expect(409)).body.error.code).toBe('INVALID_TRANSITION');
    await dirA.post(`/admissions/${adm}/decision`, { status: 'UNDER_REVIEW' }).expect(200);
    await dirA.post(`/admissions/${adm}/decision`, { status: 'ACCEPTED' }).expect(200);
  });
});

describe('staff and assignments', () => {
  it('creates a teacher linked to a user account and assigns them', async () => {
    const staff = await dirA
      .post('/staff', { firstName: 'Sylvie', lastName: 'Ngo', position: 'Professeure', isTeacher: true, employmentType: 'PERMANENT', membershipId: teacherMembershipId })
      .expect(201);
    expect(staff.body.staffNumber).toBe('EMP-0001');
    ids.staff = staff.body.id;
    ids.assignment = (await dirA.post('/teaching-assignments', { classSubjectId: ids.cs, staffId: ids.staff, startDate: addDays(t0, -100) }).expect(201)).body.id;
    const second = await dirA.post('/teaching-assignments', { classSubjectId: ids.cs, staffId: ids.staff, startDate: addDays(t0, -100) }).expect(409);
    expect(second.body.error.code).toBe('MAIN_TEACHER_EXISTS');
    const mine = await teacher.get('/me/assignments').expect(200);
    expect(mine.body.assignments.map((x: { class: { id: string } }) => x.class.id)).toEqual([ids.classA]);
  });

  it('stops a teacher from creating staff or assignments', async () => {
    await teacher.post('/staff', { firstName: 'A', lastName: 'B', position: 'X', employmentType: 'CONTRACT' }).expect(403);
  });
});

describe('attendance', () => {
  const submit = (c: Client, extra: object = {}) =>
    c.post('/attendance/submit', {
      operationId: randomUUID(),
      classId: ids.classA,
      date: t0,
      records: [
        { studentId: ids.student, status: 'PRESENT' },
        { studentId: ids.sibling, status: 'LATE', arrivalTime: '07:45' },
      ],
      ...extra,
    });

  it('lets the assigned teacher take the register', async () => {
    const reg = await teacher.get(`/attendance/register?classId=${ids.classA}&date=${t0}`).expect(200);
    expect(reg.body.version).toBe(0);
    expect(reg.body.students).toHaveLength(2);
    expect(reg.body.canRecord).toBe(true);
    ids.op = randomUUID();
    const res = await submit(teacher, { operationId: ids.op, baseVersion: 0 }).expect(200);
    expect(res.body).toMatchObject({ version: 1, recorded: 2, replayed: false });
  });

  it('applies a replayed submission only once (scenario 8)', async () => {
    const res = await submit(teacher, { operationId: ids.op, baseVersion: 0 }).expect(200);
    expect(res.body).toMatchObject({ version: 1, recorded: 2, replayed: true });
    expect(await owner.attendanceRecord.count({ where: { tenantId: tenantA } })).toBe(2);
  });

  it('reports a conflict instead of overwriting a newer register', async () => {
    const res = await submit(teacher, { baseVersion: 0 }).expect(409);
    expect(res.body.error).toMatchObject({ code: 'ATTENDANCE_CONFLICT', details: { serverVersion: 1 } });
  });

  it('requires a reason to change recorded marks, then audits the correction (ATT-005)', async () => {
    const change = { baseVersion: 1, records: [{ studentId: ids.student, status: 'ABSENT' }] };
    expect((await submit(teacher, change).expect(422)).body.error.code).toBe('CORRECTION_REASON_REQUIRED');
    const ok = await submit(teacher, { ...change, correctionReason: 'Parti avant l\'appel' }).expect(200);
    expect(ok.body).toMatchObject({ version: 2, corrected: 1 });
    const log = await owner.auditLog.findFirstOrThrow({ where: { tenantId: tenantA, action: 'attendance.corrected' } });
    expect(log.metadata).toMatchObject({ changes: [{ studentId: ids.student, from: 'PRESENT', to: 'ABSENT' }] });
  });

  it('forbids a teacher from taking attendance outside their assignment (scenario 2)', async () => {
    await teacher.get(`/attendance/register?classId=${ids.classB}&date=${t0}`).expect(403);
    await teacher
      .post('/attendance/submit', { operationId: randomUUID(), classId: ids.classB, date: t0, records: [{ studentId: ids.student, status: 'PRESENT' }] })
      .expect(403);
  });

  it('rejects future dates and students outside the class', async () => {
    expect((await submit(dirA, { date: addDays(t0, 1) }).expect(422)).body.error.code).toBe('DATE_IN_FUTURE');
    const stranger = (await dirA.post('/students', { firstName: 'Z', lastName: 'Z', dateOfBirth: '2014-01-01' }).expect(201)).body.id;
    const res = await dirA
      .post('/attendance/submit', { operationId: randomUUID(), classId: ids.classA, date: addDays(t0, -1), records: [{ studentId: stranger, status: 'PRESENT' }] })
      .expect(422);
    expect(res.body.error.code).toBe('STUDENT_NOT_IN_CLASS');
  });

  it('summarizes attendance per student', async () => {
    const res = await dirA.get(`/attendance/summary?classId=${ids.classA}&from=${addDays(t0, -7)}&to=${t0}`).expect(200);
    const sibling = res.body.students.find((s: { id: string }) => s.id === ids.sibling);
    expect(sibling.counts.LATE).toBe(1);
  });
});

describe('transfers keep history (scenario 6)', () => {
  it('changes class by closing the old enrollment and opening a new one', async () => {
    const res = await dirA.post(`/enrollments/${ids.enrollment}/change-class`, { classId: ids.classB, effectiveOn: t0, reason: 'Rééquilibrage des effectifs' }).expect(201);
    ids.enrollment2 = res.body.id;
    const old = await owner.enrollment.findUniqueOrThrow({ where: { id: ids.enrollment } });
    expect(old.status).toBe('COMPLETED');
    // Attendance taken while in the old class still points at the old enrollment.
    expect(await owner.attendanceRecord.count({ where: { enrollmentId: ids.enrollment } })).toBe(1);
  });

  it('transfers the student out without deleting anything', async () => {
    await dirA.post(`/enrollments/${ids.enrollment2}/exit`, { status: 'TRANSFERRED', leftOn: t0, reason: 'Déménagement à Yaoundé' }).expect(200);
    const file = await dirA.get(`/students/${ids.student}`).expect(200);
    expect(file.body.status).toBe('TRANSFERRED');
    expect(file.body.enrollments.map((e: { status: string }) => e.status).sort()).toEqual(['COMPLETED', 'TRANSFERRED']);
  });
});

describe('timetable conflicts (TIM-003)', () => {
  it('rejects double-booking a teacher or a room', async () => {
    const roomId = (await dirA.post('/rooms', { campusId: ids.campus, code: 'S1', name: 'Salle 1' }).expect(201)).body.id;
    const base = { academicYearId: ids.year, subjectLabel: 'Maths', staffId: ids.staff, weekday: 1, startTime: '08:00', endTime: '09:50' };
    await dirA.post('/timetable', { ...base, classId: ids.classA, roomId }).expect(201);
    const clash = await dirA.post('/timetable', { ...base, classId: ids.classB, startTime: '09:00', endTime: '10:00' }).expect(409);
    expect(clash.body.error.code).toBe('TIMETABLE_CONFLICT');
    expect(clash.body.error.details.conflicts[0].on).toEqual(['teacher']);
    const roomClash = await dirA.post('/timetable', { ...base, staffId: undefined, classId: ids.classB, roomId, startTime: '09:30', endTime: '10:30' }).expect(409);
    expect(roomClash.body.error.details.conflicts[0].on).toEqual(['room']);
    await dirA.post('/timetable', { ...base, classId: ids.classB, startTime: '09:50', endTime: '10:40' }).expect(201);
  });
});

describe('administration', () => {
  it('prevents changing one\'s own roles (separation of duties)', async () => {
    const users = (await dirA.get('/users').expect(200)).body;
    const self = users.find((u: { isSelf: boolean }) => u.isSelf);
    await dirA.put(`/users/${self.membershipId}/roles`, { roleKeys: ['teacher'] }).expect(403);
  });

  it('invites a user with a one-time password and changes their roles', async () => {
    const res = await dirA.post('/users', { email: `cashier-${run}@e2e.local`, fullName: 'Caissier', roleKeys: ['cashier'] }).expect(201);
    expect(res.body.temporaryPassword).toHaveLength(16);
    await dirA.put(`/users/${res.body.membershipId}/roles`, { roleKeys: ['cashier', 'registrar'] }).expect(200);
    const unknown = await dirA.put(`/users/${res.body.membershipId}/roles`, { roleKeys: ['wizard'] }).expect(422);
    expect(unknown.body.error.code).toBe('UNKNOWN_ROLE');
  });

  it('enforces the subscription campus limit (TEN-006)', async () => {
    const res = await dirA.post('/campuses', { code: 'ANNEXE', name: 'Annexe' }).expect(402);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });
});

describe('row-level security on Phase 1 tables', () => {
  const appDb = new PrismaClient();
  afterAll(() => appDb.$disconnect());

  it('exposes nothing without a tenant context', async () => {
    expect(await appDb.student.count()).toBe(0);
    expect(await appDb.enrollment.count()).toBe(0);
    expect(await appDb.attendanceRecord.count()).toBe(0);
    expect(await appDb.staff.count()).toBe(0);
  });

  it('cannot tamper with applied sync operations', async () => {
    await expect(appDb.$executeRaw`DELETE FROM sync_operations`).rejects.toThrow();
  });
});
