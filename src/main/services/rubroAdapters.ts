import type { TenantConfig } from '../../contracts/admin-domain';
import type { Rubro } from '../../contracts/auth-rbac';
import type { CatalogProduct } from '../../contracts/catalog-domain';
import { defaultTenantConfig } from './defaultTenantConfig';
import { LAUNCH_DEFAULTS } from '../../contracts/international-domain';

function product(
  tenantId: string,
  productId: string,
  name: string,
  rubricId: string,
  materialIds: string[],
  processIds: string[],
  internalCost: number,
  now: number
): CatalogProduct {
  return {
    productId,
    tenantId,
    name,
    rubricId,
    active: true,
    materialIds,
    processIds,
    unitId: 'UNIT',
    internalCost,
    margin: Math.round(internalCost * 0.4),
    supplierPrice: Math.round(internalCost * 0.8),
    createdAt: now,
    updatedAt: now,
  };
}

export function applyRubro(config: TenantConfig, rubro: Rubro, now = Date.now()): TenantConfig {
  const seed = defaultTenantConfig(config.tenantId, now);
  const next: TenantConfig = {
    ...config,
    units: seed.units,
    statusPresentation: seed.statusPresentation,
    customerFieldAllowlist: seed.customerFieldAllowlist,
    rubro,
    setupDone: false,
    config: { rubro },
    updatedAt: now,
  };

  if (rubro === 'CUSTOM') {
    next.disciplines = seed.disciplines.map((d) => ({ ...d, enabled: false }));
    next.fields = [];
    next.materials = [];
    next.products = [];
    next.processes = [];
    next.config = { rubro, products: [], materials: [], processes: [], units: next.units };
    return next;
  }

  if (rubro === 'TEXTIL') {
    next.disciplines = seed.disciplines.map((d) => ({ ...d, enabled: d.id === 'textile' }));
    next.fields = seed.fields.filter((f) => f.disciplineId === 'textile');
    next.materials = seed.materials
      .filter((m) => m.disciplineId === 'textile')
      .map((m) => ({
        ...m,
        internalUnitCost: 500,
        customerUnitPrice: 800,
        costConfiguration: {
          type: 'PER_METER',
          internalCost: 500,
          customerPrice: 800,
          currency: LAUNCH_DEFAULTS.currency,
          unitId: 'M',
        },
      }));
    next.processes = [
      { id: 'textile.sublimacion', label: 'Sublimación', enabled: true, type: 'print', order: 1, required: true, disciplineId: 'textile' },
      { id: 'textile.dtf', label: 'DTF', enabled: true, type: 'print', order: 2, required: false, disciplineId: 'textile' },
      { id: 'textile.serigrafia', label: 'Serigrafía', enabled: true, type: 'print', order: 3, required: false, disciplineId: 'textile' },
      ...(seed.processes || []).filter((p) => p.disciplineId === 'textile'),
    ];
    next.products = [
      product(config.tenantId, 'prod-remera', 'Remera', 'textile', ['tela-deportiva'], ['textile.sublimacion'], 120, now),
      product(config.tenantId, 'prod-buzo', 'Buzo', 'textile', ['tela-deportiva'], ['textile.serigrafia'], 220, now),
      product(config.tenantId, 'prod-pantalon', 'Pantalón', 'textile', ['tela-deportiva'], ['textile.dtf'], 180, now),
    ];
    next.config = {
      rubro,
      products: next.products,
      materials: next.materials,
      processes: next.processes,
      units: next.units,
    };
    return next;
  }

  if (rubro === 'TPU') {
    next.disciplines = seed.disciplines.map((d) => ({ ...d, enabled: d.id === 'tpu' }));
    next.fields = seed.fields.filter((f) => f.disciplineId === 'tpu');
    next.materials = [
      ...seed.materials.filter((m) => m.disciplineId === 'tpu').map((m) => ({ ...m, internalUnitCost: 400, customerUnitPrice: 600 })),
      {
        materialId: 'vinilo-tpu',
        name: 'Vinilo',
        unit: 'METRO',
        unitId: 'M',
        costType: 'PER_METER',
        internalUnitCost: 350,
        customerUnitPrice: 520,
        disciplineId: 'tpu',
        active: true,
      },
    ];
    next.processes = [
      { id: 'tpu.corte', label: 'Corte', enabled: true, type: 'prepare', order: 1, required: true, disciplineId: 'tpu' },
      { id: 'tpu.aplicacion', label: 'Aplicación', enabled: true, type: 'production', order: 2, required: true, disciplineId: 'tpu' },
    ];
    next.products = [product(config.tenantId, 'prod-tpu-film', 'Film TPU', 'tpu', ['film-tpu'], ['tpu.corte'], 90, now)];
    next.config = { rubro, products: next.products, materials: next.materials, processes: next.processes, units: next.units };
    return next;
  }

  if (rubro === 'DTF') {
    next.disciplines = seed.disciplines.map((d) => ({ ...d, enabled: d.id === 'dtf' }));
    next.fields = seed.fields.filter((f) => f.disciplineId === 'dtf');
    next.materials = [
      ...seed.materials.filter((m) => m.disciplineId === 'dtf').map((m) => ({ ...m, internalUnitCost: 300, customerUnitPrice: 450 })),
      {
        materialId: 'polvo-adhesivo',
        name: 'Polvo adhesivo',
        unit: 'KG',
        unitId: 'KG',
        costType: 'PER_UNIT',
        internalUnitCost: 80,
        customerUnitPrice: 120,
        disciplineId: 'dtf',
        active: true,
      },
    ];
    next.processes = [
      { id: 'dtf.impresion', label: 'Impresión DTF', enabled: true, type: 'print', order: 1, required: true, disciplineId: 'dtf' },
      { id: 'dtf.transfer', label: 'Transfer', enabled: true, type: 'production', order: 2, required: true, disciplineId: 'dtf' },
    ];
    next.products = [product(config.tenantId, 'prod-dtf', 'Transfer DTF', 'dtf', ['film-dtf'], ['dtf.impresion'], 70, now)];
    next.config = { rubro, products: next.products, materials: next.materials, processes: next.processes, units: next.units };
    return next;
  }

  next.disciplines = [
    ...seed.disciplines.map((d) => ({ ...d, enabled: false })),
    { id: 'publicidad', label: 'Publicidad', enabled: true },
  ];
  next.fields = [];
  next.materials = [
    {
      materialId: 'banner',
      name: 'Banner',
      unit: 'M2',
      unitId: 'M2',
      costType: 'PER_M2',
      internalUnitCost: 200,
      customerUnitPrice: 350,
      disciplineId: 'publicidad',
      active: true,
    },
    {
      materialId: 'vinilo-pub',
      name: 'Vinilo',
      unit: 'M',
      unitId: 'M',
      costType: 'PER_METER',
      internalUnitCost: 150,
      customerUnitPrice: 280,
      disciplineId: 'publicidad',
      active: true,
    },
    {
      materialId: 'papel-pub',
      name: 'Papel',
      unit: 'M2',
      unitId: 'M2',
      costType: 'PER_M2',
      internalUnitCost: 40,
      customerUnitPrice: 90,
      disciplineId: 'publicidad',
      active: true,
    },
  ];
  next.processes = [
    { id: 'pub.gran-formato', label: 'Impresión gran formato', enabled: true, type: 'print', order: 1, required: true, disciplineId: 'publicidad' },
    { id: 'pub.corte', label: 'Corte', enabled: true, type: 'prepare', order: 2, required: true, disciplineId: 'publicidad' },
  ];
  next.products = [product(config.tenantId, 'prod-banner', 'Banner', 'publicidad', ['banner'], ['pub.gran-formato'], 250, now)];
  next.config = { rubro, products: next.products, materials: next.materials, processes: next.processes, units: next.units };
  return next;
}
