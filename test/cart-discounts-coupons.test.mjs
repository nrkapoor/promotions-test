import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { createCouponClient } from '../scripts/components/cart-discounts/coupon-client.js';

const none = () => ({
  version: 0, phase: 'NONE', expiresAt: null, canRemove: false, promotions: [],
});
const reserved = (version = 2) => ({
  version, phase: 'RESERVED', expiresAt: '2099-01-01T00:00:00Z', canRemove: true,
  promotions: [{ id: 'percent', description: 'Ten percent off' }],
});
const ok = (body) => () => Response.json(body);
function fixture() {
  let context = { cartId: 'a'.repeat(32), token: 'shopper-session' };
  const queue = [];
  const fetcher = mock.fn(async () => {
    const response = queue.shift();
    assert.ok(response, 'unexpected network request');
    return response();
  });
  const refreshCart = mock.fn(async () => ({ id: context.cartId }));
  const createId = mock.fn(randomUUID);
  const client = createCouponClient({
    endpoint: 'https://runtime.example.test/coupons',
    getContext: () => context, refreshCart, fetcher, createId,
  });
  const bodies = () => fetcher.mock.calls.map((call) => JSON.parse(call.arguments[1].body));
  return {
    client, queue, fetcher, refreshCart, createId, bodies,
    change: (next) => { context = { ...context, ...next }; },
  };
}

test('apply normalizes and deduplicates codes, adds only cart/version/UUID, then refreshes native cart', async () => {
  const f = fixture();
  f.queue.push(ok(none()), ok(reserved()));
  assert.equal((await f.client.apply([' ten-off ', 'TEN-OFF', 'FIVE-OFF'])).phase, 'RESERVED');
  assert.deepEqual(f.bodies()[1], {
    operation: 'apply', cartId: 'a'.repeat(32), requestId: f.bodies()[1].requestId,
    version: 0, codes: ['TEN-OFF', 'FIVE-OFF'],
  });
  assert.equal(f.fetcher.mock.calls[1].arguments[1].headers.Authorization, 'Bearer shopper-session');
  assert.equal(f.fetcher.mock.calls[1].arguments[1].credentials, 'omit');
  assert.equal(f.refreshCart.mock.callCount(), 1);
  assert.equal(f.client.hasPending(), false);
});
test('ambiguous network/503 failures preserve the exact UUID, version and body until successful retry', async () => {
  const f = fixture();
  f.queue.push(ok(none()), async () => { throw new TypeError('NETWORK_FAILED'); });
  await assert.rejects(f.client.apply(['TEN-OFF']), /NETWORK_FAILED/);
  assert.equal(f.client.hasPending(), true);
  await assert.rejects(f.client.apply(['ANOTHER']), /previous coupon request/);
  f.queue.push(() => Response.json({ error: 'Retry later' }, { status: 503 }));
  await assert.rejects(f.client.retry(), /Retry later/);
  f.queue.push(ok(reserved()));
  await f.client.retry();
  assert.deepEqual(f.bodies()[1], f.bodies()[2]);
  assert.deepEqual(f.bodies()[2], f.bodies()[3]);
  assert.equal(f.createId.mock.callCount(), 1);
  assert.equal(f.refreshCart.mock.callCount(), 1);
});
test('an acknowledged mutation with failed native refresh retries refresh only, never the mutation', async () => {
  const f = fixture();
  f.queue.push(ok(none()), ok(reserved()));
  f.refreshCart.mock.mockImplementationOnce(async () => { throw new Error('REFRESH_FAILED'); });
  await assert.rejects(f.client.apply(['TEN-OFF']), /cart could not refresh/);
  assert.equal(f.client.hasPending(), true);
  await f.client.retry();
  assert.equal(f.fetcher.mock.callCount(), 2);
  assert.equal(f.refreshCart.mock.callCount(), 2);
  assert.equal(f.client.hasPending(), false);
});
test('a definitive conflict re-reads current status before creating a new mutation', async () => {
  const f = fixture();
  f.queue.push(ok(none()), () => Response.json({ error: 'Cart changed' }, { status: 409 }));
  await assert.rejects(f.client.apply(['TEN-OFF']), /Cart changed/);
  assert.equal(f.client.hasPending(), false);
  f.queue.push(ok(reserved(4)), ok(reserved(6)));
  await f.client.apply(['FIVE-OFF']);
  assert.equal(f.bodies()[3].version, 4);
  assert.notEqual(f.bodies()[1].requestId, f.bodies()[3].requestId);
});
test('a known saved coupon can be removed after native refresh fails, without replaying application', async () => {
  const f = fixture();
  f.queue.push(ok(none()), ok(reserved()));
  f.refreshCart.mock.mockImplementationOnce(async () => { throw new Error('NATIVE_UNAVAILABLE'); });
  await assert.rejects(f.client.apply(['TEN-OFF']), /Coupons were saved/);
  assert.equal(f.client.canRemove(), true);
  f.queue.push(ok({ ...none(), version: 4, phase: 'RELEASED' }));
  await f.client.remove();
  assert.deepEqual(f.bodies().map((body) => body.operation), ['status', 'apply', 'remove']);
  assert.equal(f.bodies().at(-1).version, 2);
  assert.equal(f.client.hasPending(), false);
});
test('late status responses cannot overwrite a newer cart reservation version', async () => {
  const f = fixture();
  let resolve;
  f.queue.push(() => new Promise((done) => { resolve = done; }), ok(reserved(4)));
  const old = f.client.read();
  assert.equal((await f.client.read()).version, 4);
  resolve(Response.json(reserved(2)));
  assert.equal((await old).version, 4);
});
test('cart/customer changes discard old results and receipts without refreshing the new cart', async () => {
  const f = fixture();
  let resolve;
  f.queue.push(ok(none()), () => new Promise((done) => { resolve = done; }));
  const applying = f.client.apply(['TEN-OFF']);
  while (!resolve) await new Promise((done) => setImmediate(done));
  f.change({ cartId: 'b'.repeat(32), token: 'different-session' });
  resolve(Response.json(reserved()));
  await assert.rejects(applying, /cart or customer changed/);
  assert.equal(f.refreshCart.mock.callCount(), 0);
  assert.equal(f.client.hasPending(), false);
  f.queue.push(ok(none()), ok(reserved()));
  await f.client.apply(['OTHER-CODE']);
  assert.equal(f.bodies().at(-1).cartId, 'b'.repeat(32));
  assert.notEqual(f.bodies()[1].requestId, f.bodies().at(-1).requestId);
});
test('concurrent double-clicks share one mutation and different concurrent requests are rejected', async () => {
  const f = fixture();
  f.queue.push(ok(none()), ok(reserved()));
  const first = f.client.apply(['TEN-OFF']);
  const second = f.client.apply(['TEN-OFF']);
  await assert.rejects(f.client.apply(['OTHER']), /Wait for the current/);
  assert.deepEqual(await first, await second);
  assert.equal(f.fetcher.mock.callCount(), 2);
});
test('remove uses the authoritative version and never sends coupon codes', async () => {
  const f = fixture();
  f.queue.push(ok(reserved(6)), ok({ ...none(), version: 8, phase: 'RELEASED' }));
  await f.client.remove();
  assert.deepEqual(f.bodies()[1], {
    operation: 'remove', cartId: 'a'.repeat(32), version: 6, requestId: f.bodies()[1].requestId,
  });
  assert.equal(f.refreshCart.mock.callCount(), 1);
});
test('invalid success bodies remain ambiguous and cannot silently clear a mutation receipt', async () => {
  const f = fixture();
  f.queue.push(ok(none()), ok({ ...reserved(), version: -1 }));
  await assert.rejects(f.client.apply(['TEN-OFF']), /response was invalid/);
  assert.equal(f.client.hasPending(), true);
  f.queue.push(ok(reserved()));
  await f.client.retry();
  assert.deepEqual(f.bodies()[1], f.bodies()[2]);
});
test('a failing status refresh does not discard an unrelated unknown mutation receipt', async () => {
  const f = fixture();
  f.queue.push(ok(none()), async () => { throw new Error('NETWORK_FAILED'); });
  await assert.rejects(f.client.apply(['TEN-OFF']));
  f.queue.push(() => Response.json({ error: 'Cart inaccessible' }, { status: 404 }));
  await assert.rejects(f.client.read(), /Cart inaccessible/);
  assert.equal(f.client.hasPending(), true);
});
test('malformed codes, too many codes and non-removable reservations never send a mutation', async () => {
  const f = fixture();
  for (const codes of [[], ['bad code'], Array(6).fill(null), ['A'], ['<img>'], ['A'.repeat(65)]]) {
    await assert.rejects(f.client.apply(codes), /valid coupon codes/);
  }
  assert.equal(f.fetcher.mock.callCount(), 0);
  f.queue.push(ok(none()));
  await assert.rejects(f.client.remove(), /no removable coupons/);
  assert.equal(f.fetcher.mock.callCount(), 1);
});
test('insecure endpoints are rejected before any browser request', () => {
  for (const endpoint of ['http://example.test', 'not-a-url', 'javascript:alert(1)']) {
    assert.throws(() => createCouponClient({ endpoint }), /not configured correctly/);
  }
});
test('a cart/customer A-B-A transition cannot accept an old A response', async () => {
  const f = fixture();
  let resolve;
  f.queue.push(() => new Promise((done) => { resolve = done; }));
  const old = f.client.read();
  f.change({ token: 'intermediate-session' });
  assert.equal(f.client.hasPending(), false);
  f.change({ token: 'shopper-session' });
  resolve(Response.json(reserved(10)));
  await assert.rejects(old, /cart or customer changed/);
  f.queue.push(ok(none()));
  assert.equal((await f.client.read()).phase, 'NONE');
});
test('missing cart and explicit resets fence old requests without losing newer pending mutations', async () => {
  const f = fixture();
  let resolve;
  f.queue.push(ok(none()), () => new Promise((done) => { resolve = done; }));
  const old = f.client.apply(['OLD-CODE']);
  while (!resolve) await new Promise((done) => setImmediate(done));
  f.change({ cartId: undefined });
  assert.equal(f.client.hasPending(), false);
  await assert.rejects(f.client.read(), /cart is not available/);
  f.change({ cartId: 'a'.repeat(32) });
  f.client.reset();
  f.queue.push(ok(none()), async () => { throw new Error('UNKNOWN_NEW_REQUEST'); });
  await assert.rejects(f.client.apply(['NEW-CODE']), /UNKNOWN_NEW_REQUEST/);
  resolve(Response.json({ error: 'Old conflict' }, { status: 409 }));
  await assert.rejects(old, /cart or customer changed/);
  assert.equal(f.client.hasPending(), true);
  f.queue.push(ok(reserved(4)));
  await f.client.retry();
  assert.deepEqual(f.bodies()[3], f.bodies()[4]);
});
