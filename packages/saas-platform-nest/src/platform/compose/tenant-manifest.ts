// The tenant-facing manifest: the same shape the SuperAdmin gets, filtered to
// what this tenant's plan actually includes.
//
// A controller rather than a module, which is why it is not among the feature
// composers: it is mounted into the platform module's own scope, next to the
// entitlement service it asks.

import type { Provider, Type } from '@nestjs/common';

import { buildTenantManifestController } from '../tenant-manifest.controller.js';
import { TenantManifestService } from '../tenant-manifest.service.js';

import { optionsOf, type CompositionContext } from './context.js';

export interface TenantManifestParts {
    readonly providers: Provider[];
    readonly exports: Array<Type<unknown>>;
    readonly controllers: Array<Type<unknown>>;
}

const NONE: TenantManifestParts = { providers: [], exports: [], controllers: [] };

/**
 * The tenant manifest endpoint, when the app asked for it.
 *
 * That something can resolve a plan is `tenant-manifest.requires-plan-resolution`,
 * checked with the rest of the configuration before any composition runs — so
 * this does not re-derive it.
 *
 * `tenantManifest: true` reuses the tenant-billing guards when they are a plain
 * array: the endpoint answers for the authenticated tenant, so it wants the
 * same chain the rest of the tenant surface uses rather than the admin one.
 */
export function composeTenantManifest(ctx: CompositionContext): TenantManifestParts {
    const { options } = ctx;
    if (!options.tenantManifest) return NONE;

    const tenantAuthGuards = optionsOf(options.tenantBilling).authGuards;
    return {
        providers: [TenantManifestService],
        exports: [TenantManifestService],
        controllers: [
            buildTenantManifestController(
                options.tenantManifest === true
                    ? {
                          guards: Array.isArray(tenantAuthGuards)
                              ? tenantAuthGuards
                              : options.controller.guards,
                      }
                    : options.tenantManifest,
            ),
        ],
    };
}
