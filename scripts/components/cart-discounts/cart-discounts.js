function cents(value) {
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid cart discount amount.');
  return Math.round((value + Number.EPSILON) * 100);
}

export function getPromotionLabels(labels = []) {
  return labels.flatMap((label) => label.split(/\r?\n|\\n/))
    .map((label) => label.trim()).filter(Boolean);
}

export function getCartSavings(cart) {
  const discounts = (cart?.appliedDiscounts ?? [])
    .filter((discount) => cents(discount.amount.value) > 0);
  if (!discounts.length) return null;
  const { currency } = discounts[0].amount;
  if (discounts.some((discount) => discount.amount.currency !== currency)) {
    throw new Error('Cart discount currencies do not match.');
  }
  return {
    discount: {
      value: discounts.reduce((sum, discount) => sum + cents(discount.amount.value), 0) / 100,
      currency,
    },
    labels: getPromotionLabels(discounts.map((discount) => discount.label)),
    subtotal: cart.subtotal?.includingDiscountOnly,
  };
}

function money(price, locale) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: price.currency })
    .format(price.value);
}

function addAmountRow(element, label, price, locale, savings = false) {
  const row = document.createElement('div');
  row.className = 'cart-discounts__row';
  const title = document.createElement('dt');
  title.textContent = label;
  const value = document.createElement('dd');
  value.textContent = `${savings ? '\u2212' : ''}${money(price, locale)}`;
  row.append(title, value);
  element.append(row);
}

function addLabels(element, labels) {
  if (!labels.length) return;
  const list = document.createElement('ul');
  list.className = 'cart-discounts__promotions';
  labels.forEach((label) => {
    const entry = document.createElement('li');
    entry.textContent = label;
    list.append(entry);
  });
  element.append(list);
}

export function renderCartSavings(ctx, labels = {}) {
  const element = document.createElement('section');
  element.className = 'cart-discounts cart-discounts--summary';
  const locale = document.documentElement.lang || 'en';
  const update = ({ data }) => {
    element.replaceChildren();
    const savings = getCartSavings(data);
    element.hidden = !savings;
    if (!savings) return;
    const heading = document.createElement('h3');
    heading.textContent = labels.CartPromotionsApplied || 'Promotions applied';
    element.append(heading);
    addLabels(element, savings.labels);
    const amounts = document.createElement('dl');
    addAmountRow(amounts, labels.CartPromotionSavings || 'Promotion savings', savings.discount, locale, true);
    if (savings.subtotal) {
      addAmountRow(amounts, labels.CartSubtotalAfterPromotions || 'Subtotal after promotions (excl. tax)', savings.subtotal, locale);
    }
    element.append(amounts);
  };
  ctx.appendChild(element);
  update(ctx);
  ctx.onChange(update);
}
