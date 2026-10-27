import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { useTranslation } from 'react-i18next';
import './i18n';
import './index.css';
import { AppLayout } from './components/AppLayout';
import { SessionProvider, useMe } from './lib/session';
import { NAV_ITEMS } from './nav';
import { AcademicYearsPage } from './pages/AcademicYearsPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function Root() {
  const { t } = useTranslation();
  const me = useMe();
  if (me.isPending) return <p className="p-8 text-slate-500">{t('common.loading')}</p>;
  if (me.isError) return <p className="p-8 text-danger-600">{t('common.errorGeneric')}</p>;
  if (!me.data) return <LoginPage />;

  return (
    <SessionProvider me={me.data}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="academic-years" element={<AcademicYearsPage />} />
          {NAV_ITEMS.filter((i) => i.phase !== undefined).map((i) => (
            <Route key={i.key} path={i.path.slice(1)} element={<ComingSoonPage titleKey={i.key} phase={i.phase!} />} />
          ))}
          <Route path="*" element={<DashboardPage />} />
        </Route>
      </Routes>
    </SessionProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Root />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
