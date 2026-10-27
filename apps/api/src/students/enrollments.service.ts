import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ADMISSION_TRANSITIONS,
  type AdmissionDecisionInput,
  type AdmissionInput,
  type ClassChangeInput,
  type EnrollmentExitInput,
  type EnrollmentInput,
} from '@mboka/shared';
import type { Enrollment } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toDate, toIso, toIsoOrNull } from '../common/dates';
import { guardDb } from '../common/db-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const ACTIVE = ['PENDING', 'ENROLLED', 'REPEATING'] as const;

const presentEnrollment = (e: Enrollment) => ({
  id: e.id,
  studentId: e.studentId,
  academicYearId: e.academicYearId,
  classId: e.classId,
  status: e.status,
  enrolledOn: toIso(e.enrolledOn),
  leftOn: toIsoOrNull(e.leftOn),
  leftReason: e.leftReason,
});

const alreadyEnrolled = () =>
  Errors.conflict('ALREADY_ENROLLED', 'The student already has an active enrollment for this academic year');

/** Admissions workflow and per-year enrollments, transfers and withdrawals (STD-001/002, 008–010). */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  // ------------------------------------------------------------ admissions

  listAdmissions(a: Actor, academicYearId?: string) {
    return this.run(a, async (tx) => {
      const rows = await tx.admission.findMany({
        where: { tenantId: a.tenantId, ...(academicYearId && { academicYearId }) },
        include: {
          student: { select: { id: true, matricule: true, firstName: true, lastName: true } },
          requestedLevel: { select: { code: true, nameFr: true, nameEn: true } },
          academicYear: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        notes: r.notes,
        student: r.student,
        requestedLevel: r.requestedLevel,
        academicYear: r.academicYear.name,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
      }));
    });
  }

  createAdmission(a: Actor, input: AdmissionInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const admission = await tx.admission.create({ data: { tenantId: a.tenantId, ...input } });
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'admission.created', entityType: 'admission', entityId: admission.id, metadata: { studentId: input.studentId }, ip: a.ip },
          tx,
        );
        return { id: admission.id, status: admission.status };
      }),
    );
  }

  decideAdmission(a: Actor, id: string, input: AdmissionDecisionInput) {
    return this.run(a, async (tx) => {
      const adm = await tx.admission.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!adm) throw Errors.notFound('Admission');
      if (!ADMISSION_TRANSITIONS[adm.status].includes(input.status)) {
        throw new ApiException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', `Cannot move an admission from ${adm.status} to ${input.status}`, {
          from: adm.status,
          allowed: ADMISSION_TRANSITIONS[adm.status],
        });
      }
      const decisive = ['ACCEPTED', 'REJECTED', 'WAITLISTED'].includes(input.status);
      const updated = await tx.admission.update({
        where: { id },
        data: {
          status: input.status,
          notes: input.notes ?? adm.notes,
          ...(decisive && { decidedAt: new Date(), decidedBy: a.userId }),
        },
      });
      if (input.status === 'ACCEPTED') {
        await tx.student.updateMany({ where: { id: adm.studentId, tenantId: a.tenantId, status: 'APPLICANT' }, data: { status: 'ACTIVE' } });
      }
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'admission.status_changed', entityType: 'admission', entityId: id, metadata: { from: adm.status, to: input.status }, ip: a.ip },
        tx,
      );
      return { id: updated.id, status: updated.status };
    });
  }

  // ------------------------------------------------------------ enrollments

  async listByClass(a: Actor, classId: string) {
    return this.run(a, async (tx) => {
      const rows = await tx.enrollment.findMany({
        where: { tenantId: a.tenantId, classId, status: { in: [...ACTIVE] } },
        include: { student: { select: { id: true, matricule: true, firstName: true, lastName: true, gender: true } } },
        orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
      });
      return rows.map((e) => ({ ...presentEnrollment(e), student: e.student }));
    });
  }

  enroll(a: Actor, input: EnrollmentInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const enrollment = await this.enrollTx(tx, a, input.studentId, input.classId, input.enrolledOn, input.status);
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'enrollment.created', entityType: 'enrollment', entityId: enrollment.id, metadata: { after: presentEnrollment(enrollment) }, ip: a.ip },
          tx,
        );
        return presentEnrollment(enrollment);
      }),
      { Enrollment: alreadyEnrolled },
    );
  }

  /** Transfer out, withdrawal or completion: closes the enrollment, keeps every record (Module 3 transfer workflow). */
  exit(a: Actor, id: string, input: EnrollmentExitInput) {
    return this.run(a, async (tx) => {
      const e = await this.activeEnrollmentOrThrow(tx, a, id);
      if (input.leftOn < toIso(e.enrolledOn)) {
        throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'LEFT_BEFORE_ENROLLED', 'The departure date precedes the enrollment date');
      }
      const closed = await tx.enrollment.update({
        where: { id },
        data: { status: input.status, leftOn: toDate(input.leftOn), leftReason: input.reason },
      });
      if (input.status === 'TRANSFERRED' || input.status === 'WITHDRAWN') {
        await tx.student.update({ where: { id: e.studentId }, data: { status: input.status } });
      }
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: `enrollment.${input.status.toLowerCase()}`, entityType: 'enrollment', entityId: id, metadata: { reason: input.reason, leftOn: input.leftOn }, ip: a.ip },
        tx,
      );
      return presentEnrollment(closed);
    });
  }

  /** Change of class within the same year: the old enrollment is closed, a new one opened. */
  changeClass(a: Actor, id: string, input: ClassChangeInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const e = await this.activeEnrollmentOrThrow(tx, a, id);
        if (e.classId === input.classId) throw Errors.conflict('SAME_CLASS', 'The student is already in this class');
        await tx.enrollment.update({
          where: { id },
          data: { status: 'COMPLETED', leftOn: toDate(input.effectiveOn), leftReason: `class_change: ${input.reason}` },
        });
        const next = await this.enrollTx(tx, a, e.studentId, input.classId, input.effectiveOn, e.status === 'REPEATING' ? 'REPEATING' : 'ENROLLED', e.academicYearId);
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'enrollment.class_changed', entityType: 'enrollment', entityId: next.id, metadata: { fromEnrollment: id, fromClass: e.classId, toClass: input.classId, reason: input.reason }, ip: a.ip },
          tx,
        );
        return presentEnrollment(next);
      }),
      { Enrollment: alreadyEnrolled },
    );
  }

  // ------------------------------------------------------------ internals

  private async enrollTx(
    tx: Tx,
    a: Actor,
    studentId: string,
    classId: string,
    enrolledOn: string,
    status: 'ENROLLED' | 'REPEATING',
    expectedYearId?: string,
  ) {
    // Serialize enrollments into the same class so the capacity check below cannot be raced.
    await tx.$queryRaw`SELECT id FROM classes WHERE id = ${classId}::uuid AND tenant_id = ${a.tenantId}::uuid FOR UPDATE`;
    const [student, schoolClass] = await Promise.all([
      tx.student.findFirst({ where: { id: studentId, tenantId: a.tenantId }, select: { status: true } }),
      tx.schoolClass.findFirst({
        where: { id: classId, tenantId: a.tenantId },
        include: { academicYear: true, _count: { select: { enrollments: { where: { status: { in: [...ACTIVE] } } } } } },
      }),
    ]);
    if (!student) throw Errors.notFound('Student');
    if (!schoolClass) throw Errors.notFound('Class');
    if (student.status === 'ARCHIVED') throw Errors.conflict('STUDENT_ARCHIVED', 'Archived students cannot be enrolled');
    if (expectedYearId && schoolClass.academicYearId !== expectedYearId) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'CLASS_IN_OTHER_YEAR', 'The class belongs to another academic year');
    }
    const year = schoolClass.academicYear;
    if (year.status === 'CLOSED') throw Errors.conflict('ACADEMIC_YEAR_CLOSED', 'The academic year is closed');
    if (enrolledOn < toIso(year.startDate) || enrolledOn > toIso(year.endDate)) {
      throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'DATE_OUTSIDE_YEAR', 'The enrollment date is outside the academic year');
    }
    if (schoolClass.capacity !== null && schoolClass._count.enrollments >= schoolClass.capacity) {
      throw Errors.conflict('CLASS_FULL', 'The class has reached its capacity');
    }
    const enrollment = await tx.enrollment.create({
      data: { tenantId: a.tenantId, studentId, academicYearId: year.id, classId, status, enrolledOn: toDate(enrolledOn) },
    });
    if (student.status === 'APPLICANT') await tx.student.update({ where: { id: studentId }, data: { status: 'ACTIVE' } });
    return enrollment;
  }

  private async activeEnrollmentOrThrow(tx: Tx, a: Actor, id: string) {
    const e = await tx.enrollment.findFirst({ where: { id, tenantId: a.tenantId } });
    if (!e) throw Errors.notFound('Enrollment');
    if (!(ACTIVE as readonly string[]).includes(e.status)) {
      throw Errors.conflict('ENROLLMENT_NOT_ACTIVE', 'This enrollment has already ended');
    }
    return e;
  }
}
