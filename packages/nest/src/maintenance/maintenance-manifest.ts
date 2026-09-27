// What the maintenance module tells the administration about itself.
//
// Registered by the module rather than by `SaaSiCatModule`, so that an
// application wiring `MaintenanceModule` by hand gets the screen as well: the
// capability is what makes the administration offer the page and watch for a
// lock, and only an installation that keeps windows can grant it.

import { MAINTENANCE_CAPABILITY, type ManifestContribution } from '@saasicat/core';

export const MAINTENANCE_MANIFEST_CONTRIBUTION: ManifestContribution = {
    capabilities: { [MAINTENANCE_CAPABILITY]: true },
    audit: {
        actions: [
            {
                key: 'MAINTENANCE_WINDOW_ANNOUNCE',
                label: 'Maintenance window announced',
                severity: 'medium',
            },
            {
                key: 'MAINTENANCE_WINDOW_RESCHEDULE',
                label: 'Maintenance window moved',
                severity: 'low',
            },
            {
                key: 'MAINTENANCE_WINDOW_CANCEL',
                label: 'Maintenance window cancelled',
                severity: 'medium',
            },
            {
                key: 'MAINTENANCE_LOCK',
                label: 'Tenants locked out for maintenance',
                severity: 'high',
            },
            { key: 'MAINTENANCE_UNLOCK', label: 'Tenants let back in', severity: 'high' },
        ],
    },
};
