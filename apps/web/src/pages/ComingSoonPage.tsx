import { useTranslation } from 'react-i18next';

export function ComingSoonPage({ titleKey, phase }: { titleKey: string; phase: number }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">{t(`nav.${titleKey}`)}</h1>
      <p className="text-slate-600">{t('common.comingSoon', { phase })}</p>
    </div>
  );
}
