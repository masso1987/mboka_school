import { Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from './zod';

export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const ListQueryParams = () => Query(new ZodPipe(listQuerySchema));

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const skipTake = (q: ListQuery) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
