// Statische, App-spezifische Manifest-Bestandteile, die nicht via DI-Contributions
// kommen. Wird beim Boot in den AdminManifestService injiziert.

import type { AdminManifest } from '@saasicat/types';

export const ADMIN_MANIFEST_CONFIG = Symbol('ADMIN_MANIFEST_CONFIG');

export interface AdminManifestConfig {
    project: AdminManifest['project'];
    build: Omit<AdminManifest['build'], 'manifestHash'>;
    planCatalogSnapshot: AdminManifest['planCatalogSnapshot'];
}
