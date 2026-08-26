import { ApiError } from './api-error';

const KEYS: Record<string, string> = {
  MEMBERSHIP_REQUIRED: 'errors.membership_required',
  MEMBERSHIP_EXPIRED: 'errors.membership_expired',
  MEMBERSHIP_SUSPENDED: 'errors.membership_suspended',
  TRIAL_ORDER_LIMIT: 'errors.trial_order_limit',
  EMAIL_NOT_VERIFIED: 'errors.email_not_verified',
  INVALID_ORDER_TRANSITION: 'errors.invalid_order_transition',
  INVALID_MEMBERSHIP_TRANSITION: 'errors.invalid_membership_transition',
  ITEM_DISABLED: 'errors.item_disabled',
  ORDER_ITEMS_REQUIRED: 'errors.order_items_required',
  CUSTOMER_REQUIRED: 'errors.customer_required',
  INVALID_CATALOG_ITEM: 'errors.invalid_catalog_item',
  INVALID_CATEGORY: 'errors.invalid_category',
  ACCESS_DENIED: 'errors.http_403',
  SECURITY_BLOCKED: 'errors.security_blocked',
  INVALID_WHATSAPP_NUMBER: 'errors.invalid_whatsapp_number',
};

export function apiNoticeKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (KEYS[error.code]) return KEYS[error.code];
    if (error.status === 403) return 'errors.http_403';
    if (error.status === 401) return 'errors.http_401';
    if (error.status === 404) return 'errors.http_404';
    if (error.status >= 500) return 'errors.http_500';
  }
  return 'errors.generic';
}
