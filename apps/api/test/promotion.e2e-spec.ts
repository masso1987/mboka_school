/**
 * Year-end promotion from the promotion screen: next year's classes copied from this year's,
 * decisions taken on the screen, pupils moved to the next class and billed next year's class fees.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { addDays, addMember, type Client, client, createApp, owner, provisionSchool, today } from './helpers';

const run = randomUUID().slice(0, 8);
const t = today();
let app: NestExpressApplication;
let director: Client;
let teacher: Client;
const ids: Record<string, string> = {};

beforeAll(async () => {
  app = await createApp();
  const school = await provisionSchool(run, 'promo');
  director = await client(app, school.email, school.tenantId);
  const te = await addMember(school.tenantId, `teacher-promo-${run}@e2e.local`, ['teacher']);
  teacher = await client(app, te.email, school.tenantId);

  ids.year = (await director.post('/academic-years', { name: `P-${run}`, startDate: addDays(t, -300), endDate: addDays(t, 10) }).expect(201)).body.id;
  ids.next = (await director.post('/academic-years', { name: `P2-${run}`, startDate: addDays(t, 40), endDate: addDays(t, 340) }).expect(201)).body.id;
  ids.campus = (await director.get('/campuses').expect(200)).body[0].id;
  ids.cm1 = (await director.post('/education-levels', { code: 'CM1', nameFr: 'CM1', nameEn: 'Class 5', cycle: 'PRIMARY' }).expect(201)).body.id;
  ids.cm2 = (await director.post('/education-levels', { code: 'CM2', nameFr: 'CM2', nameEn: 'Class 6', cycle: 'PRIMARY' }).expect(201)).body.id;
  ids.cm1a = (await director.post('/classes', { academicYearId: ids.year, campusId: ids.campus, levelId: ids.cm1, code: 'CM1A', name: 'CM1 A' }).expect(201)).body.id;
  await director.post('/classes', { academicYearId: ids.year, campusId: ids.campus, levelId: ids.cm2, code: 'CM2A', name: 'CM2 A' }).expect(201);
  ids.subject = (await director.post('/subjects', { code: 'MATH', nameFr: 'Mathématiques', nameEn: 'Mathematics' }).expect(201)).body.id;
  await director.post(`/classes/${ids.cm1a}/subjects`, { subjectId: ids.subject, coefficient: 2, weeklyHours: 5 }).expect(201);
  for (const [key, first] of [['p1', 'Awa'], ['p2', 'Brice']] as const) {
    ids[key] = (await director.post('/students', { firstName: first, lastName: `Promo${run}`, dateOfBirth: '2015-01-01' }).expect(201)).body.id;
    ids[`e${key}`] = (await director.post('/enrollments', { studentId: ids[key], classId: ids.cm1a, enrolledOn: addDays(t, -200) }).expect(201)).body.id;
  }
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('promotion to the next class', () => {
  it("copies this year's classes, with their subjects, into next year once", async () => {
    expect((await director.post(`/academic-years/${ids.next}/copy-classes`, { fromYearId: ids.year }).expect(200)).body).toEqual({ created: 2, skipped: 0 });
    expect((await director.post(`/academic-years/${ids.next}/copy-classes`, { fromYearId: ids.year }).expect(200)).body).toEqual({ created: 0, skipped: 2 });
    const next = (await director.get(`/classes?academicYearId=${ids.next}`).expect(200)).body as { id: string; code: string }[];
    ids.nextCm1a = next.find((c) => c.code === 'CM1A')!.id;
    ids.nextCm2a = next.find((c) => c.code === 'CM2A')!.id;
    expect(await owner.classSubject.count({ where: { classId: ids.nextCm1a } })).toBe(1);
  });

  it('records decisions from the promotion screen, for the director only', async () => {
    await teacher.put(`/academic-years/${ids.year}/promotion-decisions`, { decisions: [{ enrollmentId: ids.ep1, decision: 'PROMOTED' }] }).expect(403);
    const res = await director
      .put(`/academic-years/${ids.year}/promotion-decisions`, {
        decisions: [
          { enrollmentId: ids.ep1, decision: 'PROMOTED' },
          { enrollmentId: ids.ep2, decision: 'REPEAT' },
        ],
      })
      .expect(200);
    expect(res.body).toEqual({ changed: 2 });
  });

  it('moves pupils to next year, promoted to CM2, repeaters in CM1, and bills next year’s class fees', async () => {
    const cat = (await director.post('/fee-categories', { code: 'SCO', nameFr: 'Scolarité', nameEn: 'Tuition', kind: 'TUITION' }).expect(201)).body.id;
    await director
      .post('/fee-schedules', { academicYearId: ids.next, categoryId: cat, name: 'Scolarité CM2', currency: 'XAF', levelId: ids.cm2, installments: [{ label: 'Année', dueDate: addDays(t, 60), amount: '100000' }] })
      .expect(201);
    const body = { targetYearId: ids.next, classMap: [{ fromClassId: ids.cm1a, promotedTo: ids.nextCm2a, repeatIn: ids.nextCm1a }] };
    const preview = (await director.post(`/academic-years/${ids.year}/rollover/preview`, body).expect(200)).body;
    expect(preview.summary).toMatchObject({ promote: 1, repeat: 1, exceptions: 0 });
    const res = (await director.post(`/academic-years/${ids.year}/rollover`, body).expect(200)).body;
    expect(res).toMatchObject({ promoted: 1, repeating: 1, billed: 1 });
    const awa = await owner.enrollment.findFirst({ where: { studentId: ids.p1, academicYearId: ids.next } });
    expect(awa).toMatchObject({ classId: ids.nextCm2a, status: 'ENROLLED' });
    const brice = await owner.enrollment.findFirst({ where: { studentId: ids.p2, academicYearId: ids.next } });
    expect(brice).toMatchObject({ classId: ids.nextCm1a, status: 'REPEATING' });
    expect(await owner.invoice.count({ where: { studentId: ids.p1, academicYearId: ids.next } })).toBe(1);
    expect(await owner.invoice.count({ where: { studentId: ids.p2, academicYearId: ids.next } })).toBe(0);
  });
});
