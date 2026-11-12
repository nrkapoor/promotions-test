import { events } from '@dropins/tools/event-bus.js';
import { rootLink } from '../../scripts/commerce.js';

export default async function decorate(block) {
  let cart = events.lastPayload('cart/initialized');
  if (cart === undefined) {
    cart = await new Promise((resolve) => {
      const subscription = events.on('cart/initialized', (data) => {
        subscription.off();
        resolve(data);
      });
    });
  }

  if (events.lastPayload('order/placed') === undefined
    && (cart === null || cart?.items?.length === 0)) {
    window.location.href = rootLink('/cart');
    return;
  }

  const { default: renderCheckout } = await import('./checkout.js');
  await renderCheckout(block);
}
