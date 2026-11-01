import { z } from 'zod';
import { optionalText } from './primitives';

export const campusSchema = z.object({
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/, 'invalid_code'),
  name: z.string().trim().min(2).max(120),
  address: optionalText(300),
});
export type CampusInput = z.infer<typeof campusSchema>;

const roleKeys = z.array(z.string().trim().min(1).max(50)).min(1).max(10);

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  fullName: z.string().trim().min(2).max(200),
  roleKeys,
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

export const userRolesSchema = z.object({ roleKeys });
export type UserRolesInput = z.infer<typeof userRolesSchema>;

export const membershipStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'REVOKED']),
  reason: z.string().trim().min(3).max(500),
});
export type MembershipStatusInput = z.infer<typeof membershipStatusSchema>;
