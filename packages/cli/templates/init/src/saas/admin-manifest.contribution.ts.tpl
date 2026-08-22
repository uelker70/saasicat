import type { ManifestContribution } from '@saasicat/core';

/**
 * What this app adds to the SuperAdmin UI.
 *
 * The platform derives capabilities for every standard module it mounts —
 * discovery, catalogue, tenants, users, audit, subscriptions, promo codes.
 * What it cannot derive is anything of yours, so this file is where an
 * app-specific dashboard card or project page is declared.
 *
 * Without a registered contribution the sidebar is empty: the nav builder
 * drops every page whose `requiredCapability` is not `true`.
 */
export const __MANIFEST_CONST__: ManifestContribution = {
    capabilities: {
        'dashboard.read': true,
    },

    dashboard: {
        kpiCards: [
            {
                id: '__PROJECT_KEY__.tenants',
                label: 'Tenants',
                // Served by your own controller — the platform does not know
                // what your KPIs count.
                endpoint: '__API_BASE__/stats/tenants',
                displayHint: { type: 'value', icon: 'business' },
                slotPriority: 90,
                requiredCapability: 'dashboard.read',
            },
        ],
    },
};
