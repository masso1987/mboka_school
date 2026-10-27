/** Response shapes of the endpoints the web app consumes. */

export interface TenantSummary {
  id: string;
  slug: string;
  legalName: string;
  tradingName: string | null;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  defaultLocale: string;
}

export interface Me {
  user: { id: string; email: string; fullName: string; locale: string | null; platformRole: string };
  tenants: TenantSummary[];
  csrfToken: string;
}

export interface TenantContextResponse {
  tenant: {
    id: string;
    slug: string;
    legalName: string;
    tradingName: string | null;
    defaultLocale: string;
    timezone: string;
    defaultCurrency: string;
    campuses: { id: string; code: string; name: string }[];
  };
  roles: { key: string; nameFr: string; nameEn: string }[];
  permissions: string[];
}

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
}
