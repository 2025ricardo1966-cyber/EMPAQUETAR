import React, { useCallback, useEffect, useState } from 'react';
import { apiNoticeKey } from '../../foundation/api-notice';
import { operationalOf } from '../../foundation/ops-status';
import { useAuth } from '../providers/AuthProvider';
import { useI18n } from '../providers/I18nProvider';
import { useHashPath } from '../router/useHashPath';
import { OrderOpsPanel } from './OrderOpsPanel';

type WsOrder = {
  orderId?: string;
  id?: string;
  orderNumber?: string;
  displayNumber?: string;
  status?: string;
  customer?: { id?: string; displayName?: string };
  customerName?: string;
  projectName?: string;
  files?: Array<{ id?: string; filename?: string; mimeType?: string; status?: string; sizeBytes?: number }>;
  formData?: { productionOutputs?: Array<{ id?: string; filename?: string; format?: string }> };
};

export const WorkspaceAreaPage: React.FC = () => {
  const { t } = useI18n();
  const { user, logout, api } = useAuth();
  const { navigate } = useHashPath();
  const [orders, setOrders] = useState<WsOrder[]>([]);
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<WsOrder | null>(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    void api
      .get('/workspace/orders')
      .then((res) => {
        const data = res.data as { items?: WsOrder[] } | WsOrder[];
        setOrders(Array.isArray(data) ? data : data.items || []);
      })
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  }, [api, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    void api
      .get(`/workspace/orders/${openId}`)
      .then((res) => setDetail(res.data as WsOrder))
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  }, [api, openId, t]);

  return (
    <section data-pilot="workspace">
      <h1>{t('navigation.workspace')}</h1>
      <p>{user?.roleId}</p>
      <h2>{t('admin.orders')}</h2>
      {orders.length === 0 ? <p>{t('ops.no_orders')}</p> : null}
      <ul>
        {orders.map((o) => {
          const id = o.orderId || o.id || '';
          const op = operationalOf(String(o.status || ''));
          return (
            <li key={id}>
              <button type="button" onClick={() => setOpenId(id === openId ? '' : id)}>
                {o.orderNumber || o.displayNumber || id} {o.customer?.displayName || o.customerName || ''}{' '}
                {op ? t(`ops_order.${op}`) : o.status}
              </button>
              {openId === id && detail ? (
                <OrderOpsPanel
                  orderId={id}
                  customerName={detail.customer?.displayName || detail.customerName}
                  files={detail.files}
                  outputs={detail.formData?.productionOutputs}
                  fileBase="workspace"
                />
              ) : null}
            </li>
          );
        })}
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
