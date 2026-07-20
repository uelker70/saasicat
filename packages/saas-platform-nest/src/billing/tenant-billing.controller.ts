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

// TenantBillingController — Tenant-Self-Service-Endpunkte für die
// Plan-Verwaltung. Phase B: nur Reads (`/entitlement` + `/usage`). Phase C
// ergänzt Plan-Preview/Apply und Subscription-Cancel.
//
// Auth-Stack:
//   - `ComposedTenantAuthGuard` (immer): konsumenten-spezifische
//     Auth-Guards-Liste (z. B. JwtAuthGuard + TenantGuard).
//   - `TenantAdminGuard` (nur Mutationen): zusätzlich TENANT_ADMIN/SUPER_ADMIN-Rolle.
// Reads bleiben für alle authentifizierten Tenant-User offen.

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
     * P11.4 (METAMODELL §17a): Eingefrorener Paket-Snapshot aus dem
     * `CheckoutOffer`, der beim Onboarding aktiviert wurde. Read-only
     * für die Tenant-Self-Service-UI. `null` für Subscriptions ohne
     * CheckoutOffer-Herkunft.
     */
    packageSnapshot: unknown | null;
    /** P11.4: Optionaler Verweis auf den ursprünglichen CheckoutOffer. */
    checkoutOfferId: string | null;
}

@Controller('billing')
@UseGuards(ComposedTenantAuthGuard)
export class TenantBillingController {
    constructor(
        // tsup-Build hat kein emitDecoratorMetadata — Class-Type-Args müssen
        // explizit mit @Inject(Class) versehen werden, sonst bricht der DI.
        @Inject(EntitlementService) private readonly entitlements: EntitlementService,
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
        // Optional: Wenn der Konsument PromoCodesModule.forRoot(...) geladen hat,
        // unterstützt das Onboarding-Endpunkt atomares Einlösen eines Promo-Codes
        // direkt nach dem Plan-Wechsel. Ohne diese Service-Instanz wird ein
        // gesendeter `promoCode` ignoriert und in der Response als Warnung
        // gemeldet (kein Hard-Error — Tenant kann den Code per separatem
        // Endpoint nachträglich einlösen).
        @Optional()
        @Inject(PromoCodesService)
        private readonly promoCodes: PromoCodesService | null = null,
        // P10.1.2: Audit-Log für jeden Subscription-Write. Wenn der Konsument
        // `PlatformAdminModule.forRoot(...)` geladen hat (typischer Setup),
        // wird der Service automatisch injiziert. Ohne AdminModule fällt der
        // Audit-Log-Pfad still aus — kein Hard-Error für Setups, die noch
        // keinen Audit-Adapter haben.
        @Optional()
        @Inject(AdminAuditService)
        private readonly auditService: AdminAuditService | null = null,
        @Optional()
        @Inject(USER_EMAIL_RESOLVER_TOKEN)
        private readonly userEmailResolver: UserEmailResolver | null = null,
        @Optional()
        @Inject(AUDIT_CONTEXT_RESOLVER_TOKEN)
        private readonly auditContextResolver: AuditContextResolver | null = null,
        // P11.7.3 — Bundle-Buchung im Onboarding-Flow. Optional, weil das
        // SubscriptionBundleModule additiv vom Konsumenten registriert wird.
        @Optional()
        @Inject(SubscriptionBundlesService)
        private readonly subscriptionBundles: SubscriptionBundlesService | null = null,
        // #18: optionaler Contract-Freeze nach dem Plan-Wechsel (non-TRIAL).
        // Ohne Hook bleibt die Entitlement-Auflösung versions-/katalog-gepinnt.
        @Optional()
        @Inject(CONTRACT_FREEZE_PORT_TOKEN)
        private readonly contractFreeze: ContractFreezePort | null = null,
        // #17: optionaler Trial-Carry-over. Derselbe Port liefert auch die
        // Wizard-Projektion (PlanChangePreviewService). Ohne Port bleibt das
        // Trial-Ende beim Wechsel unverändert.
        @Optional()
        @Inject(TRIAL_PROJECTION_PORT_TOKEN)
        private readonly trialProjection: TrialProjectionPort | null = null,
    ) {}

    private readonly logger = new Logger(TenantBillingController.name);

    // ---------------------------------------------------------------------
    // Reads (Phase B) — alle authentifizierten Tenant-User
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
    // Plan-Preview (Phase C, Read-only) — TENANT_ADMIN
    // ---------------------------------------------------------------------

    @Post('plan/preview')
    @HttpCode(HttpStatus.OK)
    @UseGuards(TenantAdminGuard)
    async previewPlanChange(@Req() req: RequestLike, @Body() dto: PreviewPlanChangeDto) {
        const tenantId = this.requireTenantId(req);
        return this.planPreview.preview(tenantId, dto.plan, dto.billingCycle);
    }

    // ---------------------------------------------------------------------
    // Plan-Wechsel — TENANT_ADMIN (kostenwirksam)
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

        // Defense-in-depth: serverseitiger Pre-Check mit denselben Regeln
        // wie im Wizard. Verhindert Bypass per direktem API-Call.
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
            // #17: im Trial die Restzeit auf das Ziel-Paket übertragen (über den
            // vorhandenen TrialProjectionPort — derselbe, der den Wizard-Preview
            // speist). `null` → Ziel ohne Trial: Trial-Ende bleibt unverändert.
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
    // Onboarding — Initial-Subscription aus dem Konfigurator-Schritt
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

        // Self-Service-Block: ENTERPRISE etc. nicht per Onboarding wählbar
        const blockedTargets = this.blockedPlans?.asTarget ?? [];
        if (blockedTargets.includes(dto.plan)) {
            throw new ForbiddenException(`${dto.plan} wird nicht per Self-Service aktiviert.`);
        }

        const sub = await this.subscriptionUsage.findForTenant(tenantId);
        if (!sub) throw new NotFoundException(`Keine Subscription für Tenant ${tenantId}`);

        // Plan-Wechsel-Blocker (Defense-in-depth wie in changePlan)
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

        // Promo-Redeem-Callback: nur wenn alle Voraussetzungen erfüllt sind
        // (PromoCodesModule geladen + Code im DTO + Subscription-id im sub-Record).
        // Im atomaren Pfad ruft der Adapter den Callback INNERHALB seiner Transaktion
        // auf; im sequenziellen Pfad führt die Plattform den Redeem nach den Writes
        // best-effort aus.
        const canRedeem = !!dto.promoCode && !!this.promoCodes && !!sub.id;
        const redeemPromoCallback = canRedeem
            ? async (
                  tx: import('@saasicat/types').TransactionContext,
                  subscriptionId: string,
              ) =>
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

        // ─── Atomarer Pfad (bevorzugt) ──────────────────────────────────────
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
                // Atomarer Pfad: ein Fehler rollt ALLES zurück (Plan, Redeem).
                // Der Tenant sieht eine harte Fehlermeldung, weil die
                // Subscription tatsächlich nicht modifiziert wurde — kein
                // halbgares Best-Effort-Ergebnis.
                throw new BadRequestException({
                    message:
                        err instanceof Error
                            ? `Onboarding-Anlage fehlgeschlagen: ${err.message}`
                            : 'Onboarding-Anlage fehlgeschlagen',
                });
            }
        } else {
            // ─── Fallback: sequenzieller Best-Effort-Pfad ───────────────────
            // Adapter implementiert applyOnboardingSelection (noch) nicht —
            // wir ziehen Plan + Promo nacheinander. Atomicity nicht
            // garantiert, Failures hinterlassen ggf. Half-State.
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

        // ─── Bundle-Buchung (best-effort, NACH dem Plan-Setup) ─────
        // Bewusst nicht atomar mit dem Plan-Wechsel: Bundle-Fehler
        // (z. B. inkompatibler Plan, bereits gebucht) sollen den Plan
        // nicht zurückrollen. Fehler werden als Warnings gemeldet — der
        // Tenant kann fehlgeschlagene Bundles später per
        // `POST /billing/subscription-bundles` nachbuchen.
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
            // Adapter liefert `string`; UI erwartet `'MONTHLY' | 'YEARLY'`.
            // Pre-Validation per DTO + serverseitiger PlanCatalog-Check
            // garantieren, dass nur valide Werte hier ankommen.
            billingCycle: planResult.billingCycle as BillingCycle,
            bundlesAdded,
            promoRedemption,
            warnings,
        };
    }

    // ---------------------------------------------------------------------
    // Pending-PlanVersion akzeptieren — TENANT_ADMIN
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
     * #18: Contract-Freeze nach dem Plan-Wechsel — non-fatal, nur außerhalb des
     * Trials (im Trial gelten Trial-Entitlements, nicht der gebuchte Plan;
     * eingefroren wird beim Übergang in ACTIVE bzw. der Materialisierung). Ohne
     * konfigurierten `contractFreeze`-Hook ist der Aufruf ein No-op.
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
     * Audit-Log-Helfer — schreibt Best-Effort, blockt nicht den Antwort-Pfad.
     * Wenn `AdminAuditService` nicht injiziert ist (z. B. minimaler Deploy
     * ohne AdminModule), wird der Call still verworfen.
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
            // Audit-Failures dürfen den Tenant-Write-Pfad nicht brechen.
            // (Eine Beobachtungslücke ist besser als ein Operations-Outage.)
        }
    }
}

export type { UsageResponse };
