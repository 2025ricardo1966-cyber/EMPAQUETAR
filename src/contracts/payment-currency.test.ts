import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveChargeCurrency, toStripeIntegerAmount } from './payment-currency';

test('charge currency is env, then tenant, then USD — never ARS by default', () => {
  assert.equal(resolveChargeCurrency({}), 'USD');
  assert.equal(resolveChargeCurrency({ tenantCurrency: 'eur' }), 'EUR');
  assert.equal(resolveChargeCurrency({ tenantCurrency: 'ARS', envCurrency: 'USD' }), 'USD');
  assert.equal(resolveChargeCurrency({ tenantCurrency: 'nope' }), 'USD');
});

test('stripe integer amounts follow ISO 4217 zero-decimal rules', () => {
  assert.equal(toStripeIntegerAmount(10.5, 'USD'), 1050);
  assert.equal(toStripeIntegerAmount(1000, 'JPY'), 1000);
});
