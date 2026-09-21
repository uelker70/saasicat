// Static, app-specific manifest parts that do not come via DI contributions.
// Injected into the AdminManifestService at boot.
//
// The plan catalogue is not one of them. The service reads it from
// `PLAN_CATALOG_SOURCE_TOKEN` on every request, so a plan or a feature
// published while the application runs reaches the administration without a
// restart.

import type { AdminManifest } from '@saasicat/core';

export const ADMIN_MANIFEST_CONFIG = Symbol.for('saasicat/nest/AdminManifestConfig');

export interface AdminManifestConfig {
    project: AdminManifest['project'];
    build: Omit<AdminManifest['build'], 'manifestHash'>;
}
