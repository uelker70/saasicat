// Static, app-specific manifest parts that do not come via DI contributions.
// Injected into the AdminManifestService at boot.

import type { AdminManifest } from '@saasicat/core';

export const ADMIN_MANIFEST_CONFIG = Symbol.for('saasicat/nest/AdminManifestConfig');

export interface AdminManifestConfig {
    project: AdminManifest['project'];
    build: Omit<AdminManifest['build'], 'manifestHash'>;
    planCatalogSnapshot: AdminManifest['planCatalogSnapshot'];
}
