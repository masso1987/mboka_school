import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { roomSchema, timetableEntrySchema, type RoomInput, type TimetableEntryInput } from '@mboka/shared';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { ApiZodBody, ZodBody } from '../common/zod';
import { TimetableService } from './timetable.service';

const optionalUuid = new ParseUUIDPipe({ optional: true });

@ApiTags('timetable')
@Controller()
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get('rooms')
  @RequirePermissions('timetable.read')
  listRooms(@CurrentActor() a: Actor) {
    return this.timetable.listRooms(a);
  }

  @Post('rooms')
  @RequirePermissions('timetable.manage')
  @ApiZodBody(roomSchema)
  createRoom(@CurrentActor() a: Actor, @ZodBody(roomSchema) body: RoomInput) {
    return this.timetable.createRoom(a, body);
  }

  @Get('timetable')
  @RequirePermissions('timetable.read')
  list(
    @CurrentActor() a: Actor,
    @Query('academicYearId', ParseUUIDPipe) academicYearId: string,
    @Query('classId', optionalUuid) classId?: string,
    @Query('staffId', optionalUuid) staffId?: string,
    @Query('roomId', optionalUuid) roomId?: string,
  ) {
    return this.timetable.list(a, { academicYearId, classId, staffId, roomId });
  }

  @Post('timetable')
  @RequirePermissions('timetable.manage')
  @ApiZodBody(timetableEntrySchema)
  create(@CurrentActor() a: Actor, @ZodBody(timetableEntrySchema) body: TimetableEntryInput) {
    return this.timetable.create(a, body);
  }

  @Delete('timetable/:id')
  @HttpCode(204)
  @RequirePermissions('timetable.manage')
  async remove(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.timetable.remove(a, id);
  }
}
