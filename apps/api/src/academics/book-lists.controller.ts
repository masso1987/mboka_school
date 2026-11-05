import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { bookListItemSchema, type BookListItemInput } from '@mboka/shared';
import { RequirePermissions } from '../auth/decorators';
import { type Actor, CurrentActor } from '../common/actor';
import { ApiZodBody, ZodBody } from '../common/zod';
import { BookListsService } from './book-lists.service';

const MANAGE = 'academics.structure.manage' as const;

@ApiTags('academics')
@Controller('book-lists')
export class BookListsController {
  constructor(private readonly books: BookListsService) {}

  /** Any member of the school can read and print a class's list. */
  @Get('classes/:classId')
  @RequirePermissions()
  forClass(@CurrentActor() a: Actor, @Param('classId', ParseUUIDPipe) classId: string) {
    return this.books.forClass(a, classId);
  }

  @Get('items')
  @RequirePermissions(MANAGE)
  list(@CurrentActor() a: Actor, @Query('academicYearId', ParseUUIDPipe) academicYearId: string) {
    return this.books.listItems(a, academicYearId);
  }

  @Post('items')
  @RequirePermissions(MANAGE)
  @ApiZodBody(bookListItemSchema)
  create(@CurrentActor() a: Actor, @ZodBody(bookListItemSchema) body: BookListItemInput) {
    return this.books.create(a, body);
  }

  @Put('items/:id')
  @RequirePermissions(MANAGE)
  @ApiZodBody(bookListItemSchema)
  update(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @ZodBody(bookListItemSchema) body: BookListItemInput) {
    return this.books.update(a, id, body);
  }

  @Delete('items/:id')
  @HttpCode(204)
  @RequirePermissions(MANAGE)
  remove(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.books.remove(a, id);
  }
}
