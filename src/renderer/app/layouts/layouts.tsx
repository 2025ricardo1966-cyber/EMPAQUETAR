import React from 'react';
import { useI18n } from '../providers/I18nProvider';

export const ShellLayout: React.FC<{ titleKey: string; children?: React.ReactNode }> = ({ titleKey, children }) => {
  const { t } = useI18n();
  return (
    <div data-layout={titleKey} style={{ height: '100%', overflow: 'auto' }}>
      <header>
        <strong>{t(titleKey)}</strong>
      </header>
      <main>{children}</main>
    </div>
  );
};

export const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ShellLayout titleKey="navigation.login">{children}</ShellLayout>
);
export const ClientLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ShellLayout titleKey="navigation.client">{children}</ShellLayout>
);
export const WorkspaceLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ShellLayout titleKey="navigation.workspace">{children}</ShellLayout>
);
export const AdminLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ShellLayout titleKey="navigation.admin">{children}</ShellLayout>
);
export const PlatformLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ShellLayout titleKey="navigation.platform">{children}</ShellLayout>
);
export const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
