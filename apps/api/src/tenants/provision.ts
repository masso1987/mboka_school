import { DEFAULT_ROLES, type CreateTenantInput } from '@mboka/shared';
import type { Prisma } from '@prisma/client';
import { generateTemporaryPassword, hashPassword } from '../auth/password';
import type { NewAccountCredentials } from '../auth/password-links.service';

type Tx = Prisma.TransactionClient;

export interface ProvisionResult {
  tenantId: string;
  ownerUserId: string;
  /** Whether the owner account was created now (otherwise an existing account became director). */
  ownerCreated: boolean;
  /** Set only when the owner account was created now with one; shown once, never stored in clear. */
  temporaryPassword?: string;
}

/**
 * Creates a tenant with isolated defaults (TEN-001/002): subscription, main campus,
 * default roles, and the owner's membership with the director role.
 *
 * Must run inside a transaction. For the runtime role the caller sets app.tenant_id
 * to the new tenant's id (see TenantsService); the seed runs as owner and bypasses RLS.
 * `password` lets the seed and sign-up choose the password; the platform passes `credentials` from
 * PasswordLinksService (an invitation link, or a one-time password without mail delivery).
 */
export async function provisionTenant(
  tx: Tx,
  tenantId: string,
  input: CreateTenantInput,
  password?: string,
  credentials?: NewAccountCredentials,
): Promise<ProvisionResult> {
  await tx.tenant.create({
    data: {
      id: tenantId,
      slug: input.slug,
      legalName: input.legalName,
      tradingName: input.tradingName,
      defaultLocale: input.defaultLocale,
      timezone: input.timezone,
      defaultCurrency: input.defaultCurrency,
    },
  });
  await tx.subscription.create({ data: { tenantId } });
  await tx.campus.create({ data: { tenantId, code: 'MAIN', name: input.tradingName ?? input.legalName } });

  for (const template of DEFAULT_ROLES) {
    const role = await tx.role.create({
      data: { tenantId, key: template.key, nameFr: template.name.fr, nameEn: template.name.en, isSystem: true },
    });
    await tx.rolePermission.createMany({
      data: template.permissions.map((permissionKey) => ({ tenantId, roleId: role.id, permissionKey })),
    });
  }

  let owner = await tx.user.findUnique({ where: { email: input.ownerEmail } });
  const ownerCreated = !owner;
  let temporaryPassword: string | undefined;
  if (!owner) {
    let data: NewAccountCredentials['data'];
    if (password) data = { passwordHash: await hashPassword(password) };
    else if (credentials) ({ data, temporaryPassword } = credentials);
    else {
      temporaryPassword = generateTemporaryPassword();
      data = { passwordHash: await hashPassword(temporaryPassword) };
    }
    owner = await tx.user.create({ data: { email: input.ownerEmail, fullName: input.ownerName, ...data } });
  }

  const membership = await tx.membership.create({ data: { tenantId, userId: owner.id } });
  const director = await tx.role.findUniqueOrThrow({ where: { tenantId_key: { tenantId, key: 'director' } } });
  await tx.userRoleAssignment.create({ data: { tenantId, membershipId: membership.id, roleId: director.id } });

  return { tenantId, ownerUserId: owner.id, ownerCreated, temporaryPassword };
}
