import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type { AnalyticsSettings, BrandingSettings } from '@mboka/shared';
import { api } from './api';

export interface PublicStatus {
  maintenance: { active: boolean; upcoming: boolean; message: string; startsAt: string | null; endsAt: string | null };
  branding: BrandingSettings;
  analytics: AnalyticsSettings;
  legal: { kind: string; locale: string; version: number }[];
}

/** Maintenance notice, branding and published legal documents; readable before sign-in, refreshed every minute. */
export function usePublicStatus() {
  return useQuery({ queryKey: ['public-status'], queryFn: () => api<PublicStatus>('/public/status'), staleTime: 60_000, refetchInterval: 60_000 });
}

/** Applies the platform's name and main colour to the page (title, buttons, links). */
export function useBranding() {
  const status = usePublicStatus();
  const branding = status.data?.branding;
  useEffect(() => {
    if (!branding) return;
    document.title = branding.name;
    const root = document.documentElement.style;
    if (branding.primaryColor) {
      root.setProperty('--color-accent-600', branding.primaryColor);
      root.setProperty('--color-accent-700', `color-mix(in srgb, ${branding.primaryColor} 80%, black)`);
      root.setProperty('--color-accent-500', `color-mix(in srgb, ${branding.primaryColor} 85%, white)`);
    } else {
      for (const v of ['--color-accent-500', '--color-accent-600', '--color-accent-700']) root.removeProperty(v);
    }
  }, [branding]);
  return branding;
}

/**
 * Loads PostHog when the platform set a project key (Platform → System → Analytics). Anonymous page views only:
 * no user is identified, so no personal data leaves for the analytics service.
 */
export function useAnalytics() {
  const analytics = usePublicStatus().data?.analytics;
  useEffect(() => {
    if (!analytics?.posthogKey || !analytics.posthogHost || document.getElementById('posthog-loader')) return;
    const host = analytics.posthogHost.replace(/\/+$/, '');
    const script = document.createElement('script');
    script.id = 'posthog-loader';
    script.async = true;
    script.src = `${host.replace('.i.posthog.com', '-assets.i.posthog.com')}/static/array.js`;
    script.onload = () => {
      const ph = (window as unknown as { posthog?: { init: (key: string, options: object) => void } }).posthog;
      ph?.init(analytics.posthogKey!, { api_host: host, person_profiles: 'never', capture_pageview: true, autocapture: false, disable_session_recording: true });
    };
    document.head.appendChild(script);
  }, [analytics?.posthogKey, analytics?.posthogHost]);
}

/** "Maintenance planned on …" shown to everyone before a scheduled window. */
export function MaintenanceBanner() {
  const { t } = useTranslation();
  const status = usePublicStatus();
  const m = status.data?.maintenance;
  if (!m?.upcoming || !m.startsAt) return null;
  return (
    <div role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
      {t('maintenance.upcoming', { start: new Date(m.startsAt).toLocaleString(), end: m.endsAt ? new Date(m.endsAt).toLocaleString() : '' })}
      {m.message && <> — {m.message}</>}
    </div>
  );
}

/** Shown instead of the app while maintenance is on (super administrators keep working). */
export function MaintenanceScreen({ onAdminSignIn }: { onAdminSignIn?: () => void }) {
  const { t } = useTranslation();
  const status = usePublicStatus();
  const m = status.data?.maintenance;
  const name = status.data?.branding.name ?? t('app.name');
  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-8 text-center shadow-lg">
        <p className="text-sm font-semibold uppercase tracking-wide text-accent-600">{name}</p>
        <h1 className="text-2xl font-semibold">{t('maintenance.title')}</h1>
        <p className="text-slate-600">{m?.message || t('maintenance.default')}</p>
        {m?.endsAt && <p className="text-sm text-slate-500">{t('maintenance.until', { end: new Date(m.endsAt).toLocaleString() })}</p>}
        {onAdminSignIn && (
          <button type="button" className="text-xs text-slate-500 hover:underline" onClick={onAdminSignIn}>
            {t('maintenance.adminSignIn')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Footer with the platform's text, support contact and links to the published legal documents. */
export function LegalFooter({ dark = false }: { dark?: boolean }) {
  const { t, i18n } = useTranslation();
  const status = usePublicStatus();
  if (!status.data) return null;
  const { branding, legal } = status.data;
  const kinds = [...new Set(legal.map((l) => l.kind))];
  const tone = dark ? 'text-slate-300' : 'text-slate-500';
  return (
    <footer className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-4 text-xs ${tone}`}>
      <span>{branding.footerText ?? `© ${new Date().getFullYear()} ${branding.name}`}</span>
      {kinds.map((k) => (
        <Link key={k} to={`/legal/${k}?locale=${i18n.resolvedLanguage ?? 'fr'}`} className="hover:underline">
          {t(`legal.kinds.${k}`)}
        </Link>
      ))}
      {branding.supportEmail && (
        <a href={`mailto:${branding.supportEmail}`} className="hover:underline">
          {branding.supportEmail}
        </a>
      )}
      {branding.supportPhone && <span>{branding.supportPhone}</span>}
    </footer>
  );
}
