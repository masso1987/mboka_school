import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { LOCALES, type Locale } from '@mboka/shared';
import { setLocale } from '../i18n';
import { useSession } from '../lib/session';
import { visibleNavItems } from '../nav';

export function AppLayout() {
  const { t, i18n } = useTranslation();
  const { me, tenantId, selectTenant, can, signOut, context, contextError } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = visibleNavItems(can);

  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside
        className={`${menuOpen ? 'fixed inset-0 z-40 flex' : 'hidden'} w-full flex-col bg-navy-900 text-slate-200 md:static md:flex md:w-64 md:shrink-0`}
      >
        <div className="flex h-14 items-center justify-between px-5">
          <span className="text-lg font-semibold tracking-tight text-white">{t('app.name')}</span>
          <button type="button" className="md:hidden" onClick={() => setMenuOpen(false)} aria-label={t('common.cancel')}>
            ✕
          </button>
        </div>
        <nav aria-label={t('common.menu')} className="flex-1 overflow-y-auto px-3 pb-4">
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.key}>
                <NavLink
                  to={item.path}
                  end={item.path === '/'}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                      isActive ? 'bg-navy-700 text-white' : 'hover:bg-navy-800 hover:text-white'
                    }`
                  }
                >
                  <span>{t(`nav.${item.key}`)}</span>
                  {item.phase !== undefined && (
                    <span className="rounded bg-navy-800 px-1.5 text-[10px] text-slate-400">P{item.phase}</span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
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

          {me.tenants.length > 1 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">{t('common.school')}</span>
              <select
                value={tenantId}
                onChange={(e) => selectTenant(e.target.value)}
                className="max-w-56 rounded-md border border-slate-300 bg-white px-2 py-1"
              >
                {me.tenants.map((ten) => (
                  <option key={ten.id} value={ten.id}>
                    {ten.tradingName ?? ten.legalName}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="truncate text-sm font-medium">
              {context?.tenant.tradingName ?? context?.tenant.legalName}
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
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
            <span className="hidden text-sm text-slate-600 sm:inline">{me.user.fullName}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-100"
            >
              {t('common.signOut')}
            </button>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8">
          {!tenantId ? (
            <Notice>{t('tenant.none')}</Notice>
          ) : contextError?.code === 'TENANT_SUSPENDED' ? (
            <Notice>{t('tenant.suspended')}</Notice>
          ) : contextError ? (
            <Notice>{t('common.errorGeneric')}</Notice>
          ) : !context ? (
            <p className="text-slate-500">{t('common.loading')}</p>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">{children}</div>;
}
