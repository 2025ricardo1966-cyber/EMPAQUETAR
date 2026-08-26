import { randomUUID } from 'crypto';
import type { AuthContext, TenantConfig } from '../../contracts/admin-domain';
import { AccessDeniedError } from '../../contracts/admin-domain';
import { RequestInvalidError } from '../../contracts/configuration-schema';
import {
  DEFAULT_WORKSHOP_LIBRARY,
  isWorkshopCategory,
  libraryItemId,
  WORKSHOP_CATEGORIES,
  type WorkshopCatalogItem,
  type WorkshopCategory,
} from '../../contracts/workshop-catalog-domain';
import type { ControlPlaneStore } from '../../cloud/store/ControlPlaneStore';
import {
  isGarmentType,
  readWorkshopOrderConfiguration,
  referenceSizeTables,
  writeWorkshopOrderConfiguration,
  type SizeEntry,
  type SizeTable,
  type TPUAdminConfig,
} from '../../contracts/order-configuration-domain';

function emptyFlags(): Record<WorkshopCategory, boolean> {
  return Object.fromEntries(WORKSHOP_CATEGORIES.map((c) => [c, false])) as Record<WorkshopCategory, boolean>;
}

export class WorkshopCatalogService {
  constructor(private store: ControlPlaneStore) {}

  async categories(ctx: AuthContext, forClient: boolean) {
    const flags = await this.flags(ctx.tenantId);
    return WORKSHOP_CATEGORIES.map((id) => ({
      id,
      enabled: !!flags[id],
      visible: forClient ? !!flags[id] : true,
    })).filter((c) => (forClient ? c.visible : true));
  }

  async setCategory(ctx: AuthContext, category: string, enabled: boolean) {
    this.assertAdmin(ctx);
    if (!isWorkshopCategory(category)) throw new RequestInvalidError('INVALID_CATEGORY');
    const config = await this.requireConfig(ctx.tenantId);
    const flags = { ...emptyFlags(), ...(config.workshopCategories || {}) };
    flags[category] = !!enabled;
    config.workshopCategories = flags;
    config.updatedAt = Date.now();
    await this.store.saveConfig(config);
    return this.categories(ctx, false);
  }

  async listItems(ctx: AuthContext, forClient: boolean): Promise<WorkshopCatalogItem[]> {
    await this.ensureLibrary(ctx.tenantId);
    const flags = await this.flags(ctx.tenantId);
    const items = (await this.store.listWorkshopItems(ctx.tenantId)).filter((i) => i.tenantId === ctx.tenantId);
    if (!forClient) return items;
    return items.filter((i) => flags[i.category] && i.stockEnabled);
  }

  async ensureLibrary(tenantId: string): Promise<void> {
    const existing = await this.store.listWorkshopItems(tenantId);
    const known = new Set(existing.map((i) => i.itemId));
    const named = new Set(existing.map((i) => `${i.category}:${i.name.toLowerCase()}`));
    const now = Date.now();
    for (const row of DEFAULT_WORKSHOP_LIBRARY) {
      const itemId = libraryItemId(row.key);
      if (known.has(itemId) || named.has(`${row.category}:${row.name.toLowerCase()}`)) continue;
      await this.store.saveWorkshopItem({
        itemId,
        tenantId,
        category: row.category,
        name: row.name,
        description: row.description,
        price: 0,
        unit: row.unit,
        stockEnabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  async createItem(ctx: AuthContext, body: Record<string, unknown>): Promise<WorkshopCatalogItem> {
    this.assertAdmin(ctx);
    const category = String(body.category || '');
    if (!isWorkshopCategory(category)) throw new RequestInvalidError('INVALID_CATEGORY');
    const name = String(body.name || '').trim();
    const price = Number(body.price);
    const unit = String(body.unit || '').trim();
    if (!name || !unit || !Number.isFinite(price) || price < 0) throw new RequestInvalidError('INVALID_CATALOG_ITEM');
    const now = Date.now();
    const item: WorkshopCatalogItem = {
      itemId: randomUUID(),
      tenantId: ctx.tenantId,
      category,
      name,
      description: body.description != null ? String(body.description) : '',
      price,
      currency: body.currency != null ? String(body.currency) : undefined,
      unit,
      stockEnabled: body.stockEnabled !== false,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveWorkshopItem(item);
    return item;
  }

  async updateItem(ctx: AuthContext, itemId: string, body: Record<string, unknown>): Promise<WorkshopCatalogItem> {
    this.assertAdmin(ctx);
    const item = await this.store.getWorkshopItem(itemId);
    if (!item || item.tenantId !== ctx.tenantId) throw new AccessDeniedError();
    if (body.category != null) {
      const category = String(body.category);
      if (!isWorkshopCategory(category)) throw new RequestInvalidError('INVALID_CATEGORY');
      item.category = category;
    }
    if (body.name != null) item.name = String(body.name).trim();
    if (body.description != null) item.description = String(body.description);
    if (body.price != null) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) throw new RequestInvalidError('INVALID_CATALOG_ITEM');
      item.price = price;
    }
    if (body.unit != null) item.unit = String(body.unit).trim();
    if (body.stockEnabled != null) item.stockEnabled = !!body.stockEnabled;
    if (body.currency != null) item.currency = String(body.currency);
    if (!item.name || !item.unit) throw new RequestInvalidError('INVALID_CATALOG_ITEM');
    item.updatedAt = Date.now();
    await this.store.saveWorkshopItem(item);
    return item;
  }

  async requireEnabledLine(tenantId: string, itemId: string, quantity: number) {
    const item = await this.store.getWorkshopItem(itemId);
    if (!item || item.tenantId !== tenantId) throw new AccessDeniedError();
    const flags = await this.flags(tenantId);
    if (!flags[item.category] || !item.stockEnabled) throw new RequestInvalidError('ITEM_DISABLED');
    if (!Number.isFinite(quantity) || quantity <= 0) throw new RequestInvalidError('INVALID_QUANTITY');
    return item;
  }

  async listSizeTables(ctx: AuthContext, garmentType?: string): Promise<SizeTable[]> {
    const config = await this.requireConfig(ctx.tenantId);
    const custom = readWorkshopOrderConfiguration(config).sizeTables;
    const all = [...referenceSizeTables(), ...custom];
    if (garmentType && isGarmentType(garmentType)) return all.filter((t) => t.garmentType === garmentType);
    return all;
  }

  async getSizeTable(ctx: AuthContext, tableId: string): Promise<SizeTable> {
    const found = (await this.listSizeTables(ctx)).find((t) => t.id === tableId);
    if (!found) throw new RequestInvalidError('SIZE_TABLE_NOT_FOUND');
    return found;
  }

  async createSizeTable(ctx: AuthContext, body: Record<string, unknown>): Promise<SizeTable> {
    this.assertAdmin(ctx);
    const garmentType = String(body.garmentType || '');
    if (!isGarmentType(garmentType)) throw new RequestInvalidError('INVALID_GARMENT_TYPE');
    const name = String(body.name || '').trim();
    const brand = String(body.brand || '').trim();
    if (!name || !brand) throw new RequestInvalidError('SIZE_TABLE_REQUIRED');
    const now = Date.now();
    const id = `sz_${randomUUID()}`;
    const table: SizeTable = {
      id,
      workshopId: ctx.tenantId,
      name,
      brand,
      garmentType,
      source: 'CUSTOM',
      isEditable: true,
      entries: this.parseEntries(id, body.entries),
      createdAt: now,
      updatedAt: now,
    };
    const config = await this.requireConfig(ctx.tenantId);
    const state = readWorkshopOrderConfiguration(config);
    state.sizeTables.push(table);
    config.config = writeWorkshopOrderConfiguration(config, state);
    config.updatedAt = now;
    await this.store.saveConfig(config);
    return table;
  }

  async updateSizeTable(ctx: AuthContext, tableId: string, body: Record<string, unknown>): Promise<SizeTable> {
    this.assertAdmin(ctx);
    const existing = await this.getSizeTable(ctx, tableId);
    if (!existing.isEditable || existing.source === 'REFERENCE') throw new RequestInvalidError('SIZE_TABLE_IMMUTABLE');
    if (existing.workshopId !== ctx.tenantId) throw new AccessDeniedError();
    const now = Date.now();
    if (body.name != null) existing.name = String(body.name).trim();
    if (body.brand != null) existing.brand = String(body.brand).trim();
    if (body.garmentType != null) {
      if (!isGarmentType(String(body.garmentType))) throw new RequestInvalidError('INVALID_GARMENT_TYPE');
      existing.garmentType = body.garmentType as SizeTable['garmentType'];
    }
    if (body.entries != null) existing.entries = this.parseEntries(existing.id, body.entries);
    existing.updatedAt = now;
    const config = await this.requireConfig(ctx.tenantId);
    const state = readWorkshopOrderConfiguration(config);
    state.sizeTables = state.sizeTables.map((t) => (t.id === existing.id ? existing : t));
    config.config = writeWorkshopOrderConfiguration(config, state);
    config.updatedAt = now;
    await this.store.saveConfig(config);
    return existing;
  }

  async getTpuConfig(ctx: AuthContext): Promise<TPUAdminConfig> {
    const config = await this.requireConfig(ctx.tenantId);
    return readWorkshopOrderConfiguration(config).tpu;
  }

  async putTpuConfig(ctx: AuthContext, body: Record<string, unknown>): Promise<TPUAdminConfig> {
    this.assertAdmin(ctx);
    const current = await this.getTpuConfig(ctx);
    const num = (key: string, fallback: number) => {
      if (body[key] == null) return fallback;
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n <= 0) throw new RequestInvalidError('TPU_INVALID');
      return n;
    };
    const next: TPUAdminConfig = {
      ...current,
      workshopId: ctx.tenantId,
      maxWidth_mm: num('maxWidth_mm', current.maxWidth_mm),
      maxHeight_mm: num('maxHeight_mm', current.maxHeight_mm),
      defaultWidth_mm: num('defaultWidth_mm', current.defaultWidth_mm),
      defaultHeight_mm: num('defaultHeight_mm', current.defaultHeight_mm),
      laserUnitPrice: body.laserUnitPrice != null ? Number(body.laserUnitPrice) : current.laserUnitPrice,
      unit: 'mm',
      enabled: body.enabled != null ? !!body.enabled : current.enabled !== false,
      updatedAt: Date.now(),
    };
    if (!Number.isFinite(next.laserUnitPrice) || next.laserUnitPrice < 0) throw new RequestInvalidError('INVALID_AMOUNT');
    if (next.defaultWidth_mm > next.maxWidth_mm || next.defaultHeight_mm > next.maxHeight_mm) {
      throw new RequestInvalidError('TPU_LIMIT_EXCEEDED');
    }
    const config = await this.requireConfig(ctx.tenantId);
    const state = readWorkshopOrderConfiguration(config);
    state.tpu = next;
    config.config = writeWorkshopOrderConfiguration(config, state);
    config.updatedAt = next.updatedAt;
    await this.store.saveConfig(config);
    return next;
  }

  private parseEntries(tableId: string, raw: unknown): SizeEntry[] {
    if (!Array.isArray(raw) || !raw.length) throw new RequestInvalidError('SIZE_ENTRIES_REQUIRED');
    return raw.map((row, i) => {
      const r = (row || {}) as Record<string, unknown>;
      const label = String(r.label || '').trim();
      if (!label) throw new RequestInvalidError('SIZE_LABEL_REQUIRED');
      const opt = (k: string) => (r[k] == null || r[k] === '' ? undefined : Number(r[k]));
      return {
        id: String(r.id || `${tableId}:${label}`),
        sizeTableId: tableId,
        label,
        chest_cm: opt('chest_cm'),
        hip_cm: opt('hip_cm'),
        length_cm: opt('length_cm'),
        waist_cm: opt('waist_cm'),
        sortOrder: Number.isFinite(Number(r.sortOrder)) ? Number(r.sortOrder) : i + 1,
      };
    });
  }

  private async flags(tenantId: string): Promise<Record<WorkshopCategory, boolean>> {
    const config = await this.store.getConfig(tenantId);
    return { ...emptyFlags(), ...(config?.workshopCategories || {}) };
  }

  private async requireConfig(tenantId: string): Promise<TenantConfig> {
    const config = await this.store.getConfig(tenantId);
    if (!config) throw new RequestInvalidError('CONFIG_NOT_FOUND');
    return config;
  }

  private assertAdmin(ctx: AuthContext) {
    if (!['ADMIN_PRINCIPAL', 'SUBADMIN', 'ADMIN'].includes(ctx.roleId)) throw new AccessDeniedError();
  }
}
