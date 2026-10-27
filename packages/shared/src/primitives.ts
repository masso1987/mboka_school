import { z } from 'zod';

/** Calendar date as `YYYY-MM-DD` that also exists on the calendar (rejects 2026-02-30). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
  }, 'invalid_date');

/** Local wall-clock time `HH:MM`, 24h. */
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'invalid_time');

export const personName = z.string().trim().min(1).max(100);
export const optionalText = (max: number) => z.string().trim().max(max).optional();
export const optionalEmail = z.string().trim().toLowerCase().pipe(z.email()).optional();
export const optionalPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{6,20}$/, 'invalid_phone')
  .optional();

export function minutesFromHhmm(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function hhmmFromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
