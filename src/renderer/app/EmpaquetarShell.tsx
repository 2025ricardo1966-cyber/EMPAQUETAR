import React, { useEffect } from 'react';
import { classifyPath, decideAccess, homePathForRole, redirectPathForForbidden } from '../foundation/router';
import { useAuth } from './providers/AuthProvider';
import { useHashPath } from './router/useHashPath';
import { AdminLayout, AuthLayout, ClientLayout, PlatformLayout, WorkspaceLayout } from './layouts/layouts';
import { AreaScaffold, LoginPage, PlatformAreaPage, StatusPage, VerifyPage } from './pages/scaffolds';
import { AdminAreaPage, ClientAreaPage } from './pages/area-pages';

/** Cloud/web area scaffolds. Standalone EMPAQUETAR: `#/` is login, not AI Studio. */
export const EmpaquetarShell: React.FC = () => {
  const { path, navigate } = useHashPath();
  const { user, isLoading } = useAuth();
  const { area } = classifyPath(path);
  const decision = decideAccess(area, user?.roleId);

  useEffect(() => {
    if (isLoading) return;
    if (user && area === 'public' && path === '/login') {
      navigate(homePathForRole(user.roleId));
      return;
    }
    if (decision === 'unauthenticated' && area !== 'public' && area !== 'studio' && area !== 'unknown') {
      navigate('/login');
      return;
    }
    if (decision === 'forbidden') {
      navigate(redirectPathForForbidden(area, user?.roleId));
    }
  }, [area, decision, isLoading, navigate, path, user]);

  if (area === 'studio') {
    return <AuthLayout><LoginPage /></AuthLayout>;
  }
  if (isLoading && area !== 'public') return <StatusPage messageKey="app.loading" />;
  if (decision === 'unauthenticated' && area !== 'public') return <StatusPage messageKey="app.loading" />;
  if (decision === 'forbidden') return <StatusPage messageKey="app.loading" />;
  if (area === 'unknown') return <StatusPage messageKey="app.not_found" />;
  if (area === 'public') {
    return <AuthLayout>{path === '/verify' ? <VerifyPage /> : <LoginPage />}</AuthLayout>;
  }
  if (area === 'client') {
    return (
      <ClientLayout>
        <ClientAreaPage />
      </ClientLayout>
    );
  }
  if (area === 'workspace') {
    return (
      <WorkspaceLayout>
        <AreaScaffold titleKey="navigation.workspace" />
      </WorkspaceLayout>
    );
  }
  if (area === 'platform') {
    return (
      <PlatformLayout>
        <PlatformAreaPage />
      </PlatformLayout>
    );
  }
  return (
    <AdminLayout>
      <AdminAreaPage />
    </AdminLayout>
  );
};
