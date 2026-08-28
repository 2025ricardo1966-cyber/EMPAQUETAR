import React, { useCallback, useEffect, useState } from 'react';
import { apiNoticeKey } from '../../foundation/api-notice';
import { nextOperationalStatuses, operationalOf } from '../../foundation/ops-status';
import { useAuth } from '../providers/AuthProvider';
import { useI18n } from '../providers/I18nProvider';
import { useTenant } from '../providers/TenantProvider';
import { useHashPath } from '../router/useHashPath';
import { ClientOrderFlow } from './ClientOrderFlow';
import { OrderOpsPanel } from './OrderOpsPanel';

function fileToBase64(file: File): Promise<{ name: string; mime: string; content: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || '');
      const content = raw.includes(',') ? raw.split(',')[1] : raw;
      resolve({ name: file.name, mime: file.type || 'application/octet-stream', content });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const CATEGORIES = [
  'CONSULTA',
  'SUGERENCIA',
  'RECLAMO',
  'SOPORTE',
  'PEDIDO',
  'PAGO_DEUDA',
  'ERROR',
  'COMERCIAL',
  'NUEVA_FUNCIONALIDAD',
  'OTRO',
];

const STATUSES = ['NEW', 'IN_REVIEW', 'RESPONDED', 'WAITING_CLIENT', 'RESOLVED'];
const CONTEXT_KINDS = ['ORDER', 'PAYMENT', 'REQUEST', 'COMMERCIAL'];
const WORKSHOP_CATS = ['SUBLIMACION', 'DTF_TEXTIL', 'UV_DTF', 'BORDADO', 'GRAN_FORMATO', 'TPU', 'OTRO'];
const MEMBERSHIP_STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'EXPIRED'];
const OPS_STATUSES = ['PENDIENTE', 'EN_PRODUCCION', 'LISTO', 'ENTREGADO', 'CANCELADO'];

type Profile = {
  preferredLanguage?: string;
  country?: string;
  region?: string;
  city?: string;
  postalCode?: string;
  phone?: string;
  address?: string;
};

type Thread = {
  id: string;
  subject: string;
  status: string;
  statusLabel?: string;
  category?: string;
  categoryLabel?: string;
  orderId?: string | null;
  context?: { kind?: string; ref?: string } | null;
};

type CatalogItem = {
  itemId: string;
  category: string;
  name: string;
  description?: string;
  price: number;
  unit: string;
  currency?: string;
  stockEnabled?: boolean;
};

type ClientOrder = {
  id?: string;
  orderId?: string;
  number?: string;
  projectName?: string;
  operationalStatus?: string;
  statusLabel?: string;
  flowStatusLabel?: string;
  date?: number;
  createdAt?: number;
};

export const ClientAreaPage: React.FC = () => {
  const { t, setLanguage } = useI18n();
  const { user, logout, api } = useAuth();
  const { tenant } = useTenant();
  const { path, navigate } = useHashPath();
  const [profile, setProfile] = useState<Profile>({});
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('CONSULTA');
  const [contextKind, setContextKind] = useState('ORDER');
  const [contextRef, setContextRef] = useState('');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [openId, setOpenId] = useState('');
  const [history, setHistory] = useState<Array<{ content: string; authorRole: string; createdAt?: string }>>([]);
  const [notice, setNotice] = useState('');
  const [membership, setMembership] = useState<{ status?: string; expiresAt?: number; planId?: string } | null>(null);
  const [membershipError, setMembershipError] = useState('');
  const [orders, setOrders] = useState<ClientOrder[]>([]);
  const [orderTotal, setOrderTotal] = useState(0);
  const [notifications, setNotifications] = useState<Array<{ notificationId?: string; title?: string; customerMessage?: string; read?: boolean }>>([]);
  const [panel, setPanel] = useState<'catalog' | 'follow' | 'inbox' | 'profile'>('catalog');
  const [detail, setDetail] = useState<{
    number?: string;
    projectName?: string;
    notes?: string;
    operationalStatus?: string;
    flowStatusLabel?: string;
    total?: number;
    payment?: { amountDue?: number; amountPaid?: number; remaining?: number; remainingBalance?: number; meetsRequired?: boolean; settled?: boolean };
    commercialTerms?: { frozen?: boolean; validUntilLabel?: string; agreedAmount?: number; remainingAmount?: number; history?: unknown[] };
    formData?: { workshopLines?: Array<{ name?: string; quantity?: number; unit?: string; price?: number }> };
    statusHistory?: Array<{ operationalTo?: string; atIso?: string }>;
  } | null>(null);

  const orderIdFromPath = path.startsWith('/client/orders/') ? path.slice('/client/orders/'.length) : '';
  const restricted = membership?.status === 'SUSPENDED' || membership?.status === 'EXPIRED';

  const loadThreads = useCallback(() => {
    void api
      .get('/client/messages')
      .then((res) => {
        const data = res.data as { items?: Thread[] } | Thread[];
        setThreads(Array.isArray(data) ? data : data.items || []);
      })
      .catch(() => undefined);
  }, [api]);

  const loadOrders = useCallback(() => {
    void api
      .get('/client/orders')
      .then((res) => {
        const data = res.data as { items?: ClientOrder[]; total?: number };
        setOrders(data.items || []);
        setOrderTotal(data.total || (data.items || []).length);
      })
      .catch(() => undefined);
  }, [api]);

  useEffect(() => {
    void api
      .get('/client/profile')
      .then((res) => {
        const next = (res.data as Profile) || {};
        setProfile(next);
        if (next.preferredLanguage) setLanguage(next.preferredLanguage);
      })
      .catch(() => undefined);
    void api
      .get('/client/membership')
      .then((res) => {
        setMembership((res.data as { status?: string; expiresAt?: number }) || null);
        setMembershipError('');
      })
      .catch((err) => {
        setMembership(null);
        setMembershipError(t(apiNoticeKey(err)));
      });
    loadOrders();
    void api
      .get('/client/notifications')
      .then((res) => {
        const data = res.data as { items?: typeof notifications };
        setNotifications(data.items || []);
      })
      .catch(() => undefined);
    loadThreads();
  }, [api, loadOrders, loadThreads, setLanguage, t]);

  useEffect(() => {
    if (!orderIdFromPath) {
      setDetail(null);
      return;
    }
    void api
      .get(`/client/orders/${orderIdFromPath}`)
      .then((res) => setDetail(res.data as typeof detail))
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  }, [api, orderIdFromPath, t]);

  const logoutBtn = (
    <button
      type="button"
      onClick={() => {
        void logout().then(() => navigate('/login'));
      }}
    >
      {t('actions.logout')}
    </button>
  );

  if (orderIdFromPath) {
    return (
      <section>
        <h1>{t('client.order_detail')}</h1>
        <button type="button" onClick={() => navigate('/client')}>
          {t('actions.back')}
        </button>
        {detail ? (
          <>
            <p>{detail.number}</p>
            <p>{detail.projectName || ''}</p>
            <p>{detail.flowStatusLabel || (detail.operationalStatus ? t(`ops_order.${detail.operationalStatus}`) : '')}</p>
            <p>{t('client.notes')}: {detail.notes || ''}</p>
            {detail.payment ? (
              <p>
                {detail.payment.meetsRequired && Number(detail.payment.remaining || 0) > 0 ? t('flow.pay_balance') : t('flow.pay_50')}: {detail.payment.amountDue} · {t('flow.paid')}: {detail.payment.amountPaid} · {t('flow.pending')}: {detail.payment.remaining}
              </p>
            ) : null}
            {detail.payment && Number(detail.payment.remaining || 0) > 0 ? (
              <label>
                {t('flow.voucher')}
                <input
                  aria-label="voucher-file"
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file || !orderIdFromPath) return;
                    void fileToBase64(file)
                      .then((payload) =>
                        api.post(`/client/orders/${orderIdFromPath}/payment/voucher`, {
                          filename: payload.name,
                          mimeType: payload.mime,
                          contentBase64: payload.content,
                        })
                      )
                      .then((res) => {
                        setDetail(res.data as typeof detail);
                        setNotice(t('client.saved'));
                      })
                      .catch((err) => setNotice(t(apiNoticeKey(err))));
                  }}
                />
              </label>
            ) : null}
            {detail.commercialTerms?.frozen ? (
              <p>
                {t('flow.price_until').replace('{{date}}', detail.commercialTerms.validUntilLabel || '')} {detail.commercialTerms.agreedAmount}
              </p>
            ) : null}
            <h2>{t('client.order_items')}</h2>
            <ul>
              {(detail.formData?.workshopLines || []).map((line, i) => (
                <li key={`${line.name}-${i}`}>
                  {line.name} {line.quantity} {line.unit} {line.price}
                </li>
              ))}
            </ul>
            <h2>{t('client.order_history')}</h2>
            <ul>
              {(detail.statusHistory || []).map((h, i) => (
                <li key={`${h.atIso}-${i}`}>
                  {h.operationalTo ? t(`ops_order.${h.operationalTo}`) : ''} {h.atIso}
                </li>
              ))}
            </ul>
            <OrderOpsPanel orderId={orderIdFromPath} files={(detail as { files?: Array<{ id?: string; filename?: string; mimeType?: string; status?: string; sizeBytes?: number }> }).files} outputs={(detail as { outputs?: Array<{ id?: string; filename?: string; format?: string }> }).outputs} fileBase="client" />
          </>
        ) : (
          <p>{t('app.loading')}</p>
        )}
        {notice ? <p>{notice}</p> : null}
        {logoutBtn}
      </section>
    );
  }

  return (
    <section data-pilot="client">
      <h1>{t('navigation.client')}</h1>
      <p>{user?.roleId}</p>
      <p>{tenant?.currency || ''}</p>
      {restricted ? (
        <p role="alert">{membership?.status === 'SUSPENDED' ? t('errors.membership_suspended') : t('errors.membership_expired')}</p>
      ) : null}
      {membershipError ? <p role="alert">{membershipError}</p> : null}
      <nav>
        <button type="button" onClick={() => setPanel('catalog')}>
          {t('client.catalog')}
        </button>
        <button type="button" onClick={() => setPanel('follow')}>
          {t('client.orders')}
        </button>
        <button type="button" onClick={() => setPanel('inbox')}>
          {t('client.messages')}
        </button>
        <button type="button" onClick={() => setPanel('profile')}>
          {t('client.profile')}
        </button>
      </nav>
      <p>
        {membership?.status ? t(`membership.${membership.status}`) : membershipError || t('errors.membership_required')}
        {membership?.expiresAt ? ` — ${t('client.membership_expires')}: ${new Date(membership.expiresAt).toISOString()}` : ''}
      </p>
      {membership?.status === 'TRIAL' ? <p>{t('client.trial_usage', { used: orderTotal })}</p> : null}

      {panel === 'catalog' ? (
        <ClientOrderFlow
          restricted={restricted}
          onCreated={() => {
            loadOrders();
          }}
        />
      ) : null}

      {panel === 'follow' ? (
        <div>
          <button type="button" onClick={() => setPanel('catalog')}>
            {t('flow.add_another')}
          </button>
          <h2>{t('client.orders')}</h2>
          <ul>
            {orders.map((o) => {
              const id = o.id || o.orderId || '';
              return (
                <li key={id}>
                  <button type="button" onClick={() => navigate(`/client/orders/${id}`)}>
                    {o.projectName || o.number} {o.flowStatusLabel || (o.operationalStatus ? t(`ops_order.${o.operationalStatus}`) : o.statusLabel)}{' '}
                    {o.createdAt || o.date ? new Date(Number(o.createdAt || o.date)).toISOString() : ''}
                  </button>
                </li>
              );
            })}
          </ul>
          <h2>{t('client.notifications')}</h2>
          <ul>
            {notifications.map((n, i) => (
              <li key={n.notificationId || String(i)}>{n.customerMessage || n.title || ''}</li>
            ))}
          </ul>
          <h2>{t('pilot.requests')}</h2>
          <ul>
            {threads
              .filter((th) => th.category === 'PEDIDO' || th.context?.kind === 'REQUEST')
              .map((th) => (
                <li key={th.id}>
                  {th.subject} {th.statusLabel || th.status} {th.context?.kind || ''} {th.orderId || ''}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {panel === 'inbox' ? (
        <div>
          <h2>{t('client.messages')}</h2>
          {restricted ? <p>{t('client.restricted')}</p> : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (restricted) {
                setNotice(membership?.status === 'SUSPENDED' ? t('errors.membership_suspended') : t('errors.membership_expired'));
                return;
              }
              void api
                .post('/client/messages', {
                  subject,
                  content,
                  category,
                  context: { kind: contextKind, ref: contextRef || undefined },
                })
                .then(() => {
                  setNotice(t('client.sent'));
                  setSubject('');
                  setContent('');
                  loadThreads();
                })
                .catch((err) => setNotice(t(apiNoticeKey(err))));
            }}
          >
            <select aria-label="category" value={category} onChange={(e) => setCategory(e.target.value)} disabled={restricted}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`messages.categories.${c}`)}
                </option>
              ))}
            </select>
            <select aria-label="context-kind" value={contextKind} onChange={(e) => setContextKind(e.target.value)} disabled={restricted}>
              {CONTEXT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`context.${k}`)}
                </option>
              ))}
            </select>
            <input aria-label="subject" placeholder={t('client.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={restricted} />
            <textarea aria-label="message" placeholder={t('client.body')} value={content} onChange={(e) => setContent(e.target.value)} disabled={restricted} />
            <input aria-label="context-ref" placeholder={t('client.context_ref')} value={contextRef} onChange={(e) => setContextRef(e.target.value)} disabled={restricted} />
            <button type="submit" disabled={restricted}>
              {t('actions.send')}
            </button>
          </form>
          <h2>{t('client.history')}</h2>
          <ul>
            {threads.map((th) => (
              <li key={th.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(th.id);
                    void api.get(`/client/messages/${th.id}`).then((res) => {
                      const data = res.data as { entries?: Array<{ content: string; authorRole: string; createdAt?: string }> };
                      setHistory(data.entries || []);
                    });
                  }}
                >
                  {th.subject} {th.statusLabel || th.status} {th.categoryLabel || th.category} {th.context?.kind || ''} {th.orderId || ''}
                </button>
              </li>
            ))}
          </ul>
          {openId ? (
            <ul aria-label="thread-history">
              {history.map((e, i) => (
                <li key={`${openId}-${i}`}>
                  {e.authorRole}: {e.content} {e.createdAt || ''}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {panel === 'profile' ? (
        <div>
          <h2>{t('client.profile')}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void api
                .put('/client/profile', profile)
                .then(() => {
                  setNotice(t('client.saved'));
                  if (profile.preferredLanguage) setLanguage(profile.preferredLanguage);
                })
                .catch((err) => setNotice(t(apiNoticeKey(err))));
            }}
          >
            <input aria-label="phone" placeholder={t('client.phone')} value={profile.phone || ''} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
            <input aria-label="country" placeholder={t('client.country')} value={profile.country || ''} onChange={(e) => setProfile({ ...profile, country: e.target.value })} />
            <input aria-label="region" placeholder={t('client.region')} value={profile.region || ''} onChange={(e) => setProfile({ ...profile, region: e.target.value })} />
            <input aria-label="city" placeholder={t('client.city')} value={profile.city || ''} onChange={(e) => setProfile({ ...profile, city: e.target.value })} />
            <input aria-label="postalCode" placeholder={t('client.postalCode')} value={profile.postalCode || ''} onChange={(e) => setProfile({ ...profile, postalCode: e.target.value })} />
            <input aria-label="address" placeholder={t('client.address')} value={profile.address || ''} onChange={(e) => setProfile({ ...profile, address: e.target.value })} />
            <input
              aria-label="preferredLanguage"
              placeholder={t('client.language')}
              value={profile.preferredLanguage || ''}
              onChange={(e) => setProfile({ ...profile, preferredLanguage: e.target.value })}
            />
            <button type="submit">{t('actions.save')}</button>
          </form>
          <h2>{t('client.membership')}</h2>
          <p>{membership?.status ? t(`membership.${membership.status}`) : membershipError || t('errors.membership_required')}</p>
        </div>
      ) : null}

      {notice ? <p>{notice}</p> : null}
      {logoutBtn}
    </section>
  );
};

export const AdminAreaPage: React.FC = () => {
  const { t } = useI18n();
  const { user, logout, api } = useAuth();
  const { tenant } = useTenant();
  const { path, navigate } = useHashPath();
  const [rows, setRows] = useState<
    Array<{
      id: string;
      subject: string;
      category: string;
      status: string;
      customerName?: string;
      customerId: string;
      customerCountry?: string | null;
      orderId?: string | null;
      context?: { kind?: string; ref?: string } | null;
    }>
  >([]);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState('');
  const [thread, setThread] = useState<{
    orderId?: string | null;
    context?: { kind?: string; ref?: string } | null;
    entries?: Array<{ content: string; authorRole: string; createdAt?: string }>;
  } | null>(null);
  const [reply, setReply] = useState('');
  const [evalStatus, setEvalStatus] = useState('REVIEWED');
  const [classifyTo, setClassifyTo] = useState('CONSULTA');
  const [market, setMarket] = useState('');
  const [currency, setCurrency] = useState('');
  const [language, setLanguage] = useState('');
  const [customers, setCustomers] = useState<
    Array<{ id: string; displayName?: string; membershipStatus?: string | null; email?: string }>
  >([]);
  const [membershipFilter, setMembershipFilter] = useState('');
  const [recentOnly, setRecentOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [newLang, setNewLang] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newMembership, setNewMembership] = useState('TRIAL');
  const [wsCats, setWsCats] = useState<Array<{ id: string; enabled: boolean }>>([]);
  const [wsItems, setWsItems] = useState<CatalogItem[]>([]);
  const [itemName, setItemName] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemUnit, setItemUnit] = useState('');
  const [itemCat, setItemCat] = useState('SUBLIMACION');
  const [editItemId, setEditItemId] = useState('');
  const [opsOrders, setOpsOrders] = useState<
    Array<{ orderId: string; customerId?: string; displayNumber?: string; status: string; createdAt?: number; projectName?: string; totalCustomerAmount?: number; formValues?: { notes?: string; projectName?: string } }>
  >([]);
  const [opsFilter, setOpsFilter] = useState('');
  const [orderCustomer, setOrderCustomer] = useState('');
  const [orderItem, setOrderItem] = useState('');
  const [orderQty, setOrderQty] = useState('1');
  const [orderNotes, setOrderNotes] = useState('');
  const [msgStats, setMsgStats] = useState<{ total?: number; byStatus?: Record<string, number> }>({});
  const [openOrderId, setOpenOrderId] = useState('');
  const [pricePrompt, setPricePrompt] = useState<{ prompt?: string; required?: boolean } | null>(null);
  const [openPay, setOpenPay] = useState<{ remainingBalance?: number; remaining?: number; settled?: boolean } | null>(null);
  const [fiche, setFiche] = useState<{
    displayName?: string;
    email?: string;
    phone?: string;
    country?: string;
    region?: string;
    preferredLanguage?: string;
    membership?: { status?: string; expiresAt?: number };
    orders?: Array<{ id: string; number?: string; operationalStatus?: string; createdAt?: string }>;
    communications?: Array<{ subject?: string; content?: string; createdAtIso?: string; authorRole?: string }>;
  } | null>(null);

  const customerIdFromPath = path.startsWith('/admin/customers/') ? path.slice('/admin/customers/'.length) : '';

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    const qs = params.toString();
    void api
      .get(`/admin/messages${qs ? `?${qs}` : ''}`)
      .then((res) => setRows(Array.isArray(res.data) ? (res.data as typeof rows) : []))
      .catch(() => undefined);
  }, [api, category, q, status]);

  const loadCustomers = useCallback(() => {
    const params = new URLSearchParams();
    if (membershipFilter) params.set('membershipStatus', membershipFilter);
    if (recentOnly) params.set('recent', '1');
    const qs = params.toString();
    void api
      .get(`/admin/customers${qs ? `?${qs}` : ''}`)
      .then((res) => setCustomers(Array.isArray(res.data) ? (res.data as typeof customers) : []))
      .catch(() => undefined);
  }, [api, membershipFilter, recentOnly]);

  const loadCatalog = useCallback(() => {
    void api
      .get('/admin/workshop-catalog/categories')
      .then((res) => setWsCats(Array.isArray(res.data) ? (res.data as typeof wsCats) : []))
      .catch(() => undefined);
    void api
      .get('/admin/workshop-catalog/items')
      .then((res) => setWsItems(Array.isArray(res.data) ? (res.data as CatalogItem[]) : []))
      .catch(() => undefined);
  }, [api]);

  const loadOrders = useCallback(() => {
    void api
      .get('/orders')
      .then((res) => setOpsOrders(Array.isArray(res.data) ? (res.data as typeof opsOrders) : []))
      .catch(() => undefined);
  }, [api]);

  useEffect(() => {
    load();
    loadCustomers();
    loadCatalog();
    loadOrders();
    void api
      .get('/admin/messages/stats')
      .then((res) => setMsgStats((res.data as typeof msgStats) || {}))
      .catch(() => undefined);
    void api
      .get('/admin/config/commercial')
      .then((res) => {
        const data = res.data as { defaultMarket?: string; defaultCurrency?: string; defaultLanguage?: string };
        setMarket(data.defaultMarket || '');
        setCurrency(data.defaultCurrency || '');
        setLanguage(data.defaultLanguage || '');
      })
      .catch(() => undefined);
  }, [api, load, loadCatalog, loadCustomers, loadOrders]);

  useEffect(() => {
    if (!customerIdFromPath) {
      setFiche(null);
      return;
    }
    void api
      .get(`/admin/customers/${customerIdFromPath}`)
      .then((res) => setFiche(res.data as typeof fiche))
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  }, [api, customerIdFromPath, t]);

  useEffect(() => {
    if (!selected) {
      setThread(null);
      return;
    }
    void api
      .get(`/admin/messages/${selected}`)
      .then((res) => setThread(res.data as typeof thread))
      .catch(() => undefined);
  }, [api, selected]);

  const enabledItems = wsItems.filter((i) => {
    const cat = wsCats.find((c) => c.id === i.category);
    return i.stockEnabled !== false && cat?.enabled;
  });

  const fail = (err: unknown) => setNotice(t(apiNoticeKey(err)));
  const pendingCount = opsOrders.filter((o) => operationalOf(o.status) === 'PENDIENTE').length;
  const prodCount = opsOrders.filter((o) => operationalOf(o.status) === 'EN_PRODUCCION').length;
  const readyCount = opsOrders.filter((o) => operationalOf(o.status) === 'LISTO').length;
  const openMsg = Number(msgStats.byStatus?.NEW || 0) + Number(msgStats.byStatus?.IN_REVIEW || 0);
  const openOrder = opsOrders.find((o) => o.orderId === openOrderId);
  const openLines = (openOrder?.formValues as { workshopLines?: Array<{ name?: string; quantity?: number; unit?: string; price?: number }> } | undefined)?.workshopLines || [];

  if (customerIdFromPath) {
    return (
      <section>
        <h1>{t('admin.customer_fiche')}</h1>
        <button type="button" onClick={() => navigate('/admin')}>
          {t('actions.back')}
        </button>
        {fiche ? (
          <>
            <p>{fiche.displayName}</p>
            <p>{fiche.email}</p>
            <p>{fiche.phone}</p>
            <p>{fiche.country}</p>
            <p>{fiche.region}</p>
            <p>{fiche.preferredLanguage}</p>
            <p>
              {t('client.membership')}: {fiche.membership?.status ? t(`membership.${fiche.membership.status}`) : ''}
            </p>
            {fiche.membership?.expiresAt ? <p>{new Date(fiche.membership.expiresAt).toISOString()}</p> : null}
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(t('actions.confirm'))) return;
                void api
                  .put(`/admin/customers/${customerIdFromPath}/membership`, { status: 'SUSPENDED' })
                  .then(() => api.get(`/admin/customers/${customerIdFromPath}`).then((res) => setFiche(res.data as typeof fiche)))
                  .catch(fail);
              }}
            >
              {t('admin.suspend')}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(t('actions.confirm'))) return;
                void api
                  .put(`/admin/customers/${customerIdFromPath}/membership`, { status: 'ACTIVE' })
                  .then(() => api.get(`/admin/customers/${customerIdFromPath}`).then((res) => setFiche(res.data as typeof fiche)))
                  .catch(fail);
              }}
            >
              {t('admin.reactivate')}
            </button>
            <h2>{t('client.orders')}</h2>
            <ul>
              {(fiche.orders || []).map((o) => (
                <li key={o.id}>
                  {o.number} {o.operationalStatus ? t(`ops_order.${o.operationalStatus}`) : ''} {o.createdAt || ''}
                </li>
              ))}
            </ul>
            <h2>{t('admin.inbox')}</h2>
            <ul>
              {(fiche.communications || []).map((c, i) => (
                <li key={`${c.createdAtIso}-${i}`}>
                  {c.createdAtIso} {c.authorRole} {c.subject} {c.content}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{t('app.loading')}</p>
        )}
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
  }

  return (
    <section data-pilot="admin">
      <h1>{t('navigation.admin')}</h1>
      <p>{user?.roleId}</p>
      <p>{tenant?.currency || ''}</p>
      <h2>{t('pilot.dashboard')}</h2>
      <ul data-pilot="ops-summary">
        <li>
          {t('ops_order.PENDIENTE')}: {pendingCount}
        </li>
        <li>
          {t('ops_order.EN_PRODUCCION')}: {prodCount}
        </li>
        <li>
          {t('ops_order.LISTO')}: {readyCount}
        </li>
        <li>
          {t('pilot.messages_open')}: {openMsg}
        </li>
      </ul>
      <h2>{t('admin.customers')}</h2>
      <select aria-label="filter-membership" value={membershipFilter} onChange={(e) => setMembershipFilter(e.target.value)}>
        <option value="">{t('actions.all')}</option>
        {MEMBERSHIP_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`membership.${s}`)}
          </option>
        ))}
      </select>
      <label>
        <input aria-label="filter-recent" type="checkbox" checked={recentOnly} onChange={(e) => setRecentOnly(e.target.checked)} />
        {t('admin.filter_recent')}
      </label>
      <ul>
        {customers.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => navigate(`/admin/customers/${c.id}`)}>
              {c.displayName} {c.membershipStatus ? t(`membership.${c.membershipStatus}`) : ''}
            </button>
          </li>
        ))}
      </ul>
      <h3>{t('admin.create_customer')}</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void api
            .post('/admin/customers', {
              name: newName,
              email: newEmail,
              country: newCountry,
              preferredLanguage: newLang,
              password: newPassword,
              membershipStatus: newMembership,
            })
            .then(() => {
              setNotice(t('client.saved'));
              setNewName('');
              setNewEmail('');
              loadCustomers();
            })
            .catch(fail);
        }}
      >
        <input aria-label="new-name" placeholder={t('admin.name')} value={newName} onChange={(e) => setNewName(e.target.value)} />
        <input aria-label="new-email" placeholder={t('admin.email')} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        <input aria-label="new-country" placeholder={t('client.country')} value={newCountry} onChange={(e) => setNewCountry(e.target.value)} />
        <input aria-label="new-language" placeholder={t('client.language')} value={newLang} onChange={(e) => setNewLang(e.target.value)} />
        <input aria-label="new-password" type="password" placeholder={t('admin.password')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <select aria-label="new-membership" value={newMembership} onChange={(e) => setNewMembership(e.target.value)}>
          {MEMBERSHIP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`membership.${s}`)}
            </option>
          ))}
        </select>
        <button type="submit">{t('actions.create')}</button>
      </form>
      <h2>{t('admin.catalog')}</h2>
      <ul>
        {wsCats.map((c) => (
          <li key={c.id}>
            {t(`catalog.${c.id}`)} {c.enabled ? t('admin.enabled') : t('admin.disabled')}
            <button
              type="button"
              onClick={() => {
                void api.put(`/admin/workshop-catalog/categories/${c.id}`, { enabled: !c.enabled }).then(loadCatalog).catch(fail);
              }}
            >
              {c.enabled ? t('actions.disable') : t('actions.enable')}
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const body = {
            name: itemName,
            description: itemDesc,
            price: Number(itemPrice),
            unit: itemUnit,
            category: itemCat,
          };
          const req = editItemId
            ? api.put(`/admin/workshop-catalog/items/${editItemId}`, body)
            : api.post('/admin/workshop-catalog/items', body);
          void req
            .then(() => {
              setItemName('');
              setItemDesc('');
              setItemPrice('');
              setItemUnit('');
              setEditItemId('');
              loadCatalog();
            })
            .catch(fail);
        }}
      >
        <select aria-label="item-category" value={itemCat} onChange={(e) => setItemCat(e.target.value)}>
          {WORKSHOP_CATS.map((c) => (
            <option key={c} value={c}>
              {t(`catalog.${c}`)}
            </option>
          ))}
        </select>
        <input aria-label="item-name" placeholder={t('admin.item_name')} value={itemName} onChange={(e) => setItemName(e.target.value)} />
        <input aria-label="item-description" placeholder={t('admin.item_description')} value={itemDesc} onChange={(e) => setItemDesc(e.target.value)} />
        <input aria-label="item-price" placeholder={t('admin.item_price')} value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} />
        <input aria-label="item-unit" placeholder={t('admin.item_unit')} value={itemUnit} onChange={(e) => setItemUnit(e.target.value)} />
        <button type="submit">{editItemId ? t('actions.save') : t('actions.create')}</button>
      </form>
      <ul>
        {wsItems.map((item) => (
          <li key={item.itemId}>
            {item.name} {item.price} {item.unit} {item.stockEnabled === false ? t('admin.disabled') : t('admin.enabled')}
            <button
              type="button"
              onClick={() => {
                setEditItemId(item.itemId);
                setItemName(item.name);
                setItemDesc(item.description || '');
                setItemPrice(String(item.price));
                setItemUnit(item.unit);
                setItemCat(item.category);
              }}
            >
              {t('actions.edit')}
            </button>
            <button
              type="button"
              onClick={() => {
                void api
                  .put(`/admin/workshop-catalog/items/${item.itemId}`, { stockEnabled: item.stockEnabled === false })
                  .then(loadCatalog)
                  .catch(fail);
              }}
            >
              {item.stockEnabled === false ? t('actions.enable') : t('actions.disable')}
            </button>
          </li>
        ))}
      </ul>
      <h2>{t('admin.create_order')}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void api
            .post('/admin/ops/orders', {
              customerId: orderCustomer,
              items: [{ itemId: orderItem, quantity: Number(orderQty) }],
              notes: orderNotes,
            })
            .then(() => {
              setNotice(t('client.saved'));
              setOrderNotes('');
              loadOrders();
              loadCustomers();
            })
            .catch(fail);
        }}
      >
        <select aria-label="order-customer" value={orderCustomer} onChange={(e) => setOrderCustomer(e.target.value)}>
          <option value="">{t('admin.select_customer')}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.displayName}
            </option>
          ))}
        </select>
        <select aria-label="order-item" value={orderItem} onChange={(e) => setOrderItem(e.target.value)}>
          <option value="">{t('admin.select_item')}</option>
          {enabledItems.map((i) => (
            <option key={i.itemId} value={i.itemId}>
              {i.name}
            </option>
          ))}
        </select>
        <input aria-label="order-qty" placeholder={t('admin.quantity')} value={orderQty} onChange={(e) => setOrderQty(e.target.value)} />
        <input aria-label="order-notes" placeholder={t('admin.notes')} value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} />
        <button type="submit">{t('actions.create')}</button>
      </form>
      <h2>{t('admin.orders')}</h2>
      <select aria-label="filter-ops-status" value={opsFilter} onChange={(e) => setOpsFilter(e.target.value)}>
        <option value="">{t('actions.all')}</option>
        {OPS_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`ops_order.${s}`)}
          </option>
        ))}
      </select>
      <ul>
        {opsOrders
          .filter((o) => !opsFilter || operationalOf(o.status) === opsFilter)
          .map((o) => {
            const op = operationalOf(o.status);
            return (
              <li key={o.orderId}>
                <button
                  type="button"
                  onClick={() => {
                    const next = openOrderId === o.orderId ? '' : o.orderId;
                    setOpenOrderId(next);
                    setPricePrompt(null);
                    setOpenPay(null);
                    if (next) {
                      void api
                        .get(`/workspace/orders/${o.orderId}`)
                        .then((res) => {
                          const data = res.data as {
                            priceDecisionRequired?: boolean;
                            priceDecisionPrompt?: string;
                            payment?: { remainingBalance?: number; remaining?: number; settled?: boolean };
                          };
                          setPricePrompt({
                            required: !!data.priceDecisionRequired,
                            prompt: data.priceDecisionPrompt || t('flow.price_decision_q'),
                          });
                          setOpenPay({
                            remainingBalance: Number(data.payment?.remainingBalance || 0),
                            remaining: Number(data.payment?.remaining || 0),
                            settled: !!data.payment?.settled,
                          });
                        })
                        .catch(() => undefined);
                    }
                  }}
                >
                  {o.displayNumber || o.orderId} {t(`ops_order.${op}`)} {o.createdAt ? new Date(o.createdAt).toISOString() : ''}
                </button>
                {openOrderId === o.orderId ? (
                  <div data-pilot="order-detail">
                    <p>
                      {t('admin.select_customer')}: {o.customerId}
                    </p>
                    <p>
                      {t('flow.project_name')}: {o.projectName || o.formValues?.projectName || ''}
                    </p>
                    <p>
                      {t('admin.notes')}: {o.formValues?.notes || ''}
                    </p>
                    <ul>
                      {openLines.map((line, i) => (
                        <li key={`${line.name}-${i}`}>
                          {line.name} {line.quantity} {line.unit} {line.price}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => {
                        void api
                          .post(`/admin/orders/${o.orderId}/payment/confirm`, {})
                          .then(() => {
                            setNotice(t('client.saved'));
                            loadOrders();
                          })
                          .catch(fail);
                      }}
                    >
                      {t('flow.confirm_pay')}
                    </button>
                    {openPay && Number(openPay.remainingBalance) > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          void api
                            .post(`/admin/orders/${o.orderId}/payment/confirm`, {
                              amountPaid: openPay.remainingBalance,
                            })
                            .then(() => {
                              setNotice(t('client.saved'));
                              setOpenPay({ remainingBalance: 0, remaining: 0, settled: true });
                              loadOrders();
                            })
                            .catch(fail);
                        }}
                      >
                        {t('flow.confirm_balance')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        void api
                          .post(`/admin/orders/${o.orderId}/payment/confirm`, {
                            amountPaid: 0,
                            authorizeException: true,
                            exceptionNote: 'autorizacion_admin',
                          })
                          .then(() => {
                            setNotice(t('client.saved'));
                            loadOrders();
                          })
                          .catch(fail);
                      }}
                    >
                      {t('flow.authorize_exception')}
                    </button>
                    {pricePrompt?.required ? (
                      <div data-role="price-decision">
                        <p>{pricePrompt.prompt}</p>
                        <button
                          type="button"
                          onClick={() => {
                            void api
                              .post(`/admin/orders/${o.orderId}/price-decision`, { decision: 'UPDATE' })
                              .then(() => {
                                setNotice(t('client.saved'));
                                setPricePrompt(null);
                                loadOrders();
                              })
                              .catch(fail);
                          }}
                        >
                          {t('flow.update_price')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void api
                              .post(`/admin/orders/${o.orderId}/price-decision`, { decision: 'KEEP' })
                              .then(() => {
                                setNotice(t('client.saved'));
                                setPricePrompt(null);
                                loadOrders();
                              })
                              .catch(fail);
                          }}
                        >
                          {t('flow.keep_price')}
                        </button>
                      </div>
                    ) : null}
                    <p data-pilot-fixture="preview">{t('pilot.preview_fixture')}</p>
                    <OrderOpsPanel
                      orderId={o.orderId}
                      customerName={o.customerId}
                      fileBase="workspace"
                    />
                  </div>
                ) : null}
                {nextOperationalStatuses(op).map((to) => (
                  <button
                    key={to}
                    type="button"
                    onClick={() => {
                      if (!window.confirm(t('admin.confirm_status'))) return;
                      void api
                        .put(`/admin/ops/orders/${o.orderId}/status`, { status: to })
                        .then(() => {
                          loadOrders();
                        })
                        .catch(fail);
                    }}
                  >
                    {t(`ops_order.${to}`)}
                  </button>
                ))}
              </li>
            );
          })}
      </ul>
      <h2>{t('admin.inbox')}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <input aria-label="filter-q" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="filter-category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">{t('actions.all')}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`messages.categories.${c}`)}
            </option>
          ))}
        </select>
        <select aria-label="filter-status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('actions.all')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`messages.status.${s}`)}
            </option>
          ))}
        </select>
        <button type="submit">{t('actions.filter')}</button>
      </form>
      <ul>
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setSelected(r.id)}>
              {r.customerName || r.customerId} {r.customerCountry || ''} {r.subject} {r.category} {r.status} {r.context?.kind || ''}{' '}
              {r.orderId || ''}
            </button>
          </li>
        ))}
      </ul>
      {selected ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void api
              .post(`/admin/messages/${selected}/reply`, { content: reply })
              .then(() => {
                setReply('');
                load();
                void api.get(`/admin/messages/${selected}`).then((res) => setThread(res.data as typeof thread));
              })
              .catch(fail);
          }}
        >
          {thread ? (
            <p>
              {t('client.context_ref')}: {thread.context?.kind || ''} {thread.context?.ref || thread.orderId || ''}
            </p>
          ) : null}
          <ul>
            {(thread?.entries || []).map((e, i) => (
              <li key={`${selected}-e-${i}`}>
                {e.authorRole}: {e.content} {e.createdAt || ''}
              </li>
            ))}
          </ul>
          <textarea aria-label="admin-reply" value={reply} onChange={(e) => setReply(e.target.value)} />
          <button type="submit">{t('actions.reply')}</button>
          <select aria-label="classify" value={classifyTo} onChange={(e) => setClassifyTo(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`messages.categories.${c}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              void api.put(`/admin/messages/${selected}/category`, { category: classifyTo }).then(() => load());
            }}
          >
            {t('admin.classify')}
          </button>
          <button
            type="button"
            onClick={() => {
              void api.put(`/admin/messages/${selected}/status`, { status: 'IN_REVIEW' }).then(() => load());
            }}
          >
            {t('messages.status.IN_REVIEW')}
          </button>
          <button
            type="button"
            onClick={() => {
              void api.put(`/admin/messages/${selected}/status`, { status: 'RESOLVED' }).then(() => load());
            }}
          >
            {t('messages.status.RESOLVED')}
          </button>
          <button
            type="button"
            onClick={() => {
              void api.put(`/admin/messages/${selected}/evaluate`, { status: evalStatus, note: 'human' }).then(() => load());
            }}
          >
            {t('admin.evaluate')}
          </button>
          <select aria-label="eval-status" value={evalStatus} onChange={(e) => setEvalStatus(e.target.value)}>
            <option value="REVIEWED">REVIEWED</option>
            <option value="BACKLOG">BACKLOG</option>
            <option value="DECLINED">DECLINED</option>
          </select>
        </form>
      ) : null}
      <h2>{t('admin.commercial')}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void api.put('/admin/config/commercial', { defaultMarket: market, defaultCurrency: currency, defaultLanguage: language });
        }}
      >
        <input aria-label="market" placeholder={t('admin.market')} value={market} onChange={(e) => setMarket(e.target.value)} />
        <input aria-label="currency" placeholder={t('admin.currency')} value={currency} onChange={(e) => setCurrency(e.target.value)} />
        <input aria-label="commercial-language" placeholder={t('client.language')} value={language} onChange={(e) => setLanguage(e.target.value)} />
        <button type="submit">{t('actions.save')}</button>
      </form>
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
