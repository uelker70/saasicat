// A trial that ran out unbought ends when the application says so, through
// SaaSiCat (`SC-CANC-027`).
//
// SaaSiCat does not end a trial by itself: whether a trial that reaches its end
// converts — a payment method entered, a plan chosen — or ends is the
// application's rule. Once the application has decided that one ends, it calls
// `endRanOut`, which lands the trial's cancellation at the moment the trial
// ran out, as a cancellation the tenant declared in its trial would have
// landed, and records the end at once: the tenant is read-only from then and
// its deletion day is fixed, without waiting for the quarter-hourly run.
//
// Only a trial whose end has passed: this is no way to cut a running trial
// short, nor to end a subscription that is no trial.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    type AuditActor,
    type RlsBypassPort,
    type SubscriptionEnd,
    type SubscriptionUsagePort,
    type SubscriptionUsageRecord,
    type TenantSubscriptionWritePort,
} from '@saasicat/core';

import { AdminAuditService, platformJobActor } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { actorTagOf } from '../core/web-audit.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import type { EntitlementService } from '../entitlement/entitlement.service.js';
import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { codedError } from '../errors/coded-error.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import { endContractAfter } from './freeze-contract-after.js';
import { SubscriptionEndService } from './subscription-end.service.js';
import {
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
} from './tenant-billing.tokens.js';

/** Who ends a trial where the application names nobody, as the audit log tags a job. */
const TRIAL_END_JOB = platformJobActor('trials-ended');

@Injectable()
export class TrialEndService {
    private readonly logger = new Logger(TrialEndService.name);

    constructor(
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly writes: TenantSubscriptionWritePort,
        @Inject(SubscriptionEndService) private readonly ends: SubscriptionEndService,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(ENTITLEMENT_SERVICE_TOKEN)
        private readonly entitlements: EntitlementService | null = null,
        // Where contracts are frozen; a trial that converted in between has one
        // to end, and a consumer without contracts has nothing to end.
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

    /**
     * Ends the trial of `tenantId`, which ran out unbought, and answers its end
     * with the deletion day. Lands the cancellation at the trial's end where none
     * was declared, and takes the one declared where it has landed — called
     * again, it answers the end recorded the first time.
     *
     * Refuses with `NO_SUBSCRIPTION` a tenant without a subscription, and with
     * `TRIAL_NOT_RUN_OUT` one that is no trial, or a trial whose end has not
     * passed. `by` is who ended it, for the audit log; a job of the platform's
     * where the application names nobody.
     */
    async endRanOut(
        tenantId: string,
        by: AuditActor = TRIAL_END_JOB,
        now: Date = new Date(),
    ): Promise<SubscriptionEnd> {
        // A job of the application's, asking for one tenant without a request
        // of that tenant's: an installation with row-level security answers it
        // only inside the frame.
        return readAcrossTenants(this.rlsBypass, async () => {
            const sub = await this.subscriptions.findForTenant(tenantId);
            if (!sub) {
                throw new NotFoundException(
                    codedError(BILLING_ERROR_CODES.NO_SUBSCRIPTION, { tenantId }),
                );
            }
            if (!sub.id) {
                throw new Error(
                    `The SubscriptionUsagePort answered the subscription of tenant ${tenantId} ` +
                        'without its id, which its end is recorded under. Both shipped adapters ' +
                        'pass it; a port of your own adds it.',
                );
            }
            const endsAt = await this.landed(tenantId, sub, by, now);
            return this.ends.recordEndOf(
                { tenantId, subscriptionId: sub.id, endsAt },
                now,
                actorTagOf(by),
            );
        });
    }

    /** When the trial's cancellation lands, written now where none was declared. */
    private async landed(
        tenantId: string,
        sub: SubscriptionUsageRecord,
        by: AuditActor,
        now: Date,
    ): Promise<Date> {
        const declared = cancellationLandsAt(sub);
        if (declared !== null) {
            // A tenant that cancelled in its trial: it lands at the trial's end.
            if (declared > now) throw notRunOut();
            return declared;
        }
        const trialEndsAt = sub.status === 'TRIAL' ? sub.trialEndsAt : null;
        if (!trialEndsAt || trialEndsAt > now) throw notRunOut();
        const result = await this.writes.cancelSubscription(tenantId, {
            canceledAt: now,
            effectiveAt: trialEndsAt,
            terminateNow: true,
        });
        // Another caller declared it between the read and the write: the store
        // kept that one, and it is the one that ends the trial.
        const endsAt = result.canceledEffectiveAt ?? result.canceledAt ?? trialEndsAt;
        if (result.alreadyCanceled) return endsAt;
        this.entitlements?.invalidateTenant(tenantId);
        await endContractAfter(this.contractFreeze, tenantId, endsAt, 'a trial ended', this.logger);
        await this.audit?.log({
            actor: by,
            entity: 'Subscription',
            entityId: tenantId,
            action: 'CANCEL_SUBSCRIPTION',
            changes: {
                reason: 'trial-ran-out',
                canceledAt: now.toISOString(),
                effectiveAt: endsAt.toISOString(),
                status: result.status,
            },
        });
        return endsAt;
    }
}

function notRunOut(): ConflictException {
    return new ConflictException(codedError(BILLING_ERROR_CODES.TRIAL_NOT_RUN_OUT));
}
