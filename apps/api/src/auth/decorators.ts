import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { PermissionKey } from '@mboka/shared';
import { IS_PUBLIC, MFA_STAGE, REQUIRED_PERMISSIONS } from './metadata';
import { PlatformAdminGuard } from './platform-admin.guard';
import { TenantGuard } from './tenant.guard';

/** Route needs no session (login, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Route operates inside one tenant: resolves the tenant from the caller's verified
 * membership (X-Tenant-Id header) and requires every listed permission there.
 * `@RequirePermissions()` with no arguments only requires membership.
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  applyDecorators(
    SetMetadata(REQUIRED_PERMISSIONS, permissions),
    UseGuards(TenantGuard),
    ApiHeader({ name: 'X-Tenant-Id', required: true, description: 'Tenant UUID; must match an active membership' }),
  );

/** Platform super administrators only. Grants no access to school data by itself. */
export const PlatformAdmin = () => UseGuards(PlatformAdminGuard);

/** Allowed while the session still awaits its second factor ('verify') or mandatory MFA enrollment ('setup'). */
export const AllowDuringMfa = (...stages: ('verify' | 'setup')[]) => SetMetadata(MFA_STAGE, stages);
