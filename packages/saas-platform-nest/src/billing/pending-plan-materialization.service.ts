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

// PendingPlanMaterializationService (#19) — materialisiert geplante Plan-Wechsel
// zum Wirksamkeits-Stichtag. Ein geplanter Wechsel (Downgrade/Cycle) setzt nur
// `pendingPlan` + `pendingEffectiveAt`; der effektive Plan wird sonst nur LAZY
// im Entitlement-Resolver (`resolveEntitlementPlan`) aufgelöst — es gibt keinen
// Materialisierungs-Zeitpunkt, an dem Folgeaktionen (Vertrags-Freeze, Audit,
// Invoicing) auslösen könnten.
//
// Dieser Lauf wendet fällige Pending-Wechsel über den `TenantSubscriptionWritePort.
// changePlanImmediate` an — das räumt die Pending-Felder UND triggert die
// adapter-/hook-seitigen Folgeaktionen (Freeze etc.). TRIAL ist ausgenommen:
// dort gilt während des Trials der Trial-Entitlement-Plan, und der Übergang
// wird vom Trial-Lifecycle gesteuert.
//
// Der Service ist Opt-in: er wird nur registriert, wenn der Konsument einen
// `pendingPlanQueryPort` liefert. Den Cron-Trigger (Timing) stellt der
// Konsument bereit — er ruft `materializeDuePlanChanges()`.

@Injectable()
export class PendingPlanMaterializationService {
    private readonly logger = new Logger(PendingPlanMaterializationService.name);

    constructor(
        @Inject(PENDING_PLAN_QUERY_PORT_TOKEN)
        private readonly query: PendingPlanQueryPort,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly subscriptionWrite: TenantSubscriptionWritePort,
        private readonly entitlements: EntitlementService,
        // #18: optionaler Contract-Freeze nach der Materialisierung. Ohne Hook
        // bleibt die Entitlement-Auflösung versions-/katalog-gepinnt.
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
                    // Status bleibt (ACTIVE/PAST_DUE etc.) — nur der Plan wird materialisiert.
                    nextStatus: null,
                });
                this.entitlements.invalidateTenant(change.tenantId);
                applied += 1;
            } catch (err) {
                // Non-fatal pro Tenant — ein Fehler darf den Lauf nicht abbrechen.
                this.logger.error(
                    `Pending-Plan-Materialisierung fehlgeschlagen (tenant ${change.tenantId}): ${String(err)}`,
                );
                continue;
            }
            // #18: Vertrag einfrieren (non-fatal — der Plan-Wechsel ist persistiert).
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
