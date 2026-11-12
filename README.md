# Edge Delivery Services + Adobe Commerce Boilerplate + Citisignal UI/UX

- This project boilerplate is for Edge Delivery Services projects that integrate with Adobe Commerce. 
- It has instrumentation for supporting both universal editor as well as Document authoring

- Blocks available:
  - Accordion 
  -  Cards
  -  Carousel
  - Columns
  - Fragment
  - Hero
  - Product Recommendations
  - Product Teaser
  - Quote
  - Search
  - Tabs
  - Video
  - Text
  - Image

## Documentation

Before using the boilerplate, we recommend you to go through the documentation on <https://experienceleague.adobe.com/developer/commerce/storefront/> and more specifically:

1. [Storefront Developer Tutorial](https://experienceleague.adobe.com/developer/commerce/storefront/get-started/)
1. [AEM Docs](https://www.aem.live/docs/)
1. [AEM Developer Tutorial](https://www.aem.live/developer/tutorial)
1. [The Anatomy of an AEM Project](https://www.aem.live/developer/anatomy-of-a-project)
1. [Web Performance](https://www.aem.live/developer/keeping-it-100)
1. [Markup, Sections, Blocks, and Auto Blocking](https://www.aem.live/developer/markup-sections-blocks)

## Getting Started

Use the [Site Creator Tool](https://da.live/app/adobe-commerce/storefront-tools/tools/site-creator/site-creator) to quickly spin up your own copy of code and content.

Alternatively, you can follow our [Guide](https://experienceleague.adobe.com/developer/commerce/storefront/get-started/) for a more detailed walkthrough.

## Installation

Run `npm install` to install dependencies.

This repo's `.npmrc` sets `ignore-scripts=true`, which disables npm lifecycle scripts (`preinstall`/`install`/`postinstall`) for every package. This is a defense against npm supply-chain attacks that hide malicious code inside those scripts. One consequence is that `npm install` alone will **not** copy the drop-in assets into `scripts/__dropins__` or apply the GraphQL overrides defined in `build.mjs`.

After every `npm install` — initial setup, or any time a `@dropins/*` or `@adobe/*` dependency changes — run:

```bash
npm run install:dropins
```

This copies the built assets from `node_modules/@dropins` and the relevant `@adobe/*` packages into `scripts/__dropins__`, and applies the GraphQL fragment/operation overrides in `build.mjs`. Edge Delivery Services serves the copied files directly, so this step must complete before `npm start` will reflect the correct drop-in behavior.

### Build checks

GitHub Actions uses Node.js 24 and runs `npm ci`, lint, cart-discount unit tests,
and isolated coupon browser checks after installing Chromium.
The inherited Cypress suites target the upstream Adobe demo backends; both their
shards and aggregate checks are upstream-only. On upstream, failed or cancelled
shards still fail the aggregate gate. This fork's coupon checks run in Build
against synthetic responses and never place orders in the shared sandbox.
The block README workflow has read-only source access and pull-request comment
permission so it can report documentation requirements.
Commit `package-lock.json` with dependency changes so clean installs remain
reproducible. If `npm ci` reports missing or inconsistent lockfile entries, repair
the lockfile with `npm install --package-lock-only --ignore-scripts`, then verify
`npm ci` and `npm run lint` before committing. This preserves the manifest's exact
dependency pins and keeps lifecycle scripts disabled. A lockfile-only repair does
not require regenerating the tracked drop-in assets when their versions are unchanged.

### Cart promotion display

SKU/category-targeted promotions and BOGO appear under eligible product rows,
with each name and exact contribution in its own row. Their after-product-promotions
row total excludes cart-wide discounts. Untargeted names and full contributions
appear only in cart summaries. Targeted names are not repeated there; total savings
still includes every promotion. Native allocation, taxes and totals are unchanged.

The `promotion-display-endpoint` in `config.json` supplies a read-only, verified
breakdown from App Builder. Requests contain only the cart ID and optional customer
session token. The API reads Commerce and reconciles the same promotion engine with
the native cart; the client validates the fingerprint, currencies, contribution
totals and every item allocation. No amounts are parsed from label strings.
Descriptions are rendered as text, never HTML.

Cart and mini-cart slots share requests. Loading, stale or unavailable metadata
never substitutes combined native allocations for product savings. Summaries keep
the native aggregate amount and show explicit loading/error status; checkout
remains usable. The API currently requires base-currency quotes.

Optional `Global` placeholders: `CartProductPromotions`,
`CartAfterProductPromotions`, `CartPromotionsIncluded`,
`CartTotalPromotionSavings`, `CartSubtotalAfterPromotions`,
`CartPromotionDetailsLoading`, and `CartPromotionDetailsError` override the default
English copy. Currency formatting uses the document language.

Run `npm run test:cart-discounts` for focused placement, freshness and conservation
regressions, including asynchronous slot updates (Node.js 24, also run by Build).
Changes use supported drop-in slots and native OrderSummary
`updateLineItems`; generated `scripts/__dropins__` assets require no edits.

## App Builder coupon controls (gated)

After the backend passes the target environment's acceptance,
configure the optional `shopper-coupons-endpoint` key in `config.json` with the HTTPS
`shopper-coupons` Runtime action URL. This branch targets the connected shared
sandbox with backend status `SANDBOX_READY`: functional checkout is enabled and
latency certification is explicitly deferred. Production still requires the
backend's independent production readiness gate. Leave the key absent on
environments without matching acceptance.
Without it, cart and checkout preserve native Coupons and load no custom coupon
client. With it, both use the same accessible app-coupon form; load/configuration
errors show an alert instead of silently switching back to native coupon submission.
This slot manages App Builder coupons, not simultaneous native Commerce coupons.

To test, create a coupon-required discount in Promotions, save it as Draft, then
create and activate codes in Coupons. On the cart or checkout page, enter the
codes in **Coupon codes (comma-separated)** and choose **Apply coupons**.
Use **Remove all coupons** to restore automatic promotions. Use sandbox/offline
payment only. Codes must come from an active, unexpired coupon group.

Apply appends one to five distinct codes, with at most one code per promotion.
Remove removes all app coupons. Prices and discounts always come from native cart
refresh and the verified promotion display, never client-calculated savings.
Changing cart eligibility can leave a reserved code ineligible until the cart is
updated or the codes are removed/reapplied.

Mutations use the current reservation version and a stable UUID. Unknown network
outcomes must be retried unchanged. After the server acknowledges a mutation,
retrying a failed native cart refresh does not submit the mutation again; removal
remains available to recover from failed pricing refresh. Fully fenced orders are
never removable, even when their lease timestamp has passed. A changed customer
must remove the previous customer's claims before applying fresh codes.

Only the masked cart ID and optional shopper session token identify the cart.
No browser-supplied prices/customer IDs are accepted; never put the server coupon
secret or IMS credentials in storefront configuration. Codes and retry receipts
remain in memory only, and cart/customer changes clear input and reject late
responses. Reloading loses the local retry receipt; recover via status/removal,
not blind application with new UUIDs.

Optional `Global` placeholders: `CouponCodes`, `ApplyCoupon`, `RemoveCoupons`,
`RetryCoupons`, `NoCoupons`, `CouponStatus`, `CartLoading`, `CouponToolsUnavailable`.

Run `npm run test:cart-discounts` for transport/idempotency and placement tests.
For browser tests, run `npx playwright install chromium` once and then
`npm run test:coupon-ui`. These cover both slots, native-control fallback, missing
carts, expiry, retry/removal recovery, mobile layout and text-only rendering using
mocked backend responses. They do **not** certify native hook semantics or real
checkout p95 latency. Both suites and lint run in CI.

## Staying Up to Date

Once you fork or clone this repo, the code is yours — you are not subscribed to updates.

### What a suite release is (and is not)

A suite release — for example "[b2c-march-2026](https://github.com/hlxsites/aem-boilerplate-commerce/tree/b2c-march-2026)" — is a tagged snapshot of this boilerplate at a point in time when a specific combination of drop-in package versions and boilerplate code was tested together and verified to work. That tag is useful as a **starting point** for developers who are setting up a new project. You can find the release notes for each suite release in the [releases](https://experienceleague.adobe.com/developer/commerce/storefront/releases/) page.

If you have already forked or cloned this repo, a new suite release is not an upgrade you need to apply. There is no mechanism that pushes boilerplate code changes into your fork, and nothing will break in your project because a new release tag was created upstream. Treat suite releases the same way you would treat a new major version of a project template: relevant only if you are starting fresh.

### Updating your drop-in dependencies

The only things you need to actively track after forking are your **npm dependencies** — specifically the `@dropins/*` and `@adobe/*` packages (including `@adobe/magento-storefront-event-collector` and `@adobe/magento-storefront-events-sdk`) listed in your `package.json`. Before applying any update, check the release notes for breaking changes and ensure you run `npm run install:dropins` so that the dependencies in your `scripts/__dropins__` directory are updated to the latest build.

These packages follow semantic versioning. Minor and patch releases are non-breaking by contract, so routine updates should be safe to apply.

To see which packages have newer versions available:

```bash
npm outdated
```

To install a specific version:

```bash
npm install @dropins/storefront-cart@2.0.0  # updates the package in node_modules/
npm run install:dropins                     # copies scripts from node_modules into scripts/__dropins__/
```

To update a drop-in to its latest stable release:

```bash
npm install @dropins/storefront-cart@latest
npm run install:dropins
```

Always run `npm run install:dropins` after any drop-in update — it copies the built assets from `node_modules` into `scripts/__dropins__`, which is what Edge Delivery Services serves. Since this repo disables npm lifecycle scripts (see [Installation](#installation)), this step is never run automatically and must always be done manually.

### Automated dependency PRs

This repo includes a GitHub Actions workflow that runs every Monday and opens a pull request when newer stable versions of `@adobe/*` or `@dropins/*` packages are available within the ranges declared in your `package.json` ([semver](https://semver.org/)). The PR includes updated `package.json`, `package-lock.json`, and regenerated dropin assets under `scripts/__dropins__/`. Pre-release packages are held without changes and surfaced in the workflow output. This works similarly to Dependabot or Renovate; once you fork the repo, the workflow runs in your fork so you can review and merge updates at your own pace.

You can also trigger the workflow manually from the **Actions** tab in GitHub.

### Pulling boilerplate code changes into your fork (optional)

If you want to incorporate code changes made to this upstream boilerplate after you forked — for example, a new block or a bug fix in `scripts/` — you can do so by adding this repo as a git remote and merging selectively. This is entirely optional. Upstream changes may conflict with modifications you have made to your fork, so expect to resolve conflicts manually. There is no guarantee of a clean merge, and nothing in your project depends on staying in sync with the upstream boilerplate code.

## Changelog

Major changes to this boilerplate are described and documented as part of pull requests and tracked via the `changelog` tag. This log documents changes to the canonical starting point — not upgrades that forked implementations must apply. Review it if you are considering pulling specific upstream changes into your fork:

<https://github.com/hlxsites/aem-boilerplate-commerce/issues?q=label%3Achangelog+is%3Aclosed>
