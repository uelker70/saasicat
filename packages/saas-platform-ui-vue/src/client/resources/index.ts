// The resource layer: every admin endpoint defined once, framework-free.
//
// Partial by design. The roster this is growing towards covers the whole admin
// surface, and the descriptors land family by family as the composables that
// own those endpoints are rebuilt on them — a descriptor nothing calls has
// nothing keeping it honest.
//
// What is here so far: the plan catalogue, the tenant list and the audit
// trail. What is not: bundles, catalog entries, discovery, marketing, promos,
// users, pilots, email, subscriptions, dashboard.
//
// `tenants` and `audit` are called by `useResourceList`, not by `useTenants`
// and `useAuditEntries` — those keep their own implementation and their own
// signatures. The two sides are held to the same request by
// `tests/resources-match-the-composables.test.js`, which drives both and
// compares what reaches the client, in either direction.

export * from './define-resource.js';
export * from './resource-request.js';
export * from './list-resource.js';
export * from './plans.resource.js';
export * from './tenants.resource.js';
export * from './audit.resource.js';

import { auditResource } from './audit.resource.js';
import { planVersionsResource, plansResource } from './plans.resource.js';
import { tenantsResource } from './tenants.resource.js';

/**
 * Every resource the shell offers by default.
 *
 * The registry binds these; an app overrides by key. Partial while the roster
 * grows — a page whose resource is not here yet keeps its props.
 */
export const platformResources = {
    plans: plansResource,
    planVersions: planVersionsResource,
    tenants: tenantsResource,
    audit: auditResource,
};

export type PlatformResources = typeof platformResources;
