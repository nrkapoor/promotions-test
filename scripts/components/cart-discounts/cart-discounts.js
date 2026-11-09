function cents(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid cart discount amount.');
  return Math.round((value + Number.EPSILON) * 100);
}

function priceCents(price, currency) {
  if (!price || price.currency !== currency) throw new Error('Cart discount currencies do not match.');
  return cents(price.value);
}

function cartTotalDiscount(cart) {
  const { currency } = cart.total.includingTax;
  const discounts = (cart?.appliedDiscounts ?? [])
    .map((discount) => priceCents(discount.amount, currency));
  return { value: discounts.reduce((sum, value) => sum + value, 0) / 100, currency };
}

export function getCartSavings(cart, display) {
  if (!cart) return null;
  const discount = cartTotalDiscount(cart);
  if (!discount.value) return null;
  return {
    discount,
    promotions: display?.promotions.filter((promotion) => promotion.placement === 'CART') ?? [],
    subtotal: cart.subtotal?.includingDiscountOnly,
  };
}

function compare(a, b) {
  if (String(a[0]) < String(b[0])) return -1;
  if (String(a[0]) > String(b[0])) return 1;
  return 0;
}

export function cartFingerprint(cart) {
  return JSON.stringify([
    cart.id,
    cart.items.map((item) => [
      item.uid, item.sku, item.quantity, cents(item.price.value), item.price.currency,
      cents(item.rowTotal.value), item.rowTotal.currency,
      cents(item.discount.value), item.discount.currency,
    ]).sort(compare),
    (cart.appliedDiscounts ?? []).map((discount) => [
      discount.label, cents(discount.amount.value), discount.amount.currency,
    ]).sort(compare),
    cents(cart.subtotal.includingDiscountOnly.value),
    cents(cart.total.includingTax.value), cart.total.includingTax.currency,
  ]);
}

export function validatePromotionDisplay(display, cart) {
  if (display?.version !== 1 || display.fingerprint !== cartFingerprint(cart)) {
    throw new Error('Promotion details do not match the current cart.');
  }
  if (!Array.isArray(display.promotions) || display.promotions.length > 10000) {
    throw new Error('Invalid promotion detail response.');
  }
  if (display.notice !== undefined && (typeof display.notice !== 'string' || display.notice.length > 500)) {
    throw new Error('Invalid promotion detail notice.');
  }
  const expected = cartTotalDiscount(cart);
  const { currency } = expected;
  if (display.currency !== currency
    || priceCents(display.total, currency) !== cents(expected.value)) {
    throw new Error('Promotion totals do not match Commerce.');
  }
  const items = new Map(cart.items.map((item) => [item.uid, item]));
  if (items.size !== cart.items.length) throw new Error('Duplicate cart item identifiers.');
  const ids = new Set();
  const allocated = new Map();
  let total = 0;
  display.promotions.forEach((promotion) => {
    if (typeof promotion.id !== 'string' || !promotion.id || ids.has(promotion.id)
      || typeof promotion.description !== 'string' || !promotion.description
      || !['ITEM', 'CART'].includes(promotion.placement)
      || !Array.isArray(promotion.allocations) || promotion.allocations.length > items.size) {
      throw new Error('Invalid promotion detail response.');
    }
    ids.add(promotion.id);
    const value = priceCents(promotion.amount, currency);
    if (!value) throw new Error('Invalid zero promotion contribution.');
    let shares = 0;
    const uids = new Set();
    promotion.allocations.forEach((allocation) => {
      if (!items.has(allocation.uid) || uids.has(allocation.uid)) {
        throw new Error('Invalid promotion item allocation.');
      }
      uids.add(allocation.uid);
      const share = priceCents(allocation.amount, currency);
      if (!share) throw new Error('Invalid zero promotion allocation.');
      allocated.set(allocation.uid, (allocated.get(allocation.uid) ?? 0) + share);
      shares += share;
    });
    if (shares !== value) throw new Error('Promotion allocations do not conserve their contribution.');
    total += value;
  });
  if (total !== cents(expected.value) || cart.items.some((item) => (
    (allocated.get(item.uid) ?? 0) !== priceCents(item.discount, currency)
    || (allocated.get(item.uid) ?? 0) > priceCents(item.rowTotal, currency)
  ))) throw new Error('Promotion item totals do not match Commerce.');
  return display;
}

export function getItemSavings(item, display) {
  if (!display) return null;
  const promotions = display.promotions.filter((promotion) => promotion.placement === 'ITEM')
    .flatMap((promotion) => {
      const allocation = promotion.allocations.find((value) => value.uid === item.uid);
      return allocation ? [{
        id: promotion.id, description: promotion.description, amount: allocation.amount,
      }] : [];
    });
  if (!promotions.length) return null;
  const { currency } = display;
  const discount = promotions.reduce((sum, { amount }) => sum + priceCents(amount, currency), 0);
  const row = priceCents(item.rowTotal, currency);
  if (discount > row) throw new Error('Product promotion savings exceed the item total.');
  return {
    promotions,
    discount: { value: discount / 100, currency },
    afterDiscount: { value: (row - discount) / 100, currency },
  };
}
