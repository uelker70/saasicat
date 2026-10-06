import type { DynamicModule } from '@nestjs/common';
import type { FeatureWithdrawalRepository, TransactionRunner } from '@saasicat/core';

import { FeatureWithdrawalAdminModule } from '../../billing/feature-withdrawal-admin.module.js';
import type { FeatureWithdrawalsOptions } from '../../billing/tenant-billing.module.js';
import type { ProviderSpec } from '../../core/di.js';

import { operatorGuards, optionsOf, type CompositionContext } from './context.js';

/**
 * Where feature withdrawals are kept and written: the application's own
 * choice, otherwise the persistence bundle's table on the platform's runner.
 * Undefined where subscriber notices are off — a withdrawal tells everybody it
 * reaches at once, so there is nothing to withdraw with — or where the bundle
 * has nowhere to keep one.
 *
 * Whether the operator is offered the action is decided once the ports exist:
 * it needs every subscription the withdrawal reaches to be found
 * (`FeatureWithdrawalService.available`).
 */
export function featureWithdrawalsOf(
    ctx: Pick<CompositionContext, 'options' | 'persistence' | 'adapters'>,
): FeatureWithdrawalsOptions | undefined {
    const versionNotices = optionsOf(ctx.options.tenantBilling).versionNotices;
    if (!versionNotices) return undefined;
    if (versionNotices.featureWithdrawals) return versionNotices.featureWithdrawals;
    const repository = ctx.persistence?.tenantBilling?.featureWithdrawals;
    const transactionRunner = ctx.adapters.transactionRunner;
    if (!repository || !transactionRunner) return undefined;
    return {
        repository: repository as ProviderSpec<FeatureWithdrawalRepository>,
        transactionRunner: transactionRunner as ProviderSpec<TransactionRunner>,
    };
}

/**
 * The operator's withdrawal routes.
 *
 * Runs after `composeTenantBilling` and imports the module it built rather
 * than building its own: the withdrawals and the notices are its.
 */
export function composeFeatureWithdrawal(ctx: CompositionContext): DynamicModule[] {
    const { tenantBillingModule } = ctx.shared;
    if (!featureWithdrawalsOf(ctx) || !tenantBillingModule) return [];
    return [
        FeatureWithdrawalAdminModule.forRoot({
            guards: operatorGuards(ctx.options),
            imports: [tenantBillingModule],
        }),
    ];
}
