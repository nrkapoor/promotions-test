import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cartFingerprint, getCartSavings, getItemSavings, validatePromotionDisplay,
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
  const display = {
    version: 1,
    fingerprint: cartFingerprint(cart),
    currency: 'USD',
    total: price(109),
    promotions: [
      {
        id: 'diwali', description: 'Diwali Discount', placement: 'CART', amount: price(10),
        allocations: [{ uid: 'MQ==', amount: price(10) }],
      },
      {
        id: 'fixed', description: 'Fixed Amount Discount', placement: 'ITEM', amount: price(99),
        allocations: [{ uid: 'MQ==', amount: price(99) }],
      },
    ],
  };
  return { cart, display };
}

test('targeted promotions appear only on product rows; untargeted names appear only in the summary', () => {
  const { cart, display } = fixture();
  assert.equal(validatePromotionDisplay(display, cart), display);
  const item = getItemSavings(cart.items[0], display);
  assert.deepEqual(item.promotions.map((value) => value.description), ['Fixed Amount Discount']);
  assert.equal(item.discount.value, 99);
  assert.equal(item.afterDiscount.value, 787.99);
  const summary = getCartSavings(cart, display);
  assert.deepEqual(summary.promotions.map((value) => value.description), ['Diwali Discount']);
  assert.equal(summary.promotions[0].amount.value, 10);
  assert.equal(summary.discount.value, 109);
  assert.equal(summary.subtotal.value, 777.99);
});

test('untargeted promotions never show their native allocations on product rows', () => {
  const { cart, display } = fixture();
  display.promotions[1].placement = 'CART';
  assert.equal(getItemSavings(cart.items[0], validatePromotionDisplay(display, cart)), null);
  assert.equal(getCartSavings(cart, display).promotions.length, 2);
});

test('category promotion shares remain on eligible items without exposing cart-wide shares', () => {
  const { cart, display } = fixture();
  cart.items = [
    { uid: 'MQ==', sku: 'A', quantity: 1, price: price(100), rowTotal: price(100), discount: price(42.12) },
    { uid: 'Mg==', sku: 'B', quantity: 1, price: price(200), rowTotal: price(200), discount: price(66.88) },
  ];
  display.fingerprint = cartFingerprint(cart);
  display.promotions[0].allocations = [
    { uid: 'MQ==', amount: price(2.12) }, { uid: 'Mg==', amount: price(7.88) },
  ];
  display.promotions[1].allocations = [
    { uid: 'MQ==', amount: price(40) }, { uid: 'Mg==', amount: price(59) },
  ];
  validatePromotionDisplay(display, cart);
  assert.equal(getItemSavings(cart.items[0], display).discount.value, 40);
  assert.equal(getItemSavings(cart.items[1], display).discount.value, 59);
  assert.equal(getCartSavings(cart, display).promotions[0].amount.value, 10);
});

test('BOGO displays only its item-specific amount and does not subtract a cart promotion from the row', () => {
  const { cart, display } = fixture();
  cart.items[0].quantity = 3;
  cart.items[0].price = price(59.99);
  cart.items[0].rowTotal = price(179.97);
  cart.items[0].discount = price(69.99);
  cart.appliedDiscounts[0].amount = price(69.99);
  display.total = price(69.99);
  display.fingerprint = cartFingerprint(cart);
  display.promotions[1] = {
    id: 'bogo', description: 'Buy 2 get 1', placement: 'ITEM', amount: price(59.99),
    allocations: [{ uid: 'MQ==', amount: price(59.99) }],
  };
  validatePromotionDisplay(display, cart);
  assert.equal(getItemSavings(cart.items[0], display).afterDiscount.value, 119.98);
  assert.deepEqual(getCartSavings(cart, display).promotions.map((value) => value.id), ['diwali']);
});

test('stale cart data, unknown items and duplicate allocations are rejected', () => {
  const { cart, display } = fixture();
  const stale = structuredClone(display);
  stale.fingerprint = 'old-cart';
  assert.throws(() => validatePromotionDisplay(stale, cart), /do not match/);
  const unknown = structuredClone(display);
  unknown.promotions[1].allocations[0].uid = 'unknown';
  assert.throws(() => validatePromotionDisplay(unknown, cart), /item allocation/);
  const duplicate = structuredClone(display);
  duplicate.promotions[1].allocations.push(duplicate.promotions[1].allocations[0]);
  assert.throws(() => validatePromotionDisplay(duplicate, cart), /Invalid/);
});

test('totals, currency and per-item allocation conservation are validated against Commerce', () => {
  for (const change of [
    (display) => { display.total.value = 110; },
    (display) => { display.promotions[1].amount.currency = 'EUR'; },
    (display) => { display.promotions[1].allocations[0].amount.value = 98; },
    (display) => { display.promotions[1].id = 'diwali'; },
  ]) {
    const { cart, display } = fixture();
    change(display);
    assert.throws(() => validatePromotionDisplay(display, cart));
  }
});

test('loading or unavailable metadata never substitutes aggregate allocations for item savings', () => {
  const { cart } = fixture();
  assert.equal(getItemSavings(cart.items[0], null), null);
  assert.deepEqual(getCartSavings(cart, null).promotions, []);
  assert.equal(getCartSavings(cart, null).discount.value, 109);
});

test('promotion descriptions are plain strings; contribution amounts are never parsed from names', () => {
  const { cart, display } = fixture();
  display.promotions[0].description = '<img src=x onerror=alert(1)> ($999.00)\nSecond line';
  validatePromotionDisplay(display, cart);
  const promotion = getCartSavings(cart, display).promotions[0];
  assert.equal(promotion.description, display.promotions[0].description);
  assert.equal(promotion.amount.value, 10);
});

test('zero-discount and empty carts show no summary or item savings', () => {
  const { cart, display } = fixture();
  cart.appliedDiscounts = [];
  cart.items[0].discount = price(0);
  display.promotions = [];
  display.total = price(0);
  display.fingerprint = cartFingerprint(cart);
  validatePromotionDisplay(display, cart);
  assert.equal(getCartSavings(cart, display), null);
  assert.equal(getItemSavings(cart.items[0], display), null);
  assert.equal(getCartSavings(null), null);
});

test('invalid cart discount amounts fail explicitly', () => {
  for (const value of [NaN, Infinity, -1]) {
    const { cart } = fixture();
    cart.appliedDiscounts[0].amount.value = value;
    assert.throws(() => getCartSavings(cart), /Invalid cart discount amount/);
  }
});
