import { z } from 'zod';
import { LOCALES } from './schemas';

/** Platform settings (Phase 7): maintenance, session security, branding, legal documents and messages to schools. */

export const maintenanceSchema = z
  .object({
    /** Manual switch: maintenance starts at once and lasts until switched off. */
    enabled: z.boolean(),
    message: z.string().trim().max(500),
    /** Scheduled window, ISO instants; both or neither. */
    startsAt: z.iso.datetime({ offset: true }).nullable(),
    endsAt: z.iso.datetime({ offset: true }).nullable(),
    /** Show a banner to every user before the window starts. */
    notify: z.boolean(),
  })
  .refine((m) => (m.startsAt === null) === (m.endsAt === null), { message: 'window_incomplete', path: ['endsAt'] })
  .refine((m) => !m.startsAt || !m.endsAt || new Date(m.endsAt) > new Date(m.startsAt), { message: 'window_order', path: ['endsAt'] });
export type MaintenanceSettings = z.infer<typeof maintenanceSchema>;

export const DEFAULT_MAINTENANCE: MaintenanceSettings = { enabled: false, message: '', startsAt: null, endsAt: null, notify: false };

/** How long before a scheduled window the banner shows. */
export const MAINTENANCE_NOTICE_HOURS = 72;

/** Whether maintenance is on now (manual or inside the window) and whether a window is coming soon. */
export function maintenanceState(m: MaintenanceSettings, now: Date): { active: boolean; upcoming: boolean } {
  const start = m.startsAt ? new Date(m.startsAt) : null;
  const end = m.endsAt ? new Date(m.endsAt) : null;
  const inWindow = Boolean(start && end && start <= now && now < end);
  const upcoming = Boolean(m.notify && start && start > now && start.getTime() - now.getTime() <= MAINTENANCE_NOTICE_HOURS * 3_600_000);
  return { active: m.enabled || inWindow, upcoming: !m.enabled && !inWindow && upcoming };
}

export const securitySchema = z.object({
  /** Absolute lifetime of a session, whatever its activity. */
  sessionHours: z.number().int().min(1).max(720),
  /** Sign out after this long without activity; 0 turns it off. Checked to within 5 minutes. */
  idleMinutes: z.number().int().min(0).max(1440).refine((v) => v === 0 || v >= 15, { message: 'idle_too_short' }),
});
export type SecuritySettings = z.infer<typeof securitySchema>;

const optionalText = (max: number) => z.string().trim().max(max).nullable();

export const brandingSchema = z.object({
  name: z.string().trim().min(2).max(60),
  logoUrl: z.url({ protocol: /^https$/ }).max(500).nullable(),
  /** Main colour of buttons and links. */
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'invalid_color').nullable(),
  footerText: optionalText(200),
  supportEmail: z.email().max(160).nullable(),
  supportPhone: optionalText(30),
});
export type BrandingSettings = z.infer<typeof brandingSchema>;

export const DEFAULT_BRANDING: BrandingSettings = { name: 'Mboka School', logoUrl: null, primaryColor: null, footerText: null, supportEmail: null, supportPhone: null };

export const LEGAL_KINDS = ['terms', 'privacy', 'notice'] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

/** Publishing a legal document always creates a new version; earlier ones are kept. */
export const legalDocumentSchema = z.object({
  kind: z.enum(LEGAL_KINDS),
  locale: z.enum(LOCALES),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(20).max(100_000),
});
export type LegalDocumentInput = z.infer<typeof legalDocumentSchema>;

export const MESSAGE_AUDIENCES = ['ALL_SCHOOLS', 'ALL_ADMINS', 'SCHOOL', 'SCHOOL_ADMINS'] as const;

/** A message from the platform: in-app notification to the chosen people, e-mailed when mail is configured. */
export const platformMessageSchema = z
  .object({
    audience: z.enum(MESSAGE_AUDIENCES),
    tenantId: z.uuid().nullable(),
    subject: z.string().trim().min(3).max(150),
    body: z.string().trim().min(3).max(5000),
  })
  .refine((m) => (m.audience === 'SCHOOL' || m.audience === 'SCHOOL_ADMINS') === Boolean(m.tenantId), { message: 'school_required', path: ['tenantId'] });
export type PlatformMessageInput = z.infer<typeof platformMessageSchema>;
