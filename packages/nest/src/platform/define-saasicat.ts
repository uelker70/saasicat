import type { SaasPlatformModuleOptions } from './saas-platform.module.js';

/**
 * Typed identity helper for the high-level SaaSiCat configuration. It keeps
 * literal types and gives editors one place for completion without adding
 * runtime behavior.
 */
export function defineSaaSiCat<const T extends SaasPlatformModuleOptions>(options: T): T {
    return options;
}
