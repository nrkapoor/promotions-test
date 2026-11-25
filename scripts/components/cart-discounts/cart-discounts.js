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

export function customFeeModel(data) {
  return { customFees: data?.prices?.custom_fees ?? [] };
}

export function getCartFees(cart) {
  const fees = cart?.customFees ?? [];
  if (!Array.isArray(fees) || fees.length > 1000) throw new Error('Invalid cart fee response.');
  const codes = new Set();
  return fees.map((fee) => {
    if (typeof fee?.code !== 'string' || !fee.code.trim() || codes.has(fee.code)
      || typeof fee.label !== 'string' || !fee.label.trim()
      || !Number.isFinite(fee.amount?.value) || fee.amount.value <= 0
      || fee.amount.currency !== cart?.total?.includingTax?.currency) {
      throw new Error('Invalid cart fee details.');
    }
    codes.add(fee.code);
    return { code: fee.code, label: fee.label, amount: { ...fee.amount } };
  });
}

/**
 * One line per promotion, as written by the promotions checkout webhook into the Commerce discount
 * label (for example "Spring 10% off ($10.00)"). Labels are plain text, never HTML.
 */
export function promotionLines(cart) {
  return (cart?.appliedDiscounts ?? []).flatMap((discount) => String(discount.label ?? '')
    .split('\n').map((line) => line.trim()).filter(Boolean));
}

/** Cart savings from Commerce's own totals: the total discount and each promotion's label line. */
export function getCartSavings(cart) {
  if (!cart) return null;
  const discount = cartTotalDiscount(cart);
  if (!discount.value) return null;
  return {
    discount,
    promotions: promotionLines(cart),
    subtotal: cart.subtotal?.includingDiscountOnly,
  };
}

/** Savings on one product row: Commerce's item discount, which the checkout webhook sets. */
export function getItemSavings(item) {
  const { currency } = item.rowTotal;
  const discount = priceCents(item.discount, currency);
  if (!discount) return null;
  const row = priceCents(item.rowTotal, currency);
  if (discount > row) throw new Error('Product promotion savings exceed the item total.');
  return {
    discount: { value: discount / 100, currency },
    afterDiscount: { value: (row - discount) / 100, currency },
  };
}
