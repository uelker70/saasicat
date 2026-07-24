import type { ManifestContribution } from '@saasicat/types';

/**
 * What this example contributes to the SuperAdmin UI.
 *
 * The platform core contribution declares every standard page but grants no
 * capabilities — each app states which ones it actually backs with endpoints.
 * Without this file the sidebar stays empty, because the NavBuilder filters
 * out every page whose `requiredCapability` is not `true`.
 *
 * The catalog surface (discovery review, plans, bundles and the
 * marketing catalog) is DB-backed via NotesCatalogModule, so those pages are
 * switched on by granting their capabilities and letting the platform-core
 * `enabled: true` stand. The app-domain pages (tenants, users, audit,
 * subscriptions, promo codes) are backed by NotesPlatformPagesModule and are
 * switched on the same way. Only `pilots` and `platformEmail*` stay off —
 * they need infrastructure (pilot workflow, SMTP sender) this example lacks.
 */
export const NOTESAPP_MANIFEST_CONTRIBUTION: ManifestContribution = {
    capabilities: {
        'dashboard.read': true,
        // Discovery review page (DB-backed catalog entries from NotesCatalogModule).
        'discovery.read': true,
        // Plans lifecycle page/actions.
        'plans.read': true,
        'plans.publish': true,
        // Bundles page + editor actions.
        'bundles.read': true,
        'bundles.write': true,
        'bundles.publish': true,
        // Marketing catalog page (locale pivot) + projection editor.
        'marketingProjections.read': true,
        'marketingProjections.write': true,
        // Tenants page + the platform-core suspend/reactivate row actions
        // (declared in PLATFORM_CORE_MANIFEST_CONTRIBUTION.tenants.actions —
        // granting the capabilities is enough, no need to re-declare them).
        'tenants.read': true,
        'tenants.suspend': true,
        'tenants.reactivate': true,
        // Users, audit and subscriptions pages (app-owned read endpoints).
        'users.read': true,
        'audit.read': true,
        'subscriptions.read': true,
        // Promo-codes page + create/edit/delete flows.
        'promoCodes.read': true,
        'promoCodes.write': true,
        'promoCodes.delete': true,
    },

    navigation: {
        standardPages: {
            // discovery, plans, bundles,
            // marketingCatalog, tenants, users and audit inherit the
            // platform-core `enabled: true` + requiredCapability; the
            // capabilities above wire them into the nav.

            // subscriptions and promoCodes are NOT part of the platform-core
            // spine (apps hold their own view of these), so declare them here.
            subscriptions: { enabled: true, requiredCapability: 'subscriptions.read' },
            promoCodes: { enabled: true, requiredCapability: 'promoCodes.read' },

            // Need infrastructure this example lacks (pilot workflow, SMTP
            // sender) — off until a later milestone.
            pilots: { enabled: false },
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
