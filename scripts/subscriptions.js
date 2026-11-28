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

export function renderPdpSubscriptionWidget(container, initialProduct, onSelectPlan) {
  let selectedPlanId = null;
  let plans = [];
  let currentSku = initialProduct?.sku || '';

  const wrapper = document.createElement('div');
  wrapper.className = 'sub-pdp-widget';
  wrapper.hidden = true;
  container.appendChild(wrapper);

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
      onSelectPlan(selectedPlanId);
    }

    wrapper.innerHTML = '';
    const title = document.createElement('p');
    title.className = 'sub-pdp-widget__title';
    title.textContent = 'Purchase Options';
    wrapper.appendChild(title);

    if (!isSubOnly) {
      const oneTimeLabel = document.createElement('label');
      oneTimeLabel.className = `sub-pdp-option ${selectedPlanId === null ? 'is-selected' : ''}`;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `sub-plan-${currentSku}`;
      radio.checked = selectedPlanId === null;
      radio.addEventListener('change', () => {
        selectedPlanId = null;
        onSelectPlan(null);
        render();
      });
      const text = document.createElement('span');
      text.textContent = 'One-time purchase';
      oneTimeLabel.append(radio, text);
      wrapper.appendChild(oneTimeLabel);
    }

    plans.forEach((plan) => {
      const label = document.createElement('label');
      label.className = `sub-pdp-option ${selectedPlanId === plan.id ? 'is-selected' : ''}`;
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `sub-plan-${currentSku}`;
      radio.checked = selectedPlanId === plan.id;
      radio.addEventListener('change', () => {
        selectedPlanId = plan.id;
        onSelectPlan(plan.id);
        render();
      });
      const text = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = plan.name;
      const small = document.createElement('small');
      small.textContent = ` — ${plan.summary}`;
      text.append(strong, small);
      label.append(radio, text);
      wrapper.appendChild(label);
    });
  };

  const loadForProduct = (product) => {
    const sku = product?.sku;
    if (!sku) return;
    currentSku = sku;
    const subscribableAttr = isProductSubscribable(product);
    if (subscribableAttr === false) {
      plans = [];
      selectedPlanId = null;
      onSelectPlan(null);
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
