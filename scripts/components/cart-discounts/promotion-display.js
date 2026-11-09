import { events } from '@dropins/tools/event-bus.js';
import { h } from '@dropins/tools/preact.js';
import { getCookie } from '@dropins/tools/lib.js';
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import {
  cartFingerprint, getCartSavings, getItemSavings, validatePromotionDisplay,
} from './cart-discounts.js';

let lastRequest;
const CACHE_MS = 5000;
const itemBindings = new Set();

function refreshItems(cart, display) {
  itemBindings.forEach((binding) => {
    if (!binding.element.isConnected) itemBindings.delete(binding);
    else binding.render(cart, display);
  });
}

function loadDisplay(cart) {
  if (!getCartSavings(cart)) {
    itemBindings.forEach(({ element }) => { element.hidden = true; });
    return Promise.resolve(null);
  }
  const fingerprint = cartFingerprint(cart);
  const token = getCookie('auth_dropin_user_token');
  if (lastRequest?.fingerprint === fingerprint && lastRequest.token === token
    && (!lastRequest.updatedAt || Date.now() - lastRequest.updatedAt < CACHE_MS)) {
    return lastRequest.promise;
  }
  itemBindings.forEach(({ element }) => { element.hidden = true; });
  const entry = { fingerprint, token, updatedAt: 0 };
  entry.promise = (async () => {
    const endpoint = getConfigValue('promotion-display-endpoint');
    if (!URL.canParse(endpoint) || new URL(endpoint).protocol !== 'https:') {
      throw new Error('The promotion display endpoint is not configured.');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'omit',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ cartId: cart.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `Promotion detail request failed (${response.status}).`);
      return validatePromotionDisplay(body, cart);
    } finally {
      clearTimeout(timeout);
    }
  })().then((display) => {
    const current = events.lastPayload('cart/data');
    if (lastRequest === entry && current && cartFingerprint(current) === fingerprint) {
      refreshItems(current, display);
    }
    return display;
  }).catch((error) => {
    console.error(JSON.stringify({ event: 'promotion_display_failed', reason: error.message }));
    throw error;
  }).finally(() => { entry.updatedAt = Date.now(); });
  lastRequest = entry;
  return entry.promise;
}

function addAmountRow(element, label, price, savings = false) {
  const row = document.createElement('div');
  row.className = 'cart-discounts__row';
  const title = document.createElement('dt');
  title.textContent = label;
  const value = document.createElement('dd');
  const formatted = new Intl.NumberFormat(document.documentElement.lang || 'en', {
    style: 'currency', currency: price.currency,
  }).format(price.value);
  value.textContent = `${savings ? '\u2212' : ''}${formatted}`;
  row.append(title, value);
  element.append(row);
}

function addPromotions(element, promotions) {
  const amounts = document.createElement('dl');
  amounts.className = 'cart-discounts__promotions';
  promotions.forEach((promotion) => {
    addAmountRow(amounts, promotion.description, promotion.amount, true);
  });
  element.append(amounts);
}

function summaryRenderer(labels = {}, showSubtotal = true) {
  const element = document.createElement('section');
  element.className = 'cart-discounts cart-discounts--summary';
  let revision = 0;
  const render = (cart, display, state) => {
    element.replaceChildren();
    const savings = getCartSavings(cart, display);
    element.hidden = !savings;
    if (!savings) return;
    if (savings.promotions.length) {
      const heading = document.createElement('h3');
      heading.textContent = labels.CartPromotionsIncluded || 'Cart promotions included in savings';
      element.append(heading);
      addPromotions(element, savings.promotions);
    }
    const totals = document.createElement('dl');
    addAmountRow(totals, labels.CartTotalPromotionSavings || 'Total promotion savings', savings.discount, true);
    if (showSubtotal && savings.subtotal) {
      addAmountRow(totals, labels.CartSubtotalAfterPromotions || 'Subtotal after promotions (excl. tax)', savings.subtotal);
    }
    element.append(totals);
    if (display?.notice) {
      const notice = document.createElement('p');
      notice.className = 'cart-discounts__status';
      notice.textContent = display.notice;
      element.append(notice);
    }
    if (state) {
      const message = document.createElement('p');
      message.className = 'cart-discounts__status';
      message.setAttribute('role', state === 'error' ? 'alert' : 'status');
      message.textContent = state === 'error'
        ? labels.CartPromotionDetailsError || 'Promotion details could not be loaded. Cart totals are unchanged.'
        : labels.CartPromotionDetailsLoading || 'Loading promotion details...';
      element.append(message);
    }
  };
  const update = (cart) => {
    revision += 1;
    const version = revision;
    render(cart, null, getCartSavings(cart) ? 'loading' : null);
    if (!getCartSavings(cart)) return;
    loadDisplay(cart).then((display) => {
      if (version === revision) render(cart, display);
    }, () => {
      if (version === revision) render(cart, null, 'error');
    });
  };
  return { element, update };
}

export function renderCartSavings(ctx, labels) {
  const { element, update } = summaryRenderer(labels);
  ctx.appendChild(element);
  update(ctx.data);
  ctx.onChange(({ data }) => update(data));
}

export function orderSummaryPromotions(labels) {
  const { element, update } = summaryRenderer(labels, false);
  const node = h('div', {
    ref: (target) => {
      if (target && element.parentElement !== target) target.appendChild(element);
    },
  });
  return (lines) => {
    if (!lines.some((line) => line.key === 'discountsContent')) {
      throw new Error('The cart summary promotion section is unavailable.');
    }
    update(events.lastPayload('cart/data'));
    return lines.map((line) => (line.key === 'discountsContent' ? { ...line, content: node } : line));
  };
}

export function renderItemPromotions(ctx, labels = {}) {
  const element = document.createElement('section');
  element.className = 'cart-discounts cart-discounts--item';
  element.hidden = true;
  let uid = ctx.item?.uid;
  const render = (cart, display) => {
    element.hidden = true;
    element.replaceChildren();
    const item = cart?.items.find((line) => line.uid === uid);
    if (!item) return;
    const savings = getItemSavings(item, display);
    element.hidden = !savings;
    if (!savings) return;
    const heading = document.createElement('h3');
    heading.textContent = labels.CartProductPromotions || 'Product promotions';
    element.append(heading);
    addPromotions(element, savings.promotions);
    const total = document.createElement('dl');
    addAmountRow(total, labels.CartAfterProductPromotions || 'After product promotions (excl. tax)', savings.afterDiscount);
    element.append(total);
  };
  const binding = { element, render };
  const update = ({ item }) => {
    uid = item?.uid;
    itemBindings.add(binding);
    const cart = events.lastPayload('cart/data');
    render(cart, null);
    if (!cart?.items.some((line) => line.uid === uid)) return;
    const fingerprint = cartFingerprint(cart);
    loadDisplay(cart).then((display) => {
      const current = events.lastPayload('cart/data');
      if (current && cartFingerprint(current) === fingerprint) render(current, display);
    }).catch(() => {
      const current = events.lastPayload('cart/data');
      if (current && cartFingerprint(current) === fingerprint) element.hidden = true;
    });
  };
  ctx.appendChild(element);
  update(ctx);
  ctx.onChange(update);
}
