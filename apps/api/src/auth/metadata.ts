export const IS_PUBLIC = 'mboka:isPublic';
export const REQUIRED_PERMISSIONS = 'mboka:requiredPermissions';
/** Routes reachable before MFA is complete: 'verify' during login, 'setup' while enrollment is mandatory. */
export const MFA_STAGE = 'mboka:mfaStage';
/** Changes still allowed when the school's subscription has lapsed (paying for it, mainly). */
export const ALLOW_READ_ONLY = 'mboka:allowWhenReadOnly';
