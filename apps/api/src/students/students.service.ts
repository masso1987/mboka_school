import { HttpStatus, Injectable } from '@nestjs/common';
import type { GuardianLinkInput, NewGuardianInput, StudentInput, StudentUpdateInput } from '@mboka/shared';
import { Prisma, type Student } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { nextCounter } from '../common/counters';
import { toDate, toIso, toIsoOrNull } from '../common/dates';
import { guardDb } from '../common/db-errors';
import { type ListQuery, type Page, skipTake } from '../common/pagination';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export const presentStudent = (s: Student) => ({
  id: s.id,
  matricule: s.matricule,
  firstName: s.firstName,
  lastName: s.lastName,
  gender: s.gender,
  dateOfBirth: toIso(s.dateOfBirth),
  placeOfBirth: s.placeOfBirth,
  nationality: s.nationality,
  address: s.address,
  status: s.status,
});

const ACTIVE_ENROLLMENT = ['PENDING', 'ENROLLED', 'REPEATING'] as const;

/** Student identities, guardians and duplicate detection (STD-003…006, 012, 014). */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  async list(a: Actor, q: ListQuery & { classId?: string; includeArchived?: boolean }): Promise<Page<unknown>> {
    return this.run(a, async (tx) => {
      const terms = q.q?.split(/\s+/).filter(Boolean) ?? [];
      const where: Prisma.StudentWhereInput = {
        tenantId: a.tenantId,
        ...(!q.includeArchived && { status: { not: 'ARCHIVED' } }),
        ...(q.classId && { enrollments: { some: { classId: q.classId, status: { in: [...ACTIVE_ENROLLMENT] } } } }),
        AND: terms.map((t) => ({
          OR: [
            { firstName: { contains: t, mode: 'insensitive' as const } },
            { lastName: { contains: t, mode: 'insensitive' as const } },
            { matricule: { contains: t, mode: 'insensitive' as const } },
          ],
        })),
      };
      const [total, rows] = await Promise.all([
        tx.student.count({ where }),
        tx.student.findMany({
          where,
          orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
          ...skipTake(q),
          include: {
            enrollments: {
              where: { status: { in: [...ACTIVE_ENROLLMENT] } },
              select: { schoolClass: { select: { id: true, code: true, name: true } }, academicYear: { select: { name: true } } },
              orderBy: { enrolledOn: 'desc' },
              take: 1,
            },
          },
        }),
      ]);
      const items = rows.map((s) => ({
        ...presentStudent(s),
        currentClass: s.enrollments[0]?.schoolClass ?? null,
        currentYear: s.enrollments[0]?.academicYear.name ?? null,
      }));
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  /** Full file: identity, guardians, enrollment history, admissions — the student timeline basis (STD-014). */
  async get(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const s = await tx.student.findFirst({
        where: { id, tenantId: a.tenantId },
        include: {
          guardians: { include: { guardian: true }, orderBy: { isPrimary: 'desc' } },
          enrollments: {
            include: {
              schoolClass: { select: { id: true, code: true, name: true } },
              academicYear: { select: { id: true, name: true } },
            },
            orderBy: { enrolledOn: 'desc' },
          },
          admissions: { include: { academicYear: { select: { name: true } }, requestedLevel: { select: { code: true } } }, orderBy: { createdAt: 'desc' } },
        },
      });
      if (!s) throw Errors.notFound('Student');
      return {
        ...presentStudent(s),
        guardians: s.guardians.map((g) => ({
          guardianId: g.guardianId,
          relationship: g.relationship,
          isPrimary: g.isPrimary,
          isEmergencyContact: g.isEmergencyContact,
          canPickUp: g.canPickUp,
          firstName: g.guardian.firstName,
          lastName: g.guardian.lastName,
          phone: g.guardian.phone,
          email: g.guardian.email,
          portalEnabled: g.guardian.membershipId !== null,
        })),
        portalEnabled: s.membershipId !== null,
        enrollments: s.enrollments.map((e) => ({
          id: e.id,
          status: e.status,
          enrolledOn: toIso(e.enrolledOn),
          leftOn: toIsoOrNull(e.leftOn),
          leftReason: e.leftReason,
          class: e.schoolClass,
          academicYear: e.academicYear,
        })),
        admissions: s.admissions.map((ad) => ({
          id: ad.id,
          status: ad.status,
          academicYear: ad.academicYear.name,
          requestedLevel: ad.requestedLevel.code,
          createdAt: ad.createdAt.toISOString(),
        })),
      };
    });
  }

  async create(a: Actor, input: StudentInput) {
    return guardDb(
      this.run(a, async (tx) => {
        if (!input.confirmDuplicate) {
          const candidates = await this.findPossibleDuplicates(tx, a.tenantId, input);
          if (candidates.length > 0) {
            throw new ApiException(HttpStatus.CONFLICT, 'POSSIBLE_DUPLICATE', 'A student with the same name and date of birth exists', {
              candidates: candidates.map(presentStudent),
            });
          }
        }
        const matricule = input.matricule ?? (await this.nextMatricule(tx, a.tenantId));
        const student = await tx.student.create({
          data: {
            tenantId: a.tenantId,
            matricule,
            firstName: input.firstName,
            lastName: input.lastName,
            gender: input.gender,
            dateOfBirth: toDate(input.dateOfBirth),
            placeOfBirth: input.placeOfBirth,
            nationality: input.nationality,
            address: input.address,
          },
        });
        for (const link of input.guardians) await this.linkGuardianTx(tx, a, student.id, link);
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'student.created', entityType: 'student', entityId: student.id, metadata: { matricule }, ip: a.ip },
          tx,
        );
        return presentStudent(student);
      }),
      { Student: () => Errors.conflict('MATRICULE_TAKEN', 'This matricule is already assigned') },
    );
  }

  async update(a: Actor, id: string, input: StudentUpdateInput) {
    return this.run(a, async (tx) => {
      const before = await tx.student.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!before) throw Errors.notFound('Student');
      if (before.status === 'ARCHIVED') throw Errors.conflict('STUDENT_ARCHIVED', 'Archived records are read-only');
      const after = await tx.student.update({
        where: { id },
        data: { ...input, ...(input.dateOfBirth && { dateOfBirth: toDate(input.dateOfBirth) }) },
      });
      await this.audit.record(
        {
          tenantId: a.tenantId,
          actorId: a.userId,
          action: 'student.updated',
          entityType: 'student',
          entityId: id,
          metadata: { before: changed(presentStudent(before), input), after: changed(presentStudent(after), input) },
          ip: a.ip,
        },
        tx,
      );
      return presentStudent(after);
    });
  }

  /** Archival replaces deletion once history exists (Module 3 AC). Requires no active enrollment. */
  async archive(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const s = await tx.student.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!s) throw Errors.notFound('Student');
      const active = await tx.enrollment.count({ where: { tenantId: a.tenantId, studentId: id, status: { in: [...ACTIVE_ENROLLMENT] } } });
      if (active > 0) throw Errors.conflict('STUDENT_HAS_ACTIVE_ENROLLMENT', 'End the active enrollment before archiving');
      const archived = await tx.student.update({ where: { id }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
      await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'student.archived', entityType: 'student', entityId: id, metadata: { previousStatus: s.status }, ip: a.ip }, tx);
      return presentStudent(archived);
    });
  }

  async linkGuardian(a: Actor, studentId: string, link: GuardianLinkInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const s = await tx.student.findFirst({ where: { id: studentId, tenantId: a.tenantId }, select: { id: true } });
        if (!s) throw Errors.notFound('Student');
        const guardianId = await this.linkGuardianTx(tx, a, studentId, link);
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'student.guardian_linked', entityType: 'student', entityId: studentId, metadata: { guardianId, relationship: link.relationship }, ip: a.ip },
          tx,
        );
        return { guardianId };
      }),
      { StudentGuardian: () => Errors.conflict('GUARDIAN_ALREADY_LINKED', 'This guardian is already linked to the student') },
    );
  }

  async unlinkGuardian(a: Actor, studentId: string, guardianId: string) {
    return this.run(a, async (tx) => {
      const { count } = await tx.studentGuardian.deleteMany({ where: { tenantId: a.tenantId, studentId, guardianId } });
      if (count === 0) throw Errors.notFound('Guardian link');
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'student.guardian_unlinked', entityType: 'student', entityId: studentId, metadata: { guardianId }, ip: a.ip },
        tx,
      );
    });
  }

  /** Search guardians by name or phone, to reuse one record for siblings (STD-006). */
  searchGuardians(a: Actor, q: string) {
    const term = q.trim();
    return this.run(a, (tx) =>
      tx.guardian.findMany({
        where: {
          tenantId: a.tenantId,
          OR: [
            { lastName: { contains: term, mode: 'insensitive' } },
            { firstName: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term.replace(/\s+/g, '') } },
          ],
        },
        include: { students: { select: { student: { select: { id: true, firstName: true, lastName: true } } } } },
        take: 20,
        orderBy: { lastName: 'asc' },
      }),
    );
  }

  // ------------------------------------------------------------ internals

  private async linkGuardianTx(tx: Tx, a: Actor, studentId: string, link: GuardianLinkInput): Promise<string> {
    let guardianId = link.guardianId;
    if (guardianId) {
      const exists = await tx.guardian.findFirst({ where: { id: guardianId, tenantId: a.tenantId }, select: { id: true } });
      if (!exists) throw Errors.notFound('Guardian');
    } else {
      guardianId = (await tx.guardian.create({ data: { tenantId: a.tenantId, ...(link.guardian as NewGuardianInput) } })).id;
    }
    if (link.isPrimary) {
      await tx.studentGuardian.updateMany({ where: { tenantId: a.tenantId, studentId }, data: { isPrimary: false } });
    }
    await tx.studentGuardian.create({
      data: {
        tenantId: a.tenantId,
        studentId,
        guardianId,
        relationship: link.relationship,
        isPrimary: link.isPrimary,
        isEmergencyContact: link.isEmergencyContact,
        canPickUp: link.canPickUp,
      },
    });
    return guardianId;
  }

  /** Configurable matching would come later; default rule: same names (case-insensitive) and date of birth. */
  private findPossibleDuplicates(tx: Tx, tenantId: string, input: StudentInput) {
    return tx.student.findMany({
      where: {
        tenantId,
        dateOfBirth: toDate(input.dateOfBirth),
        firstName: { equals: input.firstName, mode: 'insensitive' },
        lastName: { equals: input.lastName, mode: 'insensitive' },
      },
      take: 5,
    });
  }

  /** `<year>-<5-digit sequence>`, e.g. 2026-00042; sequence restarts each calendar year. */
  private async nextMatricule(tx: Tx, tenantId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const n = await nextCounter(tx, tenantId, `matricule:${year}`);
    return `${year}-${String(n).padStart(5, '0')}`;
  }
}

/** Only the fields the request touched, for a compact before/after audit record. */
function changed<T extends Record<string, unknown>>(record: T, input: Partial<Record<keyof T, unknown>>): Prisma.InputJsonObject {
  return Object.fromEntries(Object.keys(input).map((k) => [k, (record[k] ?? null) as Prisma.InputJsonValue]));
}
