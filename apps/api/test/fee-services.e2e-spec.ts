/**
 * Class fees billed at enrolment, optional services chosen per pupil (bus, canteen, uniform),
 * an advance with the remaining balance on the receipt, and each class's book list.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { addDays, addMember, type Client, client, createApp, owner, provisionSchool, today } from './helpers';

const run = randomUUID().slice(0, 8);
const t = today();
let app: NestExpressApplication;
let director: Client;
let teacher: Client;
let other: Client;
const ids: Record<string, string> = {};

beforeAll(async () => {
  app = await createApp();
  const school = await provisionSchool(run, 'svc');
  director = await client(app, school.email, school.tenantId);
  const te = await addMember(school.tenantId, `teacher-svc-${run}@e2e.local`, ['teacher']);
  teacher = await client(app, te.email, school.tenantId);
  const otherSchool = await provisionSchool(run, 'svc2');
  other = await client(app, otherSchool.email, otherSchool.tenantId);

  ids.year = (await director.post('/academic-years', { name: `S-${run}`, startDate: addDays(t, -60), endDate: addDays(t, 250) }).expect(201)).body.id;
  ids.campus = (await director.get('/campuses').expect(200)).body[0].id;
  ids.level = (await director.post('/education-levels', { code: 'CM1', nameFr: 'CM1', nameEn: 'Class 5', cycle: 'PRIMARY' }).expect(201)).body.id;
  ids.classA = (await director.post('/classes', { academicYearId: ids.year, campusId: ids.campus, levelId: ids.level, code: 'CM1A', name: 'CM1 A' }).expect(201)).body.id;
  ids.classB = (await director.post('/classes', { academicYearId: ids.year, campusId: ids.campus, levelId: ids.level, code: 'CM1B', name: 'CM1 B' }).expect(201)).body.id;

  const cat = async (code: string, kind: string) => (await director.post('/fee-categories', { code, nameFr: code, nameEn: code, kind }).expect(201)).body.id;
  ids.catTuition = await cat('SCO', 'TUITION');
  ids.catBus = await cat('BUS', 'TRANSPORT');
  ids.catFood = await cat('CAN', 'CANTEEN');
  const schedule = async (body: Record<string, unknown>) => (await director.post('/fee-schedules', { academicYearId: ids.year, currency: 'XAF', ...body }).expect(201)).body.id;
  // Compulsory: 120 000 in two installments for the whole level.
  ids.tuition = await schedule({
    categoryId: ids.catTuition,
    name: 'Scolarité CM1',
    levelId: ids.level,
    installments: [
      { label: 'Tranche 1', dueDate: addDays(t, 10), amount: '70000' },
      { label: 'Tranche 2', dueDate: addDays(t, 100), amount: '50000' },
    ],
  });
  // Optional: bus for the whole school (90 000 in three), canteen for CM1 A only (45 000).
  ids.bus = await schedule({
    categoryId: ids.catBus,
    name: 'Bus zone A',
    optional: true,
    installments: [
      { label: 'T1', dueDate: addDays(t, 10), amount: '30000' },
      { label: 'T2', dueDate: addDays(t, 100), amount: '30000' },
      { label: 'T3', dueDate: addDays(t, 200), amount: '30000' },
    ],
  });
  ids.food = await schedule({ categoryId: ids.catFood, name: 'Cantine', optional: true, classId: ids.classA, installments: [{ label: 'Année', dueDate: addDays(t, 10), amount: '45000' }] });

  ids.pupil = (await director.post('/students', { firstName: 'Divine', lastName: `Svc${run}`, dateOfBirth: '2016-04-09' }).expect(201)).body.id;
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('class fees billed at enrolment', () => {
  it('bills the compulsory fees when the pupil is enrolled, not the optional services', async () => {
    const res = await director.post('/enrollments', { studentId: ids.pupil, classId: ids.classA, enrolledOn: t }).expect(201);
    expect(res.body.billing).toEqual({ invoices: 1, skipped: null });
    ids.enrollment = res.body.id;
    const invoices = (await director.get(`/invoices?studentId=${ids.pupil}`).expect(200)).body;
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ total: '120000', balance: '120000' });
    ids.tuitionInvoice = invoices[0].id;
  });

  it('does not bill the level fees again when the pupil changes class', async () => {
    const res = await director.post(`/enrollments/${ids.enrollment}/change-class`, { classId: ids.classB, effectiveOn: t, reason: 'Rééquilibrage' }).expect(201);
    ids.enrollment = res.body.id;
    expect((await director.get(`/invoices?studentId=${ids.pupil}`).expect(200)).body).toHaveLength(1);
    // Back to CM1 A for the canteen below.
    ids.enrollment = (await director.post(`/enrollments/${ids.enrollment}/change-class`, { classId: ids.classA, effectiveOn: t, reason: 'Retour' }).expect(201)).body.id;
  });

  it('refuses to bill an optional service to a whole class', async () => {
    expect((await director.post(`/fee-schedules/${ids.bus}/apply`, { issueDate: t }).expect(409)).body.error.code).toBe('OPTIONAL_SCHEDULE');
  });
});

describe('optional services chosen per pupil', () => {
  it('lists what the pupil pays: compulsory fees billed, services to choose', async () => {
    const o = (await director.get(`/students/${ids.pupil}/fee-options?academicYearId=${ids.year}`).expect(200)).body;
    expect(o.enrollment).toMatchObject({ className: 'CM1 A' });
    expect(o.compulsory).toEqual([expect.objectContaining({ id: ids.tuition, amount: '120000', invoiceId: ids.tuitionInvoice })]);
    expect(o.services.map((s: { name: string; amount: string; invoiceId: null }) => [s.name, s.amount, s.invoiceId])).toEqual([
      ['Bus zone A', '90000', null],
      ['Cantine', '45000', null],
    ]);
  });

  it('bills the ticked services together in one invoice, once', async () => {
    const res = await director.post(`/students/${ids.pupil}/services`, { academicYearId: ids.year, scheduleIds: [ids.bus, ids.food], issueDate: t }).expect(201);
    expect(res.body.invoices).toHaveLength(1);
    const inv = (await director.get(`/invoices/${res.body.invoices[0]}`).expect(200)).body;
    // 90 000 + 45 000, one line per installment.
    expect(inv).toMatchObject({ total: '135000', balance: '135000' });
    expect(inv.lines.map((l: { description: string }) => l.description).sort()).toEqual(['Bus zone A — T1', 'Bus zone A — T2', 'Bus zone A — T3', 'Cantine']);
    ids.serviceInvoice = inv.id;
    expect((await director.post(`/students/${ids.pupil}/services`, { academicYearId: ids.year, scheduleIds: [ids.bus], issueDate: t }).expect(409)).body.error.code).toBe(
      'SERVICE_ALREADY_BILLED',
    );
    expect((await director.post(`/students/${ids.pupil}/services`, { academicYearId: ids.year, scheduleIds: [ids.tuition], issueDate: t }).expect(409)).body.error.code).toBe(
      'SERVICE_NOT_AVAILABLE',
    );
  });

  it('accepts an advance and prints the remaining balance on the receipt', async () => {
    const pay = await director
      .post('/payments', { idempotencyKey: randomUUID(), studentId: ids.pupil, method: 'BANK_TRANSFER', currency: 'XAF', amount: '50000', receivedOn: t, externalReference: `VIR-${run}` })
      .expect(201);
    const receipt = (await director.get(`/payments/${pay.body.id}/receipt`).expect(200)).body;
    // 120 000 + 135 000 billed, 50 000 paid.
    expect(receipt.balancesAfter).toEqual([{ currency: 'XAF', balance: '205000' }]);
  });

  it('keeps other schools and non-finance staff out', async () => {
    await other.get(`/students/${ids.pupil}/fee-options?academicYearId=${ids.year}`).expect(200, { enrollment: null, compulsory: [], services: [] });
    await other.post(`/students/${ids.pupil}/services`, { academicYearId: ids.year, scheduleIds: [ids.bus], issueDate: t }).expect(409);
    await teacher.post(`/students/${ids.pupil}/services`, { academicYearId: ids.year, scheduleIds: [ids.bus], issueDate: t }).expect(403);
  });
});

describe('book lists', () => {
  it('builds a class list from school, level and class items with its total', async () => {
    const add = (body: Record<string, unknown>) => director.post('/book-lists/items', { academicYearId: ids.year, ...body }).expect(201);
    await add({ subject: 'Français', title: 'Mon livre de français CM1', author: 'Collectif', publisher: 'CLE', price: '4500', levelId: ids.level });
    await add({ subject: 'Mathématiques', title: 'Maths CM1', price: '3800.50', classId: ids.classA });
    await add({ title: 'Dictionnaire Larousse junior', price: '9000' });
    await add({ title: 'Cahier de dessin', classId: ids.classB });
    const list = (await director.get(`/book-lists/classes/${ids.classA}`).expect(200)).body;
    expect(list.items.map((i: { title: string }) => i.title)).toEqual(['Mon livre de français CM1', 'Maths CM1', 'Dictionnaire Larousse junior']);
    expect(list.totals).toEqual([{ currency: 'XAF', total: '17300.5' }]);
  });

  it('lets any member read the list but only academic managers change it', async () => {
    await teacher.get(`/book-lists/classes/${ids.classA}`).expect(200);
    await teacher.post('/book-lists/items', { academicYearId: ids.year, title: 'X' }).expect(403);
    await other.get(`/book-lists/classes/${ids.classA}`).expect(404);
  });

  it('edits and removes an item', async () => {
    const items = (await director.get(`/book-lists/items?academicYearId=${ids.year}`).expect(200)).body;
    const dict = items.find((i: { title: string }) => i.title.startsWith('Dictionnaire'));
    const edited = (await director.put(`/book-lists/items/${dict.id}`, { academicYearId: ids.year, title: 'Dictionnaire Larousse junior', price: '8500' }).expect(200)).body;
    expect(edited).toMatchObject({ price: '8500', author: null });
    await director.del(`/book-lists/items/${dict.id}`).expect(204);
    expect((await director.get(`/book-lists/classes/${ids.classA}`).expect(200)).body.totals).toEqual([{ currency: 'XAF', total: '8300.5' }]);
  });
});
