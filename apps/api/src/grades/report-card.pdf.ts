import PDFDocument from 'pdfkit';
import type { ReportCardContent } from './report-cards.service';

type Lang = 'fr' | 'en';

const L = {
  fr: {
    title: 'BULLETIN DE NOTES',
    year: 'Année scolaire',
    period: 'Période',
    annual: 'Bulletin annuel',
    student: 'Élève',
    matricule: 'Matricule',
    born: 'Né(e) le',
    class: 'Classe',
    size: 'Effectif',
    subject: 'Matière',
    coef: 'Coef.',
    avg: 'Moy.',
    points: 'Points',
    rank: 'Rang',
    classAvg: 'Moy. cl.',
    teacher: 'Enseignant / appréciation',
    totals: 'Totaux',
    general: 'Moyenne générale',
    of: 'sur',
    mention: 'Mention',
    classStats: 'Classe : moyenne {avg}, min {min}, max {max}, réussite {rate} %',
    attendance: 'Absences : {abs} non justifiée(s), {exc} justifiée(s) — Retards : {late}',
    decision: 'Décision du conseil de classe',
    decisions: { PROMOTED: 'Admis(e) en classe supérieure', REPEAT: 'Redouble', GRADUATED: 'Fin de cycle', EXCLUDED: 'Exclu(e)' } as Record<string, string>,
    rules: 'Barème v{v} — moyennes sur {max}, seuil {pass}, absences {missing}',
    missing: { EXCLUDE: 'non comptées', ZERO: 'comptées 0' } as Record<string, string>,
    verify: 'Code de vérification',
    draft: 'PROJET — NON PUBLIÉ',
    superseded: 'VERSION REMPLACÉE',
    signatures: 'Le professeur principal                    Le chef d’établissement',
  },
  en: {
    title: 'REPORT CARD',
    year: 'Academic year',
    period: 'Period',
    annual: 'Annual report',
    student: 'Student',
    matricule: 'Matricule',
    born: 'Born',
    class: 'Class',
    size: 'Class size',
    subject: 'Subject',
    coef: 'Coef.',
    avg: 'Avg.',
    points: 'Points',
    rank: 'Rank',
    classAvg: 'Class avg.',
    teacher: 'Teacher / comment',
    totals: 'Totals',
    general: 'General average',
    of: 'of',
    mention: 'Grade',
    classStats: 'Class: average {avg}, min {min}, max {max}, pass rate {rate} %',
    attendance: 'Absences: {abs} unexcused, {exc} excused — Lates: {late}',
    decision: 'Class council decision',
    decisions: { PROMOTED: 'Promoted', REPEAT: 'Repeats the year', GRADUATED: 'Completed the cycle', EXCLUDED: 'Excluded' } as Record<string, string>,
    rules: 'Rules v{v} — averages out of {max}, pass mark {pass}, absences {missing}',
    missing: { EXCLUDE: 'not counted', ZERO: 'counted as 0' } as Record<string, string>,
    verify: 'Verification code',
    draft: 'DRAFT — NOT PUBLISHED',
    superseded: 'SUPERSEDED VERSION',
    signatures: 'Class teacher                                   Head of school',
  },
};

const fill = (s: string, v: Record<string, string | number | null>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? '—'));

/** Server-side PDF of one or many report cards, one A4 page each (GRD-009). */
export function renderReportCardsPdf(cards: { content: ReportCardContent; code: string; status: string; version: number }[], lang: Lang): Promise<Buffer> {
  const t = L[lang];
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: t.title, Creator: 'Mboka School System' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  cards.forEach(({ content: c, code, status, version }, index) => {
    if (index > 0) doc.addPage();
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font('Helvetica-Bold').fontSize(13).text(c.school.tradingName ?? c.school.legalName, left, 36, { width, align: 'center' });
    doc.font('Helvetica').fontSize(8).text(c.school.legalName, { width, align: 'center' });
    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(12).text(t.title, { width, align: 'center' });
    doc.font('Helvetica').fontSize(9).text(`${t.year} ${c.academicYear} — ${c.scope.kind === 'ANNUAL' ? t.annual : `${t.period} : ${c.scope.label}`}`, { width, align: 'center' });
    if (status !== 'PUBLISHED') doc.fillColor('#b91c1c').font('Helvetica-Bold').text(status === 'DRAFT' ? t.draft : t.superseded, { width, align: 'center' }).fillColor('black');

    doc.moveDown(0.6).font('Helvetica').fontSize(9);
    const y0 = doc.y;
    doc.text(`${t.student} : ${c.student.lastName.toUpperCase()} ${c.student.firstName}`, left, y0);
    doc.text(`${t.matricule} : ${c.student.matricule}    ${t.born} ${c.student.dateOfBirth}`, left, doc.y);
    doc.text(`${t.class} : ${c.class.name}    ${t.size} : ${c.class.size}`, left + width / 2, y0, { width: width / 2, align: 'right' });

    // Subjects table
    const cols = [
      { key: 'subject', w: 0.24 },
      { key: 'coef', w: 0.06 },
      { key: 'avg', w: 0.08 },
      { key: 'points', w: 0.09 },
      { key: 'rank', w: 0.06 },
      { key: 'classAvg', w: 0.09 },
      { key: 'teacher', w: 0.38 },
    ] as const;
    let y = doc.y + 10;
    const row = (cells: string[], bold = false, shade = false) => {
      const h = 16;
      if (shade) doc.rect(left, y - 2, width, h).fill('#eef2f7').fillColor('black');
      let x = left;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      cells.forEach((cell, i) => {
        const w = cols[i]!.w * width;
        doc.text(cell, x + 2, y + 2, { width: w - 4, height: h, ellipsis: true, lineBreak: false, align: i === 0 || i === 6 ? 'left' : 'right' });
        x += w;
      });
      y += h;
    };
    row([t.subject, t.coef, t.avg, t.points, t.rank, t.classAvg, t.teacher], true, true);
    for (const s of c.subjects) {
      row([
        lang === 'en' ? s.nameEn : s.nameFr,
        s.coefficient,
        s.average ?? '—',
        s.points ?? '—',
        s.rank ? String(s.rank) : '—',
        s.classAverage ?? '—',
        [s.teacher, s.comment].filter(Boolean).join(' — '),
      ]);
      doc.moveTo(left, y - 1).lineTo(left + width, y - 1).lineWidth(0.3).strokeColor('#cbd5e1').stroke();
    }
    row([t.totals, c.totals.coefficients, '', c.totals.points, '', '', ''], true, true);

    // Results
    y += 8;
    doc.font('Helvetica-Bold').fontSize(11).text(`${t.general} : ${c.average ?? '—'} / ${c.rules.maxScore}`, left, y);
    doc.font('Helvetica').fontSize(9);
    doc.text(`${t.rank} : ${c.rank ?? '—'} ${t.of} ${c.ranked}    ${t.mention} : ${c.mention ? (lang === 'en' ? c.mention.labelEn : c.mention.labelFr) : '—'}`);
    doc.text(fill(t.classStats, { avg: c.classStats.average, min: c.classStats.min, max: c.classStats.max, rate: c.classStats.passRate }));
    doc.text(fill(t.attendance, { abs: c.attendance.absences, exc: c.attendance.excused, late: c.attendance.lates }));
    if (c.decision) doc.moveDown(0.3).font('Helvetica-Bold').text(`${t.decision} : ${t.decisions[c.decision] ?? c.decision}`).font('Helvetica');

    doc.moveDown(2).text(t.signatures, { width });

    // Footer: rules and verification
    const footY = doc.page.height - doc.page.margins.bottom - 28;
    doc.fontSize(7).fillColor('#475569');
    doc.text(fill(t.rules, { v: c.rules.version, max: c.rules.maxScore, pass: c.rules.passMark, missing: t.missing[c.rules.missingPolicy] ?? c.rules.missingPolicy }), left, footY, { width });
    doc.text(`${t.verify} : ${code}  (v${version})`, left, footY + 10, { width });
    doc.fillColor('black');
  });

  doc.end();
  return done;
}
