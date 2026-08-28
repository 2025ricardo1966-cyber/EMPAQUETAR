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

type CapabilityRow = {
  key: FlowFeatureKey;
  label: string;
  category: string;
  supported: boolean;
  configurable: boolean;
  requires?: FlowFeatureKey[];
  enabled: boolean;
  displayOrder: number;
  tenantId: string;
  actionKey?: FlowActionKey | null;
};

type FlowDto = {
  features: FeatureRow[];
  actionOrder: FlowActionKey[];
  capabilities?: CapabilityRow[];
  catalog?: {
    source?: string;
    categories?: string[];
    commercialEnforced?: boolean;
    actions?: Array<{ key: FlowActionKey; label: string }>;
  };
  updatedAt?: number;
  updatedBy?: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  core: 'Núcleo',
  visual: 'Interpretación visual',
  samples: 'Muestras y previsualización',
  production: 'Producción',
  commercial: 'Información comercial',
  communication: 'Comunicación',
};

export const AdminFlowConfigPanel: React.FC = () => {
  const { api } = useAuth();
  const { t } = useI18n();
  const [flow, setFlow] = useState<FlowDto | null>(null);
  const [notice, setNotice] = useState('');
  const [dragCap, setDragCap] = useState<FlowFeatureKey | null>(null);
  const [dragAction, setDragAction] = useState<FlowActionKey | null>(null);

  const load = useCallback(() => {
    void api
      .get('/admin/config/flow')
      .then((res) => setFlow(res.data as FlowDto))
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  }, [api, t]);

  useEffect(() => {
    load();
  }, [load]);

  const rowsOf = (dto: FlowDto): CapabilityRow[] => {
    if (dto.capabilities?.length) {
      return dto.capabilities.filter((row) => row.supported !== false);
    }
    return (dto.features || []).map((f) => ({
      key: f.featureKey,
      label: f.featureKey,
      category: '',
      supported: true,
      configurable: true,
      enabled: f.enabled,
      displayOrder: f.displayOrder,
      tenantId: '',
    }));
  };

  const save = (next: FlowDto) => {
    const capabilities = rowsOf(next);
    void api
      .put('/admin/config/flow', {
        features: capabilities.map((row) => ({
          featureKey: row.key,
          enabled: row.enabled,
          displayOrder: row.displayOrder,
        })),
        actionOrder: next.actionOrder,
      })
      .then((res) => {
        setFlow(res.data as FlowDto);
        setNotice('');
      })
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  };

  const toggle = (key: FlowFeatureKey) => {
    if (!flow) return;
    const capabilities = rowsOf(flow).map((row) => {
      if (row.key !== key || row.configurable === false) return row;
      return { ...row, enabled: !row.enabled };
    });
    save({ ...flow, capabilities });
  };

  const moveRow = (key: FlowFeatureKey, dir: -1 | 1) => {
    if (!flow) return;
    const capabilities = [...rowsOf(flow)];
    const idx = capabilities.findIndex((row) => row.key === key);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= capabilities.length) return;
    const tmp = capabilities[idx];
    capabilities[idx] = capabilities[next];
    capabilities[next] = tmp;
    save({
      ...flow,
      capabilities: capabilities.map((row, i) => ({ ...row, displayOrder: i + 1 })),
    });
  };

  const dropRow = (target: FlowFeatureKey) => {
    if (!flow || !dragCap || dragCap === target) return;
    const rest = rowsOf(flow).filter((row) => row.key !== dragCap);
    const moving = rowsOf(flow).find((row) => row.key === dragCap);
    if (!moving) return;
    const at = rest.findIndex((row) => row.key === target);
    rest.splice(at, 0, moving);
    setDragCap(null);
    save({
      ...flow,
      capabilities: rest.map((row, i) => ({ ...row, displayOrder: i + 1 })),
    });
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
    if (!flow || !dragAction || dragAction === target) return;
    const order = flow.actionOrder.filter((k) => k !== dragAction);
    const at = order.indexOf(target);
    order.splice(at, 0, dragAction);
    setDragAction(null);
    save({ ...flow, actionOrder: order });
  };

  const labelOf = (key: string) => {
    const cap = flow?.capabilities?.find((row) => row.key === key);
    if (cap?.label) return cap.label;
    const action = flow?.catalog?.actions?.find((a) => a.key === key);
    return action?.label || key;
  };

  const capabilities = flow ? rowsOf(flow) : [];

  return (
    <section data-admin="flow-config">
      <h2>CONFIGURACIÓN DEL TALLER</h2>
      <p>
        Este es tu EMPAQUETAR: elige qué capacidades ofrece tu taller y en qué orden se presentan. Activar u ordenar
        cambia la experiencia, no la producción, los pagos ni la trazabilidad.
      </p>
      {flow ? (
        <>
          <ul data-role="flow-features" data-catalog-source={flow.catalog?.source || 'empaquetar-capabilities'}>
            {capabilities.map((row, i) => (
              <li
                key={row.key}
                draggable
                onDragStart={() => setDragCap(row.key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropRow(row.key)}
              >
                <span data-category={row.category}>{CATEGORY_LABEL[row.category] || row.category}</span>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`flow-feature-${row.key}`}
                    checked={row.enabled}
                    disabled={row.configurable === false}
                    onChange={() => toggle(row.key)}
                  />
                  {row.label}
                  <span data-enabled={row.enabled ? 'true' : 'false'} data-configurable={row.configurable ? 'true' : 'false'}>
                    {' '}
                    {row.configurable === false ? '[ NÚCLEO · ACTIVADO ]' : row.enabled ? '[ ACTIVADO ]' : '[ DESACTIVADO ]'}
                  </span>
                </label>
                <button type="button" aria-label={`flow-cap-up-${row.key}`} disabled={i === 0} onClick={() => moveRow(row.key, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`flow-cap-down-${row.key}`}
                  disabled={i === capabilities.length - 1}
                  onClick={() => moveRow(row.key, 1)}
                >
                  ↓
                </button>
              </li>
            ))}
          </ul>
          <h3>ORDEN DE PRESENTACIÓN</h3>
          <ol data-role="flow-action-order">
            {flow.actionOrder.map((key, i) => (
              <li
                key={key}
                draggable
                onDragStart={() => setDragAction(key)}
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
