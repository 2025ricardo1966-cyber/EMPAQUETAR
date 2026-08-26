import React, { useCallback, useEffect, useState } from 'react';
import { apiNoticeKey } from '../../foundation/api-notice';
import { useAuth } from '../providers/AuthProvider';
import { useI18n } from '../providers/I18nProvider';
import { useTenant } from '../providers/TenantProvider';
import { ClientOrderPreview3D } from './ClientOrderPreview3D';

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

type Quote = {
  currency?: string;
  name?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  consumption?: number;
  consumptionUnit?: string;
  subtotal?: number;
  total?: number;
  lines?: Array<{ name?: string; unit?: string; consumption?: number; unitPrice?: number; amount?: number }>;
};

type Payment = {
  requiredPct?: number;
  amountDue?: number;
  amountPaid?: number;
  remaining?: number;
  remainingBalance?: number;
  settled?: boolean;
  status?: string;
  hasVoucher?: boolean;
  meetsRequired?: boolean;
  checkoutOpen?: boolean;
};

type RosterRecord = {
  name: string;
  number: string;
  size: string;
  extras?: Record<string, string>;
  sizeLabel?: string;
  sizeTableId?: string;
  garmentType?: string;
  quantity?: number;
};
type CommercialTerms = {
  frozen?: boolean;
  validUntilLabel?: string;
  agreedAmount?: number;
  remainingAmount?: number;
};

type SizeTable = {
  id: string;
  name: string;
  brand: string;
  garmentType: string;
  source: string;
  entries: Array<{ label: string }>;
};

type ViewerParams = {
  ready?: boolean;
  pendingReasons?: string[];
  moldId?: string;
  talle?: string;
  categoria?: 'adulto' | 'infantil';
  fabricId?: string;
};

type TpuAdmin = {
  maxWidth_mm?: number;
  maxHeight_mm?: number;
  defaultWidth_mm?: number;
  defaultHeight_mm?: number;
};

type FamilyStyle = { collarId?: string; sleeveId?: string; fabricId?: string; colors?: { primary?: string } };
type ConfigStep = 'garment' | 'sizes' | 'style' | 'roster' | 'tpu' | 'laser' | 'design' | 'preview' | 'pay';

function fileToBase64(file: File): Promise<{ name: string; mime: string; content: string; url: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const content = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
      resolve({ name: file.name, mime: file.type || 'application/octet-stream', content, url: dataUrl });
    };
    reader.onerror = () => reject(reader.error || new Error('read'));
    reader.readAsDataURL(file);
  });
}

export const ClientOrderFlow: React.FC<{
  restricted: boolean;
  onCreated: () => void;
}> = ({ restricted, onCreated }) => {
  const { t } = useI18n();
  const { api } = useAuth();
  const { tenant } = useTenant();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [openList, setOpenList] = useState(false);
  const [picked, setPicked] = useState<CatalogItem | null>(null);
  const [projectName, setProjectName] = useState('');
  const [qty, setQty] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [orderId, setOrderId] = useState('');
  const [designUrl, setDesignUrl] = useState('');
  const [approved, setApproved] = useState<boolean | null>(null);
  const [sendConfirm, setSendConfirm] = useState(false);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [notice, setNotice] = useState('');
  const [flowStatus, setFlowStatus] = useState('');
  const [commercial, setCommercial] = useState<CommercialTerms | null>(null);
  const [rosterRows, setRosterRows] = useState<RosterRecord[] | null>(null);
  const [rosterPending, setRosterPending] = useState(false);
  const [configStep, setConfigStep] = useState<ConfigStep>('garment');
  const [garmentTypes, setGarmentTypes] = useState<string[]>([]);
  const [sizeTables, setSizeTables] = useState<SizeTable[]>([]);
  const [tableByType, setTableByType] = useState<Record<string, string>>({});
  const [styleByType, setStyleByType] = useState<Record<string, FamilyStyle>>({});
  const [distribution, setDistribution] = useState<{
    totalUnits?: number;
    recordCount?: number;
    designFileId?: string;
    families?: Array<{ garmentType: string; units: number; bySize?: Record<string, number> }>;
  } | null>(null);
  const [tpuAdmin, setTpuAdmin] = useState<TpuAdmin | null>(null);
  const [tpuW, setTpuW] = useState(300);
  const [tpuH, setTpuH] = useState(400);
  const [laserOn, setLaserOn] = useState(false);
  const [laserConfirm, setLaserConfirm] = useState(false);
  const [viewer, setViewer] = useState<ViewerParams | null>(null);
  const [createdOrders, setCreatedOrders] = useState<Array<{ id: string; name: string }>>([]);
  const currency = quote?.currency || tenant?.currency || '';
  const nameHasNumbers = /\d/.test(projectName);

  const loadCatalog = useCallback(() => {
    void api
      .get('/client/workshop-catalog')
      .then((res) => {
        const data = res.data as { items?: CatalogItem[] };
        setItems(data.items || []);
      })
      .catch(() => undefined);
  }, [api]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (configStep !== 'tpu' || tpuAdmin) return;
    void api
      .get('/client/tpu-config')
      .then((res) => {
        const data = res.data as TpuAdmin;
        setTpuAdmin(data);
        if (data.defaultWidth_mm) setTpuW(data.defaultWidth_mm);
        if (data.defaultHeight_mm) setTpuH(data.defaultHeight_mm);
      })
      .catch(() => undefined);
  }, [api, configStep, tpuAdmin]);

  useEffect(() => {
    if (!picked) {
      setQuote(null);
      return;
    }
    void api
      .post('/client/orders/quote', { workshopItemId: picked.itemId, quantity: qty })
      .then((res) => setQuote(res.data as Quote))
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  }, [api, picked, qty, t]);

  const applyOrderView = (data: {
    payment?: Payment;
    flowStatusLabel?: string;
    commercialTerms?: CommercialTerms;
    viewer?: ViewerParams;
    total?: number;
    consumption?: Quote['lines'];
    configuration?: {
      distribution?: {
        totalUnits?: number;
        recordCount?: number;
        designFileId?: string;
        families?: Array<{ garmentType: string; units: number; bySize?: Record<string, number> }>;
      };
    };
  }) => {
    if (data.payment) setPayment(data.payment);
    if (data.flowStatusLabel) setFlowStatus(data.flowStatusLabel);
    if (data.commercialTerms) setCommercial(data.commercialTerms);
    if (data.viewer) setViewer(data.viewer);
    if (data.configuration?.distribution) setDistribution(data.configuration.distribution);
    if (data.total != null) {
      setQuote((prev) => ({ ...(prev || {}), total: data.total, subtotal: data.total, lines: data.consumption || prev?.lines }));
    }
  };

  const resetWizard = () => {
    setPicked(null);
    setOpenList(false);
    setProjectName('');
    setQty(1);
    setQuote(null);
    setOrderId('');
    setDesignUrl('');
    setApproved(null);
    setSendConfirm(false);
    setPayment(null);
    setFlowStatus('');
    setNotice('');
    setCommercial(null);
    setRosterRows(null);
    setRosterPending(false);
    setConfigStep('garment');
    setGarmentTypes([]);
    setSizeTables([]);
    setTableByType({});
    setDistribution(null);
    setTpuAdmin(null);
    setTpuW(300);
    setTpuH(400);
    setLaserOn(false);
    setLaserConfirm(false);
    setViewer(null);
  };

  const createOrder = () => {
    if (restricted || !picked || !projectName.trim() || nameHasNumbers) return;
    void api
      .post('/client/orders', {
        workshopItemId: picked.itemId,
        quantity: qty,
        projectName: projectName.trim(),
      })
      .then((res) => {
        const data = res.data as {
          orderId?: string;
          id?: string;
          payment?: Payment;
          flowStatusLabel?: string;
          commercialTerms?: CommercialTerms;
          viewer?: ViewerParams;
        };
        const id = data.orderId || data.id || '';
        setOrderId(id);
        setCreatedOrders((prev) => [...prev, { id, name: projectName.trim() }]);
        applyOrderView(data);
        setConfigStep('garment');
        onCreated();
      })
      .catch((err) => setNotice(t(apiNoticeKey(err))));
  };

  const costPanel = (
    <aside data-role="cost-engine">
      <h3>{t('flow.costs')}</h3>
      {quote ? (
        <>
          <p data-role="computed">
            {t('flow.consumption')}: {quote.consumption} {quote.consumptionUnit || quote.unit}
          </p>
          <p data-role="computed">
            {t('flow.unit_price')}: {quote.unitPrice} {currency} / {quote.unit}
          </p>
          <p data-role="computed">
            {t('flow.subtotal')}: {quote.subtotal} {currency}
          </p>
          <p data-role="computed">
            {t('flow.total')}: {quote.total} {currency}
          </p>
        </>
      ) : (
        <p>{t('app.empty')}</p>
      )}
    </aside>
  );

  return (
    <div data-order-flow="client">
      {costPanel}
      {notice ? <p>{notice}</p> : null}
      {createdOrders.length ? (
        <p data-role="session-orders">
          {t('flow.previous_orders')}: {createdOrders.map((o) => o.name).join(' · ')}
        </p>
      ) : null}
      {!picked ? (
        <div>
          <button type="button" disabled={restricted} onClick={() => setOpenList(!openList)}>
            {t('flow.material')}
          </button>
          {openList
            ? items.map((item) => (
                <button
                  key={item.itemId}
                  type="button"
                  onClick={() => {
                    setPicked(item);
                    setQty(1);
                  }}
                >
                  {item.name}
                </button>
              ))
            : null}
        </div>
      ) : !orderId ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createOrder();
          }}
        >
          <p>{picked.name}</p>
          <label>
            {t('flow.project_name')}
            <input
              aria-label="project-name"
              placeholder={t('flow.project_placeholder')}
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </label>
          {nameHasNumbers ? <p role="alert">{t('errors.project_name_no_numbers')}</p> : null}
          <div>
            <button type="button" aria-label="qty-minus" onClick={() => setQty(Math.max(1, qty - 1))}>
              −
            </button>
            <span data-order="qty">{qty}</span>
            <button type="button" aria-label="qty-plus" onClick={() => setQty(qty + 1)}>
              +
            </button>
          </div>
          <button type="submit" disabled={restricted || !projectName.trim() || nameHasNumbers}>
            {t('flow.enter_next')}
          </button>
        </form>
      ) : (
        <div>
          <p>
            {projectName} — {flowStatus}
          </p>
          {commercial?.frozen ? (
            <p>
              {t('flow.price_until').replace('{{date}}', commercial.validUntilLabel || '')}
            </p>
          ) : null}

          {configStep === 'garment' ? (
            <div data-step="garment">
              <h3>{t('flow.garment')} — {t('flow.families')}</h3>
              {['CAMISETA', 'SHORT'].map((kind) => (
                <button
                  key={kind}
                  type="button"
                  aria-pressed={garmentTypes.includes(kind)}
                  onClick={() =>
                    setGarmentTypes((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]))
                  }
                >
                  {kind}
                </button>
              ))}
              <button
                type="button"
                disabled={!garmentTypes.length}
                onClick={() => {
                  if (!orderId || !garmentTypes.length) return;
                  void api
                    .patch(`/client/orders/${orderId}/configuration`, { garmentTypes })
                    .then((res) => {
                      applyOrderView(res.data as { viewer?: ViewerParams });
                      setConfigStep('sizes');
                      return api.get('/client/size-tables');
                    })
                    .then((res) => {
                      const data = res.data as { tables?: SizeTable[] };
                      setSizeTables(data.tables || []);
                    })
                    .catch((err) => setNotice(t(apiNoticeKey(err))));
                }}
              >
                {t('flow.continue')}
              </button>
            </div>
          ) : null}

          {configStep === 'sizes' ? (
            <div data-step="sizes">
              <h3>{t('flow.sizes')}</h3>
              {garmentTypes.map((kind) => (
                <label key={kind}>
                  {t('flow.size_table')} {kind}
                  <select
                    aria-label={`size-table-${kind}`}
                    value={tableByType[kind] || ''}
                    onChange={(e) => setTableByType((prev) => ({ ...prev, [kind]: e.target.value }))}
                  >
                    <option value="">{t('app.empty')}</option>
                    {sizeTables
                      .filter((table) => table.garmentType === kind)
                      .map((table) => (
                        <option key={table.id} value={table.id}>
                          {table.brand} — {table.name}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
              <button
                type="button"
                disabled={garmentTypes.some((kind) => !tableByType[kind])}
                onClick={() => {
                  if (!orderId) return;
                  void api
                    .patch(`/client/orders/${orderId}/configuration`, {
                      sizeTables: garmentTypes.map((garmentType) => ({
                        garmentType,
                        sizeTableId: tableByType[garmentType],
                      })),
                    })
                    .then((res) => {
                      applyOrderView(res.data as { viewer?: ViewerParams });
                      setConfigStep('style');
                    })
                    .catch((err) => setNotice(t(apiNoticeKey(err))));
                }}
              >
                {t('flow.continue')}
              </button>
            </div>
          ) : null}

          {configStep === 'style' ? (
            <div data-step="style">
              <h3>{t('flow.style')}</h3>
              {garmentTypes.map((kind) => (
                <fieldset key={kind}>
                  <legend>{kind}</legend>
                  {kind === 'CAMISETA' ? (
                    <>
                      <label>
                        {t('flow.collar')}
                        <select
                          aria-label={`collar-${kind}`}
                          value={styleByType[kind]?.collarId || 'cuello-redondo'}
                          onChange={(e) =>
                            setStyleByType((prev) => ({ ...prev, [kind]: { ...prev[kind], collarId: e.target.value } }))
                          }
                        >
                          <option value="cuello-redondo">cuello-redondo</option>
                          <option value="cuello-v">cuello-v</option>
                          <option value="cuello-polo">cuello-polo</option>
                        </select>
                      </label>
                      <label>
                        {t('flow.sleeve')}
                        <select
                          aria-label={`sleeve-${kind}`}
                          value={styleByType[kind]?.sleeveId || 'manga-corta'}
                          onChange={(e) =>
                            setStyleByType((prev) => ({ ...prev, [kind]: { ...prev[kind], sleeveId: e.target.value } }))
                          }
                        >
                          <option value="manga-corta">manga-corta</option>
                          <option value="manga-larga">manga-larga</option>
                          <option value="sin-mangas">sin-mangas</option>
                        </select>
                      </label>
                    </>
                  ) : null}
                  <label>
                    {t('flow.fabric')}
                    <select
                      aria-label={`fabric-${kind}`}
                      value={styleByType[kind]?.fabricId || 'dry-fit'}
                      onChange={(e) =>
                        setStyleByType((prev) => ({ ...prev, [kind]: { ...prev[kind], fabricId: e.target.value } }))
                      }
                    >
                      <option value="dry-fit">dry-fit</option>
                      <option value="microfibra">microfibra</option>
                      <option value="poliester">poliester</option>
                    </select>
                  </label>
                  <label>
                    {t('flow.color_primary')}
                    <input
                      aria-label={`color-${kind}`}
                      type="color"
                      value={styleByType[kind]?.colors?.primary || '#1e3a5f'}
                      onChange={(e) =>
                        setStyleByType((prev) => ({
                          ...prev,
                          [kind]: { ...prev[kind], colors: { primary: e.target.value } },
                        }))
                      }
                    />
                  </label>
                </fieldset>
              ))}
              <button
                type="button"
                onClick={() => {
                  if (!orderId) return;
                  void api
                    .patch(`/client/orders/${orderId}/configuration`, {
                      familyStyles: garmentTypes.map((garmentType) => ({
                        garmentType,
                        ...(styleByType[garmentType] || {}),
                      })),
                    })
                    .then((res) => {
                      applyOrderView(res.data as { viewer?: ViewerParams });
                      setConfigStep('roster');
                    })
                    .catch((err) => setNotice(t(apiNoticeKey(err))));
                }}
              >
                {t('flow.continue')}
              </button>
            </div>
          ) : null}

          {configStep === 'roster' ? (
            <div data-step="roster">
              <h3>{t('flow.roster_check')}</h3>
              <input
                aria-label="roster-file"
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file || !orderId) return;
                  void fileToBase64(file)
                    .then((payload) =>
                      api.post(`/client/orders/${orderId}/files`, {
                        filename: payload.name,
                        mimeType: payload.mime || 'text/csv',
                        contentBase64: payload.content,
                      })
                    )
                    .then((res) => {
                      const data = res.data as {
                        roster?: { interpretation?: { records?: RosterRecord[] }; status?: string };
                      };
                      const records = data.roster?.interpretation?.records || [];
                      setRosterRows(records);
                      setRosterPending(data.roster?.status !== 'APPROVED');
                    })
                    .catch((err) => setNotice(t(apiNoticeKey(err))));
                }}
              />
              {rosterRows ? (
                <div data-role="roster-review">
                  <p>{t('flow.understood')}</p>
                  <p>{t('flow.roster_check')}</p>
                  <table>
                    <thead>
                      <tr>
                        <th>{t('flow.roster_name')}</th>
                        <th>{t('flow.roster_number')}</th>
                    <th>{t('flow.roster_size')}</th>
                    <th>{t('flow.roster_garment')}</th>
                    <th>{t('flow.roster_qty')}</th>
                  </tr>
                </thead>
                    <tbody>
                      {rosterRows.map((row, i) => (
                        <tr key={`${row.name}-${i}`}>
                          <td>
                            <input
                              aria-label={`roster-name-${i}`}
                              value={row.name}
                              onChange={(e) => {
                                const next = rosterRows.slice();
                                next[i] = { ...row, name: e.target.value };
                                setRosterRows(next);
                              }}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`roster-number-${i}`}
                              value={row.number}
                              onChange={(e) => {
                                const next = rosterRows.slice();
                                next[i] = { ...row, number: e.target.value };
                                setRosterRows(next);
                              }}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`roster-size-${i}`}
                              value={row.size}
                              onChange={(e) => {
                                const next = rosterRows.slice();
                                next[i] = { ...row, size: e.target.value };
                                setRosterRows(next);
                              }}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`roster-garment-${i}`}
                              value={row.garmentType || ''}
                              onChange={(e) => {
                                const next = rosterRows.slice();
                                next[i] = { ...row, garmentType: e.target.value };
                                setRosterRows(next);
                              }}
                            />
                          </td>
                          <td>
                            <input
                              aria-label={`roster-qty-${i}`}
                              type="number"
                              min={1}
                              value={row.quantity || 1}
                              onChange={(e) => {
                                const next = rosterRows.slice();
                                next[i] = { ...row, quantity: Number(e.target.value) || 1 };
                                setRosterRows(next);
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p>{t('flow.roster_correct_q')}</p>
                  {rosterPending ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!orderId || !rosterRows) return;
                        void api
                          .post(`/client/orders/${orderId}/roster`, { records: rosterRows, approve: true })
                          .then((res) => {
                            setRosterPending(false);
                            applyOrderView(res.data as { viewer?: ViewerParams });
                            setConfigStep('tpu');
                          })
                          .catch((err) => setNotice(t(apiNoticeKey(err))));
                      }}
                    >
                      {t('flow.yes')}
                    </button>
                  ) : (
                    <p>{t('flow.yes')}</p>
                  )}
                  {distribution ? (
                    <div data-role="design-distribution">
                      <h3>{t('flow.distribution')}</h3>
                      <p>
                        {t('flow.total_units')}: {distribution.totalUnits}
                      </p>
                      {(distribution.families || []).map((fam) => (
                        <p key={fam.garmentType}>
                          {fam.garmentType} × {fam.units}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {configStep === 'tpu' ? (
            <div data-step="tpu">
              <h3>{t('flow.tpu')}</h3>
              <label>
                mm
                <input
                  aria-label="tpu-width"
                  type="number"
                  min={1}
                  max={tpuAdmin?.maxWidth_mm}
                  value={tpuW}
                  onChange={(e) => setTpuW(Number(e.target.value))}
                  onFocus={() => {
                    if (tpuAdmin) return;
                    void api.get('/client/tpu-config').then((res) => {
                      const data = res.data as TpuAdmin;
                      setTpuAdmin(data);
                      if (data.defaultWidth_mm) setTpuW(data.defaultWidth_mm);
                      if (data.defaultHeight_mm) setTpuH(data.defaultHeight_mm);
                    }).catch(() => undefined);
                  }}
                />
                ×
                <input
                  aria-label="tpu-height"
                  type="number"
                  min={1}
                  max={tpuAdmin?.maxHeight_mm}
                  value={tpuH}
                  onChange={(e) => setTpuH(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  if (!orderId) return;
                  void api
                    .patch(`/client/orders/${orderId}/configuration`, { tpu: { width_mm: tpuW, height_mm: tpuH } })
                    .then((res) => {
                      applyOrderView(res.data as { viewer?: ViewerParams });
                      setConfigStep('laser');
                    })
                    .catch((err) => setNotice(t(apiNoticeKey(err))));
                }}
              >
                {t('flow.continue')}
              </button>
            </div>
          ) : null}

          {configStep === 'laser' ? (
            <div data-step="laser">
              <h3>{t('flow.laser')}</h3>
              <label>
                <input type="checkbox" checked={laserOn} onChange={(e) => setLaserOn(e.target.checked)} />
                {t('flow.laser_enable')}
              </label>
              {laserOn ? (
                <label>
                  <input type="checkbox" checked={laserConfirm} onChange={(e) => setLaserConfirm(e.target.checked)} />
                  {t('flow.laser_confirm')}
                </label>
              ) : null}
              <button
                type="button"
                disabled={laserOn && !laserConfirm}
                onClick={() => {
                  if (!orderId) return;
                  void api
                    .patch(`/client/orders/${orderId}/configuration`, {
                      laser: { enabled: laserOn, confirmed: laserOn ? laserConfirm : false },
                    })
                    .then((res) => {
                      applyOrderView(res.data as { viewer?: ViewerParams; total?: number; consumption?: Quote['lines'] });
                      setConfigStep('design');
                    })
                    .catch((err) => setNotice(t(apiNoticeKey(err))));
                }}
              >
                {t('flow.continue')}
              </button>
            </div>
          ) : null}

          {configStep === 'design' || configStep === 'preview' || configStep === 'pay' ? (
            <>
              <h3>{t('flow.upload_design')} — {t('flow.one_design')}</h3>
              <input
                aria-label="design-file"
                type="file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file || !orderId) return;
                  void fileToBase64(file)
                    .then((payload) => {
                      setDesignUrl(payload.url);
                      return api.post(`/client/orders/${orderId}/files`, {
                        filename: payload.name,
                        mimeType: payload.mime,
                        contentBase64: payload.content,
                      });
                    })
                    .then(() => setConfigStep('preview'))
                    .catch((err) => setNotice(t(apiNoticeKey(err))));
                }}
              />
            </>
          ) : null}

          {configStep === 'preview' || configStep === 'pay' ? (
            <>
              <h3>{t('flow.preview')}</h3>
              <ClientOrderPreview3D designUrl={designUrl || undefined} viewer={viewer} />
              <h3>{t('flow.approve_q')}</h3>
              <button
                type="button"
                onClick={() => {
                  setApproved(true);
                  void api
                    .post(`/client/orders/${orderId}/preview-3d-decision`, { status: 'APPROVED' })
                    .then((res) => {
                      applyOrderView(res.data as { viewer?: ViewerParams });
                      setConfigStep('pay');
                    })
                    .catch((err) => setNotice(t(apiNoticeKey(err))));
                }}
              >
                {t('flow.approve_3d')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setApproved(false);
                  void api.post(`/client/orders/${orderId}/preview-3d-decision`, { status: 'REJECTED' }).catch((err) =>
                    setNotice(t(apiNoticeKey(err)))
                  );
                }}
              >
                {t('flow.reject_3d')}
              </button>
              <button
                type="button"
                onClick={() => {
                  void api
                    .post(`/client/orders/${orderId}/preview-3d-decision`, { status: 'RAW' })
                    .then((res) => {
                      setApproved(true);
                      applyOrderView(res.data as { viewer?: ViewerParams });
                      setConfigStep('pay');
                    })
                    .catch((err) => setNotice(t(apiNoticeKey(err))));
                }}
              >
                {t('flow.raw_material')}
              </button>
              {approved === false ? (
                <div>
                  <p>{t('flow.raw_material_q')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      void api
                        .patch(`/client/orders/${orderId}`, { rawMaterial: true, previewApproved: false })
                        .then(() => {
                          setApproved(true);
                          setConfigStep('pay');
                        })
                        .catch((err) => setNotice(t(apiNoticeKey(err))));
                    }}
                  >
                    {t('flow.yes')}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {orderId && payment && payment.checkoutOpen !== false && Number(payment.remaining || 0) > 0 ? (
            <div data-role="payment-portal">
              <h3>{payment.meetsRequired ? t('flow.pay_balance') : t('flow.pay_50')}</h3>
              <p>
                {t('flow.paid')}: {payment.amountPaid || 0} {currency} · {t('flow.pending')}: {payment.remaining ?? payment.amountDue} {currency}
              </p>
              <button
                type="button"
                onClick={() => {
                  void api
                    .post(`/client/orders/${orderId}/payment/checkout`)
                    .then((res) => {
                      const data = res.data as { checkoutUrl?: string };
                      if (data.checkoutUrl) window.open(data.checkoutUrl, '_blank', 'noopener');
                      setNotice(t('flow.pay_checkout'));
                    })
                    .catch((err) => setNotice(t(apiNoticeKey(err))));
                }}
              >
                {t('flow.pay_checkout')}
              </button>
            </div>
          ) : null}

          {approved ? (
            <div>
              <h3>{payment?.meetsRequired && Number(payment.remaining || 0) > 0 ? t('flow.pay_balance') : t('flow.pay_50')}</h3>
              <p>
                {t('flow.total')}: {quote?.total} {currency}
              </p>
              <p>
                {t('flow.pay_50')}: {payment?.amountDue} {currency}
              </p>
              <p>
                {t('flow.paid')}: {payment?.amountPaid || 0} {currency}
              </p>
              <p>
                {t('flow.pending')}: {payment?.remaining ?? payment?.amountDue} {currency}
              </p>
              {Number(payment?.remaining || 0) > 0 ? (
              <label>
                {t('flow.voucher')}
                <input
                  aria-label="voucher-file"
                  type="file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file || !orderId) return;
                    void fileToBase64(file)
                      .then((payload) =>
                        api.post(`/client/orders/${orderId}/payment/voucher`, {
                          filename: payload.name,
                          mimeType: payload.mime,
                          contentBase64: payload.content,
                        })
                      )
                      .then((res) => {
                        const data = res.data as { payment?: Payment };
                        if (data.payment) setPayment(data.payment);
                        setNotice(t('client.saved'));
                      })
                      .catch((err) => setNotice(t(apiNoticeKey(err))));
                  }}
                />
              </label>
              ) : null}
              {payment && payment.meetsRequired === false ? (
                <div>
                  <p>{t('flow.shortfall')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      void api
                        .post('/client/messages', {
                          subject: `${t('flow.ask_exception')} ${projectName}`,
                          content: t('flow.shortfall'),
                          category: 'PAGO_DEUDA',
                          context: { kind: 'PAYMENT', ref: orderId },
                          orderId,
                        })
                        .then(() => setNotice(t('client.sent')))
                        .catch((err) => setNotice(t(apiNoticeKey(err))));
                    }}
                  >
                    {t('flow.ask_exception')}
                  </button>
                </div>
              ) : null}
              <button type="button" onClick={() => setSendConfirm(true)}>
                {t('flow.terminate')}
              </button>
              {sendConfirm ? (
                <div>
                  <p>{t('flow.send_q')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      void api
                        .post(`/client/orders/${orderId}/submit`, {})
                        .then((res) => {
                          const data = res.data as { flowStatusLabel?: string };
                          setFlowStatus(data.flowStatusLabel || flowStatus);
                          setSendConfirm(false);
                          setNotice(t('client.sent'));
                          onCreated();
                        })
                        .catch((err) => setNotice(t(apiNoticeKey(err))));
                    }}
                  >
                    {t('flow.send')}
                  </button>
                  <button type="button" onClick={() => setSendConfirm(false)}>
                    {t('flow.no')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <button type="button" onClick={resetWizard}>
            {t('flow.add_another')}
          </button>
        </div>
      )}
    </div>
  );
};
