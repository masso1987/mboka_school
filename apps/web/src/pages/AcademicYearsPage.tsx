import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { academicYearSchema } from '@mboka/shared';
import { api, ApiRequestError } from '../lib/api';
import { useSession } from '../lib/session';
import type { AcademicYear } from '../lib/types';

export function AcademicYearsPage() {
  const { t, i18n } = useTranslation();
  const { tenantId, can } = useSession();
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const [fieldError, setFieldError] = useState<string | null>(null);

  const years = useQuery({
    queryKey: ['academic-years', tenantId],
    queryFn: () => api<AcademicYear[]>('/academic-years'),
  });

  const create = useMutation({
    mutationFn: (body: typeof form) => api<AcademicYear>('/academic-years', { method: 'POST', body }),
    onSuccess: async () => {
      setForm({ name: '', startDate: '', endDate: '' });
      await qc.invalidateQueries({ queryKey: ['academic-years', tenantId] });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = academicYearSchema.safeParse(form);
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? 'VALIDATION_FAILED');
      return;
    }
    setFieldError(null);
    create.mutate(parsed.data);
  }

  const fmt = new Intl.DateTimeFormat(i18n.resolvedLanguage === 'en' ? 'en-GB' : 'fr-FR', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  });
  const showDate = (iso: string) => fmt.format(new Date(`${iso}T00:00:00Z`));

  const serverError =
    create.error instanceof ApiRequestError ? t(`errors.${create.error.code}`, { defaultValue: t('common.errorGeneric') }) : null;
  const error = fieldError ? t(`errors.${fieldError}`, { defaultValue: t('errors.VALIDATION_FAILED') }) : serverError;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('academicYears.title')}</h1>

      {can('academics.years.manage') && (
        <form onSubmit={submit} className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-4" noValidate>
          <h2 className="font-semibold sm:col-span-4">{t('academicYears.new')}</h2>
          <Field label={t('academicYears.name')}>
            <input
              value={form.name}
              placeholder={t('academicYears.namePlaceholder')}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              required
            />
          </Field>
          <Field label={t('academicYears.startDate')}>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              required
            />
          </Field>
          <Field label={t('academicYears.endDate')}>
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
              required
            />
          </Field>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={create.isPending}
              className="w-full rounded-md bg-accent-600 px-4 py-2 font-medium text-white hover:bg-accent-700 disabled:opacity-60"
            >
              {create.isPending ? t('common.loading') : t('common.save')}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger-600 sm:col-span-4">
              {error}
            </p>
          )}
          {create.isSuccess && !error && (
            <p role="status" className="text-sm text-success-600 sm:col-span-4">
              {t('academicYears.created')}
            </p>
          )}
        </form>
      )}

      <section className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        {years.isPending ? (
          <p className="p-5 text-slate-500">{t('common.loading')}</p>
        ) : years.isError ? (
          <div className="flex items-center gap-3 p-5">
            <p className="text-danger-600">{t('common.errorGeneric')}</p>
            <button type="button" onClick={() => void years.refetch()} className="text-sm underline">
              {t('common.retry')}
            </button>
          </div>
        ) : years.data.length === 0 ? (
          <p className="p-5 text-slate-600">{t('academicYears.empty')}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-2 font-medium">{t('academicYears.name')}</th>
                <th className="px-4 py-2 font-medium">{t('academicYears.startDate')}</th>
                <th className="px-4 py-2 font-medium">{t('academicYears.endDate')}</th>
                <th className="px-4 py-2 font-medium">{t('academicYears.status')}</th>
              </tr>
            </thead>
            <tbody>
              {years.data.map((y) => (
                <tr key={y.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-2 font-medium">{y.name}</td>
                  <td className="tabular px-4 py-2">{showDate(y.startDate)}</td>
                  <td className="tabular px-4 py-2">{showDate(y.endDate)}</td>
                  <td className="px-4 py-2">{t(`academicYears.statuses.${y.status}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
