import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AcademicPeriodInput,
  ClassSubjectInput,
  EducationLevelInput,
  ProgramInput,
  SchoolClassInput,
  SubjectInput,
} from '@mboka/shared';
import type { AcademicPeriod, ClassSubject, SchoolClass } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { toDate, toIso } from '../common/dates';
import { guardDb } from '../common/db-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const presentPeriod = (p: AcademicPeriod) => ({
  id: p.id,
  academicYearId: p.academicYearId,
  kind: p.kind,
  name: p.name,
  position: p.position,
  startDate: toIso(p.startDate),
  endDate: toIso(p.endDate),
});

const presentClassSubject = (cs: ClassSubject & { subject?: { code: string; nameFr: string; nameEn: string } }) => ({
  id: cs.id,
  classId: cs.classId,
  subjectId: cs.subjectId,
  coefficient: Number(cs.coefficient),
  weeklyHours: Number(cs.weeklyHours),
  subject: cs.subject,
});

const codeTaken = (what: string) => () => Errors.conflict('CODE_TAKEN', `${what} code already in use`);

/** Academic framework (Module 2): periods, levels, programs, subjects, classes and class subjects. */
@Injectable()
export class AcademicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  private async yearOrThrow(tx: Tx, tenantId: string, id: string) {
    const year = await tx.academicYear.findFirst({ where: { id, tenantId } });
    if (!year) throw Errors.notFound('Academic year');
    return year;
  }

  // ------------------------------------------------------------ periods

  async listPeriods(a: Actor, academicYearId: string) {
    return this.run(a, async (tx) => {
      await this.yearOrThrow(tx, a.tenantId, academicYearId);
      const periods = await tx.academicPeriod.findMany({
        where: { tenantId: a.tenantId, academicYearId },
        orderBy: [{ kind: 'asc' }, { position: 'asc' }],
      });
      return periods.map(presentPeriod);
    });
  }

  async createPeriod(a: Actor, academicYearId: string, input: AcademicPeriodInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const year = await this.yearOrThrow(tx, a.tenantId, academicYearId);
        if (year.status === 'CLOSED') throw Errors.conflict('ACADEMIC_YEAR_CLOSED', 'The academic year is closed');
        if (input.startDate < toIso(year.startDate) || input.endDate > toIso(year.endDate)) {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'PERIOD_OUTSIDE_YEAR', 'The period must lie within the academic year');
        }
        const period = await tx.academicPeriod.create({
          data: { tenantId: a.tenantId, academicYearId, ...input, startDate: toDate(input.startDate), endDate: toDate(input.endDate) },
        });
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'academic_period.created', entityType: 'academic_period', entityId: period.id, metadata: { after: presentPeriod(period) }, ip: a.ip },
          tx,
        );
        return presentPeriod(period);
      }),
      {
        academic_periods_no_overlap: () => Errors.conflict('PERIOD_OVERLAP', 'This period overlaps another period of the same kind'),
        AcademicPeriod: () => Errors.conflict('PERIOD_POSITION_TAKEN', 'A period of this kind already has this position'),
      },
    );
  }

  // ------------------------------------------------------------ levels, programs, subjects

  listLevels(a: Actor) {
    return this.run(a, (tx) =>
      tx.educationLevel.findMany({ where: { tenantId: a.tenantId }, orderBy: [{ position: 'asc' }, { code: 'asc' }] }),
    );
  }

  createLevel(a: Actor, input: EducationLevelInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const level = await tx.educationLevel.create({ data: { tenantId: a.tenantId, ...input } });
        await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'education_level.created', entityType: 'education_level', entityId: level.id, ip: a.ip }, tx);
        return level;
      }),
      { EducationLevel: codeTaken('Level') },
    );
  }

  listPrograms(a: Actor) {
    return this.run(a, (tx) => tx.program.findMany({ where: { tenantId: a.tenantId }, orderBy: { code: 'asc' } }));
  }

  createProgram(a: Actor, input: ProgramInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const program = await tx.program.create({ data: { tenantId: a.tenantId, ...input } });
        await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'program.created', entityType: 'program', entityId: program.id, ip: a.ip }, tx);
        return program;
      }),
      { Program: codeTaken('Program') },
    );
  }

  listSubjects(a: Actor) {
    return this.run(a, (tx) => tx.subject.findMany({ where: { tenantId: a.tenantId }, orderBy: { code: 'asc' } }));
  }

  createSubject(a: Actor, input: SubjectInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const subject = await tx.subject.create({ data: { tenantId: a.tenantId, ...input } });
        await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'subject.created', entityType: 'subject', entityId: subject.id, ip: a.ip }, tx);
        return subject;
      }),
      { Subject: codeTaken('Subject') },
    );
  }

  // ------------------------------------------------------------ classes

  async listClasses(a: Actor, academicYearId?: string) {
    return this.run(a, async (tx) => {
      const classes = await tx.schoolClass.findMany({
        where: { tenantId: a.tenantId, ...(academicYearId && { academicYearId }) },
        include: {
          level: { select: { code: true, nameFr: true, nameEn: true } },
          campus: { select: { code: true, name: true } },
          _count: { select: { enrollments: { where: { status: { in: ['ENROLLED', 'REPEATING', 'PENDING'] } } } } },
        },
        orderBy: [{ level: { position: 'asc' } }, { code: 'asc' }],
      });
      return classes.map(({ _count, ...c }) => ({ ...presentClass(c), level: c.level, campus: c.campus, studentCount: _count.enrollments }));
    });
  }

  async getClass(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const c = await tx.schoolClass.findFirst({
        where: { id, tenantId: a.tenantId },
        include: {
          level: { select: { code: true, nameFr: true, nameEn: true } },
          subjects: { include: { subject: { select: { code: true, nameFr: true, nameEn: true } } }, orderBy: { subject: { code: 'asc' } } },
        },
      });
      if (!c) throw Errors.notFound('Class');
      return { ...presentClass(c), level: c.level, subjects: c.subjects.map(presentClassSubject) };
    });
  }

  createClass(a: Actor, input: SchoolClassInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const year = await this.yearOrThrow(tx, a.tenantId, input.academicYearId);
        if (year.status === 'CLOSED') throw Errors.conflict('ACADEMIC_YEAR_CLOSED', 'The academic year is closed');
        const c = await tx.schoolClass.create({ data: { tenantId: a.tenantId, ...input } });
        await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'class.created', entityType: 'class', entityId: c.id, metadata: { after: presentClass(c) }, ip: a.ip }, tx);
        return presentClass(c);
      }),
      { SchoolClass: codeTaken('Class') },
    );
  }

  addClassSubject(a: Actor, classId: string, input: ClassSubjectInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const c = await tx.schoolClass.findFirst({ where: { id: classId, tenantId: a.tenantId }, select: { id: true } });
        if (!c) throw Errors.notFound('Class');
        const cs = await tx.classSubject.create({
          data: { tenantId: a.tenantId, classId, subjectId: input.subjectId, coefficient: input.coefficient, weeklyHours: input.weeklyHours },
          include: { subject: { select: { code: true, nameFr: true, nameEn: true } } },
        });
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'class_subject.created', entityType: 'class_subject', entityId: cs.id, metadata: { classId, subjectId: input.subjectId, coefficient: input.coefficient }, ip: a.ip },
          tx,
        );
        return presentClassSubject(cs);
      }),
      { ClassSubject: () => Errors.conflict('SUBJECT_ALREADY_IN_CLASS', 'This subject is already taught in the class') },
    );
  }
}

function presentClass(c: SchoolClass) {
  return {
    id: c.id,
    academicYearId: c.academicYearId,
    campusId: c.campusId,
    levelId: c.levelId,
    programId: c.programId,
    code: c.code,
    name: c.name,
    capacity: c.capacity,
  };
}
