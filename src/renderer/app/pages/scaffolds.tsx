import React, { useEffect, useState } from 'react';
import { apiNoticeKey } from '../../foundation/api-notice';
import { homePathForRole } from '../../foundation/router';
import { useI18n } from '../providers/I18nProvider';
import { useAuth } from '../providers/AuthProvider';
import { useTenant } from '../providers/TenantProvider';
import { useHashPath } from '../router/useHashPath';

export const LoginPage: React.FC = () => <AccessPage />;

export const AccessPage: React.FC = () => {
  const { t } = useI18n();
  const { login, user, api, setTenantId } = useAuth();
  const { path, navigate } = useHashPath();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [workshop, setWorkshop] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mode = path === '/activate' ? 'activate' : path === '/register' ? 'register' : 'login';

  useEffect(() => {
    if (!user) return;
    navigate(homePathForRole(user.roleId));
  }, [navigate, user]);

  useEffect(() => {
    void api
      .get('/public/workshop')
      .then((res) => {
        const data = res.data as { tenantId?: string; name?: string; activated?: boolean };
        if (data.tenantId) setTenantId(data.tenantId);
        if (data.name && !workshop) setWorkshop(data.name);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, setTenantId]);

  const fail = (err: unknown) => setError(t(apiNoticeKey(err)));

  return (
    <section data-role="access">
      <nav>
        <button type="button" onClick={() => navigate('/login')}>
          {t('actions.login')}
        </button>
        <button type="button" onClick={() => navigate('/activate')}>
          {t('access.activate')}
        </button>
        <button type="button" onClick={() => navigate('/register')}>
          {t('access.register')}
        </button>
      </nav>

      {mode === 'login' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            void login(email, password).catch(fail);
          }}
        >
          <h1>{t('actions.login')}</h1>
          <input aria-label="email" placeholder={t('admin.email')} value={email} onChange={(ev) => setEmail(ev.target.value)} />
          <input aria-label="password" type="password" placeholder={t('admin.password')} value={password} onChange={(ev) => setPassword(ev.target.value)} />
          <button type="submit">{t('actions.login')}</button>
        </form>
      ) : null}

      {mode === 'activate' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            void api
              .post('/auth/activate', {
                organizationName: workshop,
                principalLogin: email,
                principalPassword: password,
              })
              .then(async (res) => {
                const data = res.data as { tenant?: { tenantId?: string } };
                if (data.tenant?.tenantId) setTenantId(data.tenant.tenantId);
                await login(email, password);
                try {
                  await api.post('/onboarding/complete-default', {});
                  await api.put('/admin/workshop-catalog/categories/SUBLIMACION', { enabled: true });
                  const items = await api.get('/admin/workshop-catalog/items');
                  const list = Array.isArray(items.data) ? (items.data as Array<{ itemId: string; category?: string; price?: number }>) : [];
                  const first = list.find((i) => i.category === 'SUBLIMACION' && Number(i.price) === 0) || list.find((i) => i.category === 'SUBLIMACION');
                  if (first && Number(first.price) === 0) {
                    await api.put(`/admin/workshop-catalog/items/${first.itemId}`, { price: 1000 });
                  }
                } catch {
                  /* catalog bootstrap is best-effort */
                }
                setNotice(t('access.activated'));
              })
              .catch(fail);
          }}
        >
          <h1>{t('access.activate')}</h1>
          <input aria-label="workshop-name" placeholder={t('access.workshop_name')} value={workshop} onChange={(ev) => setWorkshop(ev.target.value)} />
          <input aria-label="email" placeholder={t('access.admin_email')} value={email} onChange={(ev) => setEmail(ev.target.value)} />
          <input aria-label="password" type="password" placeholder={t('admin.password')} value={password} onChange={(ev) => setPassword(ev.target.value)} />
          <button type="submit">{t('access.activate')}</button>
        </form>
      ) : null}

      {mode === 'register' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            void api
              .get('/public/workshop')
              .then(async (res) => {
                const data = res.data as { tenantId?: string };
                if (data.tenantId) setTenantId(data.tenantId);
                if (!data.tenantId) throw new Error('TENANT_NOT_FOUND');
                await api.post('/client/register', { email, password, name, tenantId: data.tenantId });
                await login(email, password);
                setNotice(t('access.registered'));
              })
              .catch(fail);
          }}
        >
          <h1>{t('access.register')}</h1>
          <input aria-label="name" placeholder={t('access.your_name')} value={name} onChange={(ev) => setName(ev.target.value)} />
          <input aria-label="email" placeholder={t('admin.email')} value={email} onChange={(ev) => setEmail(ev.target.value)} />
          <input aria-label="password" type="password" placeholder={t('admin.password')} value={password} onChange={(ev) => setPassword(ev.target.value)} />
          <button type="submit">{t('access.register')}</button>
        </form>
      ) : null}

      {error ? <p>{error}</p> : null}
      {notice ? <p>{notice}</p> : null}
    </section>
  );
};

export const VerifyPage: React.FC = () => {
  const { t } = useI18n();
  return <p>{t('navigation.verify')}</p>;
};

export const AreaScaffold: React.FC<{ titleKey: string }> = ({ titleKey }) => {
  const { t } = useI18n();
  const { user, logout } = useAuth();
  const { tenant } = useTenant();
  const { navigate } = useHashPath();
  return (
    <section>
      <h1>{t(titleKey)}</h1>
      <p>{user?.roleId}</p>
      <p>{tenant?.currency || ''}</p>
      <button
        type="button"
        onClick={() => {
          void logout().then(() => navigate('/login'));
        }}
      >
        {t('actions.logout')}
      </button>
    </section>
  );
};

export const StatusPage: React.FC<{ messageKey: string }> = ({ messageKey }) => {
  const { t } = useI18n();
  return <p>{t(messageKey)}</p>;
};

export const PlatformAreaPage: React.FC = () => {
  const { t } = useI18n();
  const { user, logout, api } = useAuth();
  const { tenant } = useTenant();
  const { navigate } = useHashPath();
  const [policy, setPolicy] = useState({
    autoBlockEnabled: true,
    windowMinutes: 15,
    blockMinutes: 15,
    volumeThreshold: 200,
    enumThreshold: 8,
    exemptUserIds: [] as string[],
    exemptTenantIds: [] as string[],
  });
  const [incidents, setIncidents] = useState<Array<{ id: string; nivel_riesgo?: string; tenant_id?: string; evento?: string; fecha_hora?: number }>>([]);
  const [blocks, setBlocks] = useState<Array<{ id: string; subjectId: string; until: number; riskLevel: string }>>([]);
  const [level, setLevel] = useState('');
  const [phone, setPhone] = useState('');
  const [alerts, setAlerts] = useState('CRITICAL_ONLY');
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    void api.get('/platform/security/config').then((res) => setPolicy({ ...policy, ...(res.data as typeof policy) }));
    const q = level ? `?level=${level}` : '';
    void api.get(`/platform/security/incidents${q}`).then((res) => setIncidents(Array.isArray(res.data) ? (res.data as typeof incidents) : []));
    void api.get('/platform/security/blocks').then((res) => setBlocks(Array.isArray(res.data) ? (res.data as typeof blocks) : []));
    void api.get('/platform/security/whatsapp').then((res) => {
      const data = res.data as { whatsappNumber?: string; whatsappAlerts?: string };
      setPhone(data.whatsappNumber || '');
      setAlerts(data.whatsappAlerts || 'CRITICAL_ONLY');
    });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, level]);

  return (
    <section>
      <h1>{t('navigation.platform')}</h1>
      <p>{user?.roleId}</p>
      <p>{tenant?.currency || ''}</p>
      <h2>{t('security.title')}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void api.put('/platform/security/config', policy).then(() => setNotice(t('client.saved')));
        }}
      >
        <label>
          {t('security.protection')}
          <select
            aria-label="auto-block"
            value={policy.autoBlockEnabled ? 'on' : 'off'}
            onChange={(e) => setPolicy({ ...policy, autoBlockEnabled: e.target.value === 'on' })}
          >
            <option value="on">{t('security.on')}</option>
            <option value="off">{t('security.off')}</option>
          </select>
        </label>
        <input aria-label="window-minutes" type="number" value={policy.windowMinutes} onChange={(e) => setPolicy({ ...policy, windowMinutes: Number(e.target.value) })} />
        <select aria-label="block-minutes" value={String(policy.blockMinutes)} onChange={(e) => setPolicy({ ...policy, blockMinutes: Number(e.target.value) })}>
          {[5, 15, 30, 60, 360, 1440].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button type="submit">{t('actions.save')}</button>
      </form>
      <h2>{t('security.whatsapp')}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void api.put('/platform/security/whatsapp', { whatsappNumber: phone, whatsappAlerts: alerts }).then(() => setNotice(t('client.saved')));
        }}
      >
        <input aria-label="whatsapp-number" placeholder={t('security.whatsapp_number')} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <select aria-label="whatsapp-alerts" value={alerts} onChange={(e) => setAlerts(e.target.value)}>
          <option value="CRITICAL_ONLY">{t('security.CRITICAL_ONLY')}</option>
          <option value="ALL">{t('security.ALL')}</option>
          <option value="NONE">{t('security.NONE')}</option>
        </select>
        <button type="submit">{t('actions.save')}</button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void api.post('/platform/security/whatsapp/verify', { code }).then(() => setNotice(t('client.saved')));
        }}
      >
        <input aria-label="whatsapp-code" placeholder={t('security.verify_code')} value={code} onChange={(e) => setCode(e.target.value)} />
        <button type="submit">{t('security.verify')}</button>
      </form>
      <h2>{t('security.incidents')}</h2>
      <select aria-label="filter-level" value={level} onChange={(e) => setLevel(e.target.value)}>
        <option value="">{t('actions.all')}</option>
        {['RIESGO_1', 'RIESGO_2', 'RIESGO_3', 'RIESGO_4'].map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <ul>
        {incidents.map((i) => (
          <li key={i.id}>
            {i.nivel_riesgo} {i.evento} {i.tenant_id} {i.fecha_hora ? new Date(i.fecha_hora).toISOString() : ''}
          </li>
        ))}
      </ul>
      <h2>{t('security.blocks')}</h2>
      <ul>
        {blocks.map((b) => (
          <li key={b.id}>
            {b.subjectId} {b.riskLevel}
            <button
              type="button"
              onClick={() => {
                void api.post(`/platform/security/blocks/${b.id}/unlock`, {}).then(() => load());
              }}
            >
              {t('security.unlock')}
            </button>
          </li>
        ))}
      </ul>
      {notice ? <p>{notice}</p> : null}
      <button
        type="button"
        onClick={() => {
          void logout().then(() => navigate('/login'));
        }}
      >
        {t('actions.logout')}
      </button>
    </section>
  );
};
