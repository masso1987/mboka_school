import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import './i18n';
import './index.css';
import { AppLayout } from './components/AppLayout';
import { ApiRequestError } from './lib/api';
import { SessionProvider, useMe } from './lib/session';
import { NAV_ITEMS } from './nav';
import { AcademicYearsPage } from './pages/AcademicYearsPage';
import { AccountPage, MfaVerifyPage } from './pages/AccountPage';
import { AdministrationPage } from './pages/AdministrationPage';
import { AttendancePage } from './pages/AttendancePage';
import { ClassDetailPage, ClassesPage } from './pages/ClassesPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { DashboardPage } from './pages/DashboardPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { FeesPage, InvoiceDetailPage, ReceiptPage } from './pages/FeesPage';
import { GradesPage } from './pages/GradesPage';
import { LoginPage } from './pages/LoginPage';
import { ReportCardsPage } from './pages/ReportCardsPage';
import { ReportsPage } from './pages/ReportsPage';
import { CommunityPage } from './pages/CommunityPage';
import { SignupPage, VerifyEmailPage } from './pages/SignupPage';
import { HrPage } from './pages/HrPage';
import { PortalChildPage, PortalPage } from './pages/PortalPage';
import { StudentDetailPage, StudentsPage } from './pages/StudentsPage';
import { TeachingPage } from './pages/TeachingPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // 4xx answers (forbidden, not found, validation) will not change on retry: show them at once.
      retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 2,
    },
  },
});

function Root() {
  const { t } = useTranslation();
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <p className="p-8 text-slate-500">{t('common.loading')}</p>;
  if (me.isError) return <p className="p-8 text-danger-600">{t('common.errorGeneric')}</p>;
  // Sign-up and e-mail confirmation work without a session (and the link must work even when signed in).
  if (location.pathname === '/verify-email') return <VerifyEmailPage />;
  if (!me.data) return location.pathname === '/signup' ? <SignupPage /> : <LoginPage />;
  if (me.data.security?.mfaPending) return <MfaVerifyPage />;
  if (me.data.security?.mfaSetupRequired) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-8">
        <AccountPage mandatory />
      </main>
    );
  }

  return (
    <SessionProvider me={me.data}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="academic-years" element={<AcademicYearsPage />} />
          <Route path="students" element={<StudentsPage />} />
          <Route path="students/:id" element={<StudentDetailPage />} />
          <Route path="classes" element={<ClassesPage />} />
          <Route path="classes/:id" element={<ClassDetailPage />} />
          <Route path="teaching" element={<TeachingPage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="hr" element={<HrPage />} />
          <Route path="community" element={<CommunityPage />} />
          <Route path="portal" element={<PortalPage />} />
          <Route path="portal/children/:id" element={<PortalChildPage />} />
          <Route path="administration" element={<AdministrationPage />} />
          <Route path="fees" element={<FeesPage />} />
          <Route path="fees/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="fees/receipts/:id" element={<ReceiptPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="grades" element={<GradesPage />} />
          <Route path="report-cards" element={<ReportCardsPage />} />
          {NAV_ITEMS.filter((i) => i.phase !== undefined).map((i) => (
            <Route key={i.key} path={i.path.slice(1)} element={<ComingSoonPage titleKey={i.key} phase={i.phase!} />} />
          ))}
          <Route path="*" element={<DashboardPage />} />
        </Route>
      </Routes>
    </SessionProvider>
  );
}

// App-shell service worker (§10.1); not in development, where it would fight hot reload.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
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
