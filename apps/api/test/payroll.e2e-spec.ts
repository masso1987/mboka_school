/**
 * Phase 6 — monthly payroll: build from compensation, monthly variables, submit, approval by
 * someone else, freeze, payslip PDFs, declarations, and employees seeing only their own payslips.
 * Figures are the hand-checked case of packages/shared/src/payroll.test.ts.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { addDays, addMember, type Client, client, createApp, owner, provisionSchool, today } from './helpers';

const run = randomUUID().slice(0, 8);
const t = today();
const period = t.slice(0, 7);
let app: NestExpressApplication;
let dir: Client;
let approver: Client;
let teacher: Client;
let other: Client;
let tenantId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  app = await createApp();
  const school = await provisionSchool(run, 'pay');
  tenantId = school.tenantId;
  dir = await client(app, school.email, tenantId);
  const second = await addMember(tenantId, `pay-approver-${run}@e2e.local`, ['director']);
  approver = await client(app, second.email, tenantId);
  const te = await addMember(tenantId, `pay-teacher-${run}@e2e.local`, ['teacher']);
  teacher = await client(app, te.email, tenantId);
  const otherSchool = await provisionSchool(run, 'pay2');
  other = await client(app, otherSchool.email, otherSchool.tenantId);

  const staff = (body: object) => dir.post('/staff', { employmentType: 'PERMANENT', ...body }).expect(201).then((r) => r.body.id as string);
  ids.teacherStaff = await staff({ firstName: 'Awa', lastName: 'Bello', position: 'Professeur', isTeacher: true, membershipId: te.membershipId });
  ids.clerk = await staff({ firstName: 'Paul', lastName: 'Ngono', position: 'Secrétaire' });
  ids.unpaid = await staff({ firstName: 'Sans', lastName: 'Salaire', position: 'Stagiaire' });
  await dir
    .post('/hr/compensation', {
      staffId: ids.teacherStaff,
      effectiveFrom: addDays(t, -60),
      currency: 'XAF',
      baseSalary: '300000',
      allowances: [
        { label: 'Logement', amount: '50000' },
        { label: 'Transport', amount: '20000', taxable: false },
      ],
    })
    .expect(201);
  await dir.post('/hr/compensation', { staffId: ids.clerk, effectiveFrom: addDays(t, -60), currency: 'XAF', baseSalary: '150000' }).expect(201);
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('rules', () => {
  it('starts from the Cameroonian defaults and versions every change', async () => {
    const r = await dir.get('/payroll/rules').expect(200);
    expect(r.body.version).toBe(0);
    expect(r.body.rules.cnps).toMatchObject({ pensionEmployee: '0.042', family: '0.037', ceiling: '750000' });
    const changed = await dir.put('/payroll/rules', { ...r.body.rules, cnps: { ...r.body.rules.cnps, workAccident: '0.025' } }).expect(200);
    expect(changed.body.version).toBe(1);
    // Back to group A for the rest of the suite: version 2.
    expect((await dir.put('/payroll/rules', r.body.rules).expect(200)).body.version).toBe(2);
    await dir.put('/payroll/rules', { ...r.body.rules, irppScale: [{ upTo: '1000', rate: '0.1' }] }).expect(400);
  });

  it('is reserved to payroll staff', async () => {
    await teacher.get('/payroll/rules').expect(403);
    await teacher.get('/payroll/runs').expect(403);
  });
});

describe('monthly run', () => {
  it('builds one payslip per paid employee and says who was left out', async () => {
    const res = await dir.post('/payroll/runs', { period }).expect(201);
    ids.run = res.body.id;
    expect(res.body).toMatchObject({ period, status: 'DRAFT', rulesVersion: 2 });
    expect(res.body.payslips).toHaveLength(2);
    expect(res.body.skipped).toEqual([expect.objectContaining({ staffId: ids.unpaid, reason: 'NO_COMPENSATION' })]);
    const slip = res.body.payslips.find((p: { staffId: string }) => p.staffId === ids.teacherStaff);
    ids.slip = slip.id;
    expect(slip.number).toBe(`PAY-${period.replace('-', '')}-0001`);
    expect(slip).toMatchObject({ gross: '370000', net: '323292', employerCost: '412525' });
    await dir.post('/payroll/runs', { period }).expect(409);
  });

  it('applies the month\'s variables and refuses a negative net', async () => {
    const slip = await dir
      .put(`/payroll/payslips/${ids.slip}`, { unpaidDays: 0, items: [{ label: 'Avance sur salaire', kind: 'DEDUCTION', amount: '25000' }] })
      .expect(200);
    expect(slip.body.result).toMatchObject({ gross: '370000', totalEmployee: '46708', net: '298292' });
    expect(slip.body.input.allowances).toHaveLength(2);
    const tooMuch = await dir.put(`/payroll/payslips/${ids.slip}`, { unpaidDays: 0, items: [{ label: 'Prêt', kind: 'DEDUCTION', amount: '900000' }] }).expect(422);
    expect(tooMuch.body.error.code).toBe('NEGATIVE_NET_PAY');
    // The audit log records that something changed, never the amounts.
    const audit = await owner.auditLog.findFirstOrThrow({ where: { tenantId, action: 'payroll.payslip_changed' } });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/25000|298292/);
  });

  it('keeps variables when the draft is rebuilt after a salary change', async () => {
    await dir.post('/hr/compensation', { staffId: ids.clerk, effectiveFrom: addDays(t, -1), currency: 'XAF', baseSalary: '160000' }).expect(201);
    const res = await dir.post(`/payroll/runs/${ids.run}/refresh`).expect(200);
    expect(res.body.payslips.find((p: { staffId: string }) => p.staffId === ids.clerk).baseSalary).toBe('160000');
    expect(res.body.payslips.find((p: { id: string }) => p.id === ids.slip).net).toBe('298292');
  });

  it('sums the run for the CNPS and tax declarations', async () => {
    const res = await dir.get(`/payroll/runs/${ids.run}`).expect(200);
    expect(res.body.totals.headcount).toBe(2);
    const pvid = res.body.totals.lines.find((l: { code: string }) => l.code === 'CNPS_PVID');
    // 4.2 % of (350 000 + 160 000) on each side
    expect(pvid).toMatchObject({ base: '510000', employee: '21420', employer: '21420' });
    const csv = await dir.get(`/payroll/runs/${ids.run}/declarations.csv`).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('"CNPS_PVID";');
  });
});

describe('approval and freeze', () => {
  it('cannot be approved by the person who submitted it', async () => {
    await dir.post(`/payroll/runs/${ids.run}/submit`).expect(200);
    expect((await dir.post(`/payroll/runs/${ids.run}/approve`).expect(403)).body.error.code).toBe('FORBIDDEN');
    expect((await dir.put(`/payroll/payslips/${ids.slip}`, { unpaidDays: 1, items: [] }).expect(409)).body.error.code).toBe('PAYROLL_RUN_LOCKED');
  });

  it('goes back to draft with a reason, then is approved by someone else', async () => {
    await approver.post(`/payroll/runs/${ids.run}/return`, { reason: 'Vérifier les avances' }).expect(200);
    await dir.put(`/payroll/payslips/${ids.slip}`, { unpaidDays: 0, items: [{ label: 'Avance sur salaire', kind: 'DEDUCTION', amount: '25000' }] }).expect(200);
    await dir.post(`/payroll/runs/${ids.run}/submit`).expect(200);
    const res = await approver.post(`/payroll/runs/${ids.run}/approve`).expect(200);
    expect(res.body.status).toBe('APPROVED');
    await approver.post(`/payroll/runs/${ids.run}/approve`).expect(409);
    await dir.del(`/payroll/runs/${ids.run}`).expect(409);
  });

  it('is frozen by the database itself, whoever writes', async () => {
    await expect(owner.$executeRawUnsafe(`UPDATE payslips SET net = 1 WHERE id = '${ids.slip}'`)).rejects.toThrow(/frozen/);
    await expect(owner.$executeRawUnsafe(`UPDATE payroll_runs SET status = 'DRAFT' WHERE id = '${ids.run}'`)).rejects.toThrow(/cannot go from/);
  });

  it('is marked paid, then renders the payslips', async () => {
    expect((await dir.post(`/payroll/runs/${ids.run}/paid`).expect(200)).body.status).toBe('PAID');
    const pdf = await dir.get(`/payroll/runs/${ids.run}/payslips.pdf`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await dir.get(`/payroll/payslips/${ids.slip}/pdf?lang=en`).expect(200);
  });
});

describe('employees and other schools', () => {
  it('shows employees their own approved payslips only', async () => {
    const mine = await teacher.get('/payroll/me/payslips').expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ id: ids.slip, period, status: 'PAID', net: '298292' })]);
    await teacher.get(`/payroll/me/payslips/${ids.slip}/pdf`).expect(200);
    const clerkSlip = (await dir.get(`/payroll/runs/${ids.run}`).expect(200)).body.payslips.find((p: { staffId: string }) => p.staffId === ids.clerk).id;
    await teacher.get(`/payroll/me/payslips/${clerkSlip}/pdf`).expect(404);
    await teacher.get(`/payroll/payslips/${clerkSlip}`).expect(403);
  });

  it('keeps other schools out', async () => {
    await other.get(`/payroll/runs/${ids.run}`).expect(404);
    await other.get(`/payroll/payslips/${ids.slip}/pdf`).expect(404);
  });
});
