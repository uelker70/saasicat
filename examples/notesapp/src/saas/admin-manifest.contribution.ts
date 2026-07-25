import type { ManifestContribution } from '@saasicat/types';

/**
 * What this example contributes to the SuperAdmin UI.
 *
 * SaaSiCatModule derives the capabilities for every mounted standard module:
 * discovery, catalog, tenant/user/audit/subscription resources and promo
 * codes. This contribution contains only NotesApp-specific dashboard cards.
 */
export const NOTESAPP_MANIFEST_CONTRIBUTION: ManifestContribution = {
    capabilities: {
        'dashboard.read': true,
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
