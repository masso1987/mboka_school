import { StrictMode, useState } from 'react';
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
import { LegalPage } from './pages/LegalPage';
import { LoginPage } from './pages/LoginPage';
import { MaintenanceBanner, MaintenanceScreen, useAnalytics, useBranding, usePublicStatus } from './lib/platform-status';
import { PlatformPage } from './pages/PlatformPage';
import { PlatformAdminsPage } from './pages/platform/AdminsPage';
import { PlatformAuditPage } from './pages/platform/AuditPage';
import { PlatformBackupsPage } from './pages/platform/BackupsPage';
import { PlatformDemosPage } from './pages/platform/DemosPage';
import { PlatformLoginsPage } from './pages/platform/LoginsPage';
import { PlatformUsersPage } from './pages/platform/UsersPage';
import { PlatformSystemPage } from './pages/platform/SystemPage';
import { PlatformLegalPage, PlatformMaintenancePage, PlatformMessagesPage, PlatformSettingsPage } from './pages/platform/SettingsPages';
import { PlatformHomePage } from './pages/platform/HomePage';
import { PlatformSchoolDetailPage } from './pages/platform/SchoolDetailPage';
import { PlatformSchoolsPage } from './pages/platform/SchoolsPage';
import { ForgotPasswordPage, SetPasswordPage } from './pages/PasswordPages';
import { ReportCardsPage } from './pages/ReportCardsPage';
import { CompetencesPage } from './pages/CompetencesPage';
import { BookListsPage } from './pages/BookListsPage';
import { PromotionPage } from './pages/PromotionPage';
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
  useBranding();
  useAnalytics();
  return (
    <>
      <MaintenanceBanner />
      <Screens />
    </>
  );
}

function Screens() {
  const { t } = useTranslation();
  const me = useMe();
  const location = useLocation();
  const status = usePublicStatus();
  const [adminSignIn, setAdminSignIn] = useState(false);
  // Legal documents are public and readable from anywhere, signed in or not.
  if (location.pathname.startsWith('/legal/')) {
    return (
      <Routes>
        <Route path="/legal/:kind" element={<LegalPage />} />
      </Routes>
    );
  }
  if (me.isPending) return <p className="p-8 text-slate-500">{t('common.loading')}</p>;
  // During maintenance only super administrators get in; they reach the sign-in form from the notice.
  if (status.data?.maintenance.active && me.data?.user.platformRole !== 'SUPER_ADMIN' && !(adminSignIn && !me.data)) {
    return <MaintenanceScreen onAdminSignIn={me.data ? undefined : () => setAdminSignIn(true)} />;
  }
  if (me.isError) return <p className="p-8 text-danger-600">{t('common.errorGeneric')}</p>;
  // Sign-up, e-mail confirmation and password links work without a session (and links must work even when signed in).
  if (location.pathname === '/verify-email') return <VerifyEmailPage />;
  if (location.pathname === '/reset-password') return <SetPasswordPage mode="reset" />;
  if (location.pathname === '/accept-invitation') return <SetPasswordPage mode="invitation" />;
  if (!me.data) {
    if (location.pathname === '/signup') return <SignupPage />;
    return location.pathname === '/forgot-password' ? <ForgotPasswordPage /> : <LoginPage />;
  }
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
          <Route path="competences" element={<CompetencesPage />} />
          <Route path="book-lists" element={<BookListsPage />} />
          <Route path="promotion" element={<PromotionPage />} />
          <Route path="report-cards" element={<ReportCardsPage />} />
          <Route path="platform" element={<PlatformHomePage />} />
          <Route path="platform/schools" element={<PlatformSchoolsPage />} />
          <Route path="platform/schools/:id" element={<PlatformSchoolDetailPage />} />
          <Route path="platform/demos" element={<PlatformDemosPage />} />
          <Route path="platform/billing" element={<PlatformPage />} />
          <Route path="platform/admins" element={<PlatformAdminsPage />} />
          <Route path="platform/users" element={<PlatformUsersPage />} />
          <Route path="platform/logins" element={<PlatformLoginsPage />} />
          <Route path="platform/audit" element={<PlatformAuditPage />} />
          <Route path="platform/messages" element={<PlatformMessagesPage />} />
          <Route path="platform/legal" element={<PlatformLegalPage />} />
          <Route path="platform/maintenance" element={<PlatformMaintenancePage />} />
          <Route path="platform/settings" element={<PlatformSettingsPage />} />
          <Route path="platform/system" element={<PlatformSystemPage />} />
          <Route path="platform/backups" element={<PlatformBackupsPage />} />
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
