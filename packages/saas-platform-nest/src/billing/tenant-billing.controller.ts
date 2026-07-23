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
} from '@saasicat/types';
import { EntitlementService, toEffectiveLimitsSnapshot } from '../entitlement/index.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/tokens.js';
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
} from './tenant-billing.tokens.js';
import { CONTRACT_FREEZE_PORT_TOKEN, type ContractFreezePort } from './contract-freeze.tokens.js';
import {
    SELF_SERVICE_BLOCKED_PLANS_TOKEN,
    type SelfServiceBlockedPlans,
} from './self-service-policy.js';
import {
    CancelSubscriptionDto,
    ChangePlanDto,
    PreviewPlanChangeDto,
} from './dto/tenant-billing.dto.js';
import { CompleteOnboardingSubscriptionDto } from './dto/onboarding-subscription.dto.js';
import { PromoCodesService } from '../promo/service.js';
import { SubscriptionBundlesService } from './subscription-bundles.service.js';
import type { AdminActor, OnboardingSelectionResponse } from '@saasicat/types';
import { AdminAuditService } from '../admin/admin-audit.service.js';
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
    limits: ReturnType<typeof toEffectiveLimitsSnapshot>;
    usage: Record<string, number>;
    /**
     * P11.4 (METAMODELL §17a): Frozen package snapshot from the
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
            throw new NotFoundException(`Keine Subscription für Tenant ${tenantId}`);
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
            throw new ForbiddenException(`${dto.plan} wird nicht per Self-Service aktiviert.`);
        }

        const sub = await this.subscriptionUsage.findForTenant(tenantId);
        if (!sub) throw new NotFoundException(`Keine Subscription für Tenant ${tenantId}`);

        // Defense-in-depth: server-side pre-check with the same rules
        // as the wizard. Prevents bypass via a direct API call.
        const blockers = await this.planPreview.assertChangeAllowed(
            tenantId,
            dto.plan,
            dto.billingCycle,
        );
        if (blockers.length > 0) {
            throw new BadRequestException({ message: 'Plan-Wechsel blockiert.', blockers });
        }

        if (dto.effectiveImmediately) {
            const wasTrial = sub.status === 'TRIAL';
            const period = wasTrial
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
            });
            this.entitlements.invalidateTenant(tenantId);
            await this.tryFreezeOnPlanChange(
                tenantId,
                dto.plan,
                dto.billingCycle as BillingCycle,
                wasTrial,
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

        const effectiveAt =
            sub.status === 'TRIAL' && sub.trialEndsAt
                ? sub.trialEndsAt
                : (sub.currentPeriodEnd ?? new Date());
        await this.subscriptionWrite.schedulePlanChange(tenantId, {
            pendingPlan: dto.plan,
            pendingBillingCycle: dto.billingCycle,
            pendingEffectiveAt: effectiveAt,
        });
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
            throw new ForbiddenException(`${dto.plan} wird nicht per Self-Service aktiviert.`);
        }

        const sub = await this.subscriptionUsage.findForTenant(tenantId);
        if (!sub) throw new NotFoundException(`Keine Subscription für Tenant ${tenantId}`);

        // Plan-change blockers (defense-in-depth, as in changePlan)
        const blockers = await this.planPreview.assertChangeAllowed(
            tenantId,
            dto.plan,
            dto.billingCycle,
        );
        if (blockers.length > 0) {
            throw new BadRequestException({
                message: 'Plan-Wechsel im Onboarding blockiert.',
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
            ? async (tx: import('@saasicat/types').TransactionContext, subscriptionId: string) =>
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

        let planResult: { plan: string; billingCycle: string };
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
                    },
                    redeemPromoCallback,
                );
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
                throw new BadRequestException({
                    message:
                        err instanceof Error
                            ? `Onboarding-Anlage fehlgeschlagen: ${err.message}`
                            : 'Onboarding-Anlage fehlgeschlagen',
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
            });
            await this.tryFreezeOnPlanChange(
                tenantId,
                dto.plan,
                dto.billingCycle as BillingCycle,
                wasTrial,
            );

            if (dto.promoCode) {
                if (!this.promoCodes) {
                    warnings.push(
                        'Promo-Code wurde gesendet, aber PromoCodesModule ist nicht geladen — der Code wurde NICHT eingelöst.',
                    );
                } else if (!sub.id) {
                    warnings.push(
                        'Promo-Code wurde gesendet, aber der Adapter liefert keine SubscriptionUsageRecord.id — der Code wurde NICHT eingelöst.',
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
                        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
                        warnings.push(`Promo-Code konnte nicht eingelöst werden: ${message}`);
                    }
                }
            }
        }

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
                    });
                    bundlesAdded += 1;
                } catch (err) {
                    warnings.push(
                        `Bundle '${bundleVersionId}' konnte nicht gebucht werden: ` +
                            (err instanceof Error ? err.message : String(err)),
                    );
                }
            }
        } else if (bundleVersionIds.length > 0 && !this.subscriptionBundles) {
            warnings.push(
                'Bundle-Buchungen im Onboarding angefordert, aber SubscriptionBundleModule ' +
                    'ist nicht im Konsumenten registriert. Bundles wurden nicht angelegt.',
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
        if (!sub) throw new NotFoundException(`Keine Subscription für Tenant ${tenantId}`);
        if (!sub.pendingPlanVersion) {
            throw new BadRequestException(
                'Es liegt aktuell keine Pending-Plan-Version zur Bestätigung vor.',
            );
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
        const result = await this.subscriptionWrite.cancelSubscription(
            tenantId,
            !!dto.immediately,
            new Date(),
        );
        this.entitlements.invalidateTenant(tenantId);
        await this.auditLog(req, userId, 'Subscription', tenantId, 'CANCEL_SUBSCRIPTION', {
            immediate: !!dto.immediately,
            canceledAt: result.canceledAt?.toISOString() ?? null,
            status: result.status,
        });
        return {
            canceledAt: result.canceledAt,
            status: result.status,
            immediate: !!dto.immediately,
        };
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    private requireTenantId(req: RequestLike): string {
        const resolver: TenantIdResolver =
            this.tenantIdResolver ?? ((r: unknown) => (r as RequestLike).user?.tenantId ?? null);
        const tenantId = resolver(req);
        if (!tenantId) {
            throw new NotFoundException('Tenant-ID nicht im Request gefunden');
        }
        return tenantId;
    }

    private requireUserId(req: RequestLike): string {
        const resolver: UserIdResolver =
            this.userIdResolver ??
            ((r: unknown) => (r as RequestLike).user?.sub ?? (r as RequestLike).user?.id ?? null);
        const userId = resolver(req);
        if (!userId) {
            throw new NotFoundException('User-ID nicht im Request gefunden');
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
        redemption: import('@saasicat/types').PromoCodeRedemptionRecord,
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
                `Promo-Code "${promoCode}" wurde gesendet, aber PromoCodesModule ist nicht geladen — der Code wurde NICHT eingelöst.`,
            );
        }
        if (!sub.id) {
            reasons.push(
                `Promo-Code "${promoCode}" wurde gesendet, aber der Adapter liefert keine SubscriptionUsageRecord.id — der Code wurde NICHT eingelöst.`,
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
    ): Promise<void> {
        if (wasTrial || !this.contractFreeze) return;
        try {
            await this.contractFreeze.freezeOnPlanChange(tenantId, plan, cycle, new Date());
        } catch (err) {
            this.logger.error(
                `Contract-Freeze nach Plan-Wechsel fehlgeschlagen (tenant ${tenantId}): ${String(err)}`,
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
