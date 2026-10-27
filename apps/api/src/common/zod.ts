import { applyDecorators, Body, PipeTransform } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { z } from 'zod';
import { Errors } from './api-error';

export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw Errors.validation(
        result.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code, message: i.message })),
      );
    }
    return result.data;
  }
}

/** Validated request body; the same zod schema also documents it in OpenAPI. */
export const ZodBody = (schema: z.ZodType) => Body(new ZodPipe(schema));

export const ApiZodBody = (schema: z.ZodType) =>
  applyDecorators(ApiBody({ schema: z.toJSONSchema(schema, { io: 'input' }) as SchemaObject }));
