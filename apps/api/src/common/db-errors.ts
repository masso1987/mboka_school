import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiException, Errors } from './api-error';

/**
 * Translates database constraint violations into stable API errors.
 *
 * `known` keys are matched against, in order:
 *  - a constraint name appearing in the error message (exclusion constraints, e.g. `timetable_no_room_overlap`);
 *  - for unique violations, the Prisma model name (`Student`).
 * Under RLS PostgreSQL withholds the violated key's details from the runtime role, so Prisma
 * reports `target: null` — the model name is the reliable signal. Models therefore keep a single
 * business uniqueness rule, or their service pre-checks the others.
 *
 * Unknown unique violations become 409 DUPLICATE; unknown FK violations 422 INVALID_REFERENCE —
 * a reference to another tenant's row lands here too, which is the desired answer.
 */
export function mapDbError(e: unknown, known: Record<string, () => ApiException> = {}): unknown {
  const message = e instanceof Error ? e.message : '';
  for (const [name, make] of Object.entries(known)) {
    if (name.includes('_') && message.includes(name)) return make();
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    const model = typeof e.meta?.modelName === 'string' ? e.meta.modelName : '';
    if (e.code === 'P2002' && model && known[model]) return known[model]!();
    if (e.code === 'P2002') return Errors.conflict('DUPLICATE', 'A record with these values already exists');
    if (e.code === 'P2003') {
      return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_REFERENCE', 'A referenced record does not exist');
    }
    if (e.code === 'P2025') return Errors.notFound();
  }
  if (message.includes('23503') || message.includes('foreign key constraint')) {
    return new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'INVALID_REFERENCE', 'A referenced record does not exist');
  }
  return e;
}

/** `await guard(promise, known)` — rethrows mapped errors. */
export async function guardDb<T>(work: Promise<T>, known?: Record<string, () => ApiException>): Promise<T> {
  try {
    return await work;
  } catch (e) {
    throw mapDbError(e, known);
  }
}
