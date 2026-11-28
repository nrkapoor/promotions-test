import { getCookie } from '@dropins/tools/lib.js';
import { getConfigValue } from '@dropins/tools/lib/aem/configs.js';

function getEndpoint(key) {
  const endpoint = getConfigValue(key);
  if (!endpoint || !URL.canParse(endpoint)) return null;
  const parsed = new URL(endpoint);
  return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    ? endpoint
    : null;
}

export async function fetchPlansForSkus(skus, storeViewCode) {
  const endpoint = getEndpoint('storefront-plans-endpoint');
  if (!endpoint || !Array.isArray(skus) || skus.length === 0) return [];
  const resolvedStore = storeViewCode || getConfigValue('headers.all.Store') || undefined;

  const query = `query PlansForSkus($skus: [String!]!, $storeViewCode: String) {
    subscriptionPlansForSkus(skus: $skus, storeViewCode: $storeViewCode) {
      sku
      plans {
        id
        groupId
        name
        purchaseOption
        billingIntervalUnit
        billingIntervalCount
        minCycles
        maxCycles
        initialChargeType
        summary
      }
    }
  }`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(resolvedStore ? { Store: resolvedStore } : {}),
    },
    body: JSON.stringify({ query, variables: { skus, storeViewCode: resolvedStore } }),
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data?.subscriptionPlansForSkus ?? [];
}

export async function callSubscriberPortal(query, variables = {}) {
  const endpoint = getEndpoint('subscriber-portal-endpoint');
  if (!endpoint) {
    throw new Error('Subscriber portal endpoint is not configured.');
  }
  const token = getCookie('auth_dropin_user_token');
  if (!token) {
    throw new Error('Please sign in to manage your subscriptions.');
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (!res.ok || json.errors?.length) {
    throw new Error(json.errors?.[0]?.message || `Portal request failed (${res.status})`);
  }
  return json.data;
}

export function isProductSubscribable(product) {
  const attrs = product?.attributes;
  if (!Array.isArray(attrs)) return null;
  const attr = attrs.find((a) => a?.name === 'sub_is_subscribable');
  if (!attr) return null;
  const val = String(attr.value ?? '').trim().toLowerCase();
  return val === '1' || val === 'true' || val === 'yes';
}

const SUB_STORAGE_KEY = 'accs_sub_cart_selections_v1';

function readSubSelections() {
  try {
    return JSON.parse(window.localStorage.getItem(SUB_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function setCartSubscriptionSelection(sku, plan) {
  try {
    const map = readSubSelections();
    if (plan) {
      map[sku] = { id: plan.id, name: plan.name, summary: plan.summary };
    } else {
      delete map[sku];
    }
    window.localStorage.setItem(SUB_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

export function getCartSubscriptionSelection(sku) {
  const map = readSubSelections();
  return map[sku] || null;
}

function extractUnitPrice(product) {
  const candidates = [
    product?.prices?.final?.amount,
    product?.prices?.final?.amount?.value,
    product?.price?.final?.amount?.value,
    product?.price?.final?.amount,
    product?.priceRange?.minimum?.final?.amount?.value,
    product?.priceRange?.minimum?.final?.amount,
  ];
  const numeric = candidates.find((v) => typeof v === 'number' && Number.isFinite(v));
  if (typeof numeric === 'number') return numeric;
  const domPrice = document.querySelector('.product-details__price')?.textContent;
  const parsed = domPrice ? Number(domPrice.replace(/[^0-9.]/g, '')) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseCycleOneDiscount(summary) {
  const text = String(summary || '');
  if (/^(First cycle|Cycles \d+–\d+) free/i.test(text) || /^Free for /i.test(text)) {
    return { pct: 100, isFirstFree: true };
  }
  const match = text.match(/Save\s+(\d+(?:\.\d+)?)%/i);
  return { pct: match ? Number(match[1]) : 0, isFirstFree: false };
}

function formatMoney(value) {
  return `$${Number(value).toFixed(2)}`;
}

export function renderPdpSubscriptionWidget(container, initialProduct, onSelectPlan) {
  let selectedPlanId = null;
  let plans = [];
  let currentProduct = initialProduct || null;
  let currentSku = initialProduct?.sku || '';

  const wrapper = document.createElement('div');
  wrapper.className = 'sub-pdp-widget';
  wrapper.hidden = true;
  container.appendChild(wrapper);

  const notify = () => {
    const plan = plans.find((p) => p.id === selectedPlanId) || null;
    if (currentSku) setCartSubscriptionSelection(currentSku, plan);
    onSelectPlan(selectedPlanId, plan);
  };

  const render = () => {
    if (plans.length === 0) {
      wrapper.hidden = true;
      wrapper.innerHTML = '';
      return;
    }

    wrapper.hidden = false;
    const isSubOnly = plans.every((p) => p.purchaseOption === 'SUBSCRIPTION_ONLY');
    if (isSubOnly && !selectedPlanId) {
      selectedPlanId = plans[0].id;
      notify();
    }

    const activePlan = plans.find((p) => p.id === selectedPlanId) || plans[0];
    const basePrice = extractUnitPrice(currentProduct);
    const { pct, isFirstFree } = parseCycleOneDiscount(activePlan.summary);
    const subPrice = basePrice !== null ? Number((basePrice * (1 - pct / 100)).toFixed(2)) : null;
    const isSubscribed = selectedPlanId !== null;

    wrapper.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'sub-pdp-widget__header';
    const title = document.createElement('span');
    title.className = 'sub-pdp-widget__title';
    title.textContent = 'Select Purchase Option';
    const hint = document.createElement('span');
    hint.className = 'sub-pdp-widget__hint';
    hint.textContent = 'Flexible delivery • Cancel anytime';
    headerRow.append(title, hint);
    wrapper.appendChild(headerRow);

    const subCard = document.createElement('div');
    subCard.className = `sub-pdp-card ${isSubscribed ? 'is-selected' : ''}`;

    const subHeader = document.createElement('button');
    subHeader.type = 'button';
    subHeader.className = 'sub-pdp-card__header';
    subHeader.addEventListener('click', () => {
      if (!selectedPlanId) {
        selectedPlanId = plans[0].id;
        notify();
        render();
      }
    });

    const subLeft = document.createElement('div');
    subLeft.className = 'sub-pdp-card__left';
    const radioDot = document.createElement('span');
    radioDot.className = `sub-pdp-radio ${isSubscribed ? 'is-checked' : ''}`;
    const subTextWrap = document.createElement('div');
    const subTitleRow = document.createElement('div');
    subTitleRow.className = 'sub-pdp-card__title-row';
    const subTitle = document.createElement('strong');
    if (isFirstFree) {
      subTitle.textContent = activePlan.name || 'Subscribe & Save';
    } else if (pct > 0 && pct < 100) {
      subTitle.textContent = `Subscribe & Save ${pct}%`;
    } else {
      subTitle.textContent = activePlan.name || 'Subscribe & Save';
    }
    subTitleRow.appendChild(subTitle);
    if (isFirstFree) {
      const savePill = document.createElement('span');
      savePill.className = 'sub-pdp-save-pill';
      savePill.textContent = '1st Cycle Free';
      subTitleRow.appendChild(savePill);
    } else if (pct > 0 && pct < 100 && basePrice !== null && subPrice !== null) {
      const savePill = document.createElement('span');
      savePill.className = 'sub-pdp-save-pill';
      savePill.textContent = `Save ${formatMoney(basePrice - subPrice)}`;
      subTitleRow.appendChild(savePill);
    }
    const subDesc = document.createElement('div');
    subDesc.className = 'sub-pdp-card__subtitle';
    subDesc.textContent = 'Auto-delivered on your schedule • Cancel anytime';
    subTextWrap.append(subTitleRow, subDesc);
    subLeft.append(radioDot, subTextWrap);

    const subRight = document.createElement('div');
    subRight.className = 'sub-pdp-card__price';
    if (basePrice !== null && subPrice !== null) {
      if (subPrice < basePrice) {
        const strike = document.createElement('span');
        strike.className = 'sub-pdp-price-strike';
        strike.textContent = formatMoney(basePrice);
        subRight.appendChild(strike);
      }
      const finalEl = document.createElement('span');
      finalEl.className = 'sub-pdp-price-sub';
      finalEl.textContent = formatMoney(subPrice);
      subRight.appendChild(finalEl);
    }

    subHeader.append(subLeft, subRight);
    subCard.appendChild(subHeader);

    if (isSubscribed) {
      const body = document.createElement('div');
      body.className = 'sub-pdp-card__body';

      const freqLabel = document.createElement('div');
      freqLabel.className = 'sub-pdp-freq-label';
      freqLabel.textContent = 'Delivery Frequency';
      body.appendChild(freqLabel);

      const freqGrid = document.createElement('div');
      freqGrid.className = 'sub-pdp-freq-grid';
      plans.forEach((plan) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `sub-pdp-freq-btn ${selectedPlanId === plan.id ? 'is-active' : ''}`;
        btn.textContent = `${plan.name} (${plan.summary})`;
        btn.addEventListener('click', () => {
          selectedPlanId = plan.id;
          notify();
          render();
        });
        freqGrid.appendChild(btn);
      });
      body.appendChild(freqGrid);

      const perks = document.createElement('ul');
      perks.className = 'sub-pdp-perks';
      [
        'Skip, pause, or cancel anytime in 1 click—no phone calls',
        '3-day advance reminder before every recurring charge',
      ].forEach((perk) => {
        const li = document.createElement('li');
        li.textContent = `✓ ${perk}`;
        perks.appendChild(li);
      });
      body.appendChild(perks);

      subCard.appendChild(body);
    }

    wrapper.appendChild(subCard);

    if (!isSubOnly) {
      const oneTimeCard = document.createElement('button');
      oneTimeCard.type = 'button';
      oneTimeCard.className = `sub-pdp-card sub-pdp-card--onetime ${!isSubscribed ? 'is-selected' : ''}`;
      oneTimeCard.addEventListener('click', () => {
        selectedPlanId = null;
        notify();
        render();
      });

      const otLeft = document.createElement('div');
      otLeft.className = 'sub-pdp-card__left';
      const otDot = document.createElement('span');
      otDot.className = `sub-pdp-radio ${!isSubscribed ? 'is-checked is-dark' : ''}`;
      const otText = document.createElement('div');
      const otTitle = document.createElement('strong');
      otTitle.textContent = 'One-Time Purchase';
      const otSub = document.createElement('div');
      otSub.className = 'sub-pdp-card__subtitle';
      otSub.textContent = 'Single shipment • Standard shipping rates apply';
      otText.append(otTitle, otSub);
      otLeft.append(otDot, otText);

      const otRight = document.createElement('div');
      otRight.className = 'sub-pdp-card__price';
      if (basePrice !== null) {
        const otPrice = document.createElement('span');
        otPrice.className = 'sub-pdp-price-regular';
        otPrice.textContent = formatMoney(basePrice);
        otRight.appendChild(otPrice);
      }

      oneTimeCard.append(otLeft, otRight);
      wrapper.appendChild(oneTimeCard);
    }
  };

  const loadForProduct = (product) => {
    currentProduct = product || null;
    const sku = product?.sku;
    if (!sku) return;
    currentSku = sku;
    const subscribableAttr = isProductSubscribable(product);
    if (subscribableAttr === false) {
      plans = [];
      selectedPlanId = null;
      notify();
      render();
      return;
    }

    fetchPlansForSkus([sku])
      .then((res) => {
        if (currentSku !== sku) return;
        plans = res.find((entry) => entry.sku === sku)?.plans ?? [];
        render();
      })
      .catch(() => {
        plans = [];
        render();
      });
  };

  if (initialProduct?.sku) {
    loadForProduct(initialProduct);
  }

  return {
    updateProduct: loadForProduct,
    getSelectedPlanId: () => selectedPlanId,
  };
}

export function renderCartItemSubscriptionSlot(ctx, _cartApi) {
  const sku = ctx.item?.sku;
  const subOption = ctx.item?.customizable_options?.find(
    (opt) => opt.label === 'subscription_plan_id',
  );
  const storedSelection = sku ? getCartSubscriptionSelection(sku) : null;

  const slotHost = document.createElement('div');
  slotHost.className = 'sub-cart-slot';
  ctx.appendChild(slotHost);

  const renderSlot = (plans = []) => {
    slotHost.innerHTML = '';
    const isSubOnly = plans.length > 0 && plans.every((p) => p.purchaseOption === 'SUBSCRIPTION_ONLY');
    const activeSelection = subOption
      ? {
        id: subOption.values?.[0]?.value,
        name: subOption.values?.[0]?.label || 'Subscription',
      }
      : storedSelection || getCartSubscriptionSelection(sku) || (isSubOnly ? plans[0] : null);

    if (activeSelection) {
      const badgeWrap = document.createElement('div');
      badgeWrap.className = 'sub-cart-badge-row';
      const subBadge = document.createElement('span');
      subBadge.className = 'sub-cart-badge';
      const { pct, isFirstFree } = parseCycleOneDiscount(activeSelection.summary);
      const itemTotal = ctx.item?.total?.value ?? ctx.item?.price?.value;
      if (isFirstFree && typeof itemTotal === 'number') {
        subBadge.textContent = `↻ ${activeSelection.name} • Cycle 1: $0.00 (Free), then ${formatMoney(itemTotal)}`;
      } else if (pct > 0 && pct < 100 && typeof itemTotal === 'number') {
        const discounted = Number((itemTotal * (1 - pct / 100)).toFixed(2));
        subBadge.textContent = `↻ ${activeSelection.name} • Cycle 1: ${formatMoney(discounted)} (Save ${pct}%)`;
      } else {
        subBadge.textContent = `↻ ${activeSelection.name}${activeSelection.summary ? ` (${activeSelection.summary})` : ''}`;
      }
      badgeWrap.appendChild(subBadge);

      slotHost.appendChild(badgeWrap);
      return;
    }

    if (plans.length === 0 || !sku) return;
    const plan = plans[0];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sub-cart-upgrade__btn';
    btn.textContent = `↻ Upgrade to ${plan.name} (${plan.summary})`;
    btn.addEventListener('click', () => {
      setCartSubscriptionSelection(sku, plan);
      renderSlot(plans);
    });
    slotHost.appendChild(btn);
  };

  if (subOption) {
    renderSlot();
    return;
  }

  if (!sku) return;
  fetchPlansForSkus([sku])
    .then((res) => {
      const plans = res.find((entry) => entry.sku === sku)?.plans ?? [];
      renderSlot(plans);
    })
    .catch(() => {});
}

export function renderCartSubscriptionSummary(container) {
  const box = document.createElement('div');
  box.className = 'sub-cart-summary';
  box.hidden = true;
  container.appendChild(box);

  const update = async (cartData) => {
    const items = cartData?.items ?? [];
    if (items.length === 0) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    const skus = [...new Set(items.map((i) => i.sku).filter(Boolean))];
    const plansBySku = new Map();
    try {
      const res = await fetchPlansForSkus(skus);
      res.forEach((entry) => plansBySku.set(entry.sku, entry.plans ?? []));
    } catch {
      // Ignore network errors
    }

    let totalDiscount = 0;
    let totalDueToday = 0;
    let totalRecurring = 0;
    let subCount = 0;

    items.forEach((item) => {
      const lineTotal = item?.total?.value ?? ((item?.price?.value ?? 0) * (item?.quantity ?? 1));
      const itemPlans = plansBySku.get(item.sku) ?? [];
      const isSubOnly = itemPlans.length > 0 && itemPlans.every((p) => p.purchaseOption === 'SUBSCRIPTION_ONLY');
      const selected = getCartSubscriptionSelection(item.sku) || (isSubOnly ? itemPlans[0] : null);

      if (selected) {
        subCount += 1;
        const { pct } = parseCycleOneDiscount(selected.summary);
        const discount = Number(((lineTotal * pct) / 100).toFixed(2));
        totalDiscount += discount;
        totalDueToday += Number((lineTotal - discount).toFixed(2));
        totalRecurring += lineTotal;
      } else {
        totalDueToday += lineTotal;
      }
    });

    if (subCount === 0) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }

    box.hidden = false;
    box.innerHTML = '';
    const title = document.createElement('h3');
    title.className = 'sub-cart-summary__title';
    title.textContent = 'Subscription Summary';
    box.appendChild(title);

    const rows = [
      ['Cycle 1 Subscription Savings', `-${formatMoney(totalDiscount)}`],
      ['Due Today (Cycle 1)', formatMoney(totalDueToday)],
      ['Recurring Total (Cycle 2+)', formatMoney(totalRecurring)],
    ];

    rows.forEach(([label, val]) => {
      const row = document.createElement('div');
      row.className = 'sub-cart-summary__row';
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('strong');
      v.textContent = val;
      row.append(l, v);
      box.appendChild(row);
    });
  };

  return { update };
}
