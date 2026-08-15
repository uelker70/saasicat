// The resource layer: every admin endpoint defined once, framework-free.
//
// Partial by design. The roster this is growing towards covers the whole admin
// surface, and the descriptors land family by family as the composables that
// own those endpoints are rebuilt on them — a descriptor nothing calls has
// nothing keeping it honest.
//
// What is here so far: the plan catalogue. What is not: bundles, catalog
// entries, discovery, marketing, promos, tenants, users, audit, pilots, email,
// subscriptions, dashboard.

export * from './define-resource.js';
export * from './resource-request.js';
export * from './plans.resource.js';

import { planVersionsResource, plansResource } from './plans.resource.js';

/**
 * Every resource the shell offers by default.
 *
 * The registry binds these; an app overrides by key. Partial while the roster
 * grows — a page whose resource is not here yet keeps its props.
 */
export const platformResources = {
    plans: plansResource,
    planVersions: planVersionsResource,
};

export type PlatformResources = typeof platformResources;
