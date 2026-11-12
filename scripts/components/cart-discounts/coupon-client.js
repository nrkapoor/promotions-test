const phases = new Set([
  'NONE', 'PREPARING', 'RESERVED', 'FENCING', 'FENCED', 'COMMITTED',
  'FAILED', 'RELEASED', 'EXPIRED', 'STALE', 'CUSTOMER_CHANGED', 'INELIGIBLE',
]);

function validate(body) {
  if (!body || !Number.isSafeInteger(body.version) || body.version < 0
    || !phases.has(body.phase) || typeof body.canRemove !== 'boolean'
    || !(body.expiresAt === null || (typeof body.expiresAt === 'string'
      && Number.isFinite(Date.parse(body.expiresAt))))
    || !Array.isArray(body.promotions) || body.promotions.length > 5
    || body.promotions.some((value) => !value || typeof value.id !== 'string'
      || typeof value.description !== 'string')) {
    throw new Error('The coupon response was invalid. Retry the same request.');
  }
  return body;
}

export function createCouponClient({
  endpoint, getContext, refreshCart, fetcher = fetch,
  createId = () => crypto.randomUUID(),
}) {
  if (!URL.canParse(endpoint) || new URL(endpoint).protocol !== 'https:') {
    throw new Error('The shopper coupon endpoint is not configured correctly.');
  }
  let contextKey;
  let state;
  let pending;
  let active;
  let generation = 0;
  const reset = () => {
    generation += 1;
    contextKey = undefined;
    state = undefined;
    pending = undefined;
    active = undefined;
  };
  const context = (required = true) => {
    const value = getContext();
    const key = value && /^[A-Za-z0-9_-]{16,128}$/.test(value.cartId)
      ? `${value.cartId}:${value.token || ''}` : undefined;
    if (key !== contextKey) {
      reset();
      contextKey = key;
    }
    if (!key) {
      if (required) throw new Error('The cart is not available. Reload before applying coupons.');
      return undefined;
    }
    return { ...value, key, generation };
  };
  const ensureCurrent = (expected) => {
    const current = context();
    if (current.key !== expected.key || current.generation !== expected.generation) {
      throw new Error('The cart or customer changed. Reload coupon status before retrying.');
    }
  };
  const accept = (expected, body) => {
    ensureCurrent(expected);
    if (!state || body.version >= state.version) state = body;
    return state;
  };
  const send = async (expected, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetcher(endpoint, {
        method: 'POST',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(expected.token ? { Authorization: `Bearer ${expected.token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      ensureCurrent(expected);
      if (!response.ok) {
        throw Object.assign(new Error(
          typeof result.error === 'string' ? result.error : 'Coupons are unavailable. Retry the same request.',
        ), { status: response.status });
      }
      return validate(result);
    } finally { clearTimeout(timer); }
  };
  const read = async () => {
    const expected = context();
    return accept(expected, await send(expected, { operation: 'status', cartId: expected.cartId }));
  };
  const execute = (operation, codes) => {
    const expected = context();
    const intent = JSON.stringify([operation, codes]);
    if (active) {
      if (active.intent !== intent) return Promise.reject(new Error('Wait for the current coupon request.'));
      return active.promise;
    }
    if (pending && pending.intent !== intent) {
      if (operation === 'remove' && pending.result) pending = undefined;
      else return Promise.reject(new Error('Retry the previous coupon request before changing coupons.'));
    }
    const attempt = { intent };
    active = attempt;
    attempt.promise = (async () => {
      if (!state && !pending) await read();
      ensureCurrent(expected);
      if (!pending && operation === 'remove' && !state.canRemove) {
        throw new Error('There are no removable coupons. Refresh coupon status.');
      }
      pending ??= {
        intent,
        body: {
          operation,
          cartId: expected.cartId,
          requestId: createId(),
          version: state.version,
          ...(operation === 'apply' ? { codes } : {}),
        },
      };
      const request = pending;
      try { request.result ??= await send(expected, request.body); } catch (error) {
        if (error.status >= 400 && error.status < 500 && pending === request) {
          pending = undefined;
          state = undefined;
        }
        throw error;
      }
      accept(expected, request.result);
      // An acknowledged mutation is never sent again just because native cart
      // refresh failed. Retrying completes that refresh with the same receipt.
      let refreshed;
      try { refreshed = await refreshCart(); } catch (cause) {
        throw new Error('Coupons were saved, but the cart could not refresh. Retry to refresh it or remove all coupons.', { cause });
      }
      ensureCurrent(expected);
      if (!refreshed || refreshed.id !== expected.cartId) {
        throw new Error('Coupons were saved, but the cart could not refresh. Retry to refresh it.');
      }
      pending = undefined;
      return state;
    })().finally(() => { if (active === attempt) active = undefined; });
    return attempt.promise;
  };
  return {
    read,
    reset,
    apply: (values) => {
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
        return Promise.reject(new Error('Enter one to five valid coupon codes.'));
      }
      const codes = [...new Set(values.map((value) => value.trim().toUpperCase()))];
      if (!codes.length || codes.length > 5
        || codes.some((value) => value.length < 4 || value.length > 64 || !/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(value))) {
        return Promise.reject(new Error('Enter one to five valid coupon codes.'));
      }
      return execute('apply', codes);
    },
    remove: () => execute('remove'),
    retry: () => {
      context();
      return pending ? execute(pending.body.operation, pending.body.codes) : read();
    },
    hasPending: () => { context(false); return !!pending; },
    canRemove: () => {
      context(false);
      return !!state?.canRemove && !active && (!pending || !!pending.result);
    },
  };
}
