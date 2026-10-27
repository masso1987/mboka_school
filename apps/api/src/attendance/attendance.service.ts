import { HttpStatus, Injectable } from '@nestjs/common';
import type { AttendanceSubmitInput } from '@mboka/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toDate, todayIn } from '../common/dates';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export interface SubmitResult {
  sessionId: string;
  version: number;
  recorded: number;
  corrected: number;
  unchanged: number;
  replayed: boolean;
}

/**
 * Class registers (Module 5). Submissions are idempotent by client operation id, and a
 * register edited by someone else since the client loaded it is reported as a conflict,
 * never silently overwritten (§10.3).
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  /** The register for one class/date/slot: roster on that date, current marks and version. */
  register(a: Actor, classId: string, date: string, slot: string) {
    return this.run(a, async (tx) => {
      const schoolClass = await this.classOrThrow(tx, a, classId);
      const access = await this.access(tx, a, classId, date);
      if (!access.read) throw Errors.forbidden();
      const [roster, session] = await Promise.all([
        this.rosterOn(tx, a.tenantId, classId, date),
        tx.attendanceSession.findFirst({
          where: { tenantId: a.tenantId, classId, date: toDate(date), slot },
          include: { records: true },
        }),
      ]);
      const marks = new Map(session?.records.map((r) => [r.studentId, r]) ?? []);
      return {
        class: { id: schoolClass.id, code: schoolClass.code, name: schoolClass.name },
        date,
        slot,
        sessionId: session?.id ?? null,
        version: session?.version ?? 0,
        canRecord: access.record,
        canCorrect: access.correct,
        isToday: date === todayIn(a.timezone),
        students: roster.map((e) => {
          const m = marks.get(e.studentId);
          return {
            studentId: e.studentId,
            enrollmentId: e.id,
            matricule: e.student.matricule,
            firstName: e.student.firstName,
            lastName: e.student.lastName,
            status: m?.status ?? null,
            arrivalTime: m?.arrivalTime ?? null,
            reason: m?.reason ?? null,
          };
        }),
      };
    });
  }

  async submit(a: Actor, input: AttendanceSubmitInput): Promise<SubmitResult> {
    try {
      return await this.run(a, (tx) => this.submitTx(tx, a, input));
    } catch (e) {
      // Two deliveries of the same operation raced: the loser hits the sync_operations key. Answer with the winner's result.
      if (isUniqueViolationOn(e, 'sync_operations')) {
        const stored = await this.storedOperation(a, input.operationId);
        if (stored) return stored;
      }
      if (isUniqueViolationOn(e, 'attendance_sessions')) throw this.conflict('The register was created by someone else meanwhile');
      throw e;
    }
  }

  /** Per-student counts over a date range (ATT-007). */
  summary(a: Actor, classId: string, from: string, to: string) {
    return this.run(a, async (tx) => {
      await this.classOrThrow(tx, a, classId);
      const access = await this.access(tx, a, classId, to);
      if (!access.read) throw Errors.forbidden();
      const grouped = await tx.attendanceRecord.groupBy({
        by: ['studentId', 'status'],
        where: { tenantId: a.tenantId, session: { classId, date: { gte: toDate(from), lte: toDate(to) } } },
        _count: { _all: true },
      });
      const byStudent = new Map<string, Record<string, number>>();
      for (const g of grouped) {
        const row = byStudent.get(g.studentId) ?? { PRESENT: 0, ABSENT: 0, LATE: 0, EXCUSED: 0 };
        row[g.status] = g._count._all;
        byStudent.set(g.studentId, row);
      }
      const students = await tx.student.findMany({
        where: { tenantId: a.tenantId, id: { in: [...byStudent.keys()] } },
        select: { id: true, matricule: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      });
      return { classId, from, to, students: students.map((s) => ({ ...s, counts: byStudent.get(s.id)! })) };
    });
  }

  // ------------------------------------------------------------ internals

  private async submitTx(tx: Tx, a: Actor, input: AttendanceSubmitInput): Promise<SubmitResult> {
    const replay = await tx.syncOperation.findUnique({
      where: { tenantId_operationId: { tenantId: a.tenantId, operationId: input.operationId } },
    });
    if (replay) {
      if (replay.userId !== a.userId) throw Errors.conflict('OPERATION_ID_REUSED', 'This operation id belongs to another user');
      return { ...(replay.response as unknown as SubmitResult), replayed: true };
    }

    await this.classOrThrow(tx, a, input.classId);
    const today = todayIn(a.timezone);
    if (input.date > today) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'DATE_IN_FUTURE', 'Attendance cannot be recorded for a future date');
    }
    const access = await this.access(tx, a, input.classId, input.date);
    if (!access.record) throw Errors.forbidden('You are not assigned to this class');

    const roster = await this.rosterOn(tx, a.tenantId, input.classId, input.date);
    const enrollmentByStudent = new Map(roster.map((e) => [e.studentId, e.id]));
    const unknown = input.records.filter((r) => !enrollmentByStudent.has(r.studentId)).map((r) => r.studentId);
    if (unknown.length > 0) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'STUDENT_NOT_IN_CLASS', 'Some students are not enrolled in this class on this date', {
        studentIds: unknown,
      });
    }

    // Lock the register row (if any) so concurrent submissions serialize on its version.
    const locked = await tx.$queryRaw<{ id: string; version: number }[]>`
      SELECT id, version FROM attendance_sessions
      WHERE tenant_id = ${a.tenantId}::uuid AND class_id = ${input.classId}::uuid
        AND date = ${toDate(input.date)}::date AND slot = ${input.slot}
      FOR UPDATE`;
    const existing = locked[0];
    if (existing && input.baseVersion !== existing.version) {
      throw this.conflict('The register changed since you loaded it', existing.version);
    }

    const session = existing
      ? await tx.attendanceSession.update({ where: { id: existing.id }, data: { version: { increment: 1 } } })
      : await tx.attendanceSession.create({
          data: { tenantId: a.tenantId, classId: input.classId, date: toDate(input.date), slot: input.slot, takenBy: a.userId },
        });

    const previous = new Map(
      (await tx.attendanceRecord.findMany({ where: { tenantId: a.tenantId, sessionId: session.id } })).map((r) => [r.studentId, r]),
    );
    const corrections = input.records.filter((r) => {
      const p = previous.get(r.studentId);
      return p && (p.status !== r.status || (p.arrivalTime ?? undefined) !== r.arrivalTime);
    });
    if (corrections.length > 0) {
      if (!input.correctionReason) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'CORRECTION_REASON_REQUIRED', 'Changing recorded attendance requires a reason');
      }
      if (input.date < today && !access.correct) {
        throw Errors.forbidden('Only authorized staff can correct attendance for past days');
      }
    }

    let recorded = 0;
    let unchanged = 0;
    for (const r of input.records) {
      const p = previous.get(r.studentId);
      const data = { status: r.status, arrivalTime: r.status === 'LATE' ? r.arrivalTime ?? null : null, reason: r.reason ?? null, updatedBy: a.userId };
      if (!p) {
        await tx.attendanceRecord.create({
          data: { tenantId: a.tenantId, sessionId: session.id, studentId: r.studentId, enrollmentId: enrollmentByStudent.get(r.studentId)!, ...data },
        });
        recorded++;
      } else if (corrections.includes(r) || (p.reason ?? undefined) !== r.reason) {
        await tx.attendanceRecord.update({ where: { id: p.id }, data });
      } else {
        unchanged++;
      }
    }

    await this.audit.record(
      {
        tenantId: a.tenantId,
        actorId: a.userId,
        action: corrections.length > 0 ? 'attendance.corrected' : 'attendance.recorded',
        entityType: 'attendance_session',
        entityId: session.id,
        metadata: {
          classId: input.classId,
          date: input.date,
          slot: input.slot,
          version: session.version,
          operationId: input.operationId,
          ...(corrections.length > 0 && {
            reason: input.correctionReason,
            changes: corrections.map((r) => ({ studentId: r.studentId, from: previous.get(r.studentId)!.status, to: r.status })),
          }),
        },
        ip: a.ip,
      },
      tx,
    );

    const result: SubmitResult = {
      sessionId: session.id,
      version: session.version,
      recorded,
      corrected: corrections.length,
      unchanged,
      replayed: false,
    };
    await tx.syncOperation.create({
      data: {
        tenantId: a.tenantId,
        operationId: input.operationId,
        userId: a.userId,
        kind: 'attendance.submit',
        response: result as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  private storedOperation(a: Actor, operationId: string) {
    return this.run(a, async (tx) => {
      const op = await tx.syncOperation.findUnique({ where: { tenantId_operationId: { tenantId: a.tenantId, operationId } } });
      return op && op.userId === a.userId ? { ...(op.response as unknown as SubmitResult), replayed: true } : null;
    });
  }

  /**
   * read: attendance.read / attendance.correct, or an assigned teacher.
   * record: attendance.correct (any class), or attendance.record with an assignment active on that date.
   */
  private async access(tx: Tx, a: Actor, classId: string, date: string) {
    const correct = a.permissions.has('attendance.correct');
    let assigned = false;
    if (!correct && a.permissions.has('attendance.record')) {
      assigned =
        (await tx.teachingAssignment.count({
          where: {
            tenantId: a.tenantId,
            staff: { membershipId: a.membershipId, status: 'ACTIVE' },
            classSubject: { classId },
            startDate: { lte: toDate(date) },
            OR: [{ endDate: null }, { endDate: { gte: toDate(date) } }],
          },
        })) > 0;
    }
    return {
      read: correct || assigned || a.permissions.has('attendance.read'),
      record: correct || assigned,
      correct,
    };
  }

  private async classOrThrow(tx: Tx, a: Actor, classId: string) {
    const c = await tx.schoolClass.findFirst({ where: { id: classId, tenantId: a.tenantId } });
    if (!c) throw Errors.notFound('Class');
    return c;
  }

  /** Students enrolled in the class on `date` (left_on is the first day of absence from the class). */
  private rosterOn(tx: Tx, tenantId: string, classId: string, date: string) {
    const d = toDate(date);
    return tx.enrollment.findMany({
      where: {
        tenantId,
        classId,
        status: { not: 'PENDING' },
        enrolledOn: { lte: d },
        OR: [{ leftOn: null }, { leftOn: { gt: d } }],
      },
      include: { student: { select: { matricule: true, firstName: true, lastName: true } } },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    });
  }

  private conflict(message: string, serverVersion?: number) {
    return new ApiException(HttpStatus.CONFLICT, 'ATTENDANCE_CONFLICT', message, serverVersion !== undefined ? { serverVersion } : undefined);
  }
}

const MODEL_OF: Record<string, string> = { sync_operations: 'SyncOperation', attendance_sessions: 'AttendanceSession' };

function isUniqueViolationOn(e: unknown, table: string): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  const haystack = `${JSON.stringify(e.meta ?? {})} ${e.message}`;
  return haystack.includes(table) || haystack.includes(MODEL_OF[table] ?? table);
}
