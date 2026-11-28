import { checkIsAuthenticated, CUSTOMER_LOGIN_PATH, rootLink } from '../../scripts/commerce.js';
import { callSubscriberPortal } from '../../scripts/subscriptions.js';
import '../../scripts/initializers/account.js';

const LIST_QUERY = `query MySubscriptions {
  mySubscriptions {
    id
    status
    planName
    currentCycle
    remainingPrepaidDeliveries
    intervalUnit
    intervalCount
    nextBillingAt
    nextDeliveryAt
    pausedUntil
    items {
      itemId
      sku
      qty
      lockedUnitPrice
      currency
    }
  }
}`;

const MUTATION_FIELDS = `
  id status planName currentCycle remainingPrepaidDeliveries
  intervalUnit intervalCount nextBillingAt nextDeliveryAt pausedUntil
  items { itemId sku qty lockedUnitPrice currency }
`;

function nextIdempotencyKey() {
  return `eds_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function createButton(label, className, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

export default async function decorate(block) {
  if (!checkIsAuthenticated()) {
    window.location.href = rootLink(CUSTOMER_LOGIN_PATH);
    return;
  }

  let subscriptions = [];
  let loading = true;
  let errorMsg = '';
  let statusMsg = '';
  let cancellingId = null;

  const render = () => {
    block.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'sub-portal__header';
    const h2 = document.createElement('h2');
    h2.textContent = 'My Subscriptions';
    header.appendChild(h2);
    block.appendChild(header);

    if (errorMsg) {
      const alert = document.createElement('div');
      alert.className = 'sub-portal__alert sub-portal__alert--error';
      alert.setAttribute('role', 'alert');
      alert.textContent = errorMsg;
      block.appendChild(alert);
    }

    if (statusMsg) {
      const notice = document.createElement('div');
      notice.className = 'sub-portal__alert sub-portal__alert--success';
      notice.setAttribute('role', 'status');
      notice.textContent = statusMsg;
      block.appendChild(notice);
    }

    if (loading) {
      const p = document.createElement('p');
      p.textContent = 'Loading your subscriptions…';
      block.appendChild(p);
      return;
    }

    if (subscriptions.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'You do not have any active or past subscriptions yet.';
      block.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'sub-portal__list';

    subscriptions.forEach((sub) => {
      const card = document.createElement('article');
      card.className = 'sub-portal__card';

      const top = document.createElement('div');
      top.className = 'sub-portal__card-top';
      const title = document.createElement('h3');
      title.textContent = sub.planName;
      const badge = document.createElement('span');
      badge.className = `sub-portal__badge sub-portal__badge--${sub.status.toLowerCase()}`;
      badge.textContent = sub.status;
      top.append(title, badge);
      card.appendChild(top);

      const meta = document.createElement('p');
      meta.className = 'sub-portal__meta';
      meta.textContent = `Every ${sub.intervalCount} ${sub.intervalUnit.toLowerCase()} • Cycle ${sub.currentCycle} • Next billing: ${sub.nextBillingAt.slice(0, 10)}`;
      card.appendChild(meta);

      const itemsUl = document.createElement('ul');
      itemsUl.className = 'sub-portal__items';
      sub.items.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = `${item.sku} × ${item.qty} (${item.currency} ${item.lockedUnitPrice.toFixed(2)})`;
        itemsUl.appendChild(li);
      });
      card.appendChild(itemsUl);

      const actions = document.createElement('div');
      actions.className = 'sub-portal__actions';

      const runAction = async (mutation, variables, successLabel) => {
        errorMsg = '';
        statusMsg = '';
        try {
          await callSubscriberPortal(mutation, {
            ...variables,
            id: sub.id,
            idempotencyKey: nextIdempotencyKey(),
          });
          statusMsg = successLabel;
          cancellingId = null;
          await loadSubscriptions();
        } catch (err) {
          errorMsg = err.message;
          render();
        }
      };

      if (sub.status === 'ACTIVE') {
        actions.append(
          createButton('Skip Next Delivery', 'button secondary', () => runAction(
            `mutation Skip($id: ID!, $idempotencyKey: String!) {
              skipNextDelivery(id: $id, idempotencyKey: $idempotencyKey) { ${MUTATION_FIELDS} }
            }`,
            {},
            'Skipped next delivery.',
          )),
          createButton('Order Now', 'button primary', () => runAction(
            `mutation OrderNow($id: ID!, $idempotencyKey: String!) {
              orderNow(id: $id, idempotencyKey: $idempotencyKey) { ${MUTATION_FIELDS} }
            }`,
            {},
            'Immediate renewal order placed.',
          )),
          createButton('Every 2 Months', 'button secondary', () => runAction(
            `mutation Cadence($id: ID!, $idempotencyKey: String!) {
              updateCadence(id: $id, intervalUnit: MONTH, intervalCount: 2, idempotencyKey: $idempotencyKey) { ${MUTATION_FIELDS} }
            }`,
            {},
            'Updated cadence to every 2 months.',
          )),
          createButton('Pause', 'button secondary', () => runAction(
            `mutation Pause($id: ID!, $idempotencyKey: String!) {
              pauseSubscription(id: $id, reasonCode: "CUSTOMER_PAUSE", idempotencyKey: $idempotencyKey) { ${MUTATION_FIELDS} }
            }`,
            {},
            'Subscription paused.',
          )),
        );
      }

      if (sub.status === 'PAUSED') {
        actions.append(
          createButton('Resume', 'button primary', () => runAction(
            `mutation Resume($id: ID!, $idempotencyKey: String!) {
              resumeSubscription(id: $id, idempotencyKey: $idempotencyKey) { ${MUTATION_FIELDS} }
            }`,
            {},
            'Subscription resumed.',
          )),
        );
      }

      if (sub.status === 'ACTIVE' || sub.status === 'PAUSED') {
        actions.append(
          createButton('Cancel', 'button secondary', () => {
            cancellingId = cancellingId === sub.id ? null : sub.id;
            render();
          }),
        );
      }

      card.appendChild(actions);

      if (cancellingId === sub.id) {
        const deflection = document.createElement('div');
        deflection.className = 'sub-portal__deflection';
        const prompt = document.createElement('p');
        prompt.textContent = 'Before you cancel, would you prefer to skip or pause instead?';
        const defActions = document.createElement('div');
        defActions.className = 'sub-portal__actions';
        defActions.append(
          createButton('Skip Instead', 'button primary', () => runAction(
            `mutation Skip($id: ID!, $idempotencyKey: String!) {
              skipNextDelivery(id: $id, idempotencyKey: $idempotencyKey) { ${MUTATION_FIELDS} }
            }`,
            {},
            'Kept subscription and skipped next delivery.',
          )),
          createButton('Confirm Cancellation', 'button secondary', () => runAction(
            `mutation Cancel($id: ID!, $idempotencyKey: String!) {
              cancelSubscription(id: $id, reasonCode: "TOO_EXPENSIVE", acceptedDeflectionOffer: false, idempotencyKey: $idempotencyKey) { ${MUTATION_FIELDS} }
            }`,
            {},
            'Subscription cancelled.',
          )),
        );
        deflection.append(prompt, defActions);
        card.appendChild(deflection);
      }

      list.appendChild(card);
    });

    block.appendChild(list);
  };

  async function loadSubscriptions() {
    loading = true;
    render();
    try {
      const data = await callSubscriberPortal(LIST_QUERY);
      subscriptions = data?.mySubscriptions ?? [];
    } catch (err) {
      errorMsg = err.message;
    } finally {
      loading = false;
      render();
    }
  }

  await loadSubscriptions();
}
