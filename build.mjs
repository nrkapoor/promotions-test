import { overrideGQLOperations } from '@dropins/build-tools/gql-extend.js';

overrideGQLOperations([
  // ACCS does not have Downloadable Items
  {
    npm: '@dropins/storefront-cart',
    skipFragments: ['DOWNLOADABLE_CART_ITEMS_FRAGMENT'],
    operations: [
      `fragment CART_FRAGMENT on Cart {
        prices {
          custom_fees {
            code
            label
            amount { value currency }
          }
        }
      }`,
      `fragment CART_ITEM_FRAGMENT on CartItemInterface {
        ... on SimpleCartItem {
          customizable_options {
            customizable_option_uid
            label
            values {
              label
              value
            }
          }
        }
      }`,
    ],
  },
  {
    npm: '@dropins/storefront-order',
    skipFragments: ['DOWNLOADABLE_ORDER_ITEMS_FRAGMENT'],
    operations: [],
  },
  {
    npm: '@dropins/storefront-checkout',
    operations: [
      `fragment CHECKOUT_DATA_FRAGMENT on Cart {
        id
      }`,
    ],
  },
  {
    npm: '@dropins/storefront-pdp',
    operations: [
      `fragment PRODUCT_FRAGMENT on ProductView {
        attributes(roles: []) {
          name
          label
          value
          roles
        }
      }`,
    ],
  },
]);
