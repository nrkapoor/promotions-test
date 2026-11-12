import { events } from '@dropins/tools/event-bus.js';
import { getCookie } from '@dropins/tools/lib.js';
import { loadCSS } from '../../aem.js';
import { fetchPlaceholders } from '../../commerce.js';
import { createCouponClient } from './coupon-client.js';

const bindings = new Set();
const changed = () => {
  bindings.forEach((binding) => {
    if (!binding.element.isConnected) {
      if (binding.connected) {
        binding.dispose();
        bindings.delete(binding);
      }
    } else {
      binding.connected = true;
      binding.refresh();
    }
  });
};
events.on('cart/data', changed);
events.on('authenticated', changed);

export async function renderShopperCoupons(element, { endpoint, cartApi, labels }) {
  await loadCSS(new URL('./cart-discounts.css', import.meta.url).href);
  const text = labels || (await fetchPlaceholders()).Global || {};
  const form = document.createElement('form');
  form.className = 'shopper-coupons';
  const label = document.createElement('label');
  label.textContent = text.CouponCodes || 'Coupon codes (comma-separated)';
  const input = document.createElement('input');
  input.name = 'coupon-codes';
  input.type = 'text';
  input.maxLength = 324;
  input.autocomplete = 'off';
  input.required = true;
  label.append(input);
  const apply = document.createElement('button');
  apply.type = 'submit';
  apply.textContent = text.ApplyCoupon || 'Apply coupons';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = text.RemoveCoupons || 'Remove all coupons';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = text.RetryCoupons || 'Retry / refresh status';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  const promotions = document.createElement('ul');
  form.append(label, apply, remove, retry, status, promotions, error);
  element.replaceChildren(form);
  const getContext = () => ({
    cartId: cartApi.getCartDataFromCache()?.id,
    token: getCookie('auth_dropin_user_token'),
  });
  const client = createCouponClient({
    endpoint, getContext, refreshCart: () => cartApi.refreshCart(),
  });
  let identity;
  let value;
  let busy = false;
  let revision = 0;
  let mutationRevision = 0;
  let disposed = false;
  let timer;
  const identityNow = () => JSON.stringify(getContext());
  const controls = () => {
    if (disposed) return;
    const available = !!getContext().cartId;
    const pending = client.hasPending();
    const locked = value && !['NONE', 'RELEASED'].includes(value.phase) && !value.canRemove;
    input.disabled = busy || pending || !value || !available || locked;
    apply.disabled = input.disabled;
    remove.disabled = busy || !client.canRemove() || !available;
    retry.disabled = busy || !available;
    form.setAttribute('aria-busy', String(busy));
  };
  const show = (result) => {
    value = result;
    status.textContent = result.phase === 'NONE' || result.phase === 'RELEASED'
      ? text.NoCoupons || 'No app coupons applied.'
      : `${text.CouponStatus || 'Coupon status'}: ${result.phase.replaceAll('_', ' ').toLowerCase()}.`;
    promotions.replaceChildren(...result.promotions.map((promotion) => {
      const item = document.createElement('li');
      item.textContent = promotion.description;
      return item;
    }));
    clearTimeout(timer);
    const untilExpiry = Date.parse(result.expiresAt) - Date.now();
    if (untilExpiry > 0) timer = setTimeout(changed, untilExpiry + 10);
  };
  const report = (failure) => {
    error.textContent = failure.message;
    console.error(JSON.stringify({ event: 'shopper_coupon_failed', reason: failure.name }));
  };
  const refresh = async () => {
    if (disposed) return;
    const current = identityNow();
    if (current !== identity) {
      client.reset();
      mutationRevision += 1;
      busy = false;
      identity = current;
      input.value = '';
      error.textContent = '';
      promotions.replaceChildren();
      clearTimeout(timer);
      value = undefined;
    }
    revision += 1;
    const generation = revision;
    controls();
    if (!getContext().cartId) {
      status.textContent = text.CartLoading || 'Waiting for the cart.';
      input.disabled = true;
      apply.disabled = true;
      remove.disabled = true;
      return;
    }
    try {
      const result = await client.read();
      if (!disposed && generation === revision && current === identityNow()) show(result);
    } catch (failure) {
      if (!disposed && generation === revision && current === identityNow()) report(failure);
    } finally { if (current === identityNow()) controls(); }
  };
  const mutate = async (operation) => {
    if (disposed || busy || !getContext().cartId) return;
    busy = true;
    mutationRevision += 1;
    const generation = mutationRevision;
    const current = identityNow();
    error.textContent = '';
    controls();
    try {
      const result = await operation();
      if (!disposed && generation === mutationRevision && current === identityNow()) {
        input.value = '';
        show(result);
      }
    } catch (failure) {
      if (!disposed && generation === mutationRevision && current === identityNow()) {
        report(failure);
      }
    } finally {
      if (!disposed && generation === mutationRevision) {
        busy = false;
        if (current === identityNow()) controls();
        else await refresh();
      }
    }
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    mutate(() => client.apply(input.value.split(',')));
  });
  remove.addEventListener('click', () => { mutate(() => client.remove()); });
  retry.addEventListener('click', () => { mutate(() => client.retry()); });
  bindings.add({
    element,
    connected: element.isConnected,
    refresh: () => { refresh(); },
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      client.reset();
      input.value = '';
      identity = undefined;
    },
  });
  await refresh();
}
