# Footer

## Overview

Loads the shared footer fragment and, for multistore configurations, a store
selector modal.

## Configuration and integration

The `footer` page metadata supplies the fragment path; the default is `/footer`.
The fragment loader prefixes the configured store root and requests `.plain.html`.
There are no block options, URL parameters, or storage keys.

Multistore sites also load `/store-switcher` and use the configured root to select
the current store. The button opens a modal; keyboard and click handlers expand
store groups.

## Loading and errors

Cart startup may call `preloadFooterContent()` while the primary cart renders.
This preloads the same fragment URL with matching fetch credentials so normal
rendering reuses the response. It does not insert or hide footer content.
Other pages retain normal lazy loading.

Preload failures are logged by cart startup and do not bypass normal rendering.
Fragment and decoration failures remain subject to the standard block loader;
missing store-selector content is logged by the footer.
