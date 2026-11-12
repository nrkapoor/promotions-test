import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';

const none = { version: 0, phase: 'NONE', expiresAt: null, canRemove: false, promotions: [] };

test('checkout loads its full renderer only after a nonempty cart or placed order', async (t) => {
  const browser = await chromium.launch();
  try {
    const cases = [
      { name: 'no cart redirects without checkout downloads', cart: null, redirect: true },
      { name: 'empty cart redirects without checkout downloads', cart: { items: [] }, redirect: true },
      { name: 'populated cart loads checkout', cart: { items: [{}] } },
      { name: 'placed order preserves confirmation', cart: null, orderPlaced: true },
      { name: 'uninitialized cart waits, then redirects', delayed: true, cart: null, redirect: true },
      { name: 'uninitialized cart waits, then loads checkout', delayed: true, cart: { items: [{}] } },
    ];
    for (const fixture of cases) {
      await t.test(fixture.name, async () => {
        const page = await browser.newPage();
        const downloads = [];
        await page.route('https://checkout-ui.invalid/**', async (route) => {
          const { pathname } = new URL(route.request().url());
          let body;
          let contentType = 'text/javascript';
          if (pathname === '/checkout') {
            contentType = 'text/html';
            body = `<script type="importmap">{"imports":{"@dropins/tools/event-bus.js":"/events.js"}}</script>
              <main></main><script type="module">
              import decorate from '/blocks/commerce-checkout/commerce-checkout.js';
              window.decoration = decorate(document.querySelector('main'));
              </script>`;
          } else if (pathname === '/events.js') {
            body = `export const events = {
              lastPayload: (name) => name === 'order/placed'
                ? (window.fixture.orderPlaced ? {} : undefined)
                : (window.fixture.delayed ? undefined : window.fixture.cart),
              on: (name, callback) => {
                window.initializeCart = callback;
                return { off: () => { window.unsubscribed = true; } };
              },
            };`;
          } else if (pathname === '/scripts/commerce.js') {
            body = 'export const rootLink = path => path;';
          } else if (pathname === '/blocks/commerce-checkout/commerce-checkout.js') {
            body = await readFile(new URL('../blocks/commerce-checkout/commerce-checkout.js', import.meta.url), 'utf8');
          } else if (pathname === '/blocks/commerce-checkout/checkout.js') {
            downloads.push(pathname);
            body = 'export default async block => { block.textContent = "Checkout rendered"; };';
          } else if (pathname === '/cart') {
            contentType = 'text/html';
            body = '<main>Cart</main>';
          } else {
            throw new Error(`Unexpected request: ${pathname}`);
          }
          await route.fulfill({ contentType, body });
        });
        await page.addInitScript((value) => { window.fixture = value; }, fixture);
        await page.goto('https://checkout-ui.invalid/checkout');
        if (fixture.delayed) {
          await page.waitForFunction(() => window.initializeCart);
          assert.equal(downloads.length, 0);
          assert.equal(await page.evaluate(() => {
            window.initializeCart(window.fixture.cart);
            return window.unsubscribed;
          }), true);
        }
        if (fixture.redirect) {
          await page.waitForURL('https://checkout-ui.invalid/cart');
          assert.equal(downloads.length, 0);
        } else {
          await page.waitForFunction(() => document.querySelector('main').textContent === 'Checkout rendered');
          assert.equal(downloads.length, 1);
        }
        await page.close();
      });
    }
  } finally {
    await browser.close();
  }
});

const reserved = {
  version: 2, phase: 'RESERVED', expiresAt: new Date(Date.now() + 60000).toISOString(), canRemove: true,
  promotions: [{ id: 'percent', description: '<img src=x> Ten percent off' }],
};
const released = { ...none, version: 4, phase: 'RELEASED' };
const stubs = {
  '/mocks/events.js': `export const events = {
    on: (name, callback) => (window.fixture.events[name] ??= []).push(callback),
    lastPayload: () => null,
  };`,
  '/mocks/lib.js': 'export const getCookie = () => window.fixture.token;',
  '/mocks/config.js': 'export const getConfigValue = (key) => key === "shopper-coupons-endpoint" ? window.fixture.endpoint : undefined;',
  '/mocks/preact.js': 'export const h = () => null;',
  '/scripts/commerce.js': 'export const fetchPlaceholders = async () => ({});',
  '/scripts/aem.js': `export const loadCSS = (href) => new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href; link.onload = resolve; link.onerror = reject;
    document.head.append(link);
  });`,
};
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<script type="importmap">{"imports":{
  "@dropins/tools/event-bus.js":"/mocks/events.js",
  "@dropins/tools/lib.js":"/mocks/lib.js",
  "@dropins/tools/preact.js":"/mocks/preact.js",
  "@dropins/tools/lib/aem/configs.js":"/mocks/config.js"
}}</script></head><body style="margin:8px;--spacing-small:8px;--spacing-medium:16px">
<main class="commerce-cart" id="root"></main><script type="module">
import { renderCouponSlot } from '/scripts/components/cart-discounts/promotion-display.js';
window.fixture = {
  cart: { id: '${'a'.repeat(32)}' }, events: {}, refreshes: 0, token: '',
  emit: (name) => window.fixture.events[name]?.forEach((callback) => callback()),
};
const cartApi = {
  getCartDataFromCache: () => window.fixture.cart,
  refreshCart: async () => {
    window.fixture.refreshes += 1;
    if (window.fixture.failRefresh) {
      window.fixture.failRefresh = false;
      throw new Error('NATIVE_REFRESH_FAILED');
    }
    window.fixture.emit('cart/data');
    return window.fixture.cart;
  },
};
window.mount = async (endpoint, checkout = false) => {
  window.fixture.endpoint = endpoint;
  const root = document.querySelector('#root');
  root.className = checkout ? 'commerce-checkout' : 'commerce-cart';
  root.replaceChildren();
  await renderCouponSlot(root, async (element) => { element.textContent = 'Native coupons'; }, cartApi, {});
};
</script></body></html>`;

test('gated coupon controls in a real browser', { timeout: 60000 }, async (t) => {
  const browser = await chromium.launch();
  try {
    const setup = async () => {
      const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
      page.setDefaultTimeout(4000);
      const requests = [];
      const errors = [];
      const assets = [];
      const queue = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('https://coupon-api.invalid/action', async (route) => {
        const headers = {
          'Access-Control-Allow-Origin': 'https://coupon-ui.invalid',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        };
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers });
          return;
        }
        requests.push(route.request().postDataJSON());
        const next = queue.shift();
        assert.ok(next, 'unexpected coupon API call');
        const result = typeof next === 'function' ? await next() : { body: next };
        await route.fulfill({ status: result.status || 200, headers, json: result.body });
      });
      await page.route('https://coupon-ui.invalid/**', async (route) => {
        const { pathname } = new URL(route.request().url());
        assets.push(pathname);
        if (pathname === '/') {
          await route.fulfill({ contentType: 'text/html', body: html });
        } else if (stubs[pathname]) {
          await route.fulfill({ contentType: 'text/javascript', body: stubs[pathname] });
        } else {
          assert.ok(pathname.startsWith('/scripts/components/cart-discounts/'));
          await route.fulfill({
            contentType: pathname.endsWith('.css') ? 'text/css' : 'text/javascript',
            body: await readFile(new URL(`..${pathname}`, import.meta.url), 'utf8'),
          });
        }
      });
      await page.goto('https://coupon-ui.invalid/');
      await page.waitForFunction(() => window.mount);
      const mount = (checkout = false) => page.evaluate(
        (value) => window.mount('https://coupon-api.invalid/action', value), checkout,
      );
      const idle = () => page.waitForFunction(() => document.querySelector('form')?.getAttribute('aria-busy') === 'false');
      return { page, queue, requests, errors, assets, mount, idle };
    };
    await t.test('missing endpoint keeps native controls without loading coupon code or calling the API', async () => {
      const f = await setup();
      await f.page.evaluate(() => window.mount());
      assert.equal(await f.page.locator('#root').textContent(), 'Native coupons');
      assert.equal(f.requests.length, 0);
      assert.ok(!f.assets.some((path) => path.endsWith('coupon-client.js')));
      assert.deepEqual(f.errors, []);
      await f.page.close();
    });
    await t.test('invalid endpoint displays an accessible alert, never silently falls back', async () => {
      const f = await setup();
      await f.page.evaluate(() => window.mount('http://insecure.invalid'));
      assert.match(await f.page.getByRole('alert').textContent(), /could not load/);
      assert.equal(f.requests.length, 0);
      assert.deepEqual(f.errors, []);
      await f.page.close();
    });
    await t.test('initial missing cart disables all controls, then cart arrival enables the form', async () => {
      const f = await setup();
      await f.page.evaluate(() => { window.fixture.cart = null; });
      await f.mount();
      assert.match(await f.page.getByRole('status').textContent(), /Waiting for the cart/);
      assert.equal(await f.page.locator('button:enabled').count(), 0);
      f.queue.push(none);
      await f.page.evaluate(() => {
        window.fixture.cart = { id: 'a'.repeat(32) };
        window.fixture.emit('cart/data');
      });
      await f.page.waitForFunction(() => !document.querySelector('input').disabled);
      assert.equal(f.requests.length, 1);
      assert.deepEqual(f.errors, []);
      await f.page.close();
    });
    for (const checkout of [false, true]) {
      await t.test(`${checkout ? 'checkout' : 'cart'} applies/removes coupons with native refresh and no mobile overflow`, async () => {
        const f = await setup();
        f.queue.push(none);
        await f.mount(checkout);
        await f.page.getByLabel('Coupon codes (comma-separated)').fill('TEST-CODE');
        f.queue.push(reserved, reserved);
        await f.page.getByRole('button', { name: 'Apply coupons', exact: true }).click();
        await f.page.getByRole('listitem').waitFor();
        await f.idle();
        assert.equal(await f.page.locator('img').count(), 0);
        assert.match(await f.page.getByRole('listitem').textContent(), /<img src=x>/);
        assert.equal(await f.page.evaluate(() => window.fixture.refreshes), 1);
        assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await f.page.setViewportSize({ width: 1280, height: 900 });
        assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        f.queue.push(released, released);
        await f.page.getByRole('button', { name: 'Remove all coupons' }).click();
        await f.page.getByRole('status').filter({ hasText: 'No app coupons' }).waitFor();
        await f.idle();
        assert.equal(await f.page.getByRole('listitem').count(), 0);
        assert.equal(await f.page.evaluate(() => window.fixture.refreshes), 2);
        assert.deepEqual(f.errors, []);
        await f.page.close();
      });
    }
    await t.test('cart events during detached slot initialization do not dispose the coupon form', async () => {
      const f = await setup();
      let release;
      let started;
      const requested = new Promise((resolve) => { started = resolve; });
      f.queue.push(() => new Promise((resolve) => { release = resolve; started(); }));
      await f.page.evaluate(async () => {
        const { renderCouponSlot } = await import('/scripts/components/cart-discounts/promotion-display.js');
        window.fixture.endpoint = 'https://coupon-api.invalid/action';
        const detached = document.createElement('section');
        window.detachedMount = renderCouponSlot(detached, () => {}, {
          getCartDataFromCache: () => window.fixture.cart,
          refreshCart: async () => window.fixture.cart,
        }, {}).then(() => document.querySelector('#root').append(detached));
      });
      await requested;
      await f.page.evaluate(() => window.fixture.emit('cart/data'));
      release({ body: none });
      await f.page.evaluate(() => window.detachedMount);
      assert.equal(await f.page.getByRole('textbox').isEnabled(), true);
      assert.match(await f.page.getByRole('status').textContent(), /No app coupons/);
      assert.deepEqual(f.errors, []);
      await f.page.close();
    });
    await t.test('ambiguous errors disable edits and Retry keeps the exact operation receipt', async () => {
      const f = await setup();
      f.queue.push(none);
      await f.mount();
      await f.page.getByRole('textbox').fill('TEST-CODE');
      f.queue.push(() => ({ status: 503, body: { error: 'RETRY_SAME_REQUEST' } }));
      await f.page.getByRole('button', { name: 'Apply coupons', exact: true }).click();
      await f.page.getByRole('alert').filter({ hasText: 'RETRY_SAME_REQUEST' }).waitFor();
      await f.idle();
      assert.equal(await f.page.getByRole('textbox').isDisabled(), true);
      f.queue.push(reserved, reserved);
      await f.page.getByRole('button', { name: 'Retry / refresh status' }).click();
      await f.page.getByRole('listitem').waitFor();
      await f.idle();
      assert.deepEqual(f.requests[1], f.requests[2]);
      assert.deepEqual(f.errors, []);
      await f.page.close();
    });
    await t.test('native refresh failure retries refresh without spending another coupon operation', async () => {
      const f = await setup();
      f.queue.push(none);
      await f.mount();
      await f.page.evaluate(() => { window.fixture.failRefresh = true; });
      await f.page.getByRole('textbox').fill('TEST-CODE');
      f.queue.push(reserved);
      await f.page.getByRole('button', { name: 'Apply coupons', exact: true }).click();
      await f.page.getByRole('alert').filter({ hasText: 'Coupons were saved' }).waitFor();
      await f.idle();
      f.queue.push(reserved);
      await f.page.getByRole('button', { name: 'Retry / refresh status' }).click();
      await f.page.getByRole('listitem').waitFor();
      await f.idle();
      assert.equal(f.requests.filter((request) => request.operation === 'apply').length, 1);
      assert.equal(await f.page.evaluate(() => window.fixture.refreshes), 2);
      assert.deepEqual(f.errors, []);
      await f.page.close();
    });
    await t.test('expired but fully fenced leases cannot be removed or edited', async () => {
      const f = await setup();
      f.queue.push({ ...reserved, phase: 'EXPIRED', canRemove: false, expiresAt: '2000-01-01T00:00:00Z' });
      await f.mount();
      assert.equal(await f.page.getByRole('button', { name: 'Remove all coupons' }).isDisabled(), true);
      assert.equal(await f.page.getByRole('textbox').isDisabled(), true);
      assert.deepEqual(f.errors, []);
      await f.page.close();
    });
    await t.test('an acknowledged coupon remains removable if native pricing cannot refresh', async () => {
      const f = await setup();
      f.queue.push(none);
      await f.mount();
      await f.page.evaluate(() => { window.fixture.failRefresh = true; });
      await f.page.getByRole('textbox').fill('TEST-CODE');
      f.queue.push(reserved);
      await f.page.getByRole('button', { name: 'Apply coupons', exact: true }).click();
      await f.page.getByRole('alert').filter({ hasText: 'Coupons were saved' }).waitFor();
      await f.idle();
      f.queue.push(released, released);
      await f.page.getByRole('button', { name: 'Remove all coupons' }).click();
      await f.page.getByRole('status').filter({ hasText: 'No app coupons' }).waitFor();
      await f.idle();
      assert.deepEqual(f.requests.filter((value) => value.operation !== 'status').map((value) => value.operation), ['apply', 'remove']);
      assert.deepEqual(f.errors, []);
      await f.page.close();
    });
    await t.test('customer changes fence an old mutation response without disabling the new cart', async () => {
      const f = await setup();
      f.queue.push(none);
      await f.mount();
      let release;
      let started;
      const oldStarted = new Promise((resolve) => { started = resolve; });
      f.queue.push(() => new Promise((resolve) => { release = resolve; started(); }));
      await f.page.getByRole('textbox').fill('OLD-CODE');
      await f.page.getByRole('button', { name: 'Apply coupons', exact: true }).click();
      await oldStarted;
      f.queue.push(none);
      await f.page.evaluate(() => { window.fixture.token = 'new-customer'; window.fixture.emit('authenticated'); });
      await f.page.waitForFunction(() => !document.querySelector('input').disabled);
      assert.equal(await f.page.getByRole('textbox').inputValue(), '');
      const next = { ...reserved, version: 4, promotions: [{ id: 'new', description: 'New customer promotion' }] };
      f.queue.push(next, next);
      await f.page.getByRole('textbox').fill('NEW-CODE');
      await f.page.getByRole('button', { name: 'Apply coupons', exact: true }).click();
      await f.page.getByRole('listitem').filter({ hasText: 'New customer promotion' }).waitFor();
      await f.idle();
      const oldResponse = f.page.waitForResponse((response) => response.url().includes('coupon-api'));
      release({ body: reserved });
      await oldResponse;
      await f.idle();
      assert.equal(await f.page.getByRole('listitem').textContent(), 'New customer promotion');
      assert.equal(await f.page.evaluate(() => window.fixture.refreshes), 1);
      assert.deepEqual(f.errors, []);
      await f.page.close();
    });
    await t.test('lease expiry refreshes effective status and leaves removal available', async () => {
      const f = await setup();
      f.queue.push({ ...reserved, expiresAt: new Date(Date.now() + 1000).toISOString() }, { ...reserved, phase: 'EXPIRED', expiresAt: '2000-01-01T00:00:00Z' });
      await f.mount();
      await f.page.getByRole('status').filter({ hasText: 'expired' }).waitFor();
      assert.equal(await f.page.getByRole('button', { name: 'Remove all coupons' }).isEnabled(), true);
      assert.equal(f.requests.length, 2);
      assert.deepEqual(f.errors, []);
      await f.page.close();
    });
  } finally { await browser.close(); }
});
