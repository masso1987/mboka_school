/** `YYYY-MM-DD` ⇄ Date for PostgreSQL DATE columns (always UTC midnight, never shifted by timezone). */
export const toDate = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
export const toIso = (d: Date): string => d.toISOString().slice(0, 10);
export const toIsoOrNull = (d: Date | null | undefined): string | null => (d ? toIso(d) : null);

/** Today's calendar date in the school's timezone. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}
