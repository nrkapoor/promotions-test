import { events } from '@dropins/tools/event-bus.js';
import { h } from '@dropins/tools/preact.js';
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';
import { getCartFees, getCartSavings, getItemSavings } from './cart-discounts.js';

// Promotions are calculated by the Commerce checkout webhook. Everything shown here comes from
// Commerce's own cart data; only coupon application calls the promotions app.

export async function renderCouponSlot(ctx, renderNative, cartApi, labels) {
  const element = document.createElement('div');
  ctx.appendChild(element);
  const endpoint = getConfigValue('shopper-coupons-endpoint');
  if (!endpoint) {
    await renderNative(element);
    return;
  }
  try {
    const { renderShopperCoupons } = await import('./shopper-coupons.js');
    await renderShopperCoupons(element, {
      endpoint, cartApi, labels,
    });
  } catch (error) {
    element.textContent = labels?.CouponToolsUnavailable || 'Coupon tools could not load. Reload before retrying.';
    element.setAttribute('role', 'alert');
    console.error(JSON.stringify({ event: 'shopper_coupon_load_failed', reason: error.name }));
  }
}

function addAmountRow(element, label, price, savings = false, fee = false) {
  const row = document.createElement('div');
  row.className = 'cart-discounts__row';
  const title = document.createElement('dt');
  title.textContent = label;
  const value = document.createElement('dd');
  const formatted = new Intl.NumberFormat(document.documentElement.lang || 'en', {
    style: 'currency', currency: price.currency,
  }).format(price.value);
  const prefix = fee ? '+' : '';
  value.textContent = `${savings ? '\u2212' : prefix}${formatted}`;
  row.append(title, value);
  element.append(row);
}

function addPromotionLines(element, lines) {
  const list = document.createElement('ul');
  list.className = 'cart-discounts__promotions';
  lines.forEach((line) => {
    const entry = document.createElement('li');
    entry.textContent = line;
    list.append(entry);
  });
  element.append(list);
}

function summaryRenderer(labels = {}, showSubtotal = true) {
  const element = document.createElement('section');
  element.className = 'cart-discounts cart-discounts--summary';
  const render = (cart) => {
    element.replaceChildren();
    const alert = (text) => {
      const message = document.createElement('p');
      message.className = 'cart-discounts__status';
      message.setAttribute('role', 'alert');
      message.textContent = text;
      element.append(message);
    };
    let savings = null;
    let fees = [];
    let savingsError = false;
    let feeError = false;
    try {
      savings = getCartSavings(cart);
    } catch (failure) {
      savingsError = true;
      console.error(JSON.stringify({ event: 'cart_discount_display_failed', reason: failure.message }));
    }
    try {
      fees = getCartFees(cart);
    } catch (failure) {
      feeError = true;
      console.error(JSON.stringify({ event: 'cart_fee_display_failed', reason: failure.message }));
    }
    element.hidden = !savings && !fees.length && !savingsError && !feeError;
    if (fees.length) {
      const rows = document.createElement('dl');
      fees.forEach(({ label, amount }) => addAmountRow(rows, label, amount, false, true));
      element.append(rows);
    }
    if (feeError) alert(labels.CartFeesDisplayError || 'Fee details could not be displayed. Cart totals are unchanged. Reload before retrying.');
    if (savingsError) alert(labels.CartSavingsDisplayError || 'Savings details could not be displayed. Cart totals are unchanged. Reload before retrying.');
    if (!savings) return;
    if (savings.promotions.length) {
      const heading = document.createElement('h3');
      heading.textContent = labels.CartPromotionsIncluded || 'Promotions included in savings';
      element.append(heading);
      addPromotionLines(element, savings.promotions);
    }
    const totals = document.createElement('dl');
    addAmountRow(totals, labels.CartTotalPromotionSavings || 'Total promotion savings', savings.discount, true);
    if (showSubtotal && savings.subtotal) {
      addAmountRow(totals, labels.CartSubtotalAfterPromotions || 'Subtotal after promotions (excl. tax)', savings.subtotal);
    }
    element.append(totals);
  };
  return { element, update: render };
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
  const render = ({ item: slotItem }) => {
    element.replaceChildren();
    const item = events.lastPayload('cart/data')?.items.find((line) => line.uid === slotItem?.uid);
    let savings = null;
    try {
      savings = item ? getItemSavings(item) : null;
    } catch (failure) {
      console.error(JSON.stringify({ event: 'item_discount_display_failed', reason: failure.message }));
    }
    element.hidden = !savings;
    if (!savings) return;
    const amounts = document.createElement('dl');
    addAmountRow(amounts, labels.CartProductPromotionSavings || 'Promotion savings', savings.discount, true);
    addAmountRow(amounts, labels.CartAfterProductPromotions || 'After promotions (excl. tax)', savings.afterDiscount);
    element.append(amounts);
  };
  ctx.appendChild(element);
  render(ctx);
  ctx.onChange(render);
}
