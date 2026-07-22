import type { ManifestContribution } from '@saasicat/types';

/**
 * What this example contributes to the SuperAdmin UI.
 *
 * The platform core contribution declares every standard page but grants no
 * capabilities — each app states which ones it actually backs with endpoints.
 * Without this file the sidebar stays empty, because the NavBuilder filters
 * out every page whose `requiredCapability` is not `true`.
 *
 * notesapp runs the quickstart (lightweight) platform surface: plans come from
 * `config/saas.yaml`, and there are no subscription/promo/bundle tables. So the
 * pages backed by those are switched off here rather than left to fail on
 * their first request.
 */
export const NOTESAPP_MANIFEST_CONTRIBUTION: ManifestContribution = {
    capabilities: {
        'dashboard.read': true,
    },

    navigation: {
        standardPages: {
            // Serves the raw discovery snapshot but not the DB-backed
            // catalog-entries endpoints the page needs — off until the catalog
            // repositories are wired.
            discovery: { enabled: false },
            // Needs the V3 subscription tables (prisma fragments 01/03).
            tenants: { enabled: false },
            subscriptions: { enabled: false },
            users: { enabled: false },
            pilots: { enabled: false },
            audit: { enabled: false },
            promoCodes: { enabled: false },
            // Needs the DB-driven catalog; this example reads plans from YAML.
            plans: { enabled: false },
            planVersions: { enabled: false },
            bundles: { enabled: false },
            businessTypes: { enabled: false },
            marketingCatalog: { enabled: false },
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
