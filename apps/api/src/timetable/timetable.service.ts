import { HttpStatus, Injectable } from '@nestjs/common';
import { hhmmFromMinutes, minutesFromHhmm, type RoomInput, type TimetableEntryInput } from '@mboka/shared';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../common/actor';
import { ApiException, Errors } from '../common/api-error';
import { guardDb } from '../common/db-errors';
import { PrismaService, type Tx } from '../prisma/prisma.service';

const entryInclude = {
  schoolClass: { select: { id: true, code: true, name: true } },
  staff: { select: { id: true, firstName: true, lastName: true } },
  room: { select: { id: true, code: true, name: true } },
} satisfies Prisma.TimetableEntryInclude;

type EntryWithRefs = Prisma.TimetableEntryGetPayload<{ include: typeof entryInclude }>;

const presentEntry = (e: EntryWithRefs) => ({
  id: e.id,
  academicYearId: e.academicYearId,
  weekday: e.weekday,
  startTime: hhmmFromMinutes(e.startMinute),
  endTime: hhmmFromMinutes(e.endMinute),
  subjectLabel: e.subjectLabel,
  class: e.schoolClass,
  staff: e.staff,
  room: e.room,
});

/** Rooms and weekly timetables with conflict detection (TIM-001…004). */
@Injectable()
export class TimetableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private run<T>(a: Actor, fn: (tx: Tx) => Promise<T>) {
    return this.prisma.scoped({ tenantId: a.tenantId, userId: a.userId }, fn);
  }

  listRooms(a: Actor) {
    return this.run(a, (tx) =>
      tx.room.findMany({ where: { tenantId: a.tenantId }, include: { campus: { select: { code: true } } }, orderBy: { code: 'asc' } }),
    );
  }

  createRoom(a: Actor, input: RoomInput) {
    return guardDb(
      this.run(a, async (tx) => {
        const room = await tx.room.create({ data: { tenantId: a.tenantId, ...input } });
        await this.audit.record({ tenantId: a.tenantId, actorId: a.userId, action: 'room.created', entityType: 'room', entityId: room.id, ip: a.ip }, tx);
        return room;
      }),
      { Room: () => Errors.conflict('CODE_TAKEN', 'Room code already in use on this campus') },
    );
  }

  list(a: Actor, filter: { academicYearId: string; classId?: string; staffId?: string; roomId?: string }) {
    return this.run(a, async (tx) => {
      const rows = await tx.timetableEntry.findMany({
        where: {
          tenantId: a.tenantId,
          academicYearId: filter.academicYearId,
          ...(filter.classId && { classId: filter.classId }),
          ...(filter.staffId && { staffId: filter.staffId }),
          ...(filter.roomId && { roomId: filter.roomId }),
        },
        include: entryInclude,
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      });
      return rows.map(presentEntry);
    });
  }

  /**
   * Checks every clash first so the user sees all of them at once (409 with details);
   * the exclusion constraints remain the guarantee under concurrent edits.
   */
  create(a: Actor, input: TimetableEntryInput) {
    const start = minutesFromHhmm(input.startTime);
    const end = minutesFromHhmm(input.endTime);
    return guardDb(
      this.run(a, async (tx) => {
        const schoolClass = await tx.schoolClass.findFirst({ where: { id: input.classId, tenantId: a.tenantId } });
        if (!schoolClass) throw Errors.notFound('Class');
        if (schoolClass.academicYearId !== input.academicYearId) {
          throw new ApiException(HttpStatus.UNPROCESSABLE_ENTITY, 'CLASS_IN_OTHER_YEAR', 'The class belongs to another academic year');
        }
        if (input.staffId && !(await tx.staff.findFirst({ where: { id: input.staffId, tenantId: a.tenantId }, select: { id: true } }))) {
          throw Errors.notFound('Staff member');
        }
        if (input.roomId && !(await tx.room.findFirst({ where: { id: input.roomId, tenantId: a.tenantId }, select: { id: true } }))) {
          throw Errors.notFound('Room');
        }

        const clashes = await tx.timetableEntry.findMany({
          where: {
            tenantId: a.tenantId,
            academicYearId: input.academicYearId,
            weekday: input.weekday,
            startMinute: { lt: end },
            endMinute: { gt: start },
            OR: [
              { classId: input.classId },
              ...(input.staffId ? [{ staffId: input.staffId }] : []),
              ...(input.roomId ? [{ roomId: input.roomId }] : []),
            ],
          },
          include: entryInclude,
        });
        if (clashes.length > 0) {
          throw new ApiException(HttpStatus.CONFLICT, 'TIMETABLE_CONFLICT', 'This slot clashes with existing lessons', {
            conflicts: clashes.map((c) => ({
              ...presentEntry(c),
              on: [
                c.classId === input.classId && 'class',
                input.staffId && c.staffId === input.staffId && 'teacher',
                input.roomId && c.roomId === input.roomId && 'room',
              ].filter(Boolean),
            })),
          });
        }

        const entry = await tx.timetableEntry.create({
          data: {
            tenantId: a.tenantId,
            academicYearId: input.academicYearId,
            classId: input.classId,
            subjectLabel: input.subjectLabel,
            staffId: input.staffId,
            roomId: input.roomId,
            weekday: input.weekday,
            startMinute: start,
            endMinute: end,
          },
          include: entryInclude,
        });
        await this.audit.record(
          { tenantId: a.tenantId, actorId: a.userId, action: 'timetable_entry.created', entityType: 'timetable_entry', entityId: entry.id, metadata: { after: presentEntry(entry) }, ip: a.ip },
          tx,
        );
        return presentEntry(entry);
      }),
      {
        timetable_no_teacher_overlap: () => conflict('teacher'),
        timetable_no_room_overlap: () => conflict('room'),
        timetable_no_class_overlap: () => conflict('class'),
      },
    );
  }

  remove(a: Actor, id: string) {
    return this.run(a, async (tx) => {
      const e = await tx.timetableEntry.findFirst({ where: { id, tenantId: a.tenantId }, include: entryInclude });
      if (!e) throw Errors.notFound('Timetable entry');
      await tx.timetableEntry.delete({ where: { id } });
      await this.audit.record(
        { tenantId: a.tenantId, actorId: a.userId, action: 'timetable_entry.deleted', entityType: 'timetable_entry', entityId: id, metadata: { before: presentEntry(e) }, ip: a.ip },
        tx,
      );
    });
  }
}

function conflict(on: string) {
  return new ApiException(HttpStatus.CONFLICT, 'TIMETABLE_CONFLICT', 'This slot clashes with existing lessons', { conflicts: [{ on: [on] }] });
}
