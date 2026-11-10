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
import { cancellationLandsAt, type CancellationDates } from '../entitlement/landed-cancellation.js';
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
        const declared = landedBy(sub, now);
        if (declared !== undefined) return declared;
        const trialEndsAt = sub.status === 'TRIAL' ? sub.trialEndsAt : null;
        if (!trialEndsAt || trialEndsAt > now) throw notRunOut();
        const endTrial = this.writes.endTrial?.bind(this.writes);
        if (!endTrial) {
            throw new Error(
                'The TenantSubscriptionWritePort has no `endTrial`: the platform cannot end a ' +
                    'trial without risking one that converted meanwhile. Both shipped adapters ' +
                    'have it; a port of your own adds it (SC-CANC-027).',
            );
        }
        // One conditional write: the trial read above, still that trial. A
        // trial that converted or was cancelled between the read and here is
        // left as it is, and what is stored now decides.
        const result = await endTrial(tenantId, { at: now, trialEndsAt });
        if (!result.ended) {
            const stored = landedBy(result, now);
            if (stored === undefined) throw notRunOut();
            return stored;
        }
        this.entitlements?.invalidateTenant(tenantId);
        await endContractAfter(
            this.contractFreeze,
            tenantId,
            trialEndsAt,
            'a trial ended',
            this.logger,
        );
        await this.audit?.log({
            actor: by,
            entity: 'Subscription',
            entityId: tenantId,
            action: 'CANCEL_SUBSCRIPTION',
            changes: {
                reason: 'trial-ran-out',
                canceledAt: now.toISOString(),
                effectiveAt: trialEndsAt.toISOString(),
                status: result.status,
            },
        });
        return trialEndsAt;
    }
}

/**
 * When a declared cancellation of `dates` landed, where one was declared;
 * `undefined` where none was, and a refusal where it lands after `now` — a
 * cancellation with time still to run is not an end yet.
 */
function landedBy(dates: CancellationDates, now: Date): Date | undefined {
    const landsAt = cancellationLandsAt(dates);
    if (landsAt === null) return undefined;
    if (landsAt > now) throw notRunOut();
    return landsAt;
}

function notRunOut(): ConflictException {
    return new ConflictException(codedError(BILLING_ERROR_CODES.TRIAL_NOT_RUN_OUT));
}
