import type { Appreciation, CompetenceComponent, CompetenceTermResult, SchoolProfile } from '@mboka/shared';
import PDFDocument from 'pdfkit';

/**
 * Report books as printed by Cameroonian schools (Phase 8), one or several pupils per file:
 * - PRIMARY: the MINEDUB 2018 competence-based progress report booklet (cover, competence pages, observations);
 * - SEQUENCE: the subject/sequence progress report book (cover with grading scale, marks page, decisions).
 * Pure drawing from prepared data; the service gathers marks, remarks and the school's letterhead.
 */
type Lang = 'fr' | 'en';
type Doc = PDFKit.PDFDocument;

export interface BookLetterhead {
  legalName: string;
  tradingName: string | null;
  profile: SchoolProfile;
  assets: Partial<Record<'logo' | 'emblem' | 'stamp' | 'signature', Buffer>>;
}

export interface BookPupil {
  firstName: string;
  lastName: string;
  matricule: string;
  dateOfBirth: string;
  placeOfBirth: string | null;
  region: string | null;
  division: string | null;
  subDivision: string | null;
  healthStatus: string | null;
  className: string;
  academicYear: string;
}

export interface TermSummary {
  total: string | null;
  max: string | null;
  average: string | null;
  rank: number | null;
  closing: string | null;
  reopening: string | null;
  teacherRemark: string | null;
  headRemark: string | null;
  conduct: string | null;
}

export interface PrimaryBook {
  kind: 'PRIMARY';
  pupil: BookPupil;
  classSize: number;
  grandMax: string;
  competences: {
    code: string;
    name: string;
    max: string;
    components: { kind: CompetenceComponent; max: string }[];
    terms: Record<number, CompetenceTermResult>;
    annual: { total: string | null; appreciation: Appreciation | null };
  }[];
  terms: Record<number, TermSummary>;
  annual: TermSummary & { decision: string | null };
}

export interface SequenceBook {
  kind: 'SEQUENCE';
  pupil: BookPupil;
  classSize: number;
  passMark: number;
  maxScore: number;
  subjects: { code: string; name: string; coefficient: string; terms: (string | null)[]; annual: string | null }[];
  termLabels: string[];
  terms: { average: string | null; rank: number | null; ranked: number }[];
  annual: { average: string | null; rank: number | null; ranked: number; decision: string | null; total: string | null };
}

const T = {
  en: {
    booklet: 'PRIMARY SCHOOL PROGRESS\nREPORT BOOKLET',
    conformity: 'IN CONFORMITY WITH THE 2018 MINEDUB CURRICULUM',
    sequenceBook: 'SEQUENCE PROGRESS REPORT\nBOOK',
    name: 'NAME OF PUPIL',
    born: 'DATE AND PLACE OF BIRTH',
    subDivision: 'SUB-DIVISION',
    division: 'DIVISION',
    region: 'REGION',
    health: 'HEALTH STATUS',
    class: 'CLASS',
    admission: 'ADMISSION NUMBER',
    year: 'SCHOOL YEAR',
    photo: 'PHOTO',
    competence: 'COMPETENCE',
    marks: 'marks',
    term: 'TERM',
    month: 'MONTH',
    evalTypes: 'EVAL. TYPES',
    total: 'TOTAL',
    appreciation: 'APPRECIATION',
    annual: 'An.',
    annualAppreciation: 'Annual appreciation',
    termNames: ['FIRST', 'SECOND', 'THIRD'],
    components: { ORAL: 'Oral', WRITTEN: 'Written', PRACTICAL: 'Practical', ATTITUDE: 'Attitude' } as Record<CompetenceComponent, string>,
    grandTotal: 'GRAND TOTAL',
    observations: 'GENERAL OBSERVATION AND REMARKS',
    teacher: 'TEACHER\nDATE AND SIGNATURE',
    head: 'HEAD TEACHER\nDATE AND SIGNATURE',
    parent: 'PARENT / GUARDIAN\nDATE AND SIGNATURE',
    annualRow: 'ANNUAL',
    totalLine: 'Total',
    avLine: 'Av',
    posLine: 'Position',
    outOf: 'out of',
    closing: 'Closing',
    reopening: 'Reopening',
    conduct: 'Conduct',
    decisions: { PROMOTED: 'PROMOTED', REPEAT: 'REPEAT', GRADUATED: 'COMPLETED THE CYCLE', EXCLUDED: 'DISMISSED' } as Record<string, string>,
    subject: 'SUBJECTS',
    coef: 'Coef',
    ca: 'CA',
    cna: 'CNA',
    annualAv: 'Annual average',
    annualPos: 'Annual position',
    council: 'Class council decision',
    classTeacher: "Class teacher's sign",
    headSign: "Head teacher's sign",
    parentSign: "Parent's sign",
    scale: [
      ['18-20', 'Excellent'],
      ['16-17', 'Very good'],
      ['14-15', 'Good'],
      ['12-13', 'Fair'],
      ['10-11', 'Average'],
      ['8-9', 'Insufficient'],
      ['5-7', 'Weak'],
      ['0-4', 'Poor'],
    ],
    legend: 'SNA: skill not acquired · SPA: skill partially acquired · SA: skill acquired · Exp: expert',
  },
  fr: {
    booklet: 'LIVRET SCOLAIRE\nDE L’ÉCOLE PRIMAIRE',
    conformity: 'CONFORME AU CURRICULUM MINEDUB 2018',
    sequenceBook: 'LIVRET DE SUIVI\nDES SÉQUENCES',
    name: 'NOM DE L’ÉLÈVE',
    born: 'DATE ET LIEU DE NAISSANCE',
    subDivision: 'ARRONDISSEMENT',
    division: 'DÉPARTEMENT',
    region: 'RÉGION',
    health: 'ÉTAT DE SANTÉ',
    class: 'CLASSE',
    admission: 'MATRICULE',
    year: 'ANNÉE SCOLAIRE',
    photo: 'PHOTO',
    competence: 'COMPÉTENCE',
    marks: 'points',
    term: 'TRIMESTRE',
    month: 'MOIS',
    evalTypes: 'TYPES D’ÉVAL.',
    total: 'TOTAL',
    appreciation: 'APPRÉCIATION',
    annual: 'An.',
    annualAppreciation: 'Appréciation annuelle',
    termNames: ['PREMIER', 'DEUXIÈME', 'TROISIÈME'],
    components: { ORAL: 'Oral', WRITTEN: 'Écrit', PRACTICAL: 'Pratique', ATTITUDE: 'Attitude' } as Record<CompetenceComponent, string>,
    grandTotal: 'TOTAL GÉNÉRAL',
    observations: 'OBSERVATIONS GÉNÉRALES',
    teacher: 'ENSEIGNANT\nDATE ET SIGNATURE',
    head: 'DIRECTEUR\nDATE ET SIGNATURE',
    parent: 'PARENT / TUTEUR\nDATE ET SIGNATURE',
    annualRow: 'ANNUEL',
    totalLine: 'Total',
    avLine: 'Moy',
    posLine: 'Rang',
    outOf: 'sur',
    closing: 'Fin',
    reopening: 'Reprise',
    conduct: 'Conduite',
    decisions: { PROMOTED: 'ADMIS(E)', REPEAT: 'REDOUBLE', GRADUATED: 'FIN DE CYCLE', EXCLUDED: 'EXCLU(E)' } as Record<string, string>,
    subject: 'MATIÈRES',
    coef: 'Coef',
    ca: 'CA',
    cna: 'CNA',
    annualAv: 'Moyenne annuelle',
    annualPos: 'Rang annuel',
    council: 'Décision du conseil de classe',
    classTeacher: 'Signature du maître',
    headSign: 'Signature du directeur',
    parentSign: 'Signature du parent',
    scale: [
      ['18-20', 'Excellent'],
      ['16-17', 'Très bien'],
      ['14-15', 'Bien'],
      ['12-13', 'Assez bien'],
      ['10-11', 'Passable'],
      ['8-9', 'Insuffisant'],
      ['5-7', 'Faible'],
      ['0-4', 'Médiocre'],
    ],
    legend: 'SNA : compétence non acquise · SPA : partiellement acquise · SA : acquise · Exp : expert',
  },
};

const INK = '#1a1a1a';
const RED = '#c0262d';
const GREEN = '#0b7a3e';
const GREY = '#6b7280';
const FLAG = { green: '#007a5e', red: '#ce1126', yellow: '#fcd116' };

const fmtDate = (iso: string | null, lang: Lang) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { timeZone: 'UTC' }) : '');
const ordinal = (n: number, lang: Lang) => (lang === 'fr' ? (n === 1 ? '1er' : `${n}e`) : `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`);
const img = (doc: Doc, data: Buffer | undefined, x: number, y: number, opts: PDFKit.Mixins.ImageOption) => {
  if (!data) return false;
  try {
    doc.image(data, x, y, opts);
    return true;
  } catch {
    return false; // an unreadable image never stops the booklet
  }
};

/** A five-pointed star (the one on the Cameroon flag). */
function star(doc: Doc, cx: number, cy: number, r: number, color: string) {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  doc.polygon(...pts).fill(color);
}

/** Bilingual Republic / ministry header, coat of arms in the middle, flag ribbon underneath. */
function officialHeader(doc: Doc, lh: BookLetterhead, x: number, y: number, w: number) {
  const col = w * 0.38;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.2);
  lh.profile.headerEn.forEach((line, i) => doc.text(line, x, y + i * 9.5, { width: col, align: 'center' }));
  lh.profile.headerFr.forEach((line, i) => doc.text(line, x + w - col, y + i * 9.5, { width: col, align: 'center' }));
  img(doc, lh.assets.emblem, x + w / 2 - 22, y - 4, { fit: [44, 44], align: 'center' });
  // Ribbon in the national colours under the English block, as on the printed booklet.
  const ry = y + Math.max(lh.profile.headerEn.length, lh.profile.headerFr.length) * 9.5 + 4;
  const band = (col * 0.9) / 3;
  doc.rect(x + col * 0.05, ry, band, 5).fill(FLAG.green);
  doc.rect(x + col * 0.05 + band, ry, band, 5).fill(FLAG.red);
  doc.rect(x + col * 0.05 + band * 2, ry, band, 5).fill(FLAG.yellow);
  star(doc, x + col * 0.05 + band * 1.5, ry + 2.5, 2.4, FLAG.yellow);
  return ry + 12;
}

/** School name, acronym, address, motto, authorisation and phone, centred. */
function schoolIdentity(doc: Doc, lh: BookLetterhead, x: number, y: number, w: number, nameColor = INK) {
  const p = lh.profile;
  doc.fillColor(nameColor).font('Times-Bold').fontSize(17).text(lh.legalName.toUpperCase(), x, y, { width: w, align: 'center' });
  if (p.acronym) doc.font('Times-Bold').fontSize(13).text(p.acronym, { width: w, align: 'center' });
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9);
  const place = [p.address, p.city].filter(Boolean).join(' - ');
  if (place) doc.text(place.toUpperCase(), { width: w, align: 'center' });
  doc.font('Helvetica').fontSize(8);
  if (p.motto) doc.fillColor(GREY).text(`MOTTO: ${p.motto.toUpperCase()}`, { width: w, align: 'center' });
  if (p.authorisation) doc.fillColor(RED).text(`Authorization ${p.authorisation}`, { width: w, align: 'center' });
  if (p.phone) doc.fillColor(INK).text(`Tel: ${p.phone}`, { width: w, align: 'center' });
  return doc.y;
}

/** Ornamental frame of small squares, like the printed booklet's border. */
function ornamentFrame(doc: Doc) {
  const m = 18;
  const { width, height } = doc.page;
  doc.lineWidth(1.2).strokeColor(INK).rect(m, m, width - 2 * m, height - 2 * m).stroke();
  doc.lineWidth(0.6).rect(m + 9, m + 9, width - 2 * m - 18, height - 2 * m - 18).stroke();
  for (let x = m + 4.5; x < width - m - 2; x += 9) {
    doc.rect(x - 2, m + 2.5, 4, 4).fill(INK);
    doc.rect(x - 2, height - m - 6.5, 4, 4).fill(INK);
  }
  for (let y = m + 13.5; y < height - m - 10; y += 9) {
    doc.rect(m + 2.5, y - 2, 4, 4).fill(INK);
    doc.rect(width - m - 6.5, y - 2, 4, 4).fill(INK);
  }
}

function infoLines(doc: Doc, rows: [string, string][], x: number, y: number, w: number) {
  let cy = y;
  for (const [label, value] of rows) {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(`${label}:`, x, cy, { width: w * 0.42, lineBreak: false });
    const lx = x + w * 0.42;
    doc.moveTo(lx, cy + 10).lineTo(x + w, cy + 10).lineWidth(0.5).strokeColor(INK).dash(1.2, { space: 1.6 }).stroke().undash();
    if (value) doc.font('Times-Italic').fontSize(11).fillColor('#1d3fa8').text(value, lx + 4, cy - 2, { width: w * 0.58 - 6, height: 14, lineBreak: false, ellipsis: true });
    cy += 22;
  }
  return cy;
}

function pupilRows(p: BookPupil, t: (typeof T)['en'], lang: Lang): [string, string][] {
  return [
    [t.name, `${p.lastName.toUpperCase()} ${p.firstName}`],
    [t.born, [fmtDate(p.dateOfBirth, lang), p.placeOfBirth].filter(Boolean).join(lang === 'fr' ? ' à ' : ' at ')],
    [t.class, `${p.className}   ·   ${t.year} ${p.academicYear}`],
    [t.admission, p.matricule],
    [t.subDivision, p.subDivision ?? ''],
    [t.division, p.division ?? ''],
    [t.region, p.region ?? ''],
    [t.health, p.healthStatus ?? ''],
  ];
}

// ================================================================ primary booklet

function primaryCover(doc: Doc, lh: BookLetterhead, book: PrimaryBook, t: (typeof T)['en'], lang: Lang) {
  ornamentFrame(doc);
  const x = 52;
  const w = doc.page.width - 104;
  let y = officialHeader(doc, lh, x, 48, w);
  // Photo box at the right of the school name.
  doc.lineWidth(0.8).strokeColor(INK).rect(x + w - 86, y + 2, 86, 92).stroke();
  doc.fillColor(GREY).font('Helvetica-Bold').fontSize(9).text(t.photo, x + w - 86, y + 42, { width: 86, align: 'center' });
  y = schoolIdentity(doc, lh, x + 70, y + 6, w - 160) + 10;
  // The logo's place is kept even before one is uploaded, so the cover stays balanced.
  img(doc, lh.assets.logo, doc.page.width / 2 - 70, y + 6, { fit: [140, 140], align: 'center' });
  y += 160;

  // Red banner with the booklet's title.
  const bw = w * 0.82;
  const bx = doc.page.width / 2 - bw / 2;
  doc.roundedRect(bx, y, bw, 92, 10).fill(RED);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(19).text(lh.profile.reportBookTitle?.toUpperCase() ?? t.booklet, bx, y + 14, { width: bw, align: 'center', lineGap: 2 });
  doc.font('Helvetica-Bold').fontSize(9.5).text(t.conformity, bx, y + 70, { width: bw, align: 'center' });
  y += 112;

  doc.lineWidth(0.8).strokeColor(INK).rect(x + 6, y, w - 12, 200).stroke();
  infoLines(doc, pupilRows(book.pupil, t, lang), x + 18, y + 14, w - 36);
}

/** One competence block: rows per component, then TOTAL and APPRECIATION, months 1–9 grouped by term. */
function competenceBlock(doc: Doc, c: PrimaryBook['competences'][number], x: number, y: number, w: number, t: (typeof T)['en']) {
  const labelW = w * 0.24;
  const cols = 17; // 3 × (3 months + total) + annual + 4 appreciations
  const cw = (w - labelW) / cols;
  const rowH = 12;
  const line = (yy: number) => doc.moveTo(x, yy).lineTo(x + w, yy).lineWidth(0.4).strokeColor(INK).stroke();
  const cell = (text: string, col: number, yy: number, opts: { bold?: boolean; color?: string; size?: number } = {}) =>
    doc
      .fillColor(opts.color ?? INK)
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(opts.size ?? 6.6)
      .text(text, x + labelW + col * cw, yy + 3, { width: cw, align: 'center', lineBreak: false });

  // Title band.
  doc.rect(x, y, w, 13).fill('#e9eef0');
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5).text(`${t.competence} ${c.code}: ${c.name.toUpperCase()} (${Number(c.max)} ${t.marks})`, x + 4, y + 3, { width: w - 8, height: 10, lineBreak: false, ellipsis: true });
  y += 13;
  // Term header.
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(INK);
  doc.text(t.term, x + 3, y + 3, { width: labelW - 6 });
  t.termNames.forEach((name, i) => doc.text(name, x + labelW + i * 4 * cw, y + 3, { width: cw * 4, align: 'center' }));
  doc.text(t.annual, x + labelW + 12 * cw, y + 3, { width: cw, align: 'center' });
  doc.text(t.annualAppreciation, x + labelW + 13 * cw, y + 3, { width: cw * 4, align: 'center', height: 9, lineBreak: false, ellipsis: true });
  line(y);
  y += rowH;
  // Month header.
  doc.text(t.month, x + 3, y + 3, { width: labelW - 6 });
  for (let term = 0; term < 3; term++) {
    for (let m = 0; m < 3; m++) cell(String(term * 3 + m + 1), term * 4 + m, y, { bold: true });
    cell(t.total, term * 4 + 3, y, { bold: true, size: 5.6 });
  }
  cell(t.total, 12, y, { bold: true, size: 5.6 });
  ['SNA', 'SPA', 'SA', 'Exp'].forEach((a, i) => cell(a, 13 + i, y, { bold: true }));
  line(y);
  y += rowH;
  // Components.
  for (const comp of c.components) {
    doc.fillColor(INK).font('Helvetica').fontSize(6.6).text(`${t.components[comp.kind]} - ${Number(comp.max)} mks`, x + 3, y + 3, { width: labelW - 6, lineBreak: false });
    for (let term = 1; term <= 3; term++) {
      const r = c.terms[term];
      for (let m = 0; m < 3; m++) {
        const v = r?.months[(term - 1) * 3 + m + 1]?.[comp.kind];
        if (v !== undefined) cell(String(Number(v)), (term - 1) * 4 + m, y, { color: '#1d3fa8' });
      }
      const termMark = r?.components[comp.kind];
      if (termMark !== undefined) cell(String(Number(termMark)), (term - 1) * 4 + 3, y, { bold: true });
    }
    line(y);
    y += rowH;
  }
  // TOTAL row.
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(6.8).text(t.total, x + 3, y + 3, { width: labelW - 6 });
  for (let term = 1; term <= 3; term++) {
    const total = c.terms[term]?.total;
    if (total) cell(String(Number(total)), (term - 1) * 4 + 3, y, { bold: true });
  }
  if (c.annual.total) cell(String(Number(c.annual.total)), 12, y, { bold: true });
  const ann = c.annual.appreciation ? ['SNA', 'SPA', 'SA', 'EXP'].indexOf(c.annual.appreciation) : -1;
  if (ann >= 0) {
    // A drawn tick: the standard PDF fonts have no check mark glyph.
    const tx = x + labelW + (13 + ann) * cw + cw / 2;
    doc.moveTo(tx - 3, y + 6).lineTo(tx - 1, y + 9).lineTo(tx + 4, y + 2).lineWidth(1.2).strokeColor(GREEN).stroke();
  }
  line(y);
  y += rowH;
  // APPRECIATION row.
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(6.8).text(t.appreciation, x + 3, y + 3, { width: labelW - 6 });
  for (let term = 1; term <= 3; term++) {
    const a = c.terms[term]?.appreciation;
    if (a) cell(a === 'EXP' ? 'Exp' : a, (term - 1) * 4 + 3, y, { bold: true, color: a === 'SNA' ? RED : GREEN });
  }
  line(y);
  y += rowH;
  // Grid.
  const top = y - rowH * (c.components.length + 4);
  doc.lineWidth(0.6).strokeColor(INK).rect(x, top - 13, w, y - top + 13).stroke();
  doc.lineWidth(0.4);
  doc.moveTo(x + labelW, top).lineTo(x + labelW, y).stroke();
  for (let i = 1; i < cols; i++) {
    // Term, annual and appreciation groups run the full height; lines inside a group start below its heading.
    const groupEdge = (i % 4 === 0 && i <= 12) || i === 13;
    doc.lineWidth(groupEdge ? 0.8 : 0.3).moveTo(x + labelW + i * cw, top + (groupEdge ? 0 : rowH)).lineTo(x + labelW + i * cw, y).stroke();
  }
  return y + 8;
}

function primaryCompetencePages(doc: Doc, book: PrimaryBook, t: (typeof T)['en']) {
  const x = 30;
  const w = doc.page.width - 60;
  let y = 32;
  for (const c of book.competences) {
    const h = 13 + 12 * (c.components.length + 4) + 8;
    if (y + h > doc.page.height - 50) {
      doc.addPage();
      y = 32;
    }
    y = competenceBlock(doc, c, x, y, w, t);
  }
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(`${t.grandTotal} = ${Number(book.grandMax)} MARKS`, x, Math.min(y + 4, doc.page.height - 60));
  doc.font('Helvetica').fontSize(7).fillColor(GREY).text(t.legend, x, doc.y + 2, { width: w });
}

function primaryObservations(doc: Doc, lh: BookLetterhead, book: PrimaryBook, t: (typeof T)['en'], lang: Lang) {
  doc.addPage();
  const x = 36;
  const w = doc.page.width - 72;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(9).text(t.observations, x, 36, { width: w, align: 'center' });
  const widths = [0.12, 0.3, 0.33, 0.25].map((f) => f * w);
  const heads = [t.term, t.teacher, t.head, t.parent];
  let y = 52;
  const headH = 26;
  let cx = x;
  heads.forEach((h, i) => {
    doc.font('Helvetica-Bold').fontSize(7).text(h, cx + 2, y + 5, { width: widths[i]! - 4, align: 'center' });
    cx += widths[i]!;
  });
  y += headH;
  const rowH = (doc.page.height - y - 60) / 5;
  const rows: { label: string; summary: TermSummary; decision?: string | null }[] = [
    ...[1, 2, 3].map((n) => ({ label: t.termNames[n - 1]!, summary: book.terms[n]! })),
    { label: t.annualRow, summary: book.annual },
    { label: t.annualRow, summary: book.annual, decision: book.annual.decision },
  ];
  rows.forEach((r, i) => {
    const top = y + i * rowH;
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(r.label, x + 2, top + rowH / 2 - 4, { width: widths[0]! - 4, align: 'center' });
    const tx = x + widths[0]! + 6;
    const tw = widths[1]! - 12;
    if (r.decision !== undefined) {
      if (r.decision) doc.fillColor('#1d3fa8').font('Times-Bold').fontSize(18).text(t.decisions[r.decision] ?? r.decision, tx, top + rowH / 2 - 10, { width: tw });
    } else {
      const s = r.summary;
      const lines = [
        s.total ? `${t.totalLine} = ${Number(s.total)} / ${Number(s.max ?? book.grandMax)}` : null,
        s.average ? `${t.avLine}: ${s.average}` : null,
        s.rank ? `${t.posLine}: ${ordinal(s.rank, lang)} ${t.outOf} ${book.classSize}` : null,
        s.closing ? `${t.closing}: ${fmtDate(s.closing, lang)}` : null,
        s.reopening ? `${t.reopening}: ${fmtDate(s.reopening, lang)}` : null,
        s.conduct ? `${t.conduct}: ${s.conduct}` : null,
        s.teacherRemark,
      ].filter(Boolean) as string[];
      doc.fillColor('#1d3fa8').font('Times-Italic').fontSize(10).text(lines.join('\n'), tx, top + 6, { width: tw, height: rowH - 10, lineGap: 1 });
    }
    // Head teacher: stamp and signature images, remark.
    const hx = x + widths[0]! + widths[1]!;
    if (i < 4 || r.decision) {
      img(doc, lh.assets.stamp, hx + 8, top + 6, { fit: [Math.min(widths[2]! - 16, rowH - 12), rowH - 12] });
      img(doc, lh.assets.signature, hx + widths[2]! * 0.45, top + rowH * 0.35, { fit: [widths[2]! * 0.5, rowH * 0.5] });
      if (r.summary.headRemark && r.decision === undefined) doc.fillColor(INK).font('Helvetica').fontSize(7).text(r.summary.headRemark, hx + 4, top + rowH - 18, { width: widths[2]! - 8, height: 10, lineBreak: false, ellipsis: true });
    }
  });
  // Grid.
  doc.lineWidth(0.7).strokeColor(INK).rect(x, 52, w, headH + rowH * 5).stroke();
  let gx = x;
  widths.slice(0, -1).forEach((cw) => {
    gx += cw;
    doc.moveTo(gx, 52).lineTo(gx, y + rowH * 5).stroke();
  });
  doc.moveTo(x, y).lineTo(x + w, y).stroke();
  for (let i = 1; i < 5; i++) doc.moveTo(x, y + i * rowH).lineTo(x + w, y + i * rowH).lineWidth(0.5).stroke();
  if (lh.profile.headName) {
    doc.fillColor(GREY).font('Helvetica').fontSize(7).text(`${lh.profile.headTitle ?? ''} ${lh.profile.headName}`.trim(), x, y + rowH * 5 + 6, { width: w, align: 'right' });
  }
}

// ================================================================ sequence book

const SEQ_GREEN = '#3fb059';

function sequenceCover(doc: Doc, lh: BookLetterhead, book: SequenceBook, t: (typeof T)['en'], lang: Lang) {
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(SEQ_GREEN);
  const x = 50;
  const w = doc.page.width - 100;
  doc.lineWidth(1.5).strokeColor('#0f3d1e').rect(30, 30, doc.page.width - 60, doc.page.height - 60).stroke();
  let y = officialHeader(doc, lh, x, 48, w) + 14;
  doc.fillColor('#0f3d1e').font('Times-Bold').fontSize(30).text(lh.legalName.toUpperCase(), x, y, { width: w, align: 'center', lineGap: -2 });
  y = doc.y + 4;
  doc.font('Helvetica-Bold').fontSize(10).text([lh.profile.address, lh.profile.city].filter(Boolean).join(' - ').toUpperCase(), x, y, { width: w, align: 'center' });
  y = doc.y + 18;
  doc.lineWidth(2.5).strokeColor('#0f3d1e').rect(x + 10, y, w - 20, 76).stroke();
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#0f3d1e').text(lh.profile.reportBookTitle?.toUpperCase() ?? t.sequenceBook, x + 10, y + 12, { width: w - 20, align: 'center' });
  y += 100;
  infoLines(doc, pupilRows(book.pupil, t, lang).slice(0, 4), x + 6, y, w - 12);
  // Grading scale.
  const sy = doc.page.height - 150;
  const sw = (w - 12) / t.scale.length;
  doc.lineWidth(1).strokeColor('#0f3d1e').rect(x + 6, sy, w - 12, 58).stroke();
  t.scale.forEach(([range, label], i) => {
    const sx = x + 6 + i * sw;
    if (i > 0) doc.moveTo(sx, sy).lineTo(sx, sy + 58).stroke();
    doc.moveTo(x + 6, sy + 22).lineTo(x + w - 6, sy + 22).stroke();
    doc.fillColor('#0f3d1e').font('Helvetica-Bold').fontSize(9).text(range!, sx, sy + 7, { width: sw, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(8).text(label!, sx + 2, sy + 30, { width: sw - 4, align: 'center' });
  });
}

function sequenceMarks(doc: Doc, lh: BookLetterhead, book: SequenceBook, t: (typeof T)['en'], lang: Lang) {
  doc.addPage();
  const x = 30;
  const w = doc.page.width - 60;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(`${lh.tradingName ?? lh.legalName} — ${book.pupil.lastName.toUpperCase()} ${book.pupil.firstName} — ${book.pupil.className} — ${book.pupil.academicYear}`, x, 32, { width: w });
  const terms = book.termLabels.length;
  const nameW = w * 0.3;
  const coefW = w * 0.06;
  const termW = (w - nameW - coefW - w * 0.12) / terms;
  const annW = w * 0.12;
  let y = 54;
  const rowH = 15;
  const head = () => {
    doc.rect(x, y, w, rowH * 2).fill('#e8f3ea');
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(7.5);
    doc.text(t.subject, x + 4, y + 10, { width: nameW });
    doc.text(t.coef, x + nameW, y + 10, { width: coefW, align: 'center' });
    book.termLabels.forEach((label, i) => {
      const tx = x + nameW + coefW + i * termW;
      doc.text(label, tx, y + 3, { width: termW, align: 'center', height: 11, lineBreak: false, ellipsis: true });
      doc.text(`/${book.maxScore}`, tx, y + rowH + 3, { width: termW / 2, align: 'center' });
      doc.text(`${t.ca}/${t.cna}`, tx + termW / 2, y + rowH + 3, { width: termW / 2, align: 'center' });
    });
    doc.text(t.annualAv, x + w - annW, y + 3, { width: annW, align: 'center' });
    y += rowH * 2;
  };
  head();
  for (const s of book.subjects) {
    doc.fillColor(INK).font('Helvetica').fontSize(8).text(s.name, x + 4, y + 4, { width: nameW - 8, height: rowH - 4, lineBreak: false, ellipsis: true });
    doc.text(s.coefficient, x + nameW, y + 4, { width: coefW, align: 'center' });
    s.terms.forEach((v, i) => {
      if (v === null) return;
      const tx = x + nameW + coefW + i * termW;
      const passed = Number(v) >= book.passMark;
      doc.fillColor(passed ? '#1d3fa8' : RED).font('Helvetica').text(v, tx, y + 4, { width: termW / 2, align: 'center' });
      doc.font('Helvetica-Bold').text(passed ? t.ca : t.cna, tx + termW / 2, y + 4, { width: termW / 2, align: 'center' });
    });
    if (s.annual) doc.fillColor(INK).font('Helvetica-Bold').text(s.annual, x + w - annW, y + 4, { width: annW, align: 'center' });
    doc.moveTo(x, y + rowH).lineTo(x + w, y + rowH).lineWidth(0.3).strokeColor('#9ca3af').stroke();
    y += rowH;
  }
  // Term results.
  const resultRows: [string, (i: number) => string][] = [
    [t.avLine, (i) => book.terms[i]?.average ?? ''],
    [t.posLine, (i) => (book.terms[i]?.rank ? `${ordinal(book.terms[i]!.rank!, lang)} / ${book.terms[i]!.ranked}` : '')],
  ];
  for (const [label, value] of resultRows) {
    doc.rect(x, y, w, rowH).fill('#f3f4f6');
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(label, x + 4, y + 4, { width: nameW });
    book.termLabels.forEach((_, i) => doc.text(value(i), x + nameW + coefW + i * termW, y + 4, { width: termW, align: 'center' }));
    y += rowH;
  }
  doc.lineWidth(0.8).strokeColor(INK).rect(x, 54, w, y - 54).stroke();
  // Annual box.
  y += 14;
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(10);
  doc.text(`${t.annualAv}: ${book.annual.average ?? '—'} / ${book.maxScore}`, x, y);
  doc.text(`${t.annualPos}: ${book.annual.rank ? `${ordinal(book.annual.rank, lang)} ${t.outOf} ${book.annual.ranked}` : '—'}`, x, doc.y + 3);
  doc.text(`${t.council}: ${book.annual.decision ? (t.decisions[book.annual.decision] ?? book.annual.decision) : '—'}`, x, doc.y + 3);
  // Signatures.
  const sy = doc.page.height - 130;
  const sw = w / 3;
  [t.classTeacher, t.headSign, t.parentSign].forEach((label, i) => {
    doc.lineWidth(0.6).strokeColor(INK).rect(x + i * sw + 4, sy, sw - 8, 80).stroke();
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8).text(label, x + i * sw + 4, sy + 66, { width: sw - 8, align: 'center' });
  });
  img(doc, lh.assets.stamp, x + sw + 10, sy + 4, { fit: [70, 58] });
  img(doc, lh.assets.signature, x + sw + 70, sy + 10, { fit: [sw - 90, 50] });
}

/** Renders one booklet per pupil into a single PDF. */
export function renderReportBooksPdf(lh: BookLetterhead, books: (PrimaryBook | SequenceBook)[], lang: Lang): Promise<Buffer> {
  const t = T[lang];
  const doc = new PDFDocument({ size: 'A4', margin: 30, autoFirstPage: false, info: { Title: lh.profile.reportBookTitle ?? t.booklet.replace('\n', ' '), Author: lh.legalName, Creator: 'Mboka School' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  for (const book of books) {
    doc.addPage();
    if (book.kind === 'PRIMARY') {
      primaryCover(doc, lh, book, t, lang);
      doc.addPage();
      primaryCompetencePages(doc, book, t);
      primaryObservations(doc, lh, book, t, lang);
    } else {
      sequenceCover(doc, lh, book, t, lang);
      sequenceMarks(doc, lh, book, t, lang);
    }
  }
  doc.end();
  return done;
}
