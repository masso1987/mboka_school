import type { PayslipResult } from '@mboka/shared';
import PDFDocument from 'pdfkit';

type Lang = 'fr' | 'en';

export interface PayslipDocument {
  school: string;
  legalName: string;
  number: string;
  period: string;
  status: string;
  rulesLabel: string;
  employee: { staffNumber: string; firstName: string; lastName: string; position: string };
  result: PayslipResult;
}

const L = {
  fr: {
    title: 'BULLETIN DE PAIE',
    period: 'Période',
    number: 'N°',
    employee: 'Salarié',
    staffNumber: 'Matricule',
    position: 'Emploi',
    earnings: 'Éléments de rémunération',
    base: 'Salaire de base',
    absence: 'Retenue pour absence',
    taxable: 'imposable',
    exempt: 'non imposable',
    gross: 'Salaire brut',
    contributions: 'Cotisations et impôts',
    col: ['Rubrique', 'Base', 'Taux', 'Part salariale', 'Part patronale'],
    other: 'Autres retenues',
    totalEmployee: 'Total retenues salariales',
    totalEmployer: 'Total charges patronales',
    net: 'NET À PAYER',
    cost: 'Coût total employeur',
    draft: 'PROJET — PAIE NON APPROUVÉE',
    rules: 'Règles',
    keep: 'À conserver sans limitation de durée.',
  },
  en: {
    title: 'PAYSLIP',
    period: 'Period',
    number: 'No.',
    employee: 'Employee',
    staffNumber: 'Staff number',
    position: 'Position',
    earnings: 'Earnings',
    base: 'Base salary',
    absence: 'Unpaid absence',
    taxable: 'taxable',
    exempt: 'non-taxable',
    gross: 'Gross pay',
    contributions: 'Contributions and taxes',
    col: ['Item', 'Base', 'Rate', 'Employee', 'Employer'],
    other: 'Other deductions',
    totalEmployee: 'Total employee deductions',
    totalEmployer: 'Total employer contributions',
    net: 'NET PAY',
    cost: 'Total employer cost',
    draft: 'DRAFT — PAYROLL NOT APPROVED',
    rules: 'Rules',
    keep: 'Keep this document indefinitely.',
  },
};

const fcfa = (v: string | null) => (v === null ? '' : `${Number(v).toLocaleString('fr-FR').replace(/ | /g, ' ')}`);
const pct = (r: string | null) => (r === null ? '' : `${(Number(r) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} %`);

/** One A4 page per payslip (all amounts in XAF). */
export function renderPayslipsPdf(slips: PayslipDocument[], lang: Lang): Promise<Buffer> {
  const t = L[lang];
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: t.title, Creator: 'Mboka School System' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  slips.forEach((s, index) => {
    if (index > 0) doc.addPage();
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const r = s.result;

    doc.font('Helvetica-Bold').fontSize(13).text(s.school, left, 36, { width });
    doc.font('Helvetica').fontSize(8).text(s.legalName, { width });
    doc.font('Helvetica-Bold').fontSize(12).text(t.title, left, 36, { width, align: 'right' });
    doc.font('Helvetica').fontSize(9).text(`${t.period} : ${s.period}    ${t.number} ${s.number}`, { width, align: 'right' });
    if (s.status === 'DRAFT' || s.status === 'SUBMITTED') doc.fillColor('#b91c1c').font('Helvetica-Bold').text(t.draft, { width, align: 'right' }).fillColor('black');

    doc.moveDown(1).font('Helvetica').fontSize(9);
    doc.text(`${t.employee} : ${s.employee.lastName.toUpperCase()} ${s.employee.firstName}`, left);
    doc.text(`${t.staffNumber} : ${s.employee.staffNumber}    ${t.position} : ${s.employee.position}`, left);

    // Table helper: five columns, amounts right-aligned.
    const widths = [0.4, 0.15, 0.1, 0.175, 0.175].map((w) => w * width);
    const row = (cells: string[], bold = false) => {
      const y = doc.y;
      let x = left;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      cells.forEach((c, i) => {
        doc.text(c, x + 2, y, { width: widths[i]! - 4, align: i === 0 ? 'left' : 'right' });
        x += widths[i]!;
      });
      doc.y = Math.max(doc.y, y + 12);
      doc.x = left;
    };
    const heading = (label: string) => {
      doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).text(label, left);
      doc.moveTo(left, doc.y + 1).lineTo(left + width, doc.y + 1).stroke('#94a3b8');
      doc.moveDown(0.3);
    };

    heading(t.earnings);
    row([t.base, '', '', fcfa(r.baseSalary), '']);
    if (r.absenceDeduction !== '0') row([t.absence, '', '', `-${fcfa(r.absenceDeduction)}`, '']);
    for (const e of r.earnings) row([`${e.label} (${e.taxable ? t.taxable : t.exempt})`, '', '', fcfa(e.amount), '']);
    row([t.gross, '', '', fcfa(r.gross), ''], true);

    heading(t.contributions);
    row(t.col, true);
    for (const l of r.contributions) {
      if (l.employee === '0' && l.employer === '0') continue;
      row([l.label, fcfa(l.base), pct(l.rate), l.employee === '0' ? '' : fcfa(l.employee), l.employer === '0' ? '' : fcfa(l.employer)]);
    }
    row([t.totalEmployee, '', '', fcfa(r.totalEmployee), ''], true);
    row([t.totalEmployer, '', '', '', fcfa(r.totalEmployer)], true);

    if (r.otherDeductions.length > 0) {
      heading(t.other);
      for (const d of r.otherDeductions) row([d.label, '', '', fcfa(d.amount), '']);
    }

    doc.moveDown(1);
    const y = doc.y;
    doc.rect(left, y, width, 26).fill('#f1f5f9').fillColor('black');
    doc.font('Helvetica-Bold').fontSize(12).text(t.net, left + 8, y + 7);
    doc.text(`${fcfa(r.net)} XAF`, left, y + 7, { width: width - 8, align: 'right' });
    doc.y = y + 34;
    doc.font('Helvetica').fontSize(8.5).text(`${t.cost} : ${fcfa(r.employerCost)} XAF`, left);
    doc.moveDown(1).fontSize(7.5).fillColor('#475569').text(`${t.rules} : ${s.rulesLabel}. ${t.keep}`, left, undefined, { width }).fillColor('black');
  });

  doc.end();
  return done;
}
