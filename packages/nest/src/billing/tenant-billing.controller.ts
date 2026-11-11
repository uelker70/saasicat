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
    UnprocessableEntityException,
    UseGuards,
} from '@nestjs/common';
import type {
    BillingCycle,
    PlanCatalogSettings,
    SubscriptionUsagePort,
    SubscriptionUsageRecord,
    TenantSubscriptionWritePort,
    UsageSnapshotPort,
    VersionOfferWithDays,
    VersionSwitchWithDays,
} from '@saasicat/core';
import {
    AUTH_ERROR_CODES,
    BILLING_ERROR_CODES,
    CANCELLATION_RESULT_MOMENTS,
    installationZoneOf,
    isPersistenceRefusal,
    withDays,
    withUsageDays,
    type WithUsageDays,
} from '@saasicat/core';
import { toEffectiveLimitsSnapshot } from '../entitlement/aggregation.js';
import { EntitlementService } from '../entitlement/entitlement.service.js';
import { ENTITLEMENT_SERVICE_TOKEN } from '../entitlement/entitlement.tokens.js';
import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { TenantAdminGuard } from './tenant-admin.guard.js';
import { mayChangeWhatTheTenantPays } from './tenant-roles.js';
import { initialPeriodWindow } from './billing-period.js';
import { PlanChangePreviewService } from './plan-change-preview.service.js';
import { VersionOfferService } from './version-offer.service.js';
import { VersionSwitchService } from './version-switch.service.js';
import { RetirementSwitchService } from './retirement-switch.service.js';
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
import { recordChargesAfter } from './charges/record-charges-after.js';
import { SubscriberChargeService } from './charges/subscriber-charge.service.js';
import {
    SELF_SERVICE_BLOCKED_PLANS_TOKEN,
    type SelfServiceBlockedPlans,
} from './self-service-policy.js';
import {
    AcceptVersionOfferDto,
    ChangePlanDto,
    PreviewPlanChangeDto,
    SwitchToReplacementDto,
} from './dto/tenant-billing.dto.js';
import { CompleteOnboardingSubscriptionDto } from './dto/onboarding-subscription.dto.js';
import { PromoCodesService } from '../promo/promo.service.js';
import { SubscriptionBundlesService } from './subscription-bundles.service.js';
import type {
    AdminActor,
    OnboardingSelectionResponse,
    RetirementSwitchResult,
    RetirementSwitchTerms,
    VersionRetiredNotice,
} from '@saasicat/core';
import { AdminAuditService } from '../admin/admin-audit.service.js';
import { cancellationHasLanded } from '../entitlement/landed-cancellation.js';
import { answerRefusal, answeringRefusals } from '../errors/answering-refusals.js';
import { CancelSubscriptionDto } from './dto/tenant-billing.dto.js';
import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    type AuditContextResolver,
    type UserEmailResolver,
} from './tenant-billing.tokens.js';
import { resolvePlanAnchorDay } from './bundle-period.js';
import { subscriptionNotFound } from './subscription-not-found.js';
import {
    requireTenantUserId,
    tenantActorOf,
    tenantUserEmailOf,
    type TenantAuditResolvers,
} from './tenant-audit-actor.js';
import {
    contractUnlessTrialOf,
    freezeContractAfter,
    intendedContractOf,
} from './freeze-contract-after.js';
import {
    agreementNamed,
    type AgreementSettings,
} from '../subscription-contract/contract-agreement.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from './plan-catalog.module.js';
import { WritesNothing } from '../tenant-access/tenant-access-marks.js';
import {
    SubscriptionCancellationService,
    type ProjectedCancellation,
} from './subscription-cancellation.service.js';

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

/** What `GET /billing/usage` reads, before the days of its moments are put beside them. */
interface UsageMomentsAnswer {
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
    /**
     * What the plan costs per billing cycle, net, at the version the
     * subscription is bound to — not the catalogue's price for new customers.
     * Null where the plan has no list price in this rhythm.
     */
    planPriceNet: number | null;
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
     *
     * `deletion` is what confirming it now would tell the tenant: the
     * read-only period, the last day it can still read on and the day its
     * data is deleted on. Null where the installation records no end of a
     * subscription, or the subscription has no id to record the day under.
     */
    cancellation: ProjectedCancellation;
    /**
     * What the tenant was told of its deletion when its cancellation was
     * confirmed: the days its end is recorded with. Null where it was told
     * none.
     */
    announcedDeletion: ProjectedCancellation['deletion'];
    /**
     * The retirement announced for the version the subscription is on, while it
     * has not taken effect — what the subscriber was told. Until then
     * `cancellation` is free of notice, for the end of the running period.
     * Null where none is pending.
     */
    retirement: VersionRetiredNotice | null;
    /**
     * What switching to the retirement's replacement now would cost, where the
     * subscription could (`SC-SUB-032`). Null where it could not: no retirement
     * pending, a trial, or something outstanding.
     */
    retirementSwitch: RetirementSwitchTerms | null;
    limits: ReturnType<typeof toEffectiveLimitsSnapshot>;
    usage: Record<string, number>;
    /**
     * P11.4: Frozen package snapshot from the
     * `CheckoutOffer` that was activated during onboarding. Read-only
     * for the tenant self-service UI. `null` for subscriptions without
     * a CheckoutOffer origin.
     */
    packageSnapshot: unknown;
    /** P11.4: Optional reference to the originating CheckoutOffer. */
    checkoutOfferId: string | null;
    /**
     * Whether the reader may change what the tenant pays — the plan, the
     * add-ons and the versions they are on (`SC-ADM-026`), by the rule
     * `TenantAdminGuard` refuses by. The page reads it once, for the actions
     * that have no preview to say it.
     */
    mayChange: boolean;
}

/**
 * What `GET /billing/usage` answers: beside each moment a tenant is shown as a
 * day, its days in the installation's zone (`withUsageDays`).
 */
type UsageResponse = WithUsageDays<UsageMomentsAnswer>;

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
        // Only where `chargeJournal` is configured.
        //
        // Appended LAST, as every parameter from here on, and that is not
        // stylistic: this list is also a positional signature, and inserting a
        // parameter in the middle of it shifts every argument after it — into
        // slots where nothing type-checks a boolean landing where a service
        // was, so the tests that build this controller directly fail in ways
        // that read as unrelated logic errors.
        @Optional()
        @Inject(SubscriberChargeService)
        private readonly charges: SubscriberChargeService | null = null,
        // Appended last for the reason given above. Not optional:
        // `TenantBillingModule` always registers it.
        @Inject(VersionOfferService)
        private readonly versionOffers: VersionOfferService,
        // Appended last for the same reason.
        @Inject(VersionSwitchService)
        private readonly versionSwitches: VersionSwitchService,
        // Appended last for the same reason. Only where an operator may retire
        // versions.
        @Optional()
        @Inject(RetirementSwitchService)
        private readonly retirementSwitches: RetirementSwitchService | null = null,
        // Appended last for the same reason. What a change scheduled now
        // records as agreed; optional only so a test can build the controller
        // directly.
        @Optional()
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN)
        private readonly settings:
            (AgreementSettings & Pick<PlanCatalogSettings, 'timeZone'>) | null = null,
        // Appended last for the same reason. Not optional:
        // `TenantBillingModule` always registers it.
        @Inject(SubscriptionCancellationService)
        private readonly cancellations: SubscriptionCancellationService,
    ) {}

    /** The installation's zone, which every day handed out here is read in. */
    private zone(): string {
        return installationZoneOf(this.settings);
    }

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
            throw subscriptionNotFound(tenantId);
        }

        const usage: Record<string, number> = {};
        for (const key of new Set([...Object.keys(limits.quotas), ...Object.keys(usageRaw)])) {
            usage[key] = usageRaw[key] ?? 0;
        }
        const planPriceNet = await this.planPreview.planPriceNet(sub);
        const now = new Date();
        const { cancellation, announcedDeletion, retirement } =
            await this.cancellations.projectionFor(tenantId, sub, now);
        const retirementSwitch = retirement
            ? ((await this.retirementSwitches?.openFor(sub, now))?.terms ?? null)
            : null;

        const answer: UsageMomentsAnswer = {
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
            planPriceNet,
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
            // be read in the confirmation, not discovered in the receipt. The
            // day the tenant's data is deleted on is read there too, for the
            // same reason (`SC-CANC-021`).
            cancellation,
            announcedDeletion,
            retirement,
            retirementSwitch,
            limits: toEffectiveLimitsSnapshot(limits),
            usage,
            packageSnapshot: sub.packageSnapshot ?? null,
            checkoutOfferId: sub.checkoutOfferId ?? null,
            mayChange: mayChangeWhatTheTenantPays(req),
        };
        return withUsageDays(answer, this.zone());
    }

    // ---------------------------------------------------------------------
    // Version offer (read-only) — every tenant user
    // ---------------------------------------------------------------------

    /**
     * A newer version of the tenant's plan, side by side with the one bound,
     * classified against it (`SC-SUB-040`); `offer: null` where there is none
     * the subscription could take. Open to every user of the tenant, as the
     * account read is: a user who cannot see an offer cannot ask an
     * administrator to take it.
     */
    @Get('version-offer')
    async getVersionOffer(
        @Req() req: RequestLike,
    ): Promise<{ offer: VersionOfferWithDays | null }> {
        const tenantId = this.requireTenantId(req);
        return { offer: await this.versionOffers.offerFor(tenantId) };
    }

    /**
     * Takes the version offer (`SC-SUB-021`): at once for an improvement and
     * for more for more, at the end of the term for one that takes something
     * away. The body names the version the page showed; the offer is read
     * again, and a different one is refused with `VERSION_OFFER_CHANGED`.
     * Changes what the tenant pays, so it asks for the tenant's administrator.
     */
    @Post('version-offer/accept')
    @UseGuards(TenantAdminGuard)
    async acceptVersionOffer(
        @Req() req: RequestLike,
        @Body() dto: AcceptVersionOfferDto,
    ): Promise<VersionSwitchWithDays> {
        const tenantId = this.requireTenantId(req);
        const userId = this.requireUserId(req);
        const result = await this.versionSwitches.take(tenantId, dto.planVersionId);
        await this.auditLog(
            req,
            userId,
            'Subscription',
            tenantId,
            result.immediate ? 'SWITCH_PLAN_VERSION' : 'SCHEDULE_PLAN_VERSION_SWITCH',
            {
                offerClass: result.class,
                fromPlanVersionId: result.fromPlanVersionId,
                toPlanVersionId: result.planVersionId,
                takesEffectAt: result.takesEffectAt,
            },
        );
        return withDays(result, ['takesEffectAt'], this.zone());
    }

    /**
     * Switches to the replacement a retirement names, before its date
     * (`SC-SUB-032`). The body names the version the page showed; a different
     * one is refused with `RETIREMENT_SWITCH_CHANGED` and the retirement as it
     * stands. Changes what the tenant pays, so it asks for the tenant's
     * administrator.
     */
    @Post('retirement/switch')
    @UseGuards(TenantAdminGuard)
    async switchToReplacement(
        @Req() req: RequestLike,
        @Body() dto: SwitchToReplacementDto,
    ): Promise<RetirementSwitchResult> {
        const tenantId = this.requireTenantId(req);
        const userId = this.requireUserId(req);
        if (!this.retirementSwitches) {
            throw new UnprocessableEntityException({
                code: BILLING_ERROR_CODES.RETIREMENT_SWITCH_NOT_PENDING,
                message:
                    'No retirement of your version is waiting for its date, so there is nothing to switch to.',
                params: {},
            });
        }
        const result = await this.retirementSwitches.switchNow(tenantId, dto.planVersionId);
        await this.auditLog(
            req,
            userId,
            'Subscription',
            tenantId,
            'SWITCH_TO_RETIREMENT_REPLACEMENT',
            {
                fromPlanVersionId: result.fromPlanVersionId,
                toPlanVersionId: result.planVersionId,
                heldUntilDay: result.heldUntilDay,
            },
        );
        return result;
    }

    // ---------------------------------------------------------------------
    // Plan preview (read-only) — every signed-in user (`SC-ADM-026`): who
    // cannot change the plan can still see what a change would cost, and is
    // told up front that the administration makes it.
    // ---------------------------------------------------------------------

    @Post('plan/preview')
    @HttpCode(HttpStatus.OK)
    @WritesNothing()
    async previewPlanChange(@Req() req: RequestLike, @Body() dto: PreviewPlanChangeDto) {
        const tenantId = this.requireTenantId(req);
        const preview = withDays(
            await this.planPreview.preview(tenantId, dto.plan, dto.billingCycle),
            ['effectiveAt', 'projectedTrialEndsAt'],
            this.zone(),
        );
        return { ...preview, mayChange: mayChangeWhatTheTenantPays(req) };
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
                // Says what the shipped catalogue says, so an app that has not
                // translated this code and one that has do not refuse in two
                // different sentences.
                message: `${dto.plan} is only activated via a special contract. Please contact the contract manager.`,
                // `planName` is the key here, and that is the best label this
                // check has: it decides before any catalogue is read, from
                // nothing but the key the request sent. The plan-change
                // preview does have a catalogue and passes the real name,
                // which is the one a tenant recognises. Either way the
                // template's `{planName}` resolves to a word rather than a
                // brace — `error-params-contract.test.js` holds that.
                params: { planName: dto.plan, planKey: dto.plan },
            });
        }

        const sub = await this.subscriptionUsage.findForTenant(tenantId);
        if (!sub) {
            throw subscriptionNotFound(tenantId);
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
        // The preview already resolved this against the trial, the period and
        // the term; recomputing it here is a second answer waiting to differ.
        const scheduledAt = decision.effectiveAt ?? sub.currentPeriodEnd ?? new Date();

        // Where contracts are frozen, a plan change ends in one naming the
        // tenant's subscriber, at the tax decided for it. Refused here, while
        // nothing has moved: the freeze runs after the plan is written and only
        // logs its refusal. Asked of the contract the change ends in, which
        // only the preview can say: from today, or from the date it is
        // scheduled for, in the rhythm asked for. A change made today in a
        // trial ends in none, and asks for the party alone.
        const cycle = dto.billingCycle as BillingCycle;
        await this.contractFreeze?.assertPartyFor(
            tenantId,
            decision.isImmediate
                ? contractUnlessTrialOf(sub, new Date(), cycle)
                : intendedContractOf(sub, scheduledAt, cycle),
        );

        // The version a change binds is the one its preview showed
        // (`SC-CHG-023`). The preview is read again here, at the moment the
        // change is submitted; a version that went on sale since — a successor
        // whose start passed while the page was open — is not bound at a price
        // nobody saw. The caller is shown the preview as it stands. Only a
        // change that keeps the version bound names none: the preview kept it,
        // as it does when the plan stays (`SC-SUB-024`). A subscription bound
        // to no version has nothing to keep, so its preview quotes the version
        // on sale, and the change names it like a change to another plan.
        const boundVersionId = sub.planVersion?.id ?? null;
        const quotedVersionId =
            decision.target.planVersionId !== boundVersionId ? decision.target.planVersionId : null;
        // The binding those decisions were taken from, claimed by the write
        // wherever the store binds versions: a change made in between — another
        // plan bound by someone else — is refused rather than undone by this one.
        const claimsBinding =
            this.subscriptionWrite.bindsPlanVersion !== false
                ? { expectedPlanVersionId: boundVersionId }
                : {};
        if (quotedVersionId !== null) {
            if (!dto.planVersionId) {
                throw new BadRequestException({
                    code: BILLING_ERROR_CODES.PLAN_CHANGE_VERSION_NOT_NAMED,
                    message: 'A plan change has to name the version its preview showed.',
                    params: { planKey: dto.plan },
                });
            }
            if (dto.planVersionId !== quotedVersionId) {
                throw new ConflictException({
                    code: BILLING_ERROR_CODES.PLAN_CHANGE_QUOTE_CHANGED,
                    message:
                        'This plan changed since it was shown. Look at it again before changing to it.',
                    params: { planVersionId: dto.planVersionId },
                    preview: decision,
                });
            }
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
            code: BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED,
            message: 'This subscription changed while the request was being decided. Reload it.',
        };

        if (decision.isImmediate) {
            const wasTrial = sub.status === 'TRIAL';
            // The window is the one the preview priced. In the same rhythm the
            // new plan runs inside the period already paid, on the same billing
            // day, charged the difference (`SC-CHG-020`); a longer rhythm, or a
            // subscription with no period yet, starts one today, charged in
            // full less the unused rest (`SC-CHG-021`). Deciding it here again
            // would be a second answer waiting to differ from the quote.
            //
            // Never during a trial, which commits to no period, and never with
            // a cancellation still to come: that ends the subscription on a
            // date this change does not move, and a fresh window would sell a
            // period the customer loses partway through.
            const opensPeriod = decision.proration?.basis === 'newPeriod';
            const period =
                wasTrial || cancellationOutstanding || !opensPeriod
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
            // A subscription gone or a plan version retired since the checks
            // above is refused by the store with the code those checks give.
            const result = await answeringRefusals(
                () =>
                    this.subscriptionWrite.changePlanImmediate(tenantId, {
                        planId: dto.plan,
                        cycle: dto.billingCycle,
                        periodStart: period?.start ?? null,
                        periodEnd: period?.end ?? null,
                        nextStatus: wasTrial ? null : 'ACTIVE',
                        trialEndsAt,
                        expectedCanceledAt: sub.canceledAt ?? null,
                        ...claimsBinding,
                        // A change that keeps the plan keeps the version bound
                        // (`SC-SUB-024`): the preview priced it at that version,
                        // and moving the rhythm is no occasion to move it on to
                        // the one on sale.
                        keepsBoundVersion: dto.plan === sub.plan,
                        // The version checked above, and no other: one that stops
                        // taking bookings between the check and the write leaves
                        // the row unclaimed rather than binding its successor.
                        quotedPlanVersionId: quotedVersionId,
                        quotedVersionOnly:
                            quotedVersionId !== null &&
                            this.subscriptionWrite.bindsPlanVersion !== false,
                    }),
                {},
                this.zone(),
            );
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
            await recordChargesAfter(this.charges, tenantId, 'a plan change', this.logger);
            await this.auditLog(req, userId, 'Subscription', tenantId, 'CHANGE_PLAN', {
                fromPlan: sub.plan,
                fromCycle: sub.billingCycle,
                toPlan: result.plan,
                toCycle: result.billingCycle,
                immediate: true,
            });
            return { plan: result.plan, billingCycle: result.billingCycle, immediate: true };
        }

        // A subscription gone or a plan version retired since the checks above
        // is refused by the store with the code those checks give.
        const scheduled = await answeringRefusals(
            () =>
                this.subscriptionWrite.schedulePlanChange(tenantId, {
                    pendingPlan: dto.plan,
                    pendingBillingCycle: dto.billingCycle,
                    pendingEffectiveAt: scheduledAt,
                    expectedCanceledAt: sub.canceledAt ?? null,
                    ...claimsBinding,
                    // The version the preview priced and the caller named, bound when
                    // the change comes due (`SC-CHG-022`). A change that keeps the
                    // version bound records none: it keeps whatever version is bound by
                    // that day.
                    pendingChangeVersionId: quotedVersionId,
                    // What the subscriber agrees to by scheduling it, which the
                    // contract it ends in records unless they agree to newer since.
                    pendingAgreement: agreementNamed(this.settings, dto.billingCycle, new Date()),
                }),
            {},
            this.zone(),
        );
        if (!scheduled.claimed) {
            throw new ConflictException(changedUnderneath);
        }
        this.entitlements.invalidateTenant(tenantId);
        await this.auditLog(req, userId, 'Subscription', tenantId, 'SCHEDULE_PLAN_CHANGE', {
            fromPlan: sub.plan,
            fromCycle: sub.billingCycle,
            pendingPlan: dto.plan,
            pendingCycle: dto.billingCycle,
            effectiveAt: scheduledAt.toISOString(),
        });
        return withDays(
            {
                plan: sub.plan,
                billingCycle: sub.billingCycle,
                pendingPlan: dto.plan,
                pendingBillingCycle: dto.billingCycle,
                pendingEffectiveAt: scheduledAt,
                immediate: false,
            },
            ['pendingEffectiveAt'],
            this.zone(),
        );
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
                message: `${dto.plan} is only activated via a special contract. Please contact the contract manager.`,
                // The key as the label — see the note on the plan-change route.
                params: { planName: dto.plan, planKey: dto.plan },
            });
        }

        const sub = await this.subscriptionUsage.findForTenant(tenantId);
        if (!sub) {
            throw subscriptionNotFound(tenantId);
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

        // Plan-change blockers (defense-in-depth, as in changePlan). Asked
        // about today: onboarding sets the plan at once, whatever day the
        // preview would schedule the same change for.
        const appliedAt = new Date();
        const blockers = await this.planPreview.assertChangeAllowed(
            tenantId,
            dto.plan,
            dto.billingCycle,
            appliedAt,
            { appliedAt },
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

        // Outside a trial the activation ends in a contract naming the
        // subscriber at the tax decided for it: refused here, while nothing has
        // moved, as the plan route refuses. A trial commits to no period; its
        // contract is frozen when it converts.
        if (!wasTrial) {
            await this.contractFreeze?.assertPartyFor(tenantId, {
                effectiveFrom: appliedAt,
                cycle: dto.billingCycle as BillingCycle,
                endsAt: null,
            });
        }

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
                // A store refusal is a race the checks above answer themselves:
                // the subscription went, or the plan lost its version. It gets
                // their answer, as the sequential path below gives it.
                if (isPersistenceRefusal(err)) throw answerRefusal(err, {}, this.zone());
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
                    code: BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED,
                    message:
                        'This subscription changed while onboarding was being applied. Reload it.',
                });
            }
        } else {
            // ─── Fallback: sequential best-effort path ──────────────────────
            // The adapter does not (yet) implement applyOnboardingSelection —
            // we apply plan + promo one after another. Atomicity is not
            // guaranteed; failures may leave a half-state behind.
            planResult = await answeringRefusals(
                () =>
                    this.subscriptionWrite.changePlanImmediate(tenantId, {
                        planId: dto.plan,
                        cycle: dto.billingCycle,
                        periodStart: period?.start ?? null,
                        periodEnd: period?.end ?? null,
                        nextStatus: wasTrial ? null : 'ACTIVE',
                        // What this route read, so a cancellation declared since then
                        // takes the row instead of being written over. A landed one was
                        // refused above; a pending one is legitimate and claims fine.
                        expectedCanceledAt: sub.canceledAt ?? null,
                        // Onboarding sells the chosen plan at the version in effect,
                        // as the atomic path does.
                        keepsBoundVersion: false,
                        quotedPlanVersionId: null,
                    }),
                {},
                this.zone(),
            );
            if (!planResult.claimed) {
                throw new ConflictException({
                    code: BILLING_ERROR_CODES.SUBSCRIPTION_CHANGED,
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
                        // The bundle runs in step with the plan it is booked
                        // beside — the plan whose window onboarding just opened.
                        planCycle: dto.billingCycle as BillingCycle,
                        planPeriodEnd: period?.end ?? null,
                        // The window onboarding just opened decides, not any
                        // anchor stored from the subscription's previous life —
                        // the plan change reset the rhythm.
                        planAnchorDay: resolvePlanAnchorDay({
                            currentPeriodStart: period?.start ?? null,
                        }),
                        // The plan this onboarding just set is the one it runs
                        // on: nothing is scheduled after an activation yet.
                        plansAhead: [],
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

        // Contract snapshots are a domain side effect of a successful plan
        // change, independent of whether the persistence adapter used the
        // atomic onboarding capability or the legacy sequential fallback. After
        // the add-ons: the contract names what is booked when it is written.
        await this.tryFreezeOnPlanChange(
            tenantId,
            dto.plan,
            dto.billingCycle as BillingCycle,
            wasTrial,
        );

        await recordChargesAfter(this.charges, tenantId, 'onboarding', this.logger);

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
    // Cancel — TENANT_ADMIN
    // ---------------------------------------------------------------------

    @Post('cancel')
    @UseGuards(TenantAdminGuard)
    async cancelSubscription(@Req() req: RequestLike, @Body() dto: CancelSubscriptionDto) {
        const tenantId = this.requireTenantId(req);
        const actor = this.buildActor(req, this.requireUserId(req));
        return withDays(
            await this.cancellations.declare(tenantId, dto, actor, new Date()),
            CANCELLATION_RESULT_MOMENTS,
            this.zone(),
        );
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

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
        return requireTenantUserId(req, this.auditResolvers());
    }

    private buildActor(req: RequestLike, userId: string): AdminActor {
        return tenantActorOf(req, userId, this.auditResolvers());
    }

    private resolveUserEmail(req: RequestLike): string | null {
        return tenantUserEmailOf(req, this.auditResolvers());
    }

    private auditResolvers(): TenantAuditResolvers {
        return {
            userId: this.userIdResolver,
            email: this.userEmailResolver,
            context: this.auditContextResolver,
        };
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
        if (wasTrial) return;
        await freezeContractAfter(
            this.contractFreeze,
            tenantId,
            { plan, cycle, effectiveFrom: new Date(), endsAt },
            'plan change',
            this.logger,
        );
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
