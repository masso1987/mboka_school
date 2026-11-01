/**
 * Phase 2 exit criterion (spec §14): approved test cases produce correct, reproducible results and
 * report cards. Uses the same class as the engine's hand-verified unit test, so the expected
 * averages (14.00, 13.31, 9.29) are known independently. Also §13.2 scenarios 2 and 5.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { addDays, addMember, type Client, client, createApp, owner, provisionSchool, today } from './helpers';

const run = randomUUID().slice(0, 8);
const t = today();
let app: NestExpressApplication;
let director: Client;
let principal: Client;
let teacher: Client;
let outsider: Client;
let other: Client;
let tenantId: string;
const ids: Record<string, string> = {};
const S: Record<'ana' | 'ben' | 'cyr', { id: string; matricule: string }> = {} as never;

const sheet = (subject: 'math' | 'fr', period: 'seq1' | 'seq2') => ({ classSubjectId: ids[subject]!, periodId: ids[period]! });
const P = (assessmentId: string, who: keyof typeof S, score: string) => ({ assessmentId, studentId: S[who].id, score, status: 'PRESENT' });

beforeAll(async () => {
  app = await createApp();
  const school = await provisionSchool(run, 'grd');
  tenantId = school.tenantId;
  director = await client(app, school.email, tenantId);
  const pr = await addMember(tenantId, `principal-${run}@e2e.local`, ['principal']);
  const te = await addMember(tenantId, `teacher-${run}@e2e.local`, ['teacher']);
  const out = await addMember(tenantId, `teacher2-${run}@e2e.local`, ['teacher']);
  principal = await client(app, pr.email, tenantId);
  teacher = await client(app, te.email, tenantId);
  outsider = await client(app, out.email, tenantId);
  other = await client(app, (await provisionSchool(run, 'grd2')).email, (await owner.tenant.findFirstOrThrow({ where: { slug: `grd2-${run}` } })).id);

  ids.year = (await director.post('/academic-years', { name: `G-${run}`, startDate: addDays(t, -150), endDate: addDays(t, 150) }).expect(201)).body.id;
  const period = (kind: string, name: string, position: number, s: number, e: number) =>
    director.post(`/academic-years/${ids.year}/periods`, { kind, name, position, startDate: addDays(t, s), endDate: addDays(t, e) }).expect(201);
  ids.term = (await period('TERM', 'Trimestre 1', 1, -120, -1)).body.id;
  ids.seq1 = (await period('SEQUENCE', 'Séquence 1', 1, -120, -61)).body.id;
  ids.seq2 = (await period('SEQUENCE', 'Séquence 2', 2, -60, -1)).body.id;
  ids.campus = (await director.get('/campuses').expect(200)).body[0].id;
  ids.level = (await director.post('/education-levels', { code: '6E', nameFr: '6e', nameEn: 'F1', cycle: 'SECONDARY_FIRST' }).expect(201)).body.id;
  ids.class = (await director.post('/classes', { academicYearId: ids.year, campusId: ids.campus, levelId: ids.level, code: '6A', name: '6e A' }).expect(201)).body.id;
  const mathSubject = (await director.post('/subjects', { code: 'MATH', nameFr: 'Mathématiques', nameEn: 'Mathematics' }).expect(201)).body.id;
  const frSubject = (await director.post('/subjects', { code: 'FRA', nameFr: 'Français', nameEn: 'French' }).expect(201)).body.id;
  ids.math = (await director.post(`/classes/${ids.class}/subjects`, { subjectId: mathSubject, coefficient: 4, weeklyHours: 5 }).expect(201)).body.id;
  ids.fr = (await director.post(`/classes/${ids.class}/subjects`, { subjectId: frSubject, coefficient: 3, weeklyHours: 4 }).expect(201)).body.id;

  for (const [key, first] of [['ana', 'Ana'], ['ben', 'Ben'], ['cyr', 'Cyr']] as const) {
    const s = (await director.post('/students', { firstName: first, lastName: `G${run}`, dateOfBirth: '2015-02-02' }).expect(201)).body;
    S[key] = { id: s.id, matricule: s.matricule };
    await director.post('/enrollments', { studentId: s.id, classId: ids.class, enrolledOn: addDays(t, -130) }).expect(201);
  }

  // The teacher teaches maths; the director also teaches French (to test self-approval).
  const tStaff = (await director.post('/staff', { firstName: 'T', lastName: 'Eacher', position: 'Prof', isTeacher: true, employmentType: 'PERMANENT', membershipId: te.membershipId }).expect(201)).body.id;
  await director.post('/teaching-assignments', { classSubjectId: ids.math, staffId: tStaff, startDate: addDays(t, -130) }).expect(201);
  const dirMembership = (await director.get('/users').expect(200)).body.find((u: { isSelf: boolean }) => u.isSelf).membershipId;
  const dStaff = (await director.post('/staff', { firstName: 'D', lastName: 'Irector', position: 'Dir', isTeacher: true, employmentType: 'PERMANENT', membershipId: dirMembership }).expect(201)).body.id;
  await director.post('/teaching-assignments', { classSubjectId: ids.fr, staffId: dStaff, startDate: addDays(t, -130) }).expect(201);
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('mark entry', () => {
  it('keeps teachers out of subjects they do not teach (scenario 2)', async () => {
    await outsider.get(`/grade-sheets?classSubjectId=${ids.math}&periodId=${ids.seq1}`).expect(403);
    await outsider.post('/assessments', { ...sheet('math', 'seq1'), name: 'X', kind: 'TEST', maxScore: '20', weight: '1' }).expect(403);
  });

  it('creates assessments and rejects marks out of range or inconsistent', async () => {
    ids.m1 = (await teacher.post('/assessments', { ...sheet('math', 'seq1'), name: 'Devoir 1', kind: 'TEST', maxScore: '20', weight: '1' }).expect(201)).body.id;
    ids.m2 = (await teacher.post('/assessments', { ...sheet('math', 'seq2'), name: 'Composition', kind: 'EXAM', maxScore: '40', weight: '2' }).expect(201)).body.id;
    ids.f1 = (await director.post('/assessments', { ...sheet('fr', 'seq2'), name: 'Dictée', kind: 'TEST', maxScore: '20', weight: '1' }).expect(201)).body.id;
    const over = await teacher.put('/grade-sheets/marks', { ...sheet('math', 'seq1'), marks: [P(ids.m1!, 'ana', '21')] }).expect(422);
    expect(over.body.error.code).toBe('MARK_OUT_OF_RANGE');
    await teacher.put('/grade-sheets/marks', { ...sheet('math', 'seq1'), marks: [{ assessmentId: ids.m1, studentId: S.ana.id, status: 'ABSENT', score: '5' }] }).expect(400);
  });

  it('imports a CSV all-or-nothing, naming each bad row', async () => {
    const bad = await teacher
      .post('/grade-sheets/import', { assessmentId: ids.m1, rows: [{ matricule: S.ana.matricule, value: '12' }, { matricule: 'NOPE', value: '10' }, { matricule: S.ben.matricule, value: 'abc' }] })
      .expect(422);
    expect(bad.body.error.code).toBe('IMPORT_REJECTED');
    expect(bad.body.error.details.errors).toEqual([
      { row: 2, matricule: 'NOPE', reason: 'unknown_student' },
      { row: 3, matricule: S.ben.matricule, reason: 'invalid_value' },
    ]);
    expect(await owner.studentMark.count({ where: { assessmentId: ids.m1 } })).toBe(0);
    const ok = await teacher
      .post('/grade-sheets/import', { assessmentId: ids.m1, rows: [{ matricule: S.ana.matricule, value: '12' }, { matricule: S.ben.matricule, value: '15' }, { matricule: S.cyr.matricule, value: '8' }] })
      .expect(200);
    expect(ok.body.changed).toBe(3);
  });

  it('refuses to submit incomplete marks, then locks submitted ones', async () => {
    await teacher.put('/grade-sheets/marks', { ...sheet('math', 'seq2'), marks: [P(ids.m2!, 'ana', '30'), P(ids.m2!, 'ben', '20')] }).expect(200);
    const incomplete = await teacher.post('/grade-sheets/submit', sheet('math', 'seq2')).expect(422);
    expect(incomplete.body.error.code).toBe('INCOMPLETE_MARKS');
    expect(incomplete.body.error.details.missing).toHaveLength(1);
    await teacher.put('/grade-sheets/marks', { ...sheet('math', 'seq2'), marks: [{ assessmentId: ids.m2, studentId: S.cyr.id, status: 'ABSENT' }] }).expect(200);
    await teacher.post('/grade-sheets/submit', sheet('math', 'seq1')).expect(200);
    await teacher.post('/grade-sheets/submit', sheet('math', 'seq2')).expect(200);
    expect((await teacher.put('/grade-sheets/marks', { ...sheet('math', 'seq1'), marks: [P(ids.m1!, 'ana', '13')] }).expect(409)).body.error.code).toBe('MARKS_LOCKED');
  });
});

describe('approval workflow', () => {
  it('lets reviewers approve, but never their own submission', async () => {
    await teacher.post('/grade-sheets/approve', sheet('math', 'seq1')).expect(403);
    await director.put('/grade-sheets/marks', { ...sheet('fr', 'seq2'), marks: [P(ids.f1!, 'ana', '14'), P(ids.f1!, 'ben', '15.5'), P(ids.f1!, 'cyr', '11')] }).expect(200);
    await director.post('/grade-sheets/submit', sheet('fr', 'seq2')).expect(200);
    await director.post('/grade-sheets/approve', sheet('fr', 'seq2')).expect(403);
    await principal.post('/grade-sheets/approve', sheet('fr', 'seq2')).expect(200);
    await principal.post('/grade-sheets/approve', sheet('math', 'seq1')).expect(200);
  });

  it('will not generate report cards from unapproved marks', async () => {
    const res = await principal.post('/report-cards/generate', { classId: ids.class, scope: ids.term }).expect(409);
    expect(res.body.error.code).toBe('GRADES_NOT_APPROVED');
    await principal.post('/grade-sheets/approve', sheet('math', 'seq2')).expect(200);
  });
});

describe('report cards', () => {
  const card = async (who: keyof typeof S, scope = ids.term!) => {
    const list = (await principal.get(`/report-cards?classId=${ids.class}&scope=${scope}`).expect(200)).body;
    const row = list.find((c: { student: { matricule: string } }) => c.student.matricule === S[who].matricule);
    return (await principal.get(`/report-cards/${row.id}`).expect(200)).body;
  };

  it('computes the term results exactly as verified by hand', async () => {
    expect((await principal.post('/report-cards/generate', { classId: ids.class, scope: ids.term }).expect(200)).body).toMatchObject({ created: 3, unchanged: 0, rulesVersion: 1 });
    const ana = await card('ana');
    expect(ana.content).toMatchObject({ average: '14.00', rank: 1, ranked: 3, totals: { coefficients: '7', points: '98.00' }, mention: { labelFr: 'Bien' }, passed: true });
    expect(ana.content.subjects.map((s: { code: string; average: string }) => [s.code, s.average])).toEqual([
      ['FRA', '14.00'],
      ['MATH', '14.00'],
    ]);
    expect((await card('ben')).content).toMatchObject({ average: '13.31', rank: 2 });
    expect((await card('cyr')).content).toMatchObject({ average: '9.29', rank: 3, passed: false });
    expect(ana.content.classStats).toEqual({ average: '12.20', min: '9.29', max: '14.00', passRate: 66.7 });
  });

  it('does not create new versions when nothing changed', async () => {
    expect((await principal.post('/report-cards/generate', { classId: ids.class, scope: ids.term }).expect(200)).body).toMatchObject({ created: 0, unchanged: 3 });
  });

  it('verifies only published cards, publicly', async () => {
    const ana = await card('ana');
    ids.anaV1 = ana.verificationCode;
    await request(app.getHttpServer()).get(`/api/v1/verify/report-cards/${ana.verificationCode}`).expect(404);
    await teacher.post('/report-cards/publish', { classId: ids.class, scope: ids.term }).expect(403);
    await principal.post('/report-cards/publish', { classId: ids.class, scope: ids.term }).expect(200);
    const v = await request(app.getHttpServer()).get(`/api/v1/verify/report-cards/${ana.verificationCode}`).expect(200);
    expect(v.body).toMatchObject({ valid: true, status: 'PUBLISHED', average: '14.00', rank: 1, matricule: S.ana.matricule });
  });

  it('keeps report cards inside their school', async () => {
    const ana = await card('ana');
    await other.get(`/report-cards/${ana.id}`).expect(404);
  });

  it('renders a PDF for the class', async () => {
    const res = await principal.get(`/report-cards/class.pdf?classId=${ids.class}&scope=${ids.term}&lang=fr`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('reopening and versions (GRD-012/013)', () => {
  it('requires a reason to change approved marks and records every change', async () => {
    await teacher.post('/grade-sheets/reopen', { ...sheet('math', 'seq2'), reason: 'x' }).expect(403);
    await principal.post('/grade-sheets/reopen', sheet('math', 'seq2')).expect(422);
    await principal.post('/grade-sheets/reopen', { ...sheet('math', 'seq2'), reason: 'Copie de Cyr retrouvée' }).expect(200);
    const change = { ...sheet('math', 'seq2'), marks: [P(ids.m2!, 'cyr', '20')] };
    expect((await teacher.put('/grade-sheets/marks', change).expect(422)).body.error.code).toBe('CHANGE_REASON_REQUIRED');
    await teacher.put('/grade-sheets/marks', { ...change, reason: 'Copie retrouvée, notée 20/40' }).expect(200);
    const history = await owner.gradeChange.findMany({ where: { tenantId, assessmentId: ids.m2 } });
    expect(history).toEqual([expect.objectContaining({ fromStatus: 'ABSENT', toStatus: 'PRESENT', reason: 'Copie retrouvée, notée 20/40' })]);
    await teacher.post('/grade-sheets/submit', sheet('math', 'seq2')).expect(200);
    await principal.post('/grade-sheets/approve', sheet('math', 'seq2')).expect(200);
  });

  it('issues a new version and keeps the published one valid until the new one is published', async () => {
    expect((await principal.post('/report-cards/generate', { classId: ids.class, scope: ids.term }).expect(200)).body.created).toBe(3);
    const cyr = await card2('cyr');
    // Cyr maths: (8×1 + 20/40×20×2) / 3 = 28/3 = 9.33; general (9.33×4 + 11×3) / 7 = 70.32/7 = 10.0457 → 10.05
    expect(cyr.content).toMatchObject({ average: '10.05', passed: true });
    expect(cyr.version).toBe(2);
    expect((await request(app.getHttpServer()).get(`/api/v1/verify/report-cards/${ids.anaV1}`).expect(200)).body.valid).toBe(true);
    await director.post('/report-cards/publish', { classId: ids.class, scope: ids.term }).expect(200);
    const old = (await request(app.getHttpServer()).get(`/api/v1/verify/report-cards/${ids.anaV1}`).expect(200)).body;
    expect(old).toMatchObject({ valid: false, status: 'SUPERSEDED', version: 1 });
  });

  it('keeps published cards reproducible after the rules change (scenario 5)', async () => {
    const before = await card2('ana');
    await director.put('/grading/scheme', { name: 'Barème 1 décimale', rules: { maxScore: 20, passMark: 10, decimals: 1, missingPolicy: 'EXCLUDE', ranking: 'COMPETITION', mentions: [] } }).expect(200);
    expect((await director.get(`/report-cards/${before.id}`).expect(200)).body).toMatchObject({ rulesVersion: 1, content: { average: '14.00', rules: { version: 1, decimals: 2 } } });
    await principal.post('/report-cards/generate', { classId: ids.class, scope: ids.term }).expect(200);
    const after = await card2('ana');
    expect(after).toMatchObject({ rulesVersion: 2, version: 3, content: { average: '14.0', mention: null } });
  });

  async function card2(who: keyof typeof S) {
    const list = (await principal.get(`/report-cards?classId=${ids.class}&scope=${ids.term}`).expect(200)).body;
    const row = list.find((c: { student: { matricule: string } }) => c.student.matricule === S[who].matricule);
    return (await principal.get(`/report-cards/${row.id}`).expect(200)).body;
  }
});

describe('class council and statistics', () => {
  it('proposes promotions from the annual average and records overrides', async () => {
    const proposals = (await principal.get(`/promotions?classId=${ids.class}`).expect(200)).body;
    expect(proposals.map((p: { proposed: string }) => p.proposed)).toEqual(['PROMOTED', 'PROMOTED', 'PROMOTED']);
    const cyr = proposals.find((p: { student: { matricule: string } }) => p.student.matricule === S.cyr.matricule);
    await principal.put('/promotions', { classId: ids.class, decisions: [{ enrollmentId: cyr.enrollmentId, decision: 'REPEAT', note: 'Conseil de classe' }] }).expect(200);
    const log = await owner.auditLog.findFirstOrThrow({ where: { tenantId, action: 'promotion.decided' } });
    expect(log.metadata).toMatchObject({ to: 'REPEAT', proposed: 'PROMOTED', overridden: true });
  });

  it('reports final statistics once every sheet is approved', async () => {
    const stats = (await principal.get(`/grading/statistics?classId=${ids.class}&scope=${ids.term}`).expect(200)).body;
    expect(stats).toMatchObject({ status: 'FINAL', pending: 0, rulesVersion: 2 });
    expect(stats.belowPassMark).toEqual([]);
  });
});

describe('database guarantees', () => {
  const appDb = new PrismaClient();
  afterAll(() => appDb.$disconnect());
  const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof appDb.$transaction>[0]>[0]) => Promise<T>) =>
    appDb.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });

  it('rejects a mark above the maximum even when written directly', async () => {
    await expect(asTenant((tx) => tx.$executeRaw`UPDATE student_marks SET score = 99 WHERE assessment_id = ${ids.m1}::uuid`)).rejects.toThrow(/exceeds/);
  });

  it('freezes report card content', async () => {
    await expect(asTenant((tx) => tx.$executeRaw`UPDATE report_cards SET content = '{}'::jsonb`)).rejects.toThrow(/immutable/);
  });
});
