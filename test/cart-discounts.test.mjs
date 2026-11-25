import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  customFeeModel, getCartFees, getCartSavings, getItemSavings, promotionLines,
} from '../scripts/components/cart-discounts/cart-discounts.js';

const price = (value) => ({ value, currency: 'USD' });
function fixture() {
  const cart = {
    id: 'displaycartidentifier123456789012',
    appliedDiscounts: [{
      label: 'Diwali Discount ($10.00)\nFixed Amount Discount ($99.00)',
      amount: price(109),
    }],
    subtotal: { includingDiscountOnly: price(777.99) },
    total: { includingTax: price(777.99) },
    items: [{
      uid: 'MQ==', sku: 'A', quantity: 1, price: price(886.99),
      rowTotal: price(886.99), discount: price(109),
    }],
  };
  return { cart };
}

test('the summary lists each promotion line from the Commerce discount label and the native total', () => {
  const { cart } = fixture();
  const summary = getCartSavings(cart);
  assert.deepEqual(summary.promotions, ['Diwali Discount ($10.00)', 'Fixed Amount Discount ($99.00)']);
  assert.equal(summary.discount.value, 109);
  assert.equal(summary.subtotal.value, 777.99);
});

test('product rows show the native item discount and the price after it', () => {
  const { cart } = fixture();
  const item = getItemSavings(cart.items[0]);
  assert.equal(item.discount.value, 109);
  assert.equal(item.afterDiscount.value, 777.99);
  cart.items[0].discount = price(887);
  assert.throws(() => getItemSavings(cart.items[0]), /exceed the item total/);
});

test('promotion labels stay plain text lines; blank lines are dropped', () => {
  const lines = promotionLines({ appliedDiscounts: [{ label: '<img src=x onerror=alert(1)> ($9.00)\n\n  Second  ', amount: price(9) }] });
  assert.deepEqual(lines, ['<img src=x onerror=alert(1)> ($9.00)', 'Second']);
  assert.deepEqual(promotionLines(null), []);
});

test('zero-discount and empty carts show no summary or item savings', () => {
  const { cart } = fixture();
  cart.appliedDiscounts = [];
  cart.items[0].discount = price(0);
  assert.equal(getCartSavings(cart), null);
  assert.equal(getItemSavings(cart.items[0]), null);
  assert.equal(getCartSavings(null), null);
});

test('invalid cart discount amounts fail explicitly', () => {
  for (const value of [NaN, Infinity, -1]) {
    const { cart } = fixture();
    cart.appliedDiscounts[0].amount.value = value;
    assert.throws(() => getCartSavings(cart), /Invalid cart discount amount/);
  }
});

test('native custom fees survive the model extension with currency and labels intact', () => {
  const fees = [
    { code: 'hazardous_packaging', label: 'Hazardous packaging', amount: price(3) },
    { code: 'pallet_handling', label: 'Pallet handling', amount: price(8) },
  ];
  const { cart } = fixture();
  const model = { ...cart, ...customFeeModel({ prices: { custom_fees: fees } }) };
  assert.deepEqual(getCartFees(model), fees);
  assert.equal(getCartSavings(model).discount.value, 109);
  assert.deepEqual(customFeeModel({ prices: { custom_fees: null } }), { customFees: [] });
  assert.deepEqual(customFeeModel({ prices: {} }), { customFees: [] });
  assert.deepEqual(getCartFees(null), []);
});

test('malformed and duplicate native fees cannot become valid-looking display rows', () => {
  const valid = { code: 'fee', label: 'Fee', amount: price(3) };
  for (const fees of [
    {}, [valid, valid], [{ ...valid, code: '' }], [{ ...valid, label: '' }],
    [{ ...valid, amount: price(-3) }], [{ ...valid, amount: price(NaN) }],
    [{ ...valid, amount: { value: 3, currency: 'EUR' } }],
  ]) {
    const { cart } = fixture();
    assert.throws(() => getCartFees({ ...cart, customFees: fees }), /Invalid cart fee/);
  }
});
