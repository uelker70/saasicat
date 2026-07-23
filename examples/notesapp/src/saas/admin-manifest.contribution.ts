import type { ManifestContribution } from '@saasicat/types';

/**
 * What this example contributes to the SuperAdmin UI.
 *
 * The platform core contribution declares every standard page but grants no
 * capabilities — each app states which ones it actually backs with endpoints.
 * Without this file the sidebar stays empty, because the NavBuilder filters
 * out every page whose `requiredCapability` is not `true`.
 *
 * The catalog surface (discovery review, plans, bundles, business types and the
 * marketing catalog) is DB-backed via NotesCatalogModule, so those pages are
 * switched on by granting their capabilities and letting the platform-core
 * `enabled: true` stand. The tenant/subscription/user/audit/promo/email pages
 * still need app-owned controllers, so they stay off rather than failing on
 * their first request.
 */
export const NOTESAPP_MANIFEST_CONTRIBUTION: ManifestContribution = {
    capabilities: {
        'dashboard.read': true,
        // Discovery review page (DB-backed catalog entries from NotesCatalogModule).
        'discovery.read': true,
        // Plans + plan-versions pages/actions.
        'plans.read': true,
        'plans.publish': true,
        // Bundles page + editor actions.
        'bundles.read': true,
        'bundles.write': true,
        'bundles.publish': true,
        // Business types page + editor.
        'businessTypes.read': true,
        'businessTypes.write': true,
        // Marketing catalog page (locale pivot) + projection editor.
        'marketingProjections.read': true,
        'marketingProjections.write': true,
    },

    navigation: {
        standardPages: {
            // discovery, plans, planVersions, bundles, businessTypes and
            // marketingCatalog inherit the platform-core `enabled: true` +
            // requiredCapability; the capabilities above wire them into the nav.

            // Still need app-owned controllers (V3 subscription tables, promo
            // codes, platform email) — off until a later milestone.
            tenants: { enabled: false },
            subscriptions: { enabled: false },
            users: { enabled: false },
            pilots: { enabled: false },
            audit: { enabled: false },
            promoCodes: { enabled: false },
            platformEmail: { enabled: false },
            platformEmailHistory: { enabled: false },
        },
    },

    dashboard: {
        kpiCards: [
            {
                id: 'notesapp.tenants',
                label: 'Mandanten',
                endpoint: '/api/v1/admin/stats/tenants',
                displayHint: { type: 'value', icon: 'business' },
                slotPriority: 90,
                requiredCapability: 'dashboard.read',
            },
            {
                id: 'notesapp.notes',
                label: 'Notizen',
                endpoint: '/api/v1/admin/stats/notes',
                displayHint: { type: 'value', icon: 'sticky_note_2' },
                slotPriority: 80,
                requiredCapability: 'dashboard.read',
            },
            {
                id: 'notesapp.users',
                label: 'Nutzer',
                endpoint: '/api/v1/admin/stats/users',
                displayHint: { type: 'value', icon: 'people' },
                slotPriority: 70,
                requiredCapability: 'dashboard.read',
            },
        ],
    },
};
