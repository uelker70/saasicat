import type { SaaSiCatModuleOptions } from './saasicat.module.js';

/**
 * Typed identity helper for the high-level SaaSiCat configuration. It keeps
 * literal types and gives editors one place for completion without adding
 * runtime behavior.
 */
export function defineSaaSiCat<const T extends SaaSiCatModuleOptions>(options: T): T {
    return options;
}
