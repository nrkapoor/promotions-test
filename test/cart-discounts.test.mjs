import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCartSavings, getItemSavings, getPromotionLabels } from '../scripts/components/cart-discounts/cart-discounts.js';

test('scalar item discounts show savings and a net line total without native discount labels', () => {
  const savings = getItemSavings({
    discount: { value: 109, currency: 'USD' },
    rowTotal: { value: 886.99, currency: 'USD' },
    discounted: false,
  });
  assert.deepEqual(savings.afterDiscount, { value: 777.99, currency: 'USD' });
  assert.equal(savings.discount.value, 109);
});

test('each line uses only its own native amount, including BOGO savings', () => {
  assert.equal(getItemSavings({
    discount: { value: 64.27, currency: 'USD' },
    rowTotal: { value: 119.98, currency: 'USD' },
  }).afterDiscount.value, 55.71);
  assert.equal(getItemSavings({
    discount: { value: 5.72, currency: 'USD' },
    rowTotal: { value: 79.99, currency: 'USD' },
  }).afterDiscount.value, 74.27);
});

test('zero and missing discounts do not show savings', () => {
  assert.equal(getItemSavings({}), null);
  assert.equal(getItemSavings({ discount: { value: 0, currency: 'USD' } }), null);
});

test('a fully discounted line has a zero after-promotion total', () => {
  assert.deepEqual(getItemSavings({
    discount: { value: 59.99, currency: 'USD' },
    rowTotal: { value: 59.99, currency: 'USD' },
  }).afterDiscount, { value: 0, currency: 'USD' });
});

test('inconsistent currencies or invalid monetary amounts fail explicitly', () => {
  assert.throws(() => getItemSavings({
    discount: { value: 109, currency: 'USD' },
    rowTotal: { value: 100, currency: 'USD' },
  }), /does not match/);
  assert.throws(() => getItemSavings({
    discount: { value: 1, currency: 'EUR' },
    rowTotal: { value: 100, currency: 'USD' },
  }), /does not match/);
  assert.throws(() => getItemSavings({ discount: { value: NaN } }), /Invalid/);
});

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
