import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_COMPETENCE_RULES, SCHOOL_ASSET_KINDS, type CompetenceRules, type SchoolAssetKind, type SchoolProfile } from '@mboka/shared';
import { Button, Card, ErrorMessage, Field, Input, Loading, Select } from '../components/ui';
import { api, apiBlob, apiUpload } from '../lib/api';
import { useTenantQuery } from '../lib/hooks';
import { useSession } from '../lib/session';

interface ProfileResponse {
  legalName: string;
  tradingName: string | null;
  profile: SchoolProfile;
  /** kind → last update. */
  assets: Partial<Record<SchoolAssetKind, string>>;
}

/** Administration → École: the school's identity as printed on report books, receipts and certificates. */
export function SchoolProfileTab() {
  const profile = useTenantQuery<ProfileResponse>(['school-profile'], '/school/profile');
  const rules = useTenantQuery<CompetenceRules>(['competence-rules'], '/competences/rules');
  if (profile.isPending) return <Loading />;
  if (profile.isError) return <ErrorMessage error={profile.error} />;
  return (
    <div className="space-y-6">
      <ProfileForm data={profile.data} />
      <ImagesCard assets={profile.data.assets} />
      {rules.data && <RulesCard key={JSON.stringify(rules.data)} initial={rules.data} />}
    </div>
  );
}

const lines = (v: string[]) => v.join('\n');
const unlines = (v: string) =>
  v
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);

function ProfileForm({ data }: { data: ProfileResponse }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const qc = useQueryClient();
  const p = data.profile;
  const [f, setF] = useState({ ...p, headerEnText: lines(p.headerEn), headerFrText: lines(p.headerFr) });
  const save = useMutation({
    mutationFn: () => {
      const { headerEnText, headerFrText, ...rest } = f;
      const clean = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v])) as unknown as SchoolProfile;
      return api('/school/profile', { method: 'PUT', body: { ...clean, reportBook: f.reportBook, headerEn: unlines(headerEnText), headerFr: unlines(headerFrText) } });
    },
    onSuccess: () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes('school-profile') }),
  });
  const readOnly = !can('tenant.settings.update');
  const text = (k: keyof SchoolProfile, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input disabled={readOnly} value={(f[k] as string | null) ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </Field>
  );

  return (
    <Card title={t('school.identity')}>
      <p className="mb-4 text-sm text-slate-600">{t('school.identityHelp', { name: data.legalName })}</p>
      <form
        className="space-y-5"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {text('acronym', t('school.acronym'), t('school.acronymHint'))}
          {text('motto', t('school.motto'))}
          {text('authorisation', t('school.authorisation'), t('school.authorisationHint'))}
          {text('address', t('school.address'))}
          {text('city', t('school.city'))}
          {text('poBox', t('school.poBox'))}
          {text('phone', t('school.phone'))}
          {text('email', t('school.email'))}
          {text('website', t('school.website'))}
          {text('headTitle', t('school.headTitle'), t('school.headTitleHint'))}
          {text('headName', t('school.headName'))}
        </div>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold text-slate-700">{t('school.officialHeader')}</legend>
          <Field label={t('school.headerEn')} hint={t('school.headerHint')}>
            <textarea disabled={readOnly} rows={4} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={f.headerEnText} onChange={(e) => setF({ ...f, headerEnText: e.target.value })} />
          </Field>
          <Field label={t('school.headerFr')} hint={t('school.headerHint')}>
            <textarea disabled={readOnly} rows={4} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" value={f.headerFrText} onChange={(e) => setF({ ...f, headerFrText: e.target.value })} />
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold text-slate-700">{t('school.reportBook')}</legend>
          <Field label={t('school.layout')} hint={t('school.layoutHint')}>
            <Select disabled={readOnly} value={f.reportBook} onChange={(e) => setF({ ...f, reportBook: e.target.value as SchoolProfile['reportBook'] })}>
              <option value="PRIMARY_BOOKLET">{t('school.layouts.PRIMARY_BOOKLET')}</option>
              <option value="SEQUENCE_BOOK">{t('school.layouts.SEQUENCE_BOOK')}</option>
            </Select>
          </Field>
          {text('reportBookTitle', t('school.reportBookTitle'), t('school.reportBookTitleHint'))}
        </fieldset>

        <ErrorMessage error={save.error} />
        {save.isSuccess && <p className="text-sm text-success-600">{t('platform.saved')}</p>}
        {!readOnly && (
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
        )}
      </form>
    </Card>
  );
}

/** One uploaded image with its preview, upload and removal. */
function ImageSlot({ kind, version }: { kind: SchoolAssetKind; version: string | undefined }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const qc = useQueryClient();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!version) {
      setUrl(null);
      return;
    }
    let objectUrl: string | null = null;
    apiBlob(`/school/assets/${kind}`)
      .then((b) => {
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, version]);
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey.includes('school-profile') });
  const upload = useMutation({ mutationFn: (file: File) => apiUpload(`/school/assets/${kind}`, file), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => api(`/school/assets/${kind}`, { method: 'DELETE' }), onSuccess: refresh });
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
      <p className="text-sm font-semibold">{t(`school.assets.${kind}`)}</p>
      <div className="grid h-28 place-items-center rounded bg-slate-50">
        {url ? <img src={url} alt={t(`school.assets.${kind}`)} className="max-h-24 max-w-full object-contain" /> : <span className="text-xs text-slate-400">{t('school.noImage')}</span>}
      </div>
      {can('tenant.settings.update') && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">
            {url ? t('school.replace') : t('school.upload')}
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) upload.mutate(file);
                e.target.value = '';
              }}
            />
          </label>
          {url && (
            <Button variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t('school.remove')}
            </Button>
          )}
        </div>
      )}
      <ErrorMessage error={upload.error ?? remove.error} />
    </div>
  );
}

function ImagesCard({ assets }: { assets: ProfileResponse['assets'] }) {
  const { t } = useTranslation();
  return (
    <Card title={t('school.images')}>
      <p className="mb-3 text-sm text-slate-600">{t('school.imagesHelp')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SCHOOL_ASSET_KINDS.map((k) => (
          <ImageSlot key={k} kind={k} version={assets[k]} />
        ))}
      </div>
    </Card>
  );
}

/** Thresholds of the competence appreciations (SNA / SPA / SA / Exp), in % of the maximum. */
function RulesCard({ initial }: { initial: CompetenceRules }) {
  const { t } = useTranslation();
  const { can } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState(initial);
  const save = useMutation({ mutationFn: () => api('/competences/rules', { method: 'PUT', body: f }), onSuccess: () => qc.invalidateQueries() });
  const readOnly = !can('tenant.settings.update');
  const num = (k: keyof CompetenceRules, label: string) => (
    <Field label={label}>
      <Input type="number" min={0} max={100} disabled={readOnly} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />
    </Field>
  );
  return (
    <Card title={t('school.competenceRules')}>
      <p className="mb-3 text-sm text-slate-600">{t('school.competenceRulesHelp')}</p>
      <form
        className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {num('spa', t('school.spaFrom'))}
        {num('sa', t('school.saFrom'))}
        {num('exp', t('school.expFrom'))}
        {!readOnly && (
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              {t('common.save')}
            </Button>
            <Button variant="ghost" onClick={() => setF(DEFAULT_COMPETENCE_RULES)}>
              {t('school.defaults')}
            </Button>
          </div>
        )}
      </form>
      <ErrorMessage error={save.error} />
    </Card>
  );
}
