import React from 'react';
import { I18nProvider } from './I18nProvider';
import { AuthProvider } from './AuthProvider';
import { TenantProvider } from './TenantProvider';

export const AppProviders: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <I18nProvider>
    <AuthProvider>
      <TenantProvider>{children}</TenantProvider>
    </AuthProvider>
  </I18nProvider>
);
