import { z } from 'zod';

/**
 * A school's identity as printed on its documents (Phase 8): the letterhead of report books, receipts, payslips and
 * certificates. Stored in `tenants.settings.profile`; images (logo, coat of arms, stamp, signature) are separate assets.
 */
const text = (max: number) => z.string().trim().max(max).nullable();

export const schoolProfileSchema = z.object({
  /** Short name or acronym printed under the full name, e.g. "DIBINAPS". */
  acronym: text(30),
  motto: text(160),
  address: text(200),
  city: text(80),
  poBox: text(40),
  phone: text(80),
  email: z.email().max(160).nullable(),
  website: text(160),
  /** Ministry authorisation, e.g. "No 202/I/7/0/MINEDUB/SG/DSEPB/SDAAP of 10/09/2015". */
  authorisation: text(200),
  /** Lines of the bilingual official header, left (English) and right (French). */
  headerEn: z.array(z.string().trim().max(120)).max(6),
  headerFr: z.array(z.string().trim().max(120)).max(6),
  headTitle: text(80),
  headName: text(120),
  bank: z
    .object({ bank: text(120), holder: text(160), account: text(80), iban: text(80) })
    .nullable(),
  /** Report book layout: the MINEDUB primary booklet (competences) or the subject/sequence book. */
  reportBook: z.enum(['PRIMARY_BOOKLET', 'SEQUENCE_BOOK']),
  /** Title printed on the report book cover. */
  reportBookTitle: text(120),
});
export type SchoolProfile = z.infer<typeof schoolProfileSchema>;

export const DEFAULT_HEADER_EN = ['REPUBLIC OF CAMEROON', 'Peace - Work - Fatherland', 'MINISTRY OF BASIC EDUCATION', 'INSPECTORATE GENERAL OF EDUCATION'];
export const DEFAULT_HEADER_FR = ['RÉPUBLIQUE DU CAMEROUN', 'Paix - Travail - Patrie', "MINISTÈRE DE L'ÉDUCATION DE BASE", 'INSPECTION GÉNÉRALE DES ENSEIGNEMENTS'];

export const DEFAULT_SCHOOL_PROFILE: SchoolProfile = {
  acronym: null,
  motto: null,
  address: null,
  city: null,
  poBox: null,
  phone: null,
  email: null,
  website: null,
  authorisation: null,
  headerEn: DEFAULT_HEADER_EN,
  headerFr: DEFAULT_HEADER_FR,
  headTitle: null,
  headName: null,
  bank: null,
  reportBook: 'SEQUENCE_BOOK',
  reportBookTitle: null,
};

/** Images a school can upload for its documents. */
export const SCHOOL_ASSET_KINDS = ['logo', 'emblem', 'stamp', 'signature'] as const;
export type SchoolAssetKind = (typeof SCHOOL_ASSET_KINDS)[number];
export const SCHOOL_ASSET_MAX_BYTES = 400 * 1024;
export const SCHOOL_ASSET_TYPES = ['image/png', 'image/jpeg'] as const;
