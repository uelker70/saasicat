import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { BillingCycle, TenantSubscriptionWritePort } from '@saasicat/types';

import { EntitlementService } from '../entitlement/index.js';
import { initialPeriodWindow } from './billing-period.js';
import {
    PENDING_PLAN_QUERY_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
    type PendingPlanQueryPort,
} from './tenant-billing.tokens.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';

// PendingPlanMaterializationService (#19) — materializes scheduled plan changes
// at the effective date. A scheduled change (downgrade/cycle) only sets
// `pendingPlan` + `pendingEffectiveAt`; otherwise the effective plan is only
// resolved LAZILY in the entitlement resolver (`resolveEntitlementPlan`) — there
// is no materialization point at which follow-up actions (contract freeze, audit,
// invoicing) could trigger.
//
// This run applies due pending changes via `TenantSubscriptionWritePort.
// changePlanImmediate` — that clears the pending fields AND triggers the
// adapter-/hook-side follow-up actions (freeze etc.). TRIAL is excluded:
// there the trial entitlement plan applies during the trial, and the transition
// is driven by the trial lifecycle.
//
// The service is opt-in: it is only registered if the consumer provides a
// `pendingPlanQueryPort`. The cron trigger (timing) is supplied by the
// consumer — it calls `materializeDuePlanChanges()`.

@Injectable()
export class PendingPlanMaterializationService {
    private readonly logger = new Logger(PendingPlanMaterializationService.name);

    constructor(
        @Inject(PENDING_PLAN_QUERY_PORT_TOKEN)
        private readonly query: PendingPlanQueryPort,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly subscriptionWrite: TenantSubscriptionWritePort,
        private readonly entitlements: EntitlementService,
        // #18: optional contract freeze after materialization. Without a hook
        // the entitlement resolution stays version-/catalog-pinned.
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
    ) {}

    async materializeDuePlanChanges(now: Date = new Date()): Promise<{ applied: number }> {
        const due = await this.query.findDuePendingPlanChanges(now);

        let applied = 0;
        for (const change of due) {
            const cycle = (change.pendingBillingCycle ?? 'MONTHLY') as BillingCycle;
            const period = initialPeriodWindow(now, cycle);
            try {
                await this.subscriptionWrite.changePlanImmediate(change.tenantId, {
                    planId: change.pendingPlan,
                    cycle,
                    periodStart: period.start,
                    periodEnd: period.end,
                    // Status stays (ACTIVE/PAST_DUE etc.) — only the plan is materialized.
                    nextStatus: null,
                });
                this.entitlements.invalidateTenant(change.tenantId);
                applied += 1;
            } catch (err) {
                // Non-fatal per tenant — one failure must not abort the run.
                this.logger.error(
                    `Pending-Plan-Materialisierung fehlgeschlagen (tenant ${change.tenantId}): ${String(err)}`,
                );
                continue;
            }
            // #18: freeze contract (non-fatal — the plan change is persisted).
            await this.tryFreeze(change.tenantId, change.pendingPlan, cycle, now);
        }

        if (applied > 0) {
            this.logger.log(
                `Pending-Plan-Materialisierung: ${applied} geplante(r) Plan-Wechsel angewandt.`,
            );
        }
        return { applied };
    }

    private async tryFreeze(
        tenantId: string,
        plan: string,
        cycle: BillingCycle,
        now: Date,
    ): Promise<void> {
        if (!this.contractFreeze) return;
        try {
            await this.contractFreeze.freezeOnPlanChange(tenantId, plan, cycle, now);
        } catch (err) {
            this.logger.error(
                `Contract-Freeze nach Materialisierung fehlgeschlagen (tenant ${tenantId}): ${String(err)}`,
            );
        }
    }
}
