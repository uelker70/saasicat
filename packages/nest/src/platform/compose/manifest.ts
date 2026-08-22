// The admin manifest the platform contributes about itself.
//
// Split out of the module because it is the largest thing in it that is not
// composition: 120 lines deriving which standard pages exist from which
// options are on, plus the minimal config an app gets when it declares none.
//
// It belongs to the manifest rather than to the assembler — the assembler only
// needs to know that there is one.

import type { FactoryProvider } from '@nestjs/common';
import type { ManifestContribution, PlanCatalog } from '@saasicat/types';

import type { AdminManifestConfig } from '../../admin/admin-manifest.config.js';
import { PLAN_CATALOG_TOKEN } from '../../billing/plan-catalog.module.js';
import type {
    SaaSiCatAdminResourcesOptions,
    SaaSiCatCatalogOptions,
    SaaSiCatPromoCodesOptions,
} from '../module-options.js';

/**
 * The subscription repository the platform's own plan resolver injects.
 *
 * `Symbol.for`, like every token that can be reached from more than one entry
 * point: the package is bundled into twelve of them, and a plain `Symbol()`
 * would be a different symbol per copy.
 */
export const PLATFORM_SUBSCRIPTION_REPOSITORY_TOKEN = Symbol.for(
    'saas-platform-nest/PlatformSubscriptionRepository',
);
/** Marks the provider that registers the platform's own contribution. */
export const STANDARD_MANIFEST_REGISTRATION_TOKEN = Symbol.for(
    'saas-platform-nest/StandardManifestRegistration',
);

export function buildStandardManifestContribution(
    catalog: SaaSiCatCatalogOptions | null,
    adminResources: SaaSiCatAdminResourcesOptions | true | null,
    promoCodes: SaaSiCatPromoCodesOptions | true | null,
): ManifestContribution {
    const capabilities: NonNullable<ManifestContribution['capabilities']> = {
        'discovery.read': true,
    };

    if (catalog && catalog.adminControllers !== false) {
        Object.assign(capabilities, {
            'plans.read': true,
            'plans.publish': true,
            'bundles.read': true,
            'bundles.write': true,
            'bundles.publish': true,
            'marketingProjections.read': true,
            'marketingProjections.write': true,
        });
    }

    const navigation: ManifestContribution['navigation'] = {};
    if (adminResources) {
        Object.assign(capabilities, {
            'tenants.read': true,
            'tenants.suspend': true,
            'tenants.reactivate': true,
            'users.read': true,
            'audit.read': true,
            'subscriptions.read': true,
        });
        navigation.standardPages = {
            subscriptions: {
                enabled: true,
                requiredCapability: 'subscriptions.read',
            },
        };
    }
    if (promoCodes) {
        Object.assign(capabilities, {
            'promoCodes.read': true,
            'promoCodes.write': true,
            'promoCodes.delete': true,
        });
        navigation.standardPages = {
            ...(navigation.standardPages ?? {}),
            promoCodes: {
                enabled: true,
                requiredCapability: 'promoCodes.read',
            },
        };
    }

    return {
        capabilities,
        navigation: navigation.standardPages ? navigation : undefined,
    };
}

/** The state provider `EnforcementChainCheck` reads at bootstrap. */

export function buildMinimalManifestConfig(): Pick<FactoryProvider, 'useFactory' | 'inject'> {
    return {
        useFactory: (catalog: PlanCatalog): AdminManifestConfig => ({
            project: {
                key: catalog.projectKey,
                displayName: catalog.app?.name ?? catalog.projectKey,
                label: catalog.app?.label,
                icon: catalog.app?.icon,
                logoUrl: catalog.app?.logoUrl,
                environment: (process.env.NODE_ENV === 'production'
                    ? 'production'
                    : 'development') as 'production' | 'development',
                availableLocales: catalog.marketing?.availableLocales,
                defaultLocale: catalog.marketing?.availableLocales?.[0],
            },
            build: {
                platformPackageVersion: '0.0.0',
                appVersion: '0.0.0',
            },
            planCatalogSnapshot: {
                source: 'saasicat-module',
                hash: 'sha256-quickstart',
                currency: catalog.currency,
                vatRate: catalog.vatRate,
                plans: catalog.plans ?? [],
                features: catalog.features ?? [],
            },
        }),
        inject: [PLAN_CATALOG_TOKEN],
    };
}
