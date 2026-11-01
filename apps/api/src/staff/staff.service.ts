import { HttpStatus, Injectable } from '@nestjs/common';
import type { EndAssignmentInput, StaffInput, TeachingAssignmentInput } from '@mboka/shared';
import type { Prisma, Staff, TeachingAssignment } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { nextCounter } from '../common/counters';
import { toDate, toIso, toIsoOrNull } from '../common/dates';
import { guardDb } from '../common/db-errors';
import { type ListQuery, type Page, skipTake } from '../common/pagination';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const presentStaff = (s: Staff) => ({
  id: s.id,
  staffNumber: s.staffNumber,
  firstName: s.firstName,
  lastName: s.lastName,
  gender: s.gender,
  email: s.email,
  phone: s.phone,
  position: s.position,
  isTeacher: s.isTeacher,
  employmentType: s.employmentType,
  status: s.status,
  hireDate: toIsoOrNull(s.hireDate),
  membershipId: s.membershipId,
});

const presentAssignment = (t: TeachingAssignment) => ({
  id: t.id,
  academicYearId: t.academicYearId,
  classSubjectId: t.classSubjectId,
  staffId: t.staffId,
  role: t.role,
  startDate: toIso(t.startDate),
  endDate: toIsoOrNull(t.endDate),
});

const assignmentInclude = {
  classSubject: {
    select: {
      id: true,
      coefficient: true,
      subject: { select: { code: true, nameFr: true, nameEn: true } },
      schoolClass: { select: { id: true, code: true, name: true } },
    },
  },
  staff: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.TeachingAssignmentInclude;

/** Staff records (HR-001…004) and teaching assignments (ACA-006, PED-003/004). */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  list(a: Actor, q: ListQuery & { teachersOnly?: boolean }): Promise<Page<unknown>> {
    return this.run(a, async (tx) => {
      const terms = q.q?.split(/\s+/).filter(Boolean) ?? [];
      const where: Prisma.StaffWhereInput = {
        tenantId: a.tenantId,
        ...(q.teachersOnly && { isTeacher: true, status: 'ACTIVE' }),
        AND: terms.map((t) => ({
          OR: [
            { firstName: { contains: t, mode: 'insensitive' as const } },
            { lastName: { contains: t, mode: 'insensitive' as const } },
            { staffNumber: { contains: t, mode: 'insensitive' as const } },
          ],
        })),
      };
      const [total, rows] = await Promise.all([
        tx.staff.count({ where }),
        tx.staff.findMany({ where, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], ...skipTake(q) }),
      ]);
      return { items: rows.map(presentStaff), total, page: q.page, pageSize: q.pageSize };
    });
  }

  create(a: Actor, input: StaffInput) {
    return guardDb(
      this.run(a, async (tx) => {
        if (input.membershipId) {
          await this.membershipOrThrow(tx, a, input.membershipId);
          // Staff has two unique rules; the DB cannot tell them apart for us under RLS (see db-errors.ts).
          if (await tx.staff.findFirst({ where: { tenantId: a.tenantId, membershipId: input.membershipId }, select: { id: true } })) {
            throw Errors.conflict('ACCOUNT_ALREADY_LINKED', 'This user account is already linked to a staff record');
          }
        }
        const staffNumber = input.staffNumber ?? `EMP-${String(await nextCounter(tx, a.tenantId, 'staff')).padStart(4, '0')}`;
        const staff = await tx.staff.create({
          data: {
            tenantId: a.tenantId,
            ...input,
            staffNumber,
            hireDate: input.hireDate ? toDate(input.hireDate) : undefined,
          },
        });
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'staff.created', entityType: 'staff', entityId: staff.id, metadata: { staffNumber }, ip: a.ip },
          tx,
        );
        return presentStaff(staff);
      }),
      {
        Staff: () => Errors.conflict('STAFF_NUMBER_TAKEN', 'This staff number is already assigned'),
      },
    );
  }

  // ------------------------------------------------------------ assignments

  listAssignments(a: Actor, filter: { academicYearId?: string; staffId?: string; classId?: string; activeOn?: string }) {
    return this.run(a, async (tx) => {
      const rows = await tx.teachingAssignment.findMany({
        where: {
          tenantId: a.tenantId,
          ...(filter.academicYearId && { academicYearId: filter.academicYearId }),
          ...(filter.staffId && { staffId: filter.staffId }),
          ...(filter.classId && { classSubject: { classId: filter.classId } }),
          ...(filter.activeOn && {
            startDate: { lte: toDate(filter.activeOn) },
            OR: [{ endDate: null }, { endDate: { gte: toDate(filter.activeOn) } }],
          }),
        },
        include: assignmentInclude,
        orderBy: [{ startDate: 'desc' }],
      });
      return rows.map(presentAssignmentWithRefs);
    });
  }

  /** The signed-in teacher's current assignments — what the teacher portal and attendance start from. */
  myAssignments(a: Actor, today: string) {
    return this.run(a, async (tx) => {
      const staff = await tx.staff.findFirst({ where: { tenantId: a.tenantId, membershipId: a.membershipId } });
      if (!staff) return { staff: null, assignments: [] };
      const rows = await tx.teachingAssignment.findMany({
        where: {
          tenantId: a.tenantId,
          staffId: staff.id,
          startDate: { lte: toDate(today) },
          OR: [{ endDate: null }, { endDate: { gte: toDate(today) } }],
        },
        include: assignmentInclude,
      });
      return { staff: presentStaff(staff), assignments: rows.map(presentAssignmentWithRefs) };
    });
  }

  assign(a: Actor, input: TeachingAssignmentInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const [cs, staff] = await Promise.all([
          tx.classSubject.findFirst({
            where: { id: input.classSubjectId, tenantId: a.tenantId },
            include: { schoolClass: { include: { academicYear: true } } },
          }),
          tx.staff.findFirst({ where: { id: input.staffId, tenantId: a.tenantId } }),
        ]);
        if (!cs) throw Errors.notFound('Class subject');
        if (!staff) throw Errors.notFound('Staff member');
        if (!staff.isTeacher || staff.status !== 'ACTIVE') {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'NOT_AN_ACTIVE_TEACHER', 'Only active teaching staff can be assigned');
        }
        const year = cs.schoolClass.academicYear;
        if (year.status === 'CLOSED') throw Errors.conflict('ACADEMIC_YEAR_CLOSED', 'The academic year is closed');
        if (input.role === 'MAIN') {
          const existingMain = await tx.teachingAssignment.findFirst({
            where: { tenantId: a.tenantId, classSubjectId: cs.id, role: 'MAIN', endDate: null },
          });
          if (existingMain) {
            throw Errors.conflict('MAIN_TEACHER_EXISTS', 'End the current main assignment first, or assign as co-teacher or replacement');
          }
        }
        const created = await tx.teachingAssignment.create({
          data: {
            tenantId: a.tenantId,
            academicYearId: year.id,
            classSubjectId: cs.id,
            staffId: staff.id,
            role: input.role,
            startDate: toDate(input.startDate),
          },
          include: assignmentInclude,
        });
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'teaching_assignment.created', entityType: 'teaching_assignment', entityId: created.id, metadata: { after: presentAssignment(created) }, ip: a.ip },
          tx,
        );
        return presentAssignmentWithRefs(created);
      }),
    );
  }

  /** Reassignment ends the old assignment instead of deleting it, preserving teaching history. */
  endAssignment(a: Actor, id: string, input: EndAssignmentInput) {
    return this.run(a, async (tx) => {
      const t = await tx.teachingAssignment.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!t) throw Errors.notFound('Teaching assignment');
      if (t.endDate) throw Errors.conflict('ASSIGNMENT_ALREADY_ENDED', 'This assignment has already ended');
      if (input.endDate < toIso(t.startDate)) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'END_BEFORE_START', 'The end date precedes the start date');
      }
      const ended = await tx.teachingAssignment.update({ where: { id }, data: { endDate: toDate(input.endDate) }, include: assignmentInclude });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'teaching_assignment.ended', entityType: 'teaching_assignment', entityId: id, metadata: { endDate: input.endDate }, ip: a.ip },
        tx,
      );
      return presentAssignmentWithRefs(ended);
    });
  }

  private async membershipOrThrow(tx: Tx, a: Actor, membershipId: string) {
    const m = await tx.membership.findFirst({ where: { id: membershipId, tenantId: a.tenantId } });
    if (!m) throw Errors.notFound('User account');
    return m;
  }
}

type AssignmentWithRefs = TeachingAssignment & Prisma.TeachingAssignmentGetPayload<{ include: typeof assignmentInclude }>;

function presentAssignmentWithRefs(t: AssignmentWithRefs) {
  return {
    ...presentAssignment(t),
    class: t.classSubject.schoolClass,
    subject: t.classSubject.subject,
    coefficient: Number(t.classSubject.coefficient),
    staff: t.staff,
  };
}
