/**
 * Semicolon CSV for spreadsheets set to French (Excel opens it directly thanks to the BOM). Cells starting with
 * = + - @ are prefixed with a quote so a spreadsheet never runs them as formulas (CSV injection).
 */
export function toCsv(header: string[], rows: unknown[][]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + [header, ...rows].map((r) => r.map((v) => cell(String(v ?? ''))).join(';')).join('\r\n') + '\r\n';
}
