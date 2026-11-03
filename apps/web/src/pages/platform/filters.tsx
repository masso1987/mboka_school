import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Select } from '../../components/ui';
import { api } from '../../lib/api';

/** Picks one school (or all) for the platform lists. */
export function SchoolFilter({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const schools = useQuery({
    queryKey: ['platform-schools', ''],
    queryFn: () => api<{ tenant: { id: string; legalName: string } }[]>('/platform/schools'),
    staleTime: 60_000,
  });
  return (
    <Select className="max-w-64" value={value} onChange={(e) => onChange(e.target.value)} aria-label={t('platform.school')}>
      <option value="">{t('platform.allSchools')}</option>
      {schools.data?.map((s) => (
        <option key={s.tenant.id} value={s.tenant.id}>
          {s.tenant.legalName}
        </option>
      ))}
    </Select>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
      <span>{t('platform.pageOf', { page, pages, total })}</span>
      <span className="space-x-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ←
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          →
        </Button>
      </span>
    </div>
  );
}

/** The query string without paging, for a CSV download link of the same filters. */
export function csvHref(path: string, filters: Record<string, string>) {
  const p = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), format: 'csv' });
  return `/api/v1${path}?${p.toString()}`;
}
