import { Injectable } from '@nestjs/common';
import type { BookListItemInput } from '@mboka/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { Errors } from '../common/api-error';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type Item = Prisma.BookListItemGetPayload<object>;

const present = (i: Item) => ({
  id: i.id,
  academicYearId: i.academicYearId,
  levelId: i.levelId,
  classId: i.classId,
  subject: i.subject,
  title: i.title,
  author: i.author,
  publisher: i.publisher,
  isbn: i.isbn,
  price: i.price?.toString() ?? null,
  currency: i.currency,
});

/** Each class's book list for the year, with indicative prices; parents buy the books outside the school. */
@Injectable()
export class BookListsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  /** Every item of the year, for the list editor. */
  listItems(a: Actor, academicYearId: string) {
    return this.run(a, async (tx) => {
      const rows = await tx.bookListItem.findMany({
        where: { tenantId: a.tenantId, academicYearId },
        orderBy: [{ subject: 'asc' }, { title: 'asc' }],
      });
      return rows.map(present);
    });
  }

  /** The list a class's parents receive: school-wide, level and class items, with the total per currency. */
  forClass(a: Actor, classId: string) {
    return this.run(a, async (tx) => {
      const c = await tx.schoolClass.findFirst({
        where: { id: classId, tenantId: a.tenantId },
        select: { id: true, name: true, levelId: true, academicYearId: true, academicYear: { select: { name: true } } },
      });
      if (!c) throw Errors.notFound('Class');
      const rows = await tx.bookListItem.findMany({
        where: {
          tenantId: a.tenantId,
          academicYearId: c.academicYearId,
          OR: [{ classId: null, levelId: null }, { classId: c.id }, { levelId: c.levelId }],
        },
        orderBy: [{ subject: 'asc' }, { title: 'asc' }],
      });
      const totals = new Map<string, Prisma.Decimal>();
      for (const r of rows) if (r.price) totals.set(r.currency, (totals.get(r.currency) ?? new Prisma.Decimal(0)).plus(r.price));
      return {
        class: { id: c.id, name: c.name },
        academicYear: c.academicYear.name,
        items: rows.map(present),
        totals: [...totals].map(([currency, total]) => ({ currency, total: total.toString() })),
      };
    });
  }

  create(a: Actor, input: BookListItemInput) {
    return this.run(a, async (tx) => {
      const item = await tx.bookListItem.create({ data: { tenantId: a.tenantId, ...input, createdBy: a.userId } });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'book_list.item_added', entityType: 'book_list_item', entityId: item.id, metadata: { title: item.title }, ip: a.ip },
        tx,
      );
      return present(item);
    });
  }

  update(a: Actor, id: string, input: BookListItemInput) {
    return this.run(a, async (tx) => {
      const found = await tx.bookListItem.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!found) throw Errors.notFound('Book');
      const item = await tx.bookListItem.update({
        where: { id },
        // Fields left out of the form are cleared, not kept.
        data: { levelId: null, classId: null, subject: null, author: null, publisher: null, isbn: null, price: null, ...input },
      });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'book_list.item_updated', entityType: 'book_list_item', entityId: id, metadata: { title: item.title }, ip: a.ip },
        tx,
      );
      return present(item);
    });
  }

  remove(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const found = await tx.bookListItem.findFirst({ where: { id, tenantId: a.tenantId } });
      if (!found) throw Errors.notFound('Book');
      await tx.bookListItem.delete({ where: { id } });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'book_list.item_removed', entityType: 'book_list_item', entityId: id, metadata: { title: found.title }, ip: a.ip },
        tx,
      );
    });
  }
}
