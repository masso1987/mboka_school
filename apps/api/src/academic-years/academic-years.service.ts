import { Injectable } from '@nestjs/common';
import type { AcademicYearInput } from '@mboka/shared';
import { Prisma, type AcademicYear } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/api-error';
import { PrismaService } from '../prisma/prisma.service';

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);

function present(y: AcademicYear) {
  return { id: y.id, name: y.name, startDate: toIso(y.startDate), endDate: toIso(y.endDate), status: y.status };
}

/**
 * Reference implementation of a tenant-scoped module: every query runs inside
 * `prisma.scoped(...)` AND filters by tenantId; every change is audited in the same transaction.
 */
@Injectable()
export class AcademicYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, userId: string) {
    const years = await this.prisma.scoped({ tenantId, userId }, (tx) =>
      tx.academicYear.findMany({ where: { tenantId }, orderBy: { startDate: 'desc' } }),
    );
    return years.map(present);
  }

  async get(tenantId: string, userId: string, id: string) {
    const year = await this.prisma.scoped({ tenantId, userId }, (tx) =>
      tx.academicYear.findFirst({ where: { id, tenantId } }),
    );
    if (!year) throw Errors.notFound('Academic year');
    return present(year);
  }

  async create(tenantId: string, userId: string, input: AcademicYearInput, ip?: string) {
    try {
      const year = await this.prisma.scoped({ tenantId, userId }, async (tx) => {
        const created = await tx.academicYear.create({
          data: {
            tenantId,
            name: input.name,
            startDate: toDate(input.startDate),
            endDate: toDate(input.endDate),
            createdBy: userId,
          },
        });
        await this.audit.record(
          {
            tenantId,
            actorId: userId,
            action: 'academic_year.created',
            entityType: 'academic_year',
            entityId: created.id,
            metadata: { after: present(created) },
            ip,
          },
          tx,
        );
        return created;
      });
      return present(year);
    } catch (e) {
      throw mapConstraintError(e) ?? e;
    }
  }
}

function mapConstraintError(e: unknown) {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    return Errors.conflict('ACADEMIC_YEAR_NAME_TAKEN', 'An academic year with this name already exists');
  }
  // Exclusion-constraint violations (23P01) are not mapped to a Prisma code; match the constraint name.
  const message = e instanceof Error ? e.message : '';
  if (message.includes('academic_years_no_overlap') || message.includes('23P01')) {
    return Errors.conflict('ACADEMIC_YEAR_OVERLAP', 'This period overlaps an existing academic year');
  }
  return null;
}
