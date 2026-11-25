// A tenant whose subscription ended comes back before its deletion day
// (`SC-CANC-034`): its administrator takes out a new subscription on the same
// row, at the catalogue's current terms — the version on sale, which its
// preview showed, from the moment of the return, without a trial, an add-on
// or a code — and the new subscription lifts the end, its deletion day and the
// read-only state that end put the tenant in. Another reason that holds the
// tenant stays: an invoice still unpaid keeps it read-only until it is paid.
//
// Whether the tenant can come back is decided by `subscriptionReturnRefusal`,
// asked twice: before anything is written, and again in the transaction that
// writes the return, once it locked the reason the end put the tenant in. A
// deletion begins on the strength of the same reason and locks it first too,
// so of a return and a deletion that begins beside it exactly one acts: a
// return that waited finds the tenant being deleted and is refused, and a
// deletion that waited finds the reason lifted and begins nothing.
//
// The subscription, its contract and the lift of the end and its reason are
// one transaction: where any of them fails, none of them is written. What can
// refuse the plan is asked first, as a plan change to it is refused — a
// rhythm it is not sold in, usage today it would not hold
// (`PlanChangePreviewService.blockersOfStartingAgain`); what can refuse the
// contract — the subscriber, the tax — while it is composed. Both before the
// transaction.
//
// The catalogue's terms are all a return runs on: the subscription's special
// terms — a pilot, limits and a price of the operator's own — end with it,
// and the audit names those that did. The operator grants them again where he
// wants to.
//
// A booking of the subscription that ended belonged to it, and ends at its
// end: a return books none, and a booking left running would come back with
// the new subscription, granted and charged without being chosen.

import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    type HttpException,
    type OnModuleInit,
} from '@nestjs/common';
import {
    BILLING_ERROR_CODES,
    TENANT_ACCESS_ERROR_CODES,
    type SubscriptionSpecialTerm,
    installationZoneOf,
    openEndedHoldOf,
    subscriptionReturnRefusal,
    withDays,
    type AdminActor,
    type BillingCycle,
    type CalendarDay,
    type CreateSubscriptionContractData,
    type PlanCatalogSettings,
    type PlanRepository,
    type SelfServiceBlockedPlans,
    type SubscriptionBundleRecord,
    type SubscriptionBundleRepository,
    type SubscriptionContractPriceSnapshot,
    type SubscriptionEnd,
    type SubscriptionEndPort,
    type SubscriptionReturnRefusal,
    type SubscriptionUsagePort,
    type TenantAccessHold,
    type TenantAccessHoldPort,
    type TenantSubscriptionWritePort,
    type TransactionContext,
    type TransactionRunner,
    type WithDays,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { PLAN_REPOSITORY_TOKEN } from '../catalog/catalog.tokens.js';
import { actorTagOf } from '../core/web-audit.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { cancellationLandsAt } from '../entitlement/landed-cancellation.js';
import { codedError } from '../errors/coded-error.js';
import { PaymentGatewayRegistry } from '../payments/payment-gateway-registry.js';
import { SubscriberPaymentMethodService } from '../payments/subscriber-payment-method.service.js';
import { agreementNamed } from '../subscription-contract/contract-agreement.js';
import {
    SubscriptionContractService,
    contractChanged,
} from '../subscription-contract/subscription-contract.service.js';
import { heldBackRefusal } from '../tenant-access/held-back-refusal.js';
import {
    TenantAccessService,
    type SubscriptionReturnSource,
} from '../tenant-access/tenant-access.service.js';
import { TENANT_ACCESS_HOLDS_TOKEN } from '../tenant-access/tenant-access.tokens.js';
import { initialPeriodWindow } from './billing-period.js';
import { recordChargesAfter } from './charges/record-charges-after.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import {
    PlanChangePreviewService,
    type PlanChangePreviewIssue,
} from './plan-change-preview.service.js';
import { PLAN_CATALOG_SETTINGS_TOKEN, PLAN_CATALOG_SOURCE_TOKEN } from './plan-catalog.module.js';
import type { PlanCatalogSource } from './plan-catalog-source.js';
import { findPlan } from './plan-helpers.js';
import { SELF_SERVICE_BLOCKED_PLANS_TOKEN } from './self-service-policy.js';
import { SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN } from './subscription-bundles.tokens.js';
import { deletionDayDiffersFromShown } from './subscription-end.service.js';
import { subscriptionNotFound } from './subscription-not-found.js';
import {
    SUBSCRIPTION_END_PORT_TOKEN,
    SUBSCRIPTION_RETURN_TRANSACTION_RUNNER_TOKEN,
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import { versionOnSale } from './version-on-sale.js';
import { assertNamesTheVersionShown } from './version-shown.js';

/** What the audit log names a return under. */
const AUDITED_ACTION = 'SUBSCRIPTION_RETURNED';

/** The plan and the rhythm a tenant comes back on, and the version and deletion day its page showed. */
export interface SubscriptionReturnChoice {
    readonly plan: string;
    readonly billingCycle: BillingCycle;
    /**
     * The version the preview showed, its `planVersionId`: the return binds it
     * only while it is still the one on sale (`PLAN_CHANGE_QUOTE_CHANGED`), and
     * has to be told it wherever it binds one (`PLAN_CHANGE_VERSION_NOT_NAMED`).
     */
    readonly planVersionId?: string | null;
    /**
     * The deletion day the page showed, where it sent one: the tenant is taken
     * back only from the end that names it (`TENANT_RETURN_DELETION_DAY_CHANGED`).
     */
    readonly expectedDeletesOn?: CalendarDay;
}

/** The subscription a tenant comes back on. */
export interface SubscriptionReturned {
    readonly plan: string;
    readonly billingCycle: BillingCycle;
    /** The version on sale it is bound to; null where the write binds no version. */
    readonly planVersionId: string | null;
    /** Its first period, from the moment of the return, which the journal charges first. */
    readonly periodStart: Date;
    readonly periodEnd: Date;
}

/** What a tenant that can come back is shown before it does. */
export interface SubscriptionReturnTerms extends SubscriptionReturned {
    readonly refusal: null;
    /** The deletion day the return lifts. */
    readonly deletesOn: CalendarDay;
    /**
     * What stands in the way of the plan chosen, as a plan change to it would
     * be told (`PLAN_CHANGE_BLOCKED`); the return is refused until it is empty.
     */
    readonly blockers: readonly PlanChangePreviewIssue[];
    /**
     * One period of the new contract, as it records it; null where the
     * installation keeps no contracts, and where a blocker stands in the way.
     */
    readonly price: SubscriptionContractPriceSnapshot | null;
    /** The days of notice a cancellation of the new subscription is owed. */
    readonly cancellationNoticeDays: number;
    /** Whether a payment method has to be entered first (`TENANT_RETURN_PAYMENT_METHOD_REQUIRED`). */
    readonly paymentMethodRequired: boolean;
}

/** Why a tenant cannot come back, and the deletion day of the end that stands, where one does. */
export interface SubscriptionReturnRefused {
    readonly refusal: SubscriptionReturnRefusal;
    readonly deletesOn: CalendarDay | null;
}

export type SubscriptionReturnPreview = SubscriptionReturnTerms | SubscriptionReturnRefused;

/** The moments a return answers with, each handed out with its days in the installation's zone. */
export const SUBSCRIPTION_RETURN_MOMENTS = ['periodStart', 'periodEnd'] as const;

type SubscriptionReturnMoment = (typeof SUBSCRIPTION_RETURN_MOMENTS)[number];

/** The subscription a tenant came back on, with the days of its first period. */
export type SubscriptionReturnedWithDays = WithDays<SubscriptionReturned, SubscriptionReturnMoment>;

/** What a tenant is shown before it comes back, with the days of the first period; or why it cannot. */
export type SubscriptionReturnPreviewWithDays =
    WithDays<SubscriptionReturnTerms, SubscriptionReturnMoment> | SubscriptionReturnRefused;

/** `preview` as the tenant is handed it, the days of its first period in `timeZone`. */
export function previewWithDays(
    preview: SubscriptionReturnPreview,
    timeZone: string,
): SubscriptionReturnPreviewWithDays {
    return preview.refusal === null
        ? withDays(preview, SUBSCRIPTION_RETURN_MOMENTS, timeZone)
        : preview;
}

/** The tenant's open reasons, the one its end put it in, and that end. */
interface Standing {
    readonly holds: readonly TenantAccessHold[];
    readonly ended: TenantAccessHold | null;
    readonly end: SubscriptionEnd | null;
}

/** An end a tenant can come back from, and the reason it put the tenant in. */
interface Returnable {
    readonly ended: TenantAccessHold;
    readonly end: SubscriptionEnd;
}

/** How each refusal is answered: as wherever the tenant asks while held back, or with a code of the return's. */
const REFUSED: Readonly<
    Record<
        SubscriptionReturnRefusal,
        (open: readonly TenantAccessHold[], end: SubscriptionEnd | null) => HttpException
    >
> = {
    'deletion-begun': (open) => heldBackRefusal('deleting', open),
    suspended: (open) => heldBackRefusal('suspended', open),
    'not-ended': () =>
        new ConflictException(codedError(TENANT_ACCESS_ERROR_CODES.TENANT_RETURN_NOT_ENDED)),
    'deletion-day-reached': (_open, end) =>
        new ConflictException(
            codedError(TENANT_ACCESS_ERROR_CODES.TENANT_RETURN_DELETION_DAY_REACHED, {
                deletesOn: end?.deletesOn ?? null,
            }),
        ),
};

@Injectable()
export class SubscriptionReturnService implements SubscriptionReturnSource, OnModuleInit {
    private readonly logger = new Logger(SubscriptionReturnService.name);

    constructor(
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptions: SubscriptionUsagePort,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly writes: TenantSubscriptionWritePort,
        @Inject(SUBSCRIPTION_END_PORT_TOKEN) private readonly ends: SubscriptionEndPort,
        @Inject(SUBSCRIPTION_RETURN_TRANSACTION_RUNNER_TOKEN)
        private readonly transactions: TransactionRunner,
        @Inject(PLAN_CATALOG_SOURCE_TOKEN) private readonly catalogs: PlanCatalogSource,
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings: Pick<
            PlanCatalogSettings,
            'timeZone' | 'tenantBilling' | 'terms'
        >,
        @Inject(ENTITLEMENT_SERVICE_TOKEN)
        private readonly entitlements: { invalidateTenant(tenantId: string): void },
        @Inject(PlanChangePreviewService)
        private readonly planChanges: Pick<PlanChangePreviewService, 'blockersOfStartingAgain'>,
        // Absent only where tenant billing is wired by hand without
        // `SaaSiCatModule`: nothing records the reason an end puts a tenant
        // in then, so no tenant has an end to come back from.
        @Optional()
        @Inject(TENANT_ACCESS_HOLDS_TOKEN)
        private readonly holds: TenantAccessHoldPort | null = null,
        // Reads the version on sale, which the return binds. Without it — a
        // catalogue given as a file — only a write that binds no version can
        // start a subscription again.
        @Optional()
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository | null = null,
        @Optional()
        @Inject(SELF_SERVICE_BLOCKED_PLANS_TOKEN)
        private readonly blockedPlans: SelfServiceBlockedPlans | null = null,
        // Both present where the installation keeps contracts: the return's
        // contract is composed by the one and written by the other, in the
        // return's transaction.
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        @Optional()
        @Inject(SubscriptionContractService)
        private readonly contracts: SubscriptionContractService | null = null,
        // Without the bundle module nothing is booked, so nothing ends with
        // the subscription.
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly bookings: SubscriptionBundleRepository | null = null,
        // Present where the installation takes payments: a tenant that comes
        // back where a gateway takes payment methods has one in use first.
        @Optional()
        @Inject(SubscriberPaymentMethodService)
        private readonly paymentMethods: Pick<
            SubscriberPaymentMethodService,
            'current'
        > | null = null,
        @Optional()
        @Inject(PaymentGatewayRegistry)
        private readonly gateways: Pick<
            PaymentGatewayRegistry,
            'forNewPaymentMethods'
        > | null = null,
        @Optional()
        @Inject(SubscriberChargeService)
        private readonly charges: SubscriberChargeService | null = null,
        // Without the administration's audit log — a minimal deploy — a
        // return is not audited.
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
        // Absent where tenant access is wired by hand without one in scope:
        // a read-only tenant is then let through to come back by nothing.
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
    ) {}

    onModuleInit(): void {
        this.access?.answerReturnsFrom(this);
    }

    async mayComeBack(tenantId: string, now: Date): Promise<boolean> {
        return !('refusal' in this.decide(await this.standingOf(tenantId), now));
    }

    async assertMayComeBack(tenantId: string, now: Date): Promise<void> {
        const standing = await this.standingOf(tenantId);
        const returnable = this.decide(standing, now);
        if ('refusal' in returnable) throw refused(returnable.refusal, standing);
    }

    /**
     * What `tenantId` would come back on at `now` with `choice`, and what it
     * would pay, written nowhere; or why it cannot come back. What stands in
     * the way of the plan chosen is listed as a plan change's preview lists
     * it; a plan it cannot choose, and a contract that could not be written,
     * are refused as the return refuses them.
     */
    async preview(
        tenantId: string,
        choice: SubscriptionReturnChoice,
        now: Date,
    ): Promise<SubscriptionReturnPreview> {
        const standing = await this.standingOf(tenantId);
        const returnable = this.decide(standing, now);
        if ('refusal' in returnable) {
            return { refusal: returnable.refusal, deletesOn: standing.end?.deletesOn ?? null };
        }
        const returned = await this.subscriptionChosen(choice, now);
        const blockers = await this.blockersOf(tenantId, returned, now);
        const contract = blockers.length > 0 ? null : await this.contractOf(tenantId, returned);
        return {
            refusal: null,
            deletesOn: returnable.end.deletesOn,
            ...returned,
            blockers,
            price: contract?.priceSnapshot ?? null,
            cancellationNoticeDays: agreementNamed(this.settings, choice.billingCycle, now)
                .cancellationNoticeDays,
            paymentMethodRequired: await this.paymentMethodMissing(tenantId),
        };
    }

    /**
     * Takes out a new subscription for `tenantId` at `now` with `choice`, as
     * `actor`, its administrator: started again on the version on sale, its
     * contract written, and the end and the reason it put the tenant in
     * lifted, in one transaction. Refused, with nothing written, where the
     * tenant cannot come back (`subscriptionReturnRefusal`), where its page
     * showed another deletion day than its end names, where something
     * stands in the way of the plan as a plan change to it would be refused
     * (`PLAN_CHANGE_BLOCKED`), where `choice` does not name the version on
     * sale its preview showed, as a plan change is refused
     * (`assertNamesTheVersionShown`), where a gateway takes payment methods
     * and the subscriber has none in use, where a contract of the tenant
     * runs already, and where the plan or its contract is refused.
     */
    async takeOut(
        tenantId: string,
        choice: SubscriptionReturnChoice,
        actor: AdminActor,
        now: Date,
    ): Promise<SubscriptionReturned> {
        const standing = await this.standingOf(tenantId);
        const returnable = this.decide(standing, now);
        if ('refusal' in returnable) throw refused(returnable.refusal, standing);
        if (deletionDayDiffersFromShown(choice.expectedDeletesOn, returnable.end)) {
            throw new ConflictException(
                codedError(TENANT_ACCESS_ERROR_CODES.TENANT_RETURN_DELETION_DAY_CHANGED, {
                    deletesOn: returnable.end.deletesOn,
                }),
            );
        }
        const holds = this.holds;
        if (!holds) throw refused('not-ended', standing);
        const subscription = await this.subscriptions.findForTenant(tenantId);
        if (!subscription) throw subscriptionNotFound(tenantId);
        const endsAt = cancellationLandsAt(subscription);
        if (endsAt === null) throw refused('not-ended', standing);
        const returned = await this.subscriptionChosen(choice, now);
        const blockers = await this.blockersOf(tenantId, returned, now);
        if (blockers.length > 0) {
            throw new BadRequestException({
                code: BILLING_ERROR_CODES.PLAN_CHANGE_BLOCKED,
                message: 'Plan change is blocked.',
                blockers,
            });
        }
        await assertNamesTheVersionShown(
            { planKey: choice.plan, planVersionId: choice.planVersionId },
            returned.planVersionId,
            async () =>
                previewWithDays(
                    await this.preview(tenantId, choice, now),
                    installationZoneOf(this.settings),
                ),
        );
        if (await this.paymentMethodMissing(tenantId)) {
            throw new ConflictException(
                codedError(TENANT_ACCESS_ERROR_CODES.TENANT_RETURN_PAYMENT_METHOD_REQUIRED),
            );
        }
        const contract = await this.contractOf(tenantId, returned);
        if (await this.contracts?.runningFrom(tenantId, now)) throw contractChanged(tenantId);
        await this.endBookingsAt(returnable.end.subscriptionId, endsAt);
        const endedSpecialTerms = await this.transactions.run(async (tx) => {
            const locked = await this.lockedStanding(holds, tenantId, returnable, now, tx);
            if (locked.refusal) throw refused(locked.refusal, locked);
            const started = await this.writes.startAgain(
                tenantId,
                {
                    planId: returned.plan,
                    cycle: returned.billingCycle,
                    periodStart: returned.periodStart,
                    periodEnd: returned.periodEnd,
                    expectedCanceledEffectiveAt: endsAt,
                    planVersionId: returned.planVersionId,
                },
                tx,
            );
            if (!started.claimed) {
                throw new ConflictException(codedError(BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED));
            }
            if (contract && this.contracts) await this.contracts.create(contract, tx);
            await this.liftEnd(holds, returnable, now, actorTagOf(actor), tx);
            return started.endedSpecialTerms;
        });
        this.entitlements.invalidateTenant(tenantId);
        await recordChargesAfter(this.charges, tenantId, 'a return', this.logger);
        await this.audited(actor, tenantId, returned, returnable.end, endedSpecialTerms);
        return returned;
    }

    /**
     * Takes `tenantId` back in the caller's transaction `tx`, as of `at`, for
     * `by` as the audit log tags an actor: the end of its subscription and the
     * reason it put the tenant in are lifted, nothing else is written — for a
     * path that concludes the new subscription itself. Answers false where no
     * end stands to lift, and refuses as a return is refused where the tenant
     * cannot come back.
     */
    async takeBackWithin(
        tenantId: string,
        at: Date,
        by: string,
        tx: TransactionContext,
    ): Promise<boolean> {
        const holds = this.holds;
        if (!holds) return false;
        const standing = await this.standingOf(tenantId);
        const returnable = this.decide(standing, at);
        if ('refusal' in returnable) {
            if (returnable.refusal === 'not-ended') return false;
            throw refused(returnable.refusal, standing);
        }
        const locked = await this.lockedStanding(holds, tenantId, returnable, at, tx);
        if (locked.refusal === 'not-ended') return false;
        if (locked.refusal) throw refused(locked.refusal, locked);
        await this.liftEnd(holds, returnable, at, by, tx);
        return true;
    }

    /** The tenant's open reasons, the one its end put it in, and that end as it stands. */
    private async standingOf(tenantId: string): Promise<Standing> {
        const holds = this.holds ? await this.holds.listOpen(tenantId) : [];
        const ended = openEndedHoldOf(holds);
        const [end] = ended?.reference ? await this.ends.listFor([ended.reference]) : [];
        return { holds, ended, end: end ?? null };
    }

    /** The end the tenant can come back from at `now`, or why it cannot. */
    private decide(
        standing: Standing,
        now: Date,
    ): Returnable | { readonly refusal: SubscriptionReturnRefusal } {
        const refusal = subscriptionReturnRefusal({
            holds: standing.holds,
            end: standing.end,
            now,
            timeZone: installationZoneOf(this.settings),
        });
        if (refusal) return { refusal };
        if (!standing.ended || !standing.end) return { refusal: 'not-ended' };
        return { ended: standing.ended, end: standing.end };
    }

    /**
     * Locks the reason `returnable`'s end put the tenant in, for the rest of
     * `tx`, and decides again from every reason as it stands once locked: a
     * deletion that began first has written its own by then. `not-ended` where
     * the reason was lifted first.
     */
    private async lockedStanding(
        holds: TenantAccessHoldPort,
        tenantId: string,
        { ended, end }: Returnable,
        now: Date,
        tx: TransactionContext,
    ): Promise<Standing & { readonly refusal: SubscriptionReturnRefusal | null }> {
        if (!(await holds.lockOpen(ended.id, tx))) {
            return { holds: [], ended: null, end, refusal: 'not-ended' };
        }
        const locked = await holds.lockAllOf(tenantId, tx);
        const refusal = subscriptionReturnRefusal({
            holds: locked,
            end,
            now,
            timeZone: installationZoneOf(this.settings),
        });
        return { holds: locked, ended, end, refusal };
    }

    /** Lifts the end and the reason it put the tenant in, as of `at`, by `by`, in `tx`. */
    private async liftEnd(
        holds: TenantAccessHoldPort,
        { ended, end }: Returnable,
        at: Date,
        by: string,
        tx: TransactionContext,
    ): Promise<void> {
        await holds.lift(ended.id, at, by, tx);
        if (!(await this.ends.lift(end.subscriptionId, at, tx))) {
            throw refused('not-ended', { holds: [], ended, end });
        }
    }

    /**
     * The subscription `choice` takes out at `now`: on the version of its plan
     * on sale, for one period from then. Refused for a plan sold only by a
     * contract of its own, and one the catalogue does not sell.
     */
    private async subscriptionChosen(
        { plan, billingCycle }: SubscriptionReturnChoice,
        now: Date,
    ): Promise<SubscriptionReturned> {
        if (this.blockedPlans?.asTarget?.includes(plan)) {
            throw new ForbiddenException(
                codedError(BILLING_ERROR_CODES.PLAN_NOT_SELF_SERVICE, {
                    planName: plan,
                    planKey: plan,
                }),
            );
        }
        if (!findPlan(await this.catalogs.current(), plan)) throw planNotInCatalog(plan);
        const period = initialPeriodWindow(now, billingCycle);
        return {
            plan,
            billingCycle,
            planVersionId: await this.versionToBind(plan, now),
            periodStart: period.start,
            periodEnd: period.end,
        };
    }

    /** The id of the version of `plan` on sale at `now`; null where the write binds none. */
    private async versionToBind(plan: string, now: Date): Promise<string | null> {
        if (this.writes.bindsPlanVersion === false) return null;
        const onSale = this.plans ? await versionOnSale(this.plans, plan, now) : null;
        if (!onSale) throw planNotInCatalog(plan);
        return onSale.id;
    }

    /** What stands in the way of `returned`'s plan, as a plan change to it would be told. */
    private blockersOf(
        tenantId: string,
        returned: SubscriptionReturned,
        now: Date,
    ): Promise<PlanChangePreviewIssue[]> {
        return this.planChanges.blockersOfStartingAgain(
            tenantId,
            returned.plan,
            returned.billingCycle,
            now,
        );
    }

    /**
     * The contract `returned` is concluded under from its first period on,
     * composed for the subscription started again and checked, not written;
     * null where the installation keeps no contracts.
     */
    private async contractOf(
        tenantId: string,
        returned: SubscriptionReturned,
    ): Promise<CreateSubscriptionContractData | null> {
        if (!this.contractFreeze || !this.contracts) return null;
        const composed = await this.contractFreeze.composeFor(
            tenantId,
            { plan: returned.plan, planVersionId: returned.planVersionId, startsAgain: true },
            { effectiveFrom: returned.periodStart, cycle: returned.billingCycle, endsAt: null },
        );
        if (!composed) {
            throw new Error(
                `The contract of tenant ${tenantId}'s return could not be composed: version ` +
                    `${String(returned.planVersionId)} cannot be read as one of plan ` +
                    `'${returned.plan}'. The contract freeze reads versions through the ` +
                    'PlanRepository, which SaaSiCatModule provides.',
            );
        }
        return composed;
    }

    /** Whether a gateway takes payment methods and the tenant's subscriber has none in use. */
    private async paymentMethodMissing(tenantId: string): Promise<boolean> {
        if (!this.paymentMethods || !this.gateways?.forNewPaymentMethods()) return false;
        return (await this.paymentMethods.current(tenantId)) === null;
    }

    /**
     * Ends at `endsAt` every booking of `subscriptionId` that runs past it.
     * Written before the return's transaction, and without effect where the
     * return then fails: nothing is granted or charged of a subscription past
     * its end, so a booking ending there changes nothing until the
     * subscription starts again — which is what it is ended for.
     */
    private async endBookingsAt(subscriptionId: string, endsAt: Date): Promise<void> {
        const bookings = this.bookings;
        if (!bookings) return;
        for (const booking of await bookings.listBySubscription(subscriptionId)) {
            const landsAt = cancellationLandsAt(booking);
            if (landsAt !== null && landsAt <= endsAt) continue;
            await endBookingAt(bookings, booking, landsAt, endsAt);
        }
    }

    /** Audits a return that stands; a failure to audit is logged, not answered. */
    private async audited(
        actor: AdminActor,
        tenantId: string,
        returned: SubscriptionReturned,
        end: SubscriptionEnd,
        endedSpecialTerms: readonly SubscriptionSpecialTerm[],
    ): Promise<void> {
        if (!this.audit) return;
        try {
            await this.audit.log({
                actor,
                entity: 'Subscription',
                entityId: tenantId,
                tenantId,
                action: AUDITED_ACTION,
                changes: {
                    plan: returned.plan,
                    billingCycle: returned.billingCycle,
                    planVersionId: returned.planVersionId,
                    endedAt: end.endsAt.toISOString(),
                    deletesOn: end.deletesOn,
                    endedSpecialTerms: [...endedSpecialTerms],
                },
            });
        } catch (error) {
            this.logger.error(
                `Tenant ${tenantId} came back, and the audit entry of its return could not be ` +
                    `written: ${String(error)}`,
            );
        }
    }
}

/** What a tenant that cannot come back for `refusal` is answered, `standing` naming its reasons and end. */
function refused(refusal: SubscriptionReturnRefusal, standing: Standing): HttpException {
    const open = standing.holds.filter((hold) => hold.liftedAt === null);
    return REFUSED[refusal](open, standing.end);
}

function planNotInCatalog(plan: string): NotFoundException {
    return new NotFoundException(
        codedError(BILLING_ERROR_CODES.PLAN_NOT_IN_CATALOG, { planKey: plan }),
    );
}

/**
 * Ends `booking`, whose cancellation lands at `landsAt` — none, or one after
 * `endsAt` — at `endsAt`.
 */
async function endBookingAt(
    bookings: SubscriptionBundleRepository,
    booking: SubscriptionBundleRecord,
    landsAt: Date | null,
    endsAt: Date,
): Promise<void> {
    if (landsAt === null) {
        await bookings.cancel(booking.id, { canceledAt: endsAt, canceledEffectiveAt: endsAt });
        return;
    }
    if (!bookings.endNow) {
        throw new Error(
            `Booking ${booking.id} is cancelled for ${landsAt.toISOString()}, after its ` +
                `subscription ended at ${endsAt.toISOString()}, and the SubscriptionBundleRepository ` +
                'has no `endNow` to end it there before the subscription starts again. Both ' +
                'shipped adapters have it.',
        );
    }
    const ended = await bookings.endNow(booking.id, {
        at: endsAt,
        expectedCanceledEffectiveAt: landsAt,
    });
    if (!ended) throw new ConflictException(codedError(BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED));
}
