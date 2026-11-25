import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const state = { cart: null, errors: [] };
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
const { renderCartSavings, renderItemPromotions, orderSummaryPromotions } = await import(
  '../scripts/components/cart-discounts/promotion-display.js'
);
hooks.deregister();
delete globalThis.promotionTest;
const saved = { document: globalThis.document, fetch: globalThis.fetch, error: console.error };
let fetches = 0;

class Element {
  children = [];
  hidden = false;
  isConnected = true;
  value = '';
  get textContent() { return this.value + this.children.map((child) => child.textContent).join(' '); }
  set textContent(value) { this.value = value; this.children = []; }
  append(...children) { this.children.push(...children); }
  appendChild(child) {
    if (child.parentElement === this) return;
    child.parentElement = this;
    this.append(child);
  }
  replaceChildren(...children) { this.children = children; this.value = ''; }
  attributes = {};
  setAttribute(name, value) { this.attributes[name] = value; }
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

test.before(() => {
  globalThis.promotionTest = state;
  globalThis.document = { createElement: () => new Element(), documentElement: { lang: 'en' } };
  globalThis.fetch = () => { fetches += 1; return new Promise(() => {}); };
  console.error = (message) => state.errors.push(message);
});
test.after(() => {
  globalThis.document = saved.document;
  globalThis.fetch = saved.fetch;
  console.error = saved.error;
  delete globalThis.promotionTest;
});

test('summary and product rows render from Commerce cart data without calling the app', () => {
  state.cart = cart('Diwali ($10.00)\nProduct promotion ($99.00)');
  const summary = context(state.cart);
  const item = context();
  item.item = state.cart.items[1];
  renderCartSavings(summary);
  renderItemPromotions(item);
  assert.match(summary.children[0].textContent, /Diwali \(\$10\.00\)/);
  assert.match(summary.children[0].textContent, /Product promotion \(\$99\.00\)/);
  assert.match(summary.children[0].textContent, /Total promotion savings \u2212\$109\.00/);
  assert.equal(item.children[0].hidden, false);
  assert.match(item.children[0].textContent, /Promotion savings \u2212\$106\.88/);
  assert.match(item.children[0].textContent, /After promotions \(excl\. tax\) \$93\.12/);
  assert.equal(fetches, 0);
});

test('product rows follow cart changes and hide when the item has no discount', () => {
  state.cart = cart('Diwali ($10.00)');
  const item = context();
  item.item = state.cart.items[0];
  renderItemPromotions(item);
  assert.match(item.children[0].textContent, /\u2212\$2\.12/);
  const updated = cart('Diwali ($10.00)');
  updated.items[0].discount = money(0);
  state.cart = updated;
  item.callbacks.forEach((callback) => callback({ item: updated.items[0] }));
  assert.equal(item.children[0].hidden, true);
  assert.equal(fetches, 0);
});

test('fee-only cart and minicart show native positive fees', () => {
  const model = {
    ...cart(''), appliedDiscounts: [],
    customFees: [{ code: 'hazardous_packaging', label: 'Hazardous packaging', amount: money(3) }],
  };
  state.cart = model;
  const mini = context(model);
  renderCartSavings(mini);
  assert.equal(mini.children[0].hidden, false);
  assert.match(mini.children[0].textContent, /Hazardous packaging \+\$3\.00/);
  assert.doesNotMatch(mini.children[0].textContent, /Total promotion savings/);
  const summary = orderSummaryPromotions();
  const lines = summary([{ key: 'discountsContent' }, { key: 'taxContent', content: 'tax' }]);
  const target = new Element();
  lines[0].content.props.ref(target);
  assert.match(target.textContent, /Hazardous packaging \+\$3\.00/);
  assert.equal(lines[1].content, 'tax');
});

test('fees update, do not duplicate on refresh, and disappear when removed', () => {
  const feeCart = (value) => ({
    ...cart(''), appliedDiscounts: [],
    customFees: [{ code: 'pallet_handling', label: 'Pallet handling', amount: money(value) }],
  });
  const initial = feeCart(4);
  const mini = context(initial);
  renderCartSavings(mini);
  const summary = orderSummaryPromotions();
  const target = new Element();
  const renderSummary = (model) => {
    state.cart = model;
    summary([{ key: 'discountsContent' }])[0].content.props.ref(target);
  };
  renderSummary(initial);
  for (const value of [8, 8]) {
    const model = feeCart(value);
    update(mini, model);
    renderSummary(model);
    assert.match(mini.children[0].textContent, /Pallet handling \+\$8\.00/);
    assert.match(target.textContent, /Pallet handling \+\$8\.00/);
    assert.equal((target.textContent.match(/Pallet handling/g) ?? []).length, 1);
  }
  const removed = { ...initial, customFees: [] };
  update(mini, removed);
  renderSummary(removed);
  assert.equal(mini.children[0].hidden, true);
  assert.doesNotMatch(target.textContent, /Pallet handling/);
});

test('fee rows remain independent of discount savings and their failures', () => {
  const model = {
    ...cart('Discount alongside fee ($109.00)'),
    customFees: [{ code: 'pallet_handling', label: 'Pallet handling', amount: money(8) }],
  };
  state.cart = model;
  const summary = context(model);
  renderCartSavings(summary);
  assert.match(summary.children[0].textContent, /Pallet handling \+\$8\.00/);
  assert.match(summary.children[0].textContent, /Total promotion savings \u2212\$109\.00/);
  const broken = { ...model, appliedDiscounts: [{ label: 'Broken', amount: money(-1) }] };
  update(summary, broken);
  assert.match(summary.children[0].textContent, /Pallet handling \+\$8\.00/);
  assert.match(summary.children[0].textContent, /Savings details could not be displayed/);
});

test('invalid fee data shows an explicit error without changing cart totals', () => {
  const model = {
    ...cart(''), appliedDiscounts: [],
    customFees: [{ code: 'fee', label: 'Fee', amount: { value: 3, currency: 'EUR' } }],
  };
  const originalTotal = structuredClone(model.total);
  const ctx = context(model);
  renderCartSavings(ctx);
  assert.equal(ctx.children[0].hidden, false);
  assert.match(ctx.children[0].textContent, /Fee details could not be displayed/);
  assert.equal(ctx.children[0].children[0].attributes.role, 'alert');
  assert.deepEqual(model.total, originalTotal);
});
