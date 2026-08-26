import React, { useEffect, useState } from 'react';
import { apiNoticeKey } from '../../foundation/api-notice';
import { homePathForRole } from '../../foundation/router';
import { useI18n } from '../providers/I18nProvider';
import { useAuth } from '../providers/AuthProvider';
import { useTenant } from '../providers/TenantProvider';
import { useHashPath } from '../router/useHashPath';

export const LoginPage: React.FC = () => {
  const { t } = useI18n();
  const { login, user } = useAuth();
  const { navigate } = useHashPath();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    navigate(homePathForRole(user.roleId));
  }, [navigate, user]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void login(email, password).catch((err) => {
          console.log('[AUTH DEBUG] login error:', err);
          setError(t(apiNoticeKey(err)));
        });
      }}
    >
      <h1>{t('actions.login')}</h1>
      <input aria-label="email" value={email} onChange={(ev) => setEmail(ev.target.value)} />
      <input aria-label="password" type="password" value={password} onChange={(ev) => setPassword(ev.target.value)} />
      <button type="submit">{t('actions.login')}</button>
      {error ? <p>{error}</p> : null}
    </form>
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
