import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { AccountPage } from '../pages/AccountPage';
import { LOCALES, type Locale } from '@mboka/shared';
import { setLocale } from '../i18n';
import { LegalFooter, usePublicStatus } from '../lib/platform-status';
import { PLATFORM_CHOICE, useSession } from '../lib/session';
import { useTenantQuery } from '../lib/hooks';
import type { AcademicYear } from '../lib/types';
import { groupNavItems, PLATFORM_NAV_ITEMS, schoolInitials, visibleNavItems } from '../nav';
import { NotificationBell } from './NotificationBell';
import { OfflineIndicator } from './OfflineIndicator';

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { me, tenantId, selectTenant, can, signOut, context, contextError } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const platformName = usePublicStatus().data?.branding.name;
  const superAdmin = me.user.platformRole === 'SUPER_ADMIN';
  // A super administrator with no school selected works on the platform console.
  const platformMode = superAdmin && !tenantId;
  const onPlatformPath = location.pathname === '/platform' || location.pathname.startsWith('/platform/');
  const items = platformMode ? PLATFORM_NAV_ITEMS : visibleNavItems(can);
  const years = useTenantQuery<AcademicYear[]>(['academic-years'], '/academic-years', Boolean(tenantId) && can('academics.years.read'));
  const year = years.data?.find((y) => y.status === 'ACTIVE') ?? years.data?.[0];
  const stampName = platformMode ? t('platform.console') : (context?.tenant.tradingName ?? context?.tenant.legalName ?? platformName ?? t('app.name'));
  const stampDetail = platformMode ? (platformName ?? t('app.name')) : year ? t('nav.schoolYear', { year: year.name }) : undefined;

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside
        className={`${menuOpen ? 'fixed inset-0 z-40 flex' : 'hidden'} w-full flex-col bg-forest-900 text-white/80 md:sticky md:top-0 md:flex md:h-dvh md:w-64 md:shrink-0`}
      >
        <div className="flex items-start justify-between gap-2 px-4 pb-4 pt-5">
          <SchoolStamp name={stampName} detail={stampDetail} />
          <button type="button" className="rounded p-1 text-white/70 hover:bg-white/10 md:hidden" onClick={() => setMenuOpen(false)} aria-label={t('common.cancel')}>
            ✕
          </button>
        </div>
        <nav aria-label={t('common.menu')} className="menu-scroll flex-1 overflow-y-auto px-3 pb-4">
          {groupNavItems(items).map((section) => (
            <div key={section.group} className="mb-3">
              {section.group !== 'home' && <p className="px-3 pb-1 pt-2 text-xs font-semibold text-white/45">{t(`nav.groups.${section.group}`)}</p>}
              <ul className="space-y-px">
                {section.items.map((item) => (
                  <li key={item.key}>
                    <NavLink
                      to={item.path}
                      end={item.path === '/' || item.path === '/platform'}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) =>
                        `relative flex items-center justify-between rounded-md px-3 py-1.5 text-[0.9rem] ${
                          isActive
                            ? 'bg-white/10 font-semibold text-white before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-accent-500'
                            : 'hover:bg-white/5 hover:text-white'
                        }`
                      }
                    >
                      <span>{t(`nav.${item.key}`)}</span>
                      {item.phase !== undefined && <span className="text-[11px] text-white/40">{t('nav.soon')}</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <p className="border-t border-white/10 px-5 py-3 text-xs text-white/45">{platformName ?? t('app.name')}</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-2 py-1 text-sm md:hidden"
            onClick={() => setMenuOpen(true)}
          >
            {t('common.menu')}
          </button>

          {me.tenants.length > 1 || (superAdmin && me.tenants.length > 0) ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">{t('common.school')}</span>
              <select
                value={tenantId ?? PLATFORM_CHOICE}
                onChange={(e) => selectTenant(e.target.value)}
                className="max-w-56 rounded-md border border-slate-300 bg-white px-2 py-1"
              >
                {superAdmin && <option value={PLATFORM_CHOICE}>{t('platform.console')}</option>}
                {me.tenants.map((ten) => (
                  <option key={ten.id} value={ten.id}>
                    {ten.tradingName ?? ten.legalName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="truncate text-sm font-semibold md:hidden">{stampName}</span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <OfflineIndicator />
            {context && <NotificationBell />}
            <label className="text-sm">
              <span className="sr-only">{t('common.language')}</span>
              <select
                value={i18n.resolvedLanguage}
                onChange={(e) => setLocale(e.target.value as Locale)}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 uppercase"
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>
            <Link to="/account" className="hidden items-center gap-2 rounded-md px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-100 sm:flex">
              <span aria-hidden className="grid size-7 place-items-center rounded-full bg-accent-50 text-xs font-bold text-accent-700">
                {schoolInitials(me.user.fullName).slice(0, 2)}
              </span>
              {me.user.fullName}
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="whitespace-nowrap rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-100"
            >
              {t('common.signOut')}
            </button>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 md:px-10">
          {location.pathname === '/account' ? (
            <Outlet />
          ) : contextError?.code === 'MFA_SETUP_REQUIRED' ? (
            <AccountPage mandatory />
          ) : platformMode ? (
            onPlatformPath ? <Outlet /> : <Navigate to="/platform" replace />
          ) : onPlatformPath ? (
            <Navigate to="/" replace />
          ) : !tenantId ? (
            <Notice>{t('tenant.none')}</Notice>
          ) : contextError?.code === 'TENANT_SUSPENDED' ? (
            <Notice>{t('tenant.suspended')}</Notice>
          ) : contextError ? (
            <Notice>{t('common.errorGeneric')}</Notice>
          ) : !context ? (
            <p className="text-slate-500">{t('common.loading')}</p>
          ) : (
            <>
              <SubscriptionBanner />
              <Outlet />
            </>
          )}
        </main>
        <LegalFooter />
      </div>
    </div>
  );
}

/**
 * The school's stamp: its initials in Mboka orange on the forest green, like the seal on a school certificate,
 * with its name and the school year. The one bold element of the interface.
 */
function SchoolStamp({ name, detail }: { name: string; detail?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden
        className="grid size-11 shrink-0 place-items-center rounded-lg border-2 border-action-500 bg-forest-950 text-[0.95rem] font-extrabold tracking-wide text-action-500"
      >
        {schoolInitials(name)}
      </span>
      <span className="min-w-0">
        <span className="line-clamp-2 block text-[0.95rem] font-bold leading-snug text-white">{name}</span>
        {detail && <span className="block text-xs text-white/55">{detail}</span>}
      </span>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">{children}</div>;
}

/** Trial countdown, renewal reminder, or the read-only notice once the subscription has lapsed. */
function SubscriptionBanner() {
  const { t } = useTranslation();
  const { context } = useSession();
  const sub = context?.tenant.subscription;
  if (!sub || sub.state === 'OK' || (sub.state === 'TRIAL' && (sub.daysLeft ?? 99) > 14)) return null;
  const tone = sub.state === 'EXPIRED' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900';
  return (
    <div role="status" className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-2 text-sm ${tone}`}>
      <span>{t(`subscription.banner.${sub.state}`, { days: sub.daysLeft ?? 0 })}</span>
      <Link to="/administration?tab=subscription" className="font-medium underline">
        {t('subscription.banner.action')}
      </Link>
    </div>
  );
}
