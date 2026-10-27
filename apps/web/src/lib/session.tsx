import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { applyTenantDefaultLocale } from '../i18n';
import { api, ApiRequestError, setActiveTenant, setCsrfToken } from './api';
import type { Me, TenantContextResponse } from './types';

const TENANT_KEY = 'mboka.tenant';

interface Session {
  me: Me;
  tenantId: string | undefined;
  selectTenant: (id: string) => void;
  context: TenantContextResponse | undefined;
  contextError: ApiRequestError | null;
  can: (permission: string) => boolean;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api<Me>('/auth/me');
        setCsrfToken(me.csrfToken);
        return me;
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
  });
}

function readStoredTenant(): string | undefined {
  try {
    return localStorage.getItem(TENANT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function SessionProvider({ me, children }: { me: Me; children: ReactNode }) {
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState<string | undefined>(() => {
    const stored = readStoredTenant();
    return me.tenants.some((t) => t.id === stored) ? stored : me.tenants[0]?.id;
  });

  // Set synchronously during render so the first tenant-scoped request carries the header.
  setActiveTenant(tenantId);

  const contextQuery = useQuery({
    queryKey: ['tenant-context', tenantId],
    queryFn: () => api<TenantContextResponse>('/tenant/context'),
    enabled: Boolean(tenantId),
    retry: (count, e) => !(e instanceof ApiRequestError && e.status < 500) && count < 2,
  });

  useEffect(() => {
    if (contextQuery.data) applyTenantDefaultLocale(contextQuery.data.tenant.defaultLocale);
  }, [contextQuery.data]);

  const value = useMemo<Session>(() => {
    const perms = new Set(contextQuery.data?.permissions ?? []);
    return {
      me,
      tenantId,
      context: contextQuery.data,
      contextError: contextQuery.error instanceof ApiRequestError ? contextQuery.error : null,
      can: (p) => perms.has(p),
      selectTenant: (id) => {
        try {
          localStorage.setItem(TENANT_KEY, id);
        } catch {
          // Non-persistent choice is acceptable.
        }
        // Drop every cached tenant-scoped response before switching (spec §10.3: clear tenant data on context change).
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
        setTenantId(id);
      },
      signOut: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
        setCsrfToken(undefined);
        setActiveTenant(undefined);
        // Drop all school data, then mark the session signed out so the root renders the login page.
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
        qc.setQueryData(['me'], null);
      },
    };
  }, [me, tenantId, contextQuery.data, contextQuery.error, qc]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
