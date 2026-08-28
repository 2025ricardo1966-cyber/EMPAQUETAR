import React, { useCallback, useEffect, useState } from 'react';
import type { FlowActionKey, FlowFeatureKey } from '../../../contracts/flow-configuration';
import { apiNoticeKey } from '../../foundation/api-notice';
import { useAuth } from '../providers/AuthProvider';
import { useI18n } from '../providers/I18nProvider';

type FeatureRow = {
  featureKey: FlowFeatureKey;
  enabled: boolean;
  displayOrder: number;
};

type Catalog = {
  features: Array<{ key: FlowFeatureKey; label: string }>;
  actions: Array<{ key: FlowActionKey; label: string }>;
};

type FlowDto = {
  features: FeatureRow[];
  actionOrder: FlowActionKey[];
  catalog?: Catalog;
  updatedAt?: number;
  updatedBy?: string | null;
};

export const AdminFlowConfigPanel: React.FC = () => {
  const { api } = useAuth();
  const { t } = useI18n();
  const [flow, setFlow] = useState<FlowDto | null>(null);
  const [notice, setNotice] = useState('');
  const [dragKey, setDragKey] = useState<FlowActionKey | null>(null);

  const load = useCallback(() => {
    void api
      .get('/admin/config/flow')
      .then((res) => setFlow(res.data as FlowDto))
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  }, [api, t]);

  useEffect(() => {
    load();
  }, [load]);

  const save = (next: FlowDto) => {
    void api
      .put('/admin/config/flow', { features: next.features, actionOrder: next.actionOrder })
      .then((res) => {
        setFlow(res.data as FlowDto);
        setNotice('');
      })
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  };

  const toggle = (key: FlowFeatureKey) => {
    if (!flow) return;
    const features = flow.features.map((f) => (f.featureKey === key ? { ...f, enabled: !f.enabled } : f));
    save({ ...flow, features });
  };

  const moveAction = (key: FlowActionKey, dir: -1 | 1) => {
    if (!flow) return;
    const order = [...flow.actionOrder];
    const idx = order.indexOf(key);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= order.length) return;
    const tmp = order[idx];
    order[idx] = order[next];
    order[next] = tmp;
    save({ ...flow, actionOrder: order });
  };

  const dropAction = (target: FlowActionKey) => {
    if (!flow || !dragKey || dragKey === target) return;
    const order = flow.actionOrder.filter((k) => k !== dragKey);
    const at = order.indexOf(target);
    order.splice(at, 0, dragKey);
    setDragKey(null);
    save({ ...flow, actionOrder: order });
  };

  const labelOf = (key: string) =>
    flow?.catalog?.features.find((f) => f.key === key)?.label ||
    flow?.catalog?.actions.find((a) => a.key === key)?.label ||
    key;

  return (
    <section data-admin="flow-config">
      <h2>CONFIGURACIÓN DEL FLUJO</h2>
      <p>Activa o desactiva capacidades visibles para el cliente. No modifica producción, pagos ni trazabilidad de pedidos.</p>
      {flow ? (
        <>
          <ul data-role="flow-features">
            {flow.features.map((row) => (
              <li key={row.featureKey}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`flow-feature-${row.featureKey}`}
                    checked={row.enabled}
                    onChange={() => toggle(row.featureKey)}
                  />
                  {labelOf(row.featureKey)}
                  <span data-enabled={row.enabled ? 'true' : 'false'}> {row.enabled ? '[ ACTIVADO ]' : '[ DESACTIVADO ]'}</span>
                </label>
              </li>
            ))}
          </ul>
          <h3>ORDEN DE PRESENTACIÓN</h3>
          <ol data-role="flow-action-order">
            {flow.actionOrder.map((key, i) => (
              <li
                key={key}
                draggable
                onDragStart={() => setDragKey(key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropAction(key)}
              >
                ≡ {labelOf(key)}
                <button type="button" aria-label={`flow-order-up-${key}`} disabled={i === 0} onClick={() => moveAction(key, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`flow-order-down-${key}`}
                  disabled={i === flow.actionOrder.length - 1}
                  onClick={() => moveAction(key, 1)}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p>{t('app.loading')}</p>
      )}
      {notice ? <p>{notice}</p> : null}
    </section>
  );
};
