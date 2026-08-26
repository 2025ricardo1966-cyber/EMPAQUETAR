import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { mapCapabilities, mapTenant, type TenantSnapshot } from '../../foundation/tenant';
import { useAuth } from './AuthProvider';
import { isForbidden } from '../../foundation/api-error';

type TenantValue = {
  tenant: TenantSnapshot | null;
  isLoading: boolean;
};

const TenantContext = createContext<TenantValue | null>(null);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated, isLoading: authLoading, api } = useAuth();
  const [tenant, setTenant] = useState<TenantSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated || !user || user.roleId === 'SUPER_ADMIN') {
      setTenant(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    void (async () => {
      try {
        if (user.roleId === 'CUSTOMER') {
          const caps = await api.get('/client/fulfillment-options');
          let currency: string | undefined;
          let defaultLanguage: string | undefined;
          try {
            const cfg = await api.get('/tenant/config');
            const row = cfg.data as Record<string, unknown>;
            currency = row.currency ? String(row.currency) : undefined;
            defaultLanguage = row.defaultLanguage ? String(row.defaultLanguage) : undefined;
          } catch {
            /* optional */
          }
          if (!cancelled) {
            setTenant({
              tenantId: user.tenantId,
              capabilities: mapCapabilities(caps.data),
              currency,
              defaultLanguage,
            });
          }
          return;
        }
        const me = await api.get('/tenants/me');
        let capabilities = mapCapabilities((me.data as { clientOptions?: unknown } | undefined)?.clientOptions);
        try {
          const caps = await api.get('/admin/config/client-options');
          capabilities = mapCapabilities(caps.data);
        } catch (error) {
          if (!isForbidden(error)) throw error;
        }
        if (!cancelled) setTenant(mapTenant(me.data, capabilities));
      } catch {
        if (!cancelled) setTenant(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, authLoading, isAuthenticated, user]);

  const value = useMemo(() => ({ tenant, isLoading }), [tenant, isLoading]);
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export function useTenant(): TenantValue {
  const ctx = useContext(TenantContext);
  if (!ctx) return { tenant: null, isLoading: false };
  return ctx;
}
