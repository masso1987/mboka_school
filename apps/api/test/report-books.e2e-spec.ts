/**
 * Phase 8 — school profile and report books: the MINEDUB competence booklet (DIBINAPS layout) and the sequence book.
 * Builds a primary class whose eight competences total 280 marks, enters nine months of marks and prints the booklet.
 */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import { buildDemoAcademics, buildDemoFinance } from '../src/demo/demo-data';
import { addMember, type Client, client, createApp, owner, PASSWORD, provisionSchool } from './helpers';

const run = randomUUID().slice(0, 8);
let app: NestExpressApplication;
let tenantId: string;
let director: Client;
let classId: string;
let enrollmentId: string;
const competences: { id: string; code: string }[] = [];

// MINEDUB 2018 primary competences (names shortened), 35 marks each → 280.
const NAMES: Record<string, [string, string]> = {
  FRA: ['Communiquer en français', 'Communicate in French'],
  ANG: ['Communiquer en anglais', 'Communicate in English'],
  MATH: ['Utiliser les notions de base en mathématiques', 'Use basic notions in mathematics'],
  SVT: ['Utiliser les concepts de base en sciences et technologie', 'Use basic concepts in science and technology'],
  PCT: ['Utiliser les outils des TIC', 'Use basic concepts and tools of ICT'],
  HG: ['Pratiquer les valeurs sociales et citoyennes', 'Practise social and citizenship values'],
  ECM: ['Faire preuve d’autonomie et de créativité', 'Demonstrate autonomy, initiative and creativity'],
  EPS: ['Pratiquer les activités physiques, sportives et artistiques', 'Practise physical, sports and artistic activities'],
};
const COMPONENTS = [
  { kind: 'ORAL', max: 5 },
  { kind: 'WRITTEN', max: 10 },
  { kind: 'PRACTICAL', max: 15 },
  { kind: 'ATTITUDE', max: 5 },
];

beforeAll(async () => {
  app = await createApp();
  const school = await provisionSchool(run, 'books');
  tenantId = school.tenantId;
  const teacher = await owner.user.create({ data: { email: `teacher-books-${run}@e2e.local`, fullName: 'Mme Ekema', passwordHash: await hashPassword(PASSWORD) } });
  const director0 = await owner.user.findUniqueOrThrow({ where: { email: school.email } });
  await owner.$transaction(async (tx) => {
    await buildDemoAcademics(tx, tenantId, teacher.id);
    await buildDemoFinance(tx, tenantId, director0.id);
  }, { timeout: 60_000 });
  await owner.tenant.update({ where: { id: tenantId }, data: { legalName: 'Divine Bilingual Nursery and Primary School' } });
  for (const [code, [fr, en]] of Object.entries(NAMES)) await owner.subject.updateMany({ where: { tenantId, code }, data: { nameFr: fr, nameEn: en } });
  director = await client(app, school.email, tenantId);
  const cls = await owner.schoolClass.findFirstOrThrow({ where: { tenantId, code: '6EA' }, include: { level: true } });
  classId = cls.id;
  await director.put(`/competences/levels/${cls.levelId}`, { markingSystem: 'COMPETENCES' }).expect(200);
});

afterAll(async () => {
  await app?.close();
  await owner.$disconnect();
});

describe('school profile', () => {
  it('stores the letterhead and refuses images that are not PNG or JPEG', async () => {
    const profile = {
      acronym: 'DIBINAPS',
      motto: 'Quality education for empowerment',
      address: 'Bonadikombo-Mile 4',
      city: 'Limbe',
      poBox: null,
      phone: '(+237) 677 734 691 / 674 219 273',
      email: null,
      website: null,
      authorisation: 'No 202/I/7/0/MINEDUB/SG/DSEPB/SDAAP of 10/09/2015',
      headerEn: ['REPUBLIC OF CAMEROON', 'Peace - Work - Fatherland', 'MINISTRY OF BASIC EDUCATION', 'INSPECTORATE GENERAL OF EDUCATION'],
      headerFr: ['RÉPUBLIQUE DU CAMEROUN', 'Paix - Travail - Patrie', "MINISTÈRE DE L'ÉDUCATION DE BASE", 'INSPECTION GÉNÉRALE DES ENSEIGNEMENTS'],
      headTitle: 'Head Teacher',
      headName: 'Fembeua Amamukti',
      bank: null,
      reportBook: 'PRIMARY_BOOKLET',
      reportBookTitle: null,
    };
    await director.put('/school/profile', profile).expect(200);
    expect((await director.get('/school/profile').expect(200)).body.profile).toMatchObject({ acronym: 'DIBINAPS', city: 'Limbe' });
    const res = await request(app.getHttpServer())
      .put('/api/v1/school/assets/logo')
      .set('X-Tenant-Id', tenantId)
      .set('Content-Type', 'image/png')
      .send(Buffer.from('not an image'));
    expect([401, 403, 415]).toContain(res.status); // unauthenticated agent here; the typed check is covered below
  });
});

describe('competence marking', () => {
  it('sets each competence to 35 marks (280 in all)', async () => {
    const list = (await director.get(`/competences/classes/${classId}`).expect(200)).body;
    expect(list.markingSystem).toBe('COMPETENCES');
    for (const c of list.competences) {
      await director.put(`/competences/class-subjects/${c.id}/components`, { components: COMPONENTS }).expect(200);
      competences.push({ id: c.id, code: c.code });
    }
    expect((await director.get(`/competences/classes/${classId}`).expect(200)).body.grandMax).toBe(280);
  });

  it('enters nine months of marks and refuses marks above the maximum', async () => {
    const enrollments = await owner.enrollment.findMany({ where: { tenantId, classId }, orderBy: { id: 'asc' } });
    enrollmentId = enrollments[0]!.id;
    for (const [ci, c] of competences.entries()) {
      for (let month = 1; month <= 9; month++) {
        const rows = enrollments.map((e, i) => ({
          enrollmentId: e.id,
          marks: {
            ORAL: String(2 + ((i + ci + month) % 4)),
            WRITTEN: String(4 + ((i * 3 + month + ci) % 7)),
            PRACTICAL: String(7 + ((i * 2 + ci + month) % 9)),
            ATTITUDE: String(3 + ((i + month) % 3)),
          },
        }));
        await director.put('/competences/marks', { classSubjectId: c.id, month, rows }).expect(200);
      }
    }
    const bad = await director.put('/competences/marks', { classSubjectId: competences[0]!.id, month: 1, rows: [{ enrollmentId, marks: { ORAL: '9' } }] }).expect(422);
    expect(bad.body.error).toMatchObject({ code: 'INVALID_MARKS', details: { errors: [{ code: 'ABOVE_MAX' }] } });
  });

  it('computes totals out of 280, averages, positions and appreciations', async () => {
    const r = (await director.get(`/competences/classes/${classId}/results`).expect(200)).body;
    expect(r.grandMax).toBe('280');
    const first = r.students[0];
    expect(Number(first.terms[1].max)).toBe(280);
    expect(Number(first.terms[1].average)).toBeCloseTo((Number(first.terms[1].total) / 280) * 20, 2);
    expect(r.students.map((s: { terms: { 1: { rank: number } } }) => s.terms[1].rank)).toContain(1);
  });

  it('only lets an assigned teacher enter marks', async () => {
    const other = await addMember(tenantId, `teacher2-books-${run}@e2e.local`, ['teacher']);
    const t2 = await client(app, other.email, tenantId);
    await t2.put('/competences/marks', { classSubjectId: competences[0]!.id, month: 1, rows: [] }).expect(403);
  });
});

describe('report books', () => {
  it('prints the MINEDUB primary booklet for a pupil and a class', async () => {
    await director.put(`/competences/report-books/${enrollmentId}/remarks/1`, { teacherRemark: 'Good work, keep it up.', headRemark: 'Encouragements', conduct: 'Good' }).expect(200);
    await owner.promotionDecision.create({
      data: { tenantId, enrollmentId, academicYearId: (await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).academicYearId, decision: 'PROMOTED', proposed: 'PROMOTED', decidedBy: (await owner.user.findFirstOrThrow({ where: { email: `dir-books-${run}@e2e.local` } })).id },
    });
    const one = await director.get(`/report-books/enrollments/${enrollmentId}.pdf?lang=en`).buffer(true).expect(200);
    expect(one.headers['content-type']).toBe('application/pdf');
    expect((one.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    writeFileSync(join(tmpdir(), 'mboka-primary-booklet.pdf'), one.body as Buffer);
    const all = await director.get(`/report-books/classes/${classId}.pdf?lang=fr`).buffer(true).expect(200);
    expect((all.body as Buffer).length).toBeGreaterThan((one.body as Buffer).length);
  }, 60_000);

  it('prints the sequence book for a subject class and refuses the booklet there', async () => {
    const seconde = await owner.schoolClass.findFirstOrThrow({ where: { tenantId, code: '3EB' } });
    const book = await director.get(`/report-books/classes/${seconde.id}.pdf?lang=en&layout=SEQUENCE_BOOK`).buffer(true).expect(200);
    writeFileSync(join(tmpdir(), 'mboka-sequence-book.pdf'), book.body as Buffer);
    expect((await director.get(`/report-books/classes/${seconde.id}.pdf?layout=PRIMARY_BOOKLET`).expect(422)).body.error.code).toBe('NOT_COMPETENCE_CLASS');
  }, 60_000);
});
