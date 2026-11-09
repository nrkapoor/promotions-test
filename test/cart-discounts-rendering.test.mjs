import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { cartFingerprint } from '../scripts/components/cart-discounts/cart-discounts.js';

const state = { cart: null, requests: [], errors: [] };
globalThis.promotionTest = state;
const sources = new Map([
  ['@dropins/tools/event-bus.js', 'export const events = { lastPayload: () => globalThis.promotionTest.cart };'],
  ['@dropins/tools/preact.js', 'export const h = (type, props) => ({ type, props });'],
  ['@dropins/tools/lib.js', 'export const getCookie = () => "";'],
  ['@dropins/tools/lib/aem/configs.js', 'export const getConfigValue = () => "https://display.example/api";'],
]);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return sources.has(specifier)
      ? { url: `promotion-test:${specifier}`, shortCircuit: true }
      : nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    return url.startsWith('promotion-test:')
      ? { format: 'module', source: sources.get(url.slice('promotion-test:'.length)), shortCircuit: true }
      : nextLoad(url, context);
  },
});
const { renderCartSavings, renderItemPromotions } = await import(
  '../scripts/components/cart-discounts/promotion-display.js'
);
hooks.deregister();
delete globalThis.promotionTest;
const saved = { document: globalThis.document, fetch: globalThis.fetch, error: console.error };

class Element {
  children = [];
  hidden = false;
  isConnected = true;
  value = '';
  get textContent() { return this.value + this.children.map((child) => child.textContent).join(' '); }
  set textContent(value) { this.value = value; this.children = []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.value = ''; }
  setAttribute() {}
}

const money = (value) => ({ value, currency: 'USD' });
function cart(label) {
  return {
    id: 'renderer_test_cart', total: { includingTax: money(191) },
    subtotal: { includingDiscountOnly: money(191) },
    appliedDiscounts: [{ label, amount: money(109) }],
    items: [
      { uid: 'a', sku: 'a', quantity: 1, price: money(100), rowTotal: money(100), discount: money(2.12) },
      { uid: 'b', sku: 'b', quantity: 1, price: money(200), rowTotal: money(200), discount: money(106.88) },
    ],
  };
}
function display(model, description) {
  return {
    version: 1, currency: 'USD', fingerprint: cartFingerprint(model), total: money(109),
    promotions: [
      {
        id: 'cart', description: 'Diwali', placement: 'CART', amount: money(10),
        allocations: [{ uid: 'a', amount: money(2.12) }, { uid: 'b', amount: money(7.88) }],
      },
      {
        id: 'product', description, placement: 'ITEM', amount: money(99),
        allocations: [{ uid: 'b', amount: money(99) }],
      },
    ],
  };
}
function context(data) {
  const result = { data, children: [], callbacks: [] };
  result.appendChild = (element) => result.children.push(element);
  result.onChange = (callback) => result.callbacks.push(callback);
  return result;
}
function update(ctx, model) {
  state.cart = model;
  ctx.callbacks.forEach((callback) => callback({ data: model }));
}
function complete(index, body, status = 200) {
  state.requests[index].resolve(new Response(JSON.stringify(body), { status }));
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test.before(() => {
  globalThis.promotionTest = state;
  globalThis.document = { createElement: () => new Element(), documentElement: { lang: 'en' } };
  globalThis.fetch = () => new Promise((resolve) => state.requests.push({ resolve }));
  console.error = (message) => state.errors.push(message);
});
test.after(() => {
  globalThis.document = saved.document;
  globalThis.fetch = saved.fetch;
  console.error = saved.error;
  delete globalThis.promotionTest;
});

test('same-price promotion changes refresh product slots without item onChange', async () => {
  state.cart = cart('Original product promotion');
  const summary = context(state.cart);
  const item = context();
  item.item = state.cart.items[1];
  const before = state.requests.length;
  renderCartSavings(summary);
  renderItemPromotions(item);
  assert.equal(state.requests.length - before, 1);
  complete(before, display(state.cart, 'Original product promotion'));
  await settle();
  assert.match(item.children[0].textContent, /Original product promotion/);
  assert.doesNotMatch(summary.children[0].textContent, /Original product promotion/);
  const updated = cart('Updated product promotion');
  update(summary, updated);
  assert.equal(item.children[0].hidden, true);
  complete(before + 1, display(updated, 'Updated product promotion'));
  await settle();
  assert.equal(item.children[0].hidden, false);
  assert.match(item.children[0].textContent, /Updated product promotion/);
  assert.match(item.children[0].textContent, /\$101\.00/);
  assert.doesNotMatch(item.children[0].textContent, /Diwali|\$106\.88/);
  item.children[0].isConnected = false;
});

test('older successes and failures cannot overwrite current product metadata', async () => {
  state.cart = cart('Delayed old response');
  const summary = context(state.cart);
  const item = context();
  item.item = state.cart.items[1];
  const before = state.requests.length;
  const old = state.cart;
  renderCartSavings(summary);
  renderItemPromotions(item);
  const current = cart('Current product promotion');
  update(summary, current);
  complete(before + 1, display(current, 'Current product promotion'));
  await settle();
  complete(before, display(old, 'Delayed old response'));
  await settle();
  assert.match(item.children[0].textContent, /Current product promotion/);
  const olderFailure = state.requests.length;
  update(summary, cart('Delayed failure'));
  const newest = cart('Newest product promotion');
  update(summary, newest);
  complete(olderFailure + 1, display(newest, 'Newest product promotion'));
  await settle();
  complete(olderFailure, { error: 'Old request failed.' }, 503);
  await settle();
  assert.equal(item.children[0].hidden, false);
  assert.match(item.children[0].textContent, /Newest product promotion/);
  assert.doesNotMatch(summary.children[0].textContent, /could not be loaded/);
  item.children[0].isConnected = false;
});
