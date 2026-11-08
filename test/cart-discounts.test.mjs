import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCartSavings, getPromotionLabels } from '../scripts/components/cart-discounts/cart-discounts.js';

test('promotion labels split actual and escaped newlines without parsing money or HTML', () => {
  assert.deepEqual(getPromotionLabels([
    'Diwali Discount ($10.00)\nFixed Amount Discount ($99.00)',
    'BOGO ($59.99)\\nOther offer ($5.00)',
    '<img src=x onerror=alert(1)> ($1.00)',
  ]), [
    'Diwali Discount ($10.00)', 'Fixed Amount Discount ($99.00)',
    'BOGO ($59.99)', 'Other offer ($5.00)',
    '<img src=x onerror=alert(1)> ($1.00)',
  ]);
});

test('cart summary keeps one aggregate amount and names each promotion separately', () => {
  const summary = getCartSavings({
    appliedDiscounts: [{
      label: 'Diwali Discount ($10.00)\nFixed Amount Discount ($99.00)',
      amount: { value: 109, currency: 'USD' },
    }],
    subtotal: { includingDiscountOnly: { value: 777.99, currency: 'USD' } },
  });
  assert.deepEqual(summary.discount, { value: 109, currency: 'USD' });
  assert.deepEqual(summary.labels, ['Diwali Discount ($10.00)', 'Fixed Amount Discount ($99.00)']);
  assert.equal(summary.subtotal.value, 777.99);
});

test('separate native cart discounts are summed once, never inferred from label text', () => {
  const summary = getCartSavings({
    appliedDiscounts: [
      { label: 'Offer ($999.00)', amount: { value: 10.01, currency: 'USD' } },
      { label: 'Other offer', amount: { value: 2.02, currency: 'USD' } },
    ],
  });
  assert.equal(summary.discount.value, 12.03);
  assert.equal(getCartSavings(null), null);
  assert.equal(getCartSavings({ appliedDiscounts: [] }), null);
});

test('cart summary rejects mixed currencies and hides zero discounts', () => {
  assert.throws(() => getCartSavings({
    appliedDiscounts: [
      { label: 'First', amount: { value: 10, currency: 'USD' } },
      { label: 'Second', amount: { value: 2, currency: 'EUR' } },
    ],
  }), /currencies do not match/);
  assert.equal(getCartSavings({
    appliedDiscounts: [{ label: 'Inactive', amount: { value: 0, currency: 'USD' } }],
  }), null);
});

test('cart promotion totals do not change when item allocations are redistributed', () => {
  const cart = {
    appliedDiscounts: [{
      label: 'Diwali Discount ($10.00)\nFixed Amount Discount ($99.00)',
      amount: { value: 109, currency: 'USD' },
    }],
    subtotal: { includingDiscountOnly: { value: 777.99, currency: 'USD' } },
    items: [{ discount: { value: 109, currency: 'USD' } }],
  };
  const before = getCartSavings(cart);
  cart.items = [
    { discount: { value: 2.12, currency: 'USD' } },
    { discount: { value: 106.88, currency: 'USD' } },
  ];
  assert.deepEqual(getCartSavings(cart), before);
  assert.deepEqual(before.labels, ['Diwali Discount ($10.00)', 'Fixed Amount Discount ($99.00)']);
  assert.equal(before.discount.value, 109);
});

test('invalid cart discount amounts fail explicitly', () => {
  for (const value of [NaN, Infinity, -1]) {
    assert.throws(() => getCartSavings({
      appliedDiscounts: [{ label: 'Invalid', amount: { value, currency: 'USD' } }],
    }), /Invalid cart discount amount/);
  }
});
