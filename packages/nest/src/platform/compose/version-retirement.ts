import type { DynamicModule } from '@nestjs/common';
import type { TransactionRunner, VersionRetirementRepository } from '@saasicat/core';

import { VersionRetirementAdminModule } from '../../billing/version-retirement-admin.module.js';
import type { VersionRetirementsOptions } from '../../billing/tenant-billing.module.js';
import type { ProviderSpec } from '../../core/di.js';

import { operatorGuards, optionsOf, type CompositionContext } from './context.js';

/**
 * Where retirement announcements are kept and written: the application's own
 * choice, otherwise the persistence bundle's table on the platform's runner.
 * Undefined where version notices are off or the bundle has nowhere to keep
 * them — retiring versions is then off.
 */
export function versionRetirementsOf(
    ctx: Pick<CompositionContext, 'options' | 'persistence' | 'adapters'>,
): VersionRetirementsOptions | undefined {
    const versionNotices = optionsOf(ctx.options.tenantBilling).versionNotices;
    if (!versionNotices) return undefined;
    if (versionNotices.retirements) return versionNotices.retirements;
    const repository = ctx.persistence?.tenantBilling?.versionRetirements;
    const transactionRunner = ctx.adapters.transactionRunner;
    if (!repository || !transactionRunner) return undefined;
    return {
        repository: repository as ProviderSpec<VersionRetirementRepository>,
        transactionRunner: transactionRunner as ProviderSpec<TransactionRunner>,
    };
}

/**
 * Whether the operator is offered retiring a version: the catalogue serves its
 * operator routes and tenant billing keeps announcements. The routes and the
 * capability that announces them both ask this, so neither exists without the
 * other.
 */
export function servesVersionRetirements(
    ctx: Pick<CompositionContext, 'options' | 'persistence' | 'adapters'>,
): boolean {
    const catalog = ctx.options.catalog;
    return Boolean(
        catalog && catalog.adminControllers !== false && versionRetirementsOf(ctx) !== undefined,
    );
}

/**
 * The operator's retirement routes, beside the plan versions.
 *
 * Runs after `composeTenantBilling` and imports the module it built rather
 * than building its own: the announcements and the notices are its.
 */
export function composeVersionRetirement(ctx: CompositionContext): DynamicModule[] {
    const { tenantBillingModule } = ctx.shared;
    if (!servesVersionRetirements(ctx) || !tenantBillingModule) return [];
    return [
        VersionRetirementAdminModule.forRoot({
            guards: operatorGuards(ctx.options),
            imports: [tenantBillingModule],
        }),
    ];
}
