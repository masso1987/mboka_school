import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { useSession } from './session';
import type { AcademicYear } from './types';

/** GET bound to the active tenant (the tenant id is part of the cache key). */
export function useTenantQuery<T>(key: unknown[], path: string | null, enabled = true) {
  const { tenantId } = useSession();
  return useQuery({
    queryKey: [tenantId, ...key],
    queryFn: () => api<T>(path!),
    enabled: enabled && path !== null,
  });
}

/** POST/PUT/PATCH that refreshes the given query keys on success. */
export function useTenantMutation<TBody, TResult = unknown>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string | ((body: TBody) => string),
  invalidate: unknown[][] = [],
) {
  const { tenantId } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) =>
      api<TResult>(typeof path === 'function' ? path(body) : path, { method, body: method === 'DELETE' ? undefined : body }),
    onSuccess: async () => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: [tenantId, ...k] })));
    },
  });
}

export function useAcademicYears() {
  return useTenantQuery<AcademicYear[]>(['academic-years'], '/academic-years');
}

/** The active year, else the most recent one. */
export function useCurrentYear() {
  const years = useAcademicYears();
  const current = years.data?.find((y) => y.status === 'ACTIVE') ?? years.data?.[0];
  return { years, current };
}

/** Picks the FR or EN label of a bilingual record. */
export function useLabel() {
  const { i18n } = useTranslation();
  return (r: { nameFr: string; nameEn: string } | null | undefined) => (r ? (i18n.resolvedLanguage === 'en' ? r.nameEn : r.nameFr) : '');
}

export function useDateFormat() {
  const { i18n } = useTranslation();
  const fmt = new Intl.DateTimeFormat(i18n.resolvedLanguage === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeZone: 'UTC' });
  return (iso: string | null | undefined) => (iso ? fmt.format(new Date(`${iso}T00:00:00Z`)) : '—');
}

/** Today's date in the school's timezone, `YYYY-MM-DD`. */
export function useSchoolToday() {
  const { context } = useSession();
  return new Intl.DateTimeFormat('en-CA', { timeZone: context?.tenant.timezone ?? 'Africa/Douala' }).format(new Date());
}
