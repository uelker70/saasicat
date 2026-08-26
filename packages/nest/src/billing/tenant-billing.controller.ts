import {
    BadRequestException,
    Body,
    Controller,
    ForbiddenException,
    Get,
    HttpCode,
    HttpStatus,
    Inject,
    Logger,
    ConflictException,
    NotFoundException,
    Optional,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import type {
    BillingCycle,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
    TenantSubscriptionWritePort,
    UsageSnapshotPort,
} from '@saasicat/core';
import { AUTH_ERROR_CODES, BILLING_ERROR_CODES } from '@saasicat/core';
import { toEffectiveLimitsSnapshot } from '../entitlement/aggregation.js';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { TenantAdminGuard } from './tenant-admin.guard.js';
import { initialPeriodWindow } from './billing-period.js';
import { PlanChangePreviewService } from './plan-change-preview.service.js';
import {
    SUBSCRIPTION_USAGE_PORT_TOKEN,
    SUBSCRIPTION_WRITE_PORT_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    TRIAL_PROJECTION_PORT_TOKEN,
    USAGE_SNAPSHOT_PORT_TOKEN,
    USER_ID_RESOLVER_TOKEN,
    type TenantIdResolver,
    type TrialProjectionPort,
    type UserIdResolver,
    CANCELLATION_NOTICE_DAYS_TOKEN,
} from './tenant-billing.tokens.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import {
    SELF_SERVICE_BLOCKED_PLANS_TOKEN,
    type SelfServiceBlockedPlans,
} from './self-service-policy.js';
import { ChangePlanDto, PreviewPlanChangeDto } from './dto/tenant-billing.dto.js';
import { CompleteOnboardingSubscriptionDto } from './dto/onboarding-subscription.dto.js';
import { PromoCodesService } from '../promo/promo.service.js';
import { SubscriptionBundlesService } from './subscription-bundles.service.js';
import type { AdminActor, OnboardingSelectionResponse } from '@saasicat/core';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { decideCancellationFor, type CancellationDecision } from './cancellation.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import { CancelSubscriptionDto } from './dto/tenant-billing.dto.js';
import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    type AuditContextResolver,
    type UserEmailResolver,
} from './tenant-billing.tokens.js';

// TenantBillingController — tenant self-service endpoints for plan
// management. Phase B: reads only (`/entitlement` + `/usage`). Phase C
// adds plan preview/apply and subscription cancel.
//
// Auth stack:
//   - `ComposedTenantAuthGuard` (always): consumer-specific list of
//     auth guards (e.g. JwtAuthGuard + TenantGuard).
//   - `TenantAdminGuard` (mutations only): additionally requires the TENANT_ADMIN/SUPER_ADMIN role.
// Reads remain open to all authenticated tenant users.

interface RequestLike {
    user?: { tenantId?: string; sub?: string; id?: string };
}

interface UsageResponse {
    plan: string;
    effectivePlan: string;
    billingCycle: string;
    status: string;
    isPilot: boolean;
    pilotEndsAt: Date | null;
    trialEndsAt: Date | null;
    startedAt: Date | null;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    pendingPlan: string | null;
    pendingBillingCycle: string | null;
    pendingEffectiveAt: Date | null;
    planVersion: SubscriptionUsageRecord['planVersion'];
    pendingPlanVersion: SubscriptionUsageRecord['pendingPlanVersion'];
    pendingPlanVersionEffectiveAt: Date | null;
    pendingPlanVersionAccepted: boolean;
    pendingPlanVersionAcceptedAt: Date | null;
    /** When a cancellation was declared. Null while none was. */
    canceledAt: Date | null;
    /** When it lands. A tenant keeps everything until then. */
    canceledEffectiveAt: Date | null;
    /**
     * What cancelling right now would do — the date, and why it is that date.
     *
     * A projection, not a state: it is recomputed on every read, and it says
     * nothing about whether a cancellation exists. `canceledEffectiveAt` above
     * is the one that does.
     */
    cancellation: CancellationDecision;
    limits: ReturnType<typeof toEffectiveLimitsSnapshot>;
    usage: Record<string, number>;
    /**
     * P11.4: Frozen package snapshot from the
     * `CheckoutOffer` that was activated during onboarding. Read-only
     * for the tenant self-service UI. `null` for subscriptions without
     * a CheckoutOffer origin.
     */
    packageSnapshot: unknown | null;
    /** P11.4: Optional reference to the originating CheckoutOffer. */
    checkoutOfferId: string | null;
}

@Controller('billing')
@UseGuards(ComposedTenantAuthGuard)
export class TenantBillingController {
    constructor(
        // The tsup build has no emitDecoratorMetadata — class-type args must
        // be annotated explicitly with @Inject(Class), otherwise DI breaks.
        @Inject(ENTITLEMENT_SERVICE_TOKEN) private readonly entitlements: EntitlementService,
        @Inject(PlanChangePreviewService)
        private readonly planPreview: PlanChangePreviewService,
        @Inject(SUBSCRIPTION_USAGE_PORT_TOKEN)
        private readonly subscriptionUsage: SubscriptionUsagePort,
        @Inject(USAGE_SNAPSHOT_PORT_TOKEN)
        private readonly usageSnapshot: UsageSnapshotPort,
        @Inject(SUBSCRIPTION_WRITE_PORT_TOKEN)
        private readonly subscriptionWrite: TenantSubscriptionWritePort,
        @Optional()
        @Inject(TENANT_ID_RESOLVER_TOKEN)
        private readonly tenantIdResolver: TenantIdResolver | null = null,
        @Optional()
        @Inject(USER_ID_RESOLVER_TOKEN)
        private readonly userIdResolver: UserIdResolver | null = null,
        @Optional()
        @Inject(SELF_SERVICE_BLOCKED_PLANS_TOKEN)
        private readonly blockedPlans: SelfServiceBlockedPlans | null = null,
        // Optional: if the consumer has loaded PromoCodesModule.forRoot(...),
        // the onboarding endpoint supports atomically redeeming a promo code
        // right after the plan change. Without this service instance a
        // supplied `promoCode` is ignored and reported as a warning in the
        // response (no hard error — the tenant can redeem the code later via a
        // separate endpoint).
        @Optional()
        @Inject(PromoCodesService)
        private readonly promoCodes: PromoCodesService | null = null,
        // P10.1.2: audit log for every subscription write. If the consumer has
        // loaded `PlatformAdminModule.forRoot(...)` (the typical setup), the
        // service is injected automatically. Without AdminModule the audit-log
        // path is silently skipped — no hard error for setups that don't yet
        // have an audit adapter.
        @Optional()
        @Inject(AdminAuditService)
        private readonly auditService: AdminAuditService | null = null,
        @Optional()
        @Inject(USER_EMAIL_RESOLVER_TOKEN)
        private readonly userEmailResolver: UserEmailResolver | null = null,
        @Optional()
        @Inject(AUDIT_CONTEXT_RESOLVER_TOKEN)
        private readonly auditContextResolver: AuditContextResolver | null = null,
        // P11.7.3 — bundle booking in the onboarding flow. Optional, because the
        // SubscriptionBundleModule is registered additively by the consumer.
        @Optional()
        @Inject(SubscriptionBundlesService)
        private readonly subscriptionBundles: SubscriptionBundlesService | null = null,
        // #18: optional contract freeze after the plan change (non-TRIAL).
        // Without the hook, entitlement resolution stays version-/catalog-pinned.
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        // #17: optional trial carry-over. The same port also supplies the
        // wizard projection (PlanChangePreviewService). Without the port the
        // trial end stays unchanged across the change.
        @Optional()
        @Inject(TRIAL_PROJECTION_PORT_TOKEN)
        private readonly trialProjection: TrialProjectionPort | null = null,
        // Zero unless an installation asked for a notice period. See the token.
        //
        // LAST, and that is not stylistic: this list is also a positional
        // signature, and inserting a parameter in the middle of it shifts every
        // argument after it. Doing that here moved `promoCodes` into this slot
        // and broke eleven tests in ways that read as unrelated logic errors,
        // because nothing type-checks a boolean landing where a service was.
        @Optional()
        @Inject(CANCELLATION_NOTICE_DAYS_TOKEN)
        private readonly cancellationNoticeDays: number = 0,
    ) {}

    private readonly logger = new Logger(TenantBillingController.name);

    // ---------------------------------------------------------------------
    // Reads (Phase B) — all authenticated tenant users
    // ---------------------------------------------------------------------

    @Get('entitlement')
    async getEntitlement(@Req() req: RequestLike) {
        const tenantId = this.requireTenantId(req);
        const limits = await this.entitlements.computeLimits(tenantId);
        return toEffectiveLimitsSnapshot(limits);
    }

    @Get('usage')
    async getUsage(@Req() req: RequestLike): Promise<UsageResponse> {
        const tenantId = this.requireTenantId(req);

        const [sub, limits, usageRaw] = await Promise.all([
            this.subscriptionUsage.findForTenant(tenantId),
            this.entitlements.computeLimits(tenantId),
            this.usageSnapshot.snapshot(tenantId),
        ]);

        if (!sub) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
                message: `No subscription for tenant ${tenantId}`,
                params: { tenantId },
            });
        }

        const usage: Record<string, number> = {};
        for (const key of new Set([...Object.keys(limits.quotas), ...Object.keys(usageRaw)])) {
            usage[key] = usageRaw[key] ?? 0;
        }

        return {
            plan: sub.plan,
            effectivePlan: limits.plan,
            billingCycle: sub.billingCycle,
            status: sub.status,
            isPilot: sub.isPilot,
            pilotEndsAt: sub.pilotEndsAt,
            trialEndsAt: sub.trialEndsAt,
            startedAt: sub.startedAt,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            pendingPlan: sub.pendingPlan,
            pendingBillingCycle: sub.pendingBillingCycle,
            pendingEffectiveAt: sub.pendingEffectiveAt,
            planVersion: sub.planVersion,
            pendingPlanVersion: sub.pendingPlanVersion,
            pendingPlanVersionEffectiveAt: sub.pendingPlanVersionEffectiveAt,
            pendingPlanVersionAccepted: sub.pendingPlanVersionAccepted,
            pendingPlanVersionAcceptedAt: sub.pendingPlanVersionAcceptedAt,
            canceledAt: sub.canceledAt ?? null,
            // The same fallback the renewal and the cancel route apply, for the
            // same reason: on a row written before the two fields separated,
            // `canceledAt` IS the effective date and the second column is
            // genuinely null. Reading it strictly here told the page the
            // subscription was never cancelled — so it hid the end date and
            // went on offering to cancel something that already had been.
            canceledEffectiveAt: sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
            // What a cancellation declared right now would do.
            //
            // Here rather than behind a second route, because the page has to
            // state the date BEFORE the customer confirms, and the rule that
            // produces it lives on this side: the minimum term and the notice
            // period are not visible to a browser. With a window configured,
            // four days of delay cost a whole period — a sentence that has to
            // be read in the confirmation, not discovered in the receipt.
            cancellation: this.projectCancellation(sub, new Date()),
            limits: toEffectiveLimitsSnapshot(limits),
            usage,
            packageSnapshot: sub.packageSnapshot ?? null,
            checkoutOfferId: sub.checkoutOfferId ?? null,
        };
    }

    // ---------------------------------------------------------------------
    // Plan preview (Phase C, read-only) — TENANT_ADMIN
    // ---------------------------------------------------------------------

    @Post('plan/preview')
    @HttpCode(HttpStatus.OK)
    @UseGuards(TenantAdminGuard)
    async previewPlanChange(@Req() req: RequestLike, @Body() dto: PreviewPlanChangeDto) {
        const tenantId = this.requireTenantId(req);
        return this.planPreview.preview(tenantId, dto.plan, dto.billingCycle);
    }

    // ---------------------------------------------------------------------
    // Plan change — TENANT_ADMIN (cost-relevant)
    // ---------------------------------------------------------------------

    @Post('plan')
    @UseGuards(TenantAdminGuard)
    async changePlan(@Req() req: RequestLike, @Body() dto: ChangePlanDto) {
        const tenantId = this.requireTenantId(req);
        const userId = this.requireUserId(req);

        const blockedTargets = this.blockedPlans?.asTarget ?? [];
        if (blockedTargets.includes(dto.plan)) {
            throw new ForbiddenException({
                code: BILLING_ERROR_CODES.PLAN_NOT_SELF_SERVICE,
                message: `${dto.plan} is not activated via self-service.`,
                params: { planKey: dto.plan },
            });
        }

        const sub = await this.subscriptionUsage.findForTenant(tenantId);
        if (!sub) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
                message: `No subscription for tenant ${tenantId}`,
                params: { tenantId },
            });
        }

        // A contract that is over cannot be changed, only started again — and
        // there is no route for that yet, deliberately. Without this the
        // immediate branch would prorate an upgrade and charge for it while
        // entitlement resolution grants nothing, because the cancellation it
        // reads has already landed.
        if (cancellationHasLanded(sub, new Date())) {
            throw new ConflictException({
                code: 'SUBSCRIPTION_ENDED',
                message: 'This subscription has ended. Its plan can no longer be changed.',
                canceledEffectiveAt: sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
            });
        }

        // A cancellation is measured against the term of the cycle it was
        // declared under, so that cycle cannot change while it is outstanding.
        //
        // Allowing it produced a contract that contradicted itself. A monthly
        // subscription ending on the 1st, upgraded to a yearly plan, is an
        // immediate change — the plan goes up, the cycle gets longer — and the
        // suppression below then keeps the monthly window while the write puts
        // `YEARLY` beside it. The preview meanwhile prorates the yearly price
        // across the days left in the monthly period: a year bought, billed,
        // and over on the 1st.
        //
        // The plan may still move on the same cycle. What may not move is the
        // rhythm the ending was calculated in.
        const cancellationOutstanding = (sub.canceledEffectiveAt ?? sub.canceledAt) !== null;
        if (cancellationOutstanding && dto.billingCycle !== sub.billingCycle) {
            throw new ConflictException({
                code: 'CANCELLATION_LOCKS_THE_CYCLE',
                message:
                    'This subscription is cancelled, so its billing cycle cannot change. ' +
                    'The plan can.',
                canceledEffectiveAt: sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
                billingCycle: sub.billingCycle,
            });
        }

        // The same preview the wizard renders, and for the same reason: this
        // route decides what happens, not the caller.
        //
        // It used to ask `assertChangeAllowed` for the blockers only, under a
        // comment promising it "prevents bypass via a direct API call" — and
        // then took the timing from `dto.effectiveImmediately`. A direct POST
        // with that flag entered the immediate branch, reset the period from
        // today, and ended a yearly commitment the customer was still inside.
        // The blockers were checked; the one decision that carries money was
        // handed to whoever was calling.
        const decision = await this.planPreview.preview(tenantId, dto.plan, dto.billingCycle);
        if (decision.blockers.length > 0) {
            throw new BadRequestException({
                code: BILLING_ERROR_CODES.PLAN_CHANGE_BLOCKED,
                message: 'Plan change is blocked.',
                blockers: decision.blockers,
            });
        }

        // The decisions above were taken against the cancellation as it stood
        // when this route read it, and the write claims the row only while that
        // still holds. A cancellation declared in between loses nothing and
        // changes nothing: the caller is told to look again.
        //
        // The claim compares `canceledAt`, which a passing minute does not
        // change — so a cancellation recorded BEFORE this request, landing
        // while the preview was computed, would satisfy it. The boundary is
        // therefore re-read here, against the clock as it is now rather than as
        // it was when the subscription was fetched.
        if (cancellationHasLanded(sub, new Date())) {
            throw new ConflictException({
                code: 'SUBSCRIPTION_ENDED',
                message: 'This subscription ended while the request was being decided.',
                canceledEffectiveAt: sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
            });
        }
        const changedUnderneath = {
            code: 'SUBSCRIPTION_CHANGED',
            message: 'This subscription changed while the request was being decided. Reload it.',
        };

        if (decision.isImmediate) {
            const wasTrial = sub.status === 'TRIAL';
            // A fresh window is a fresh term, and a cancellation still to come
            // ends the subscription on a date this change does not move. Opening
            // one anyway sells a period the customer loses partway through. The
            // plan changes today either way; what stays is when it runs out.
            const period =
                wasTrial || cancellationOutstanding
                    ? null
                    : initialPeriodWindow(new Date(), dto.billingCycle as BillingCycle);
            // #17: in trial, carry the remaining time over to the target package
            // (via the existing TrialProjectionPort — the same one that feeds the
            // wizard preview). `null` → target without trial: trial end stays unchanged.
            const trialEndsAt =
                wasTrial && this.trialProjection
                    ? await this.trialProjection.projectTrialEndsAt({
                          currentPlan: sub.plan,
                          targetPlan: dto.plan,
                          currentTrialEndsAt: sub.trialEndsAt,
                          status: sub.status,
                          now: new Date(),
                      })
                    : undefined;
            const result = await this.subscriptionWrite.changePlanImmediate(tenantId, {
                planId: dto.plan,
                cycle: dto.billingCycle,
                periodStart: period?.start ?? null,
                periodEnd: period?.end ?? null,
                nextStatus: wasTrial ? null : 'ACTIVE',
                trialEndsAt,
                expectedCanceledAt: sub.canceledAt ?? null,
            });
            if (!result.claimed) {
                throw new ConflictException(changedUnderneath);
            }
            this.entitlements.invalidateTenant(tenantId);
            await this.tryFreezeOnPlanChange(
                tenantId,
                dto.plan,
                dto.billingCycle as BillingCycle,
                wasTrial,
                // A plan change on a cancelled subscription is allowed; the
                // contract it freezes still ends when the subscription does.
                sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
            );
            await this.auditLog(req, userId, 'Subscription', tenantId, 'CHANGE_PLAN', {
                fromPlan: sub.plan,
                fromCycle: sub.billingCycle,
                toPlan: result.plan,
                toCycle: result.billingCycle,
                immediate: true,
            });
            return { plan: result.plan, billingCycle: result.billingCycle, immediate: true };
        }

        // The preview already resolved this against the trial, the period and
        // the term; recomputing it here is a second answer waiting to differ.
        const effectiveAt = decision.effectiveAt ?? sub.currentPeriodEnd ?? new Date();
        const scheduled = await this.subscriptionWrite.schedulePlanChange(tenantId, {
            pendingPlan: dto.plan,
            pendingBillingCycle: dto.billingCycle,
            pendingEffectiveAt: effectiveAt,
            expectedCanceledAt: sub.canceledAt ?? null,
        });
        if (!scheduled.claimed) {
            throw new ConflictException(changedUnderneath);
        }
        this.entitlements.invalidateTenant(tenantId);
        await this.auditLog(req, userId, 'Subscription', tenantId, 'SCHEDULE_PLAN_CHANGE', {
            fromPlan: sub.plan,
            fromCycle: sub.billingCycle,
            pendingPlan: dto.plan,
            pendingCycle: dto.billingCycle,
            effectiveAt: effectiveAt.toISOString(),
        });
        return {
            plan: sub.plan,
            billingCycle: sub.billingCycle,
            pendingPlan: dto.plan,
            pendingBillingCycle: dto.billingCycle,
            pendingEffectiveAt: effectiveAt,
            immediate: false,
        };
    }

    // ---------------------------------------------------------------------
    // Onboarding — initial subscription from the configurator step
    // ---------------------------------------------------------------------

    @Post('onboarding/initial-subscription')
    @UseGuards(TenantAdminGuard)
    async completeOnboardingSubscription(
        @Req() req: RequestLike,
        @Body() dto: CompleteOnboardingSubscriptionDto,
    ): Promise<OnboardingSelectionResponse> {
        const tenantId = this.requireTenantId(req);
        const userId = this.requireUserId(req);
        const userEmail = this.resolveUserEmail(req);
        const warnings: string[] = [];

        // Self-service block: ENTERPRISE etc. cannot be selected via onboarding
        const blockedTargets = this.blockedPlans?.asTarget ?? [];
        if (blockedTargets.includes(dto.plan)) {
            throw new ForbiddenException({
                code: BILLING_ERROR_CODES.PLAN_NOT_SELF_SERVICE,
                message: `${dto.plan} is not activated via self-service.`,
                params: { planKey: dto.plan },
            });
        }

        const sub = await this.subscriptionUsage.findForTenant(tenantId);
        if (!sub) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
                message: `No subscription for tenant ${tenantId}`,
                params: { tenantId },
            });
        }

        // Onboarding is a first activation, and a subscription that has ended
        // is not one. Its own guard rather than the plan route's: they are two
        // routes, and only one of them was checked.
        if (cancellationHasLanded(sub, new Date())) {
            throw new ConflictException({
                code: 'SUBSCRIPTION_ENDED',
                message: 'This subscription has ended and cannot be activated again.',
                canceledEffectiveAt: sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
            });
        }

        // Plan-change blockers (defense-in-depth, as in changePlan)
        const blockers = await this.planPreview.assertChangeAllowed(
            tenantId,
            dto.plan,
            dto.billingCycle,
        );
        if (blockers.length > 0) {
            throw new BadRequestException({
                code: BILLING_ERROR_CODES.PLAN_CHANGE_BLOCKED,
                message: 'Plan change during onboarding is blocked.',
                blockers,
            });
        }

        const wasTrial = sub.status === 'TRIAL';
        const period = wasTrial
            ? null
            : initialPeriodWindow(new Date(), dto.billingCycle as BillingCycle);

        // Promo-redeem callback: only when all preconditions are met
        // (PromoCodesModule loaded + code in the DTO + subscription id in the sub record).
        // In the atomic path the adapter invokes the callback INSIDE its transaction;
        // in the sequential path the platform runs the redeem best-effort after the
        // writes.
        const canRedeem = !!dto.promoCode && !!this.promoCodes && !!sub.id;
        const redeemPromoCallback = canRedeem
            ? async (tx: import('@saasicat/core').TransactionContext, subscriptionId: string) =>
                  this.promoCodes!.redeemInTransaction(
                      {
                          code: dto.promoCode!,
                          subscriptionId,
                          tenantId,
                          email: userEmail ?? undefined,
                      },
                      tx,
                  )
            : null;

        let planResult: { plan: string; billingCycle: string; claimed?: boolean };
        // Assigned in the atomic branch and read after its catch. Declared
        // without a value because the catch always throws, so there is no path
        // that reads it unset — and an initialiser here would be dead.
        let claimLost: boolean;
        let promoRedemption: OnboardingSelectionResponse['promoRedemption'] = null;

        // ─── Atomic path (preferred) ────────────────────────────────────────
        if (this.subscriptionWrite.applyOnboardingSelection) {
            try {
                const result = await this.subscriptionWrite.applyOnboardingSelection(
                    tenantId,
                    {
                        planId: dto.plan,
                        cycle: dto.billingCycle,
                        periodStart: period?.start ?? null,
                        periodEnd: period?.end ?? null,
                        nextStatus: wasTrial ? null : 'ACTIVE',
                        expectedCanceledAt: sub.canceledAt ?? null,
                    },
                    redeemPromoCallback,
                );
                claimLost = !result.claimed;
                planResult = { plan: result.plan, billingCycle: result.billingCycle };
                if (result.promoRedemption) {
                    promoRedemption = this.toResponseRedemption(
                        result.promoRedemption,
                        dto.promoCode!,
                    );
                } else if (dto.promoCode) {
                    warnings.push(...this.collectPromoSkipReasons(dto.promoCode, sub));
                }
            } catch (err) {
                // Atomic path: a failure rolls back EVERYTHING (plan, redeem).
                // The tenant sees a hard error message, because the
                // subscription was in fact not modified — no
                // half-baked best-effort result.
                const reason = err instanceof Error ? err.message : null;
                throw new BadRequestException({
                    code: BILLING_ERROR_CODES.ONBOARDING_CREATE_FAILED,
                    message: reason
                        ? `Onboarding creation failed: ${reason}`
                        : 'Onboarding creation failed',
                    params: { reason },
                });
            }
            // Outside the catch on purpose. A lost claim is not a failure of
            // the write — nothing was written, deliberately, because somebody
            // cancelled while this was being applied. Reporting it as
            // ONBOARDING_CREATE_FAILED would tell the caller their adapter
            // broke, when what happened is that their subscription moved.
            if (claimLost) {
                throw new ConflictException({
                    code: 'SUBSCRIPTION_CHANGED',
                    message:
                        'This subscription changed while onboarding was being applied. Reload it.',
                });
            }
        } else {
            // ─── Fallback: sequential best-effort path ──────────────────────
            // The adapter does not (yet) implement applyOnboardingSelection —
            // we apply plan + promo one after another. Atomicity is not
            // guaranteed; failures may leave a half-state behind.
            planResult = await this.subscriptionWrite.changePlanImmediate(tenantId, {
                planId: dto.plan,
                cycle: dto.billingCycle,
                periodStart: period?.start ?? null,
                periodEnd: period?.end ?? null,
                nextStatus: wasTrial ? null : 'ACTIVE',
                // What this route read, so a cancellation declared since then
                // takes the row instead of being written over. A landed one was
                // refused above; a pending one is legitimate and claims fine.
                expectedCanceledAt: sub.canceledAt ?? null,
            });
            if (!planResult.claimed) {
                throw new ConflictException({
                    code: 'SUBSCRIPTION_CHANGED',
                    message:
                        'This subscription changed while onboarding was being applied. Reload it.',
                });
            }
            if (dto.promoCode) {
                if (!this.promoCodes) {
                    warnings.push(
                        'A promo code was sent, but PromoCodesModule is not loaded — the code was NOT redeemed.',
                    );
                } else if (!sub.id) {
                    warnings.push(
                        'A promo code was sent, but the adapter returns no SubscriptionUsageRecord.id — the code was NOT redeemed.',
                    );
                } else {
                    try {
                        const redemption = await this.promoCodes.redeem({
                            code: dto.promoCode,
                            subscriptionId: sub.id,
                            tenantId,
                            email: userEmail ?? undefined,
                        });
                        promoRedemption = this.toResponseRedemption(redemption, dto.promoCode);
                    } catch (err) {
                        const message = err instanceof Error ? err.message : 'Unknown error';
                        warnings.push(`The promo code could not be redeemed: ${message}`);
                    }
                }
            }
        }

        // Contract snapshots are a domain side effect of a successful plan
        // change, independent of whether the persistence adapter used the
        // atomic onboarding capability or the legacy sequential fallback.
        await this.tryFreezeOnPlanChange(
            tenantId,
            dto.plan,
            dto.billingCycle as BillingCycle,
            wasTrial,
        );

        this.entitlements.invalidateTenant(tenantId);

        await this.auditLog(
            req,
            userId,
            'Subscription',
            tenantId,
            'COMPLETE_ONBOARDING_SUBSCRIPTION',
            {
                plan: planResult.plan,
                billingCycle: planResult.billingCycle,
                promoCode: dto.promoCode ?? null,
                promoRedeemed: promoRedemption != null,
                warnings,
            },
        );

        // ─── Bundle booking (best-effort, AFTER the plan setup) ────
        // Deliberately not atomic with the plan change: bundle failures
        // (e.g. incompatible plan, already booked) must not roll the plan
        // back. Failures are reported as warnings — the tenant can book
        // failed bundles later via
        // `POST /billing/subscription-bundles`.
        const bundleVersionIds = dto.bundleVersionIds ?? [];
        let bundlesAdded = 0;
        if (bundleVersionIds.length > 0 && this.subscriptionBundles && sub.id) {
            for (const bundleVersionId of bundleVersionIds) {
                try {
                    await this.subscriptionBundles.addBundleToSubscription({
                        subscriptionId: sub.id,
                        bundleVersionId,
                        currentPlanKey: planResult.plan,
                        // Onboarding refuses an ended subscription above, and a
                        // cancellation still outstanding still caps the term.
                        parentEndsAt: sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
                    });
                    bundlesAdded += 1;
                } catch (err) {
                    warnings.push(
                        `Bundle '${bundleVersionId}' could not be booked: ` +
                            (err instanceof Error ? err.message : String(err)),
                    );
                }
            }
        } else if (bundleVersionIds.length > 0 && !this.subscriptionBundles) {
            warnings.push(
                'Bundle bookings were requested during onboarding, but SubscriptionBundleModule ' +
                    'is not registered in the consumer. No bundles were created.',
            );
        }

        return {
            plan: planResult.plan,
            // The adapter returns `string`; the UI expects `'MONTHLY' | 'YEARLY'`.
            // DTO pre-validation + the server-side PlanCatalog check
            // guarantee that only valid values reach this point.
            billingCycle: planResult.billingCycle as BillingCycle,
            bundlesAdded,
            promoRedemption,
            warnings,
        };
    }

    // ---------------------------------------------------------------------
    // Accept pending plan version — TENANT_ADMIN
    // ---------------------------------------------------------------------

    @Post('subscription/accept-pending-version')
    @UseGuards(TenantAdminGuard)
    async acceptPendingPlanVersion(@Req() req: RequestLike) {
        const tenantId = this.requireTenantId(req);
        const userId = this.requireUserId(req);

        const sub = await this.subscriptionUsage.findForTenant(tenantId);
        if (!sub) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
                message: `No subscription for tenant ${tenantId}`,
                params: { tenantId },
            });
        }
        // Same reason the plan cannot be changed: there is no subscription left
        // to accept anything for, and a page that still offers the act turns a
        // state it could have shown into an error.
        if (cancellationHasLanded(sub, new Date())) {
            throw new ConflictException({
                code: 'SUBSCRIPTION_ENDED',
                message: 'This subscription has ended. There is nothing left to accept.',
                canceledEffectiveAt: sub.canceledEffectiveAt ?? sub.canceledAt ?? null,
            });
        }
        if (!sub.pendingPlanVersion) {
            throw new BadRequestException({
                code: BILLING_ERROR_CODES.NO_PENDING_PLAN_VERSION,
                message: 'There is no pending plan version awaiting confirmation.',
            });
        }

        const result = await this.subscriptionWrite.acceptPendingPlanVersion(
            tenantId,
            userId,
            new Date(),
        );
        if (!result.alreadyAccepted) {
            this.entitlements.invalidateTenant(tenantId);
            await this.auditLog(
                req,
                userId,
                'Subscription',
                tenantId,
                'ACCEPT_PENDING_PLAN_VERSION',
                {
                    pendingPlanVersionId: sub.pendingPlanVersion.id,
                    pendingPlanId: sub.pendingPlanVersion.planId,
                    pendingPlanVersion: sub.pendingPlanVersion.version,
                    effectiveAt: result.effectiveAt?.toISOString() ?? null,
                },
            );
        }
        return {
            accepted: true,
            acceptedAt: result.acceptedAt,
            effectiveAt: result.effectiveAt,
            idempotent: result.alreadyAccepted,
        };
    }

    // ---------------------------------------------------------------------
    // Cancel — TENANT_ADMIN
    // ---------------------------------------------------------------------

    @Post('cancel')
    @UseGuards(TenantAdminGuard)
    async cancelSubscription(@Req() req: RequestLike, @Body() dto: CancelSubscriptionDto) {
        const tenantId = this.requireTenantId(req);
        const userId = this.requireUserId(req);
        const now = new Date();

        const sub = await this.subscriptionUsage.findForTenant(tenantId);
        if (!sub) {
            throw new NotFoundException({
                code: 'NO_SUBSCRIPTION',
                message: 'This tenant has no subscription to cancel.',
            });
        }

        // Already cancelled? Say so and change nothing.
        //
        // Not politeness — arithmetic. With a notice period configured, running
        // the decision again against a later `now` can land the cancellation a
        // whole period further out: an on-time declaration landing January 2027,
        // retried after the deadline, becomes January 2028. The customer pressed
        // the same button twice and bought another year. A cancellation is
        // declared once; a repeat is a question about it, not a new one.
        const existing = sub.canceledEffectiveAt ?? sub.canceledAt ?? null;
        if (existing) {
            // Repairing rather than merely reporting. A legacy row was written
            // before this hook existed, and a retry means the subscription
            // write succeeded while the non-fatal contract call did not — in
            // both cases nothing else will ever cap that contract, because only
            // the request that wins the cancellation write reaches the hook
            // below. Ending it again is a no-op: the lookup asks as of the
            // effective date, and a contract already capped there is gone.
            if (this.contractFreeze) {
                try {
                    await this.contractFreeze.endOnCancellation(tenantId, existing);
                } catch (err) {
                    this.logger.error(
                        `Ending the contract for an existing cancellation failed ` +
                            `(tenant ${tenantId}): ${String(err)}`,
                    );
                }
            }
            return {
                canceledAt: sub.canceledAt ?? null,
                canceledEffectiveAt: existing,
                status: sub.status,
                // Null rather than recomputed, because the three below explain a
                // decision that was taken once and is not stored. Deriving them
                // from the effective date tells the wrong story exactly where it
                // matters: a declaration that landed a period late has an
                // earlier term end and `afterNoticeDeadline: true`, and a retry
                // would report the effective date as the term end and the late
                // declaration as on time. Null says "not recomputed", which is
                // the truth; the date, which is stored, is above.
                termEndsAt: null,
                noticeDeadline: null,
                afterNoticeDeadline: null,
                alreadyCanceled: true,
            };
        }

        // A tenant declares; the rules decide when it lands. The request body
        // used to carry `immediately`, and honouring it let a customer end a
        // term they were still inside — the one thing this route may not do.
        // Ending a contract on the spot is an operator's act, and it goes
        // through the operator's own path.
        const decision = this.projectCancellation(sub, now);

        // What the page showed has to be what the customer agreed to. Refused
        // rather than silently applied, with the new date in the error so the
        // page can re-ask instead of guessing why.
        //
        // Equality is the wrong test where the answer IS the moment of asking.
        // A subscription with nothing left to run lands its cancellation now,
        // and "now" is read once when the page is drawn and again when the
        // button is pressed — never the same number, seconds apart. Comparing
        // them for equality refuses every confirmation, the retry included,
        // because the retry moves the date it is compared against. What the
        // reader agreed to there is "immediately", and every reading of the
        // clock up to this one says that. A date still in the FUTURE does not:
        // no projection of this route produced it, so it is refused as before.
        const expected = dto.expectedEffectiveAt ? new Date(dto.expectedEffectiveAt) : null;
        const landsImmediately = decision.effectiveAt <= now;
        const disagrees =
            expected !== null &&
            (landsImmediately
                ? expected.getTime() > decision.effectiveAt.getTime()
                : expected.getTime() !== decision.effectiveAt.getTime());
        if (disagrees) {
            throw new ConflictException({
                code: 'CANCELLATION_TERMS_CHANGED',
                message: 'The effective date changed since it was shown. Confirm the new one.',
                effectiveAt: decision.effectiveAt,
                termEndsAt: decision.termEndsAt,
                noticeDeadline: decision.noticeDeadline,
                afterNoticeDeadline: decision.afterNoticeDeadline,
            });
        }

        // Two further writes the decision implies, and neither is the client's
        // to ask for.
        //
        // `terminateNow` follows the DATE the rules returned, not a flag: it is
        // true exactly when they found nothing left to run — no period, no term,
        // as on a trial or a subscription still waiting for sales — and there
        // `effectiveAt` is `now`. Without it the row keeps saying ACTIVE for
        // good, because nothing downstream would ever transition it:
        // `computeNextPeriod` returns early on a subscription whose period end
        // is null, and there is no other materialisation path.
        //
        // What it does NOT do is stop the entitlements. Measured, not assumed:
        // `EntitlementService.computeLimits` grants a CANCELED subscription
        // whose cancellation landed eight months ago exactly what it granted
        // while active. Nothing on that path reads the status or the effective
        // date. That gap is general rather than particular to this route, and
        // it is issue #219.
        //
        // A declaration made after the notice deadline is the mirror image. It
        // buys the following period, and the commitment has to say so, because
        // every reader of the term end looks at `minimumTermUntil` rather than
        // at this cancellation — a downgrade scheduled meanwhile would otherwise
        // land at the old term end, inside the period just paid for.
        const result = await this.subscriptionWrite.cancelSubscription(tenantId, {
            canceledAt: now,
            effectiveAt: decision.effectiveAt,
            terminateNow: decision.effectiveAt <= now,
            minimumTermUntil: decision.afterNoticeDeadline ? decision.effectiveAt : undefined,
        });
        // The check above and this write are two moments, and a second request
        // can arrive between them. The store settles it — the claim either took
        // the row or found it taken — and a claim that lost neither audits a
        // cancellation that did not happen nor explains its own decision, which
        // was never applied.
        if (result.alreadyCanceled) {
            return {
                canceledAt: result.canceledAt,
                canceledEffectiveAt: result.canceledEffectiveAt,
                status: result.status,
                termEndsAt: null,
                noticeDeadline: null,
                afterNoticeDeadline: null,
                alreadyCanceled: true,
            };
        }
        this.entitlements.invalidateTenant(tenantId);
        // The frozen contract ends when the subscription does. Non-fatal, like
        // every other use of this port: the cancellation is already recorded,
        // and a consumer without contracts has nothing to end.
        if (this.contractFreeze) {
            try {
                await this.contractFreeze.endOnCancellation(tenantId, decision.effectiveAt);
            } catch (err) {
                this.logger.error(
                    `Ending the contract after a cancellation failed (tenant ${tenantId}): ${String(err)}`,
                );
            }
        }
        await this.auditLog(req, userId, 'Subscription', tenantId, 'CANCEL_SUBSCRIPTION', {
            canceledAt: now.toISOString(),
            effectiveAt: decision.effectiveAt.toISOString(),
            afterNoticeDeadline: decision.afterNoticeDeadline,
            status: result.status,
        });
        return {
            canceledAt: result.canceledAt,
            canceledEffectiveAt: result.canceledEffectiveAt,
            status: result.status,
            // What the page needs to say which period it landed in, and why.
            termEndsAt: decision.termEndsAt,
            noticeDeadline: decision.noticeDeadline,
            afterNoticeDeadline: decision.afterNoticeDeadline,
            alreadyCanceled: false,
        };
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    /**
     * What a cancellation declared at `now` would do. One method, because the
     * page states the date and this route applies it, and two constructions of
     * the same input are two chances to disagree about a rule the customer
     * meets once.
     */
    private projectCancellation(sub: SubscriptionUsageRecord, now: Date): CancellationDecision {
        return decideCancellationFor(
            {
                status: sub.status,
                billingCycle: sub.billingCycle as BillingCycle,
                currentPeriodEnd: sub.currentPeriodEnd ?? null,
                minimumTermUntil: sub.minimumTermUntil ?? null,
                trialEndsAt: sub.trialEndsAt ?? null,
                billingAnchorDay: sub.billingAnchorDay ?? null,
            },
            now,
            this.cancellationNoticeDays,
        );
    }

    private requireTenantId(req: RequestLike): string {
        const resolver: TenantIdResolver =
            this.tenantIdResolver ?? ((r: unknown) => (r as RequestLike).user?.tenantId ?? null);
        const tenantId = resolver(req);
        if (!tenantId) {
            throw new NotFoundException({
                code: AUTH_ERROR_CODES.TENANT_CONTEXT_MISSING,
                message: 'No tenant ID found on the request',
            });
        }
        return tenantId;
    }

    private requireUserId(req: RequestLike): string {
        const resolver: UserIdResolver =
            this.userIdResolver ??
            ((r: unknown) => (r as RequestLike).user?.sub ?? (r as RequestLike).user?.id ?? null);
        const userId = resolver(req);
        if (!userId) {
            throw new NotFoundException({
                code: AUTH_ERROR_CODES.TENANT_CONTEXT_MISSING,
                message: 'No user ID found on the request',
            });
        }
        return userId;
    }

    private buildActor(req: RequestLike, userId: string): AdminActor {
        const email = this.resolveUserEmail(req) ?? 'unknown';
        const contextResolver: AuditContextResolver =
            this.auditContextResolver ??
            ((r: unknown) => {
                const headers = (r as { headers?: Record<string, string | string[] | undefined> })
                    .headers;
                const sid = headers?.['x-session-id'];
                if (Array.isArray(sid)) return sid[0] ?? null;
                return sid ?? null;
            });
        const context = contextResolver(req) ?? 'tenant-self-service';
        return {
            userId,
            email,
            source: 'web',
            context,
        };
    }

    private resolveUserEmail(req: RequestLike): string | null {
        const emailResolver: UserEmailResolver =
            this.userEmailResolver ??
            ((r: unknown) =>
                ((r as RequestLike).user as { email?: string } | undefined)?.email ?? null);
        return emailResolver(req) ?? null;
    }

    private toResponseRedemption(
        redemption: import('@saasicat/core').PromoCodeRedemptionRecord,
        code: string,
    ): NonNullable<OnboardingSelectionResponse['promoRedemption']> {
        return {
            code: code.toUpperCase(),
            discount: {
                valueType: redemption.appliedValueType,
                value: String(redemption.appliedValue),
                durationType: redemption.appliedDurationType,
                durationValue: redemption.appliedDurationValue,
            },
            startsAt: redemption.startsAt.toISOString(),
            endsAt: redemption.endsAt ? redemption.endsAt.toISOString() : null,
        };
    }

    private collectPromoSkipReasons(promoCode: string, sub: SubscriptionUsageRecord): string[] {
        const reasons: string[] = [];
        if (!this.promoCodes) {
            reasons.push(
                `Promo-Code "${promoCode}" was sent, but PromoCodesModule is not loaded — the code was NOT redeemed.`,
            );
        }
        if (!sub.id) {
            reasons.push(
                `Promo-Code "${promoCode}" was sent, but the adapter returns no SubscriptionUsageRecord.id — the code was NOT redeemed.`,
            );
        }
        return reasons;
    }

    /**
     * #18: contract freeze after the plan change — non-fatal, only outside of
     * the trial (during a trial the trial entitlements apply, not the booked plan;
     * the freeze happens on the transition to ACTIVE, i.e. on materialization).
     * Without a configured `contractFreeze` hook the call is a no-op.
     */
    private async tryFreezeOnPlanChange(
        tenantId: string,
        plan: string,
        cycle: BillingCycle,
        wasTrial: boolean,
        endsAt: Date | null = null,
    ): Promise<void> {
        if (wasTrial || !this.contractFreeze) return;
        try {
            await this.contractFreeze.freezeOnPlanChange(tenantId, plan, cycle, new Date(), endsAt);
        } catch (err) {
            this.logger.error(
                `Contract freeze after plan change failed (tenant ${tenantId}): ${String(err)}`,
            );
        }
    }

    /**
     * Audit-log helper — writes best-effort, does not block the response path.
     * If `AdminAuditService` is not injected (e.g. a minimal deploy without
     * AdminModule), the call is silently discarded.
     */
    private async auditLog(
        req: RequestLike,
        userId: string,
        entity: string,
        entityId: string,
        action: string,
        changes?: Record<string, unknown>,
    ): Promise<void> {
        if (!this.auditService) return;
        try {
            await this.auditService.log({
                actor: this.buildActor(req, userId),
                entity,
                entityId,
                action,
                changes,
            });
        } catch {
            // Audit failures must not break the tenant write path.
            // (An observability gap is better than an operations outage.)
        }
    }
}

export type { UsageResponse };
