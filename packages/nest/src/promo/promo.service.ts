import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
    Optional,
} from '@nestjs/common';
import type {
    BillingCycle,
    CreatePromoCodeData,
    FirstTimeCustomerCheck,
    PlanCatalog,
    PromoCodeFilter,
    PromoCodeHoldRepository,
    PromoCodeRecord,
    PromoCodeRedemptionListItem,
    PromoCodeRedemptionRecord,
    PromoCodeRedemptionRepository,
    PromoCodeRepository,
    PromoCodeValidationLogRepository,
    PromoPreviewInvalidReason,
    PromoRevenueDeductionAggregator,
    PromoSubscriptionLookup,
    TransactionContext,
    TransactionRunner,
    UpdatePromoCodeData,
} from '@saasicat/core';
import { BILLING_ERROR_CODES, CONTRACT_ERROR_CODES, PROMO_ERROR_CODES } from '@saasicat/core';
import { PLAN_CATALOG_SOURCE_TOKEN } from '../billing/plan-catalog.module.js';
import type { PlanCatalogSource } from '../billing/plan-catalog-source.js';
import { getPlanPriceGross } from '../billing/plan-helpers.js';
import {
    PROMO_CODE_HOLD_REPOSITORY_TOKEN,
    PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN,
    PROMO_CODE_REPOSITORY_TOKEN,
    PROMO_CODE_VALIDATION_LOG_REPOSITORY_TOKEN,
    PROMO_FIRST_TIME_CUSTOMER_CHECK_TOKEN,
    PROMO_REVENUE_DEDUCTION_AGGREGATOR_TOKEN,
    PROMO_SERVICE_CONFIG_TOKEN,
    PROMO_SUBSCRIPTION_LOOKUP_TOKEN,
    PROMO_TRANSACTION_RUNNER_TOKEN,
} from './promo.tokens.js';
import { buildLabel, computeRegularStartsAt } from './calculator.js';
import {
    ALL_TERMS,
    appliedValue,
    assertCodeTerms,
    type CodeRuleContext,
    type CodeTermField,
    type CodeTerms,
    discountOnPlan,
} from './code-rules.js';
import { computeIncludedVat, netFromGross } from './math.js';

export const CODE_MIN_LENGTH = 4;
export const CODE_MAX_LENGTH = 32;
// One literal, with the two bounds repeated in it: a pattern assembled from
// the constants is what the lint refuses, and `promo-code-pattern.test.js`
// holds the literal to the constants so they cannot drift apart.
export const CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/;

/** How often a hold is tried again when a concurrent call for the same offer took its slot. */
const HOLD_ATTEMPTS = 2;

export type PreviewReason = PromoPreviewInvalidReason;

/**
 * The reason travels as a `params` field so consumers can translate it —
 * appending it to the message keeps the developer-facing text readable.
 */
function notRedeemable(reason: PromoPreviewInvalidReason): BadRequestException {
    return new BadRequestException({
        code: PROMO_ERROR_CODES.PROMO_CODE_NOT_REDEEMABLE,
        message: `Code cannot be redeemed: ${reason}`,
        params: { reason },
    });
}

export type PreviewInvalid = { valid: false; reason: PreviewReason };

/** A code as it was applied to a subscription when it was redeemed. */
export interface RedeemedPromoCode {
    code: string;
    valueType: PromoCodeRecord['valueType'];
    /** Decimal-as-string, as the redemption recorded it. */
    value: string;
    durationType: PromoCodeRecord['durationType'];
    durationValue: number | null;
    redeemedAt: Date;
}

export interface PreviewValid {
    valid: true;
    code: string;
    label: string;
    discount: {
        valueType: PromoCodeRecord['valueType'];
        value: string;
        durationType: PromoCodeRecord['durationType'];
        durationValue: number | null;
    };
    price: {
        originalGross: string;
        discountGross: string;
        discountNet: string;
        discountedGross: string;
        includedVat: string;
        nextRegularAmountGross: string;
        regularStartsAt: string | null;
    };
}

export type PreviewResult = PreviewValid | PreviewInvalid;

export interface PreviewInput {
    code: string;
    planId: string;
    billingCycle: BillingCycle;
    /** For the firstTimeCustomersOnly check. */
    email?: string;
    ipHash?: string;
    sessionId?: string;
}

export interface PreviewOptions {
    /**
     * The checkout offer the code is priced for. A live slot that offer holds
     * is its own and is not counted against it.
     */
    checkoutOfferId?: string;
    /**
     * The offer is priced as it is concluded: its live slot also keeps the
     * code's state as it was when the slot was taken, so a code paused or past
     * its validity since is still accepted for the checkout that holds it.
     */
    concluding?: boolean;
}

export interface RedeemInput {
    code: string;
    subscriptionId: string;
    tenantId: string;
    /** For the firstTimeCustomersOnly check in the final redeem path. */
    email?: string;
}

/** A slot of a code to hold for a checkout. */
export interface CheckoutHoldInput {
    /** The checkout offer the slot is held for; it holds one at most. */
    checkoutOfferId: string;
    code: string;
    planId: string;
    billingCycle: BillingCycle;
    /** For the firstTimeCustomersOnly check. */
    email?: string;
    /** When the checkout expires, and with it the hold. */
    until: Date;
}

export interface PromoServiceConfig {
    /** Plans that are not discountable (e.g. 'ENTERPRISE'). */
    nonRedeemablePlans?: readonly string[];
}

export interface PromoCodeStats {
    code: PromoCodeRecord;
    validations: number;
    redemptions: { active: number; total: number; reversed: number; expired: number };
    /** Slots held for checkouts that have not concluded, which no one else can take. */
    held: number;
    /** Decimal-as-string ('0.00' if no aggregator is available). */
    revenueDeductionGross: string;
}

/** How a code is judged: for whom, and what has been settled already. */
interface JudgeOptions {
    /** The caller's checkout holds a live slot: the code's state is as it was when taken. */
    held?: boolean;
    /** The caller's checkout holds a slot of this code, so it is not counted against it. */
    ownSlot?: boolean;
    /** Whether a full code refuses here; a redemption leaves that to `claimSlot`. */
    countSlots: boolean;
    /** A first-time-only code without an address is refused rather than let through. */
    requireEmail?: boolean;
}

type Verdict =
    | { reason: PreviewReason }
    | {
          reason: null;
          promo: PromoCodeRecord;
          catalog: PlanCatalog;
          planGross: number;
          discount: ReturnType<typeof discountOnPlan>;
      };

@Injectable()
export class PromoCodesService {
    constructor(
        @Inject(PROMO_CODE_REPOSITORY_TOKEN)
        private readonly promoRepo: PromoCodeRepository,
        @Inject(PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN)
        private readonly redemptionRepo: PromoCodeRedemptionRepository,
        @Inject(PROMO_CODE_VALIDATION_LOG_REPOSITORY_TOKEN)
        private readonly validationLogRepo: PromoCodeValidationLogRepository,
        @Inject(PROMO_FIRST_TIME_CUSTOMER_CHECK_TOKEN)
        private readonly firstTimeCheck: FirstTimeCustomerCheck,
        @Inject(PROMO_SUBSCRIPTION_LOOKUP_TOKEN)
        private readonly subscriptionLookup: PromoSubscriptionLookup,
        @Inject(PROMO_REVENUE_DEDUCTION_AGGREGATOR_TOKEN)
        private readonly revenueAggregator: PromoRevenueDeductionAggregator,
        @Inject(PROMO_TRANSACTION_RUNNER_TOKEN)
        private readonly transactionRunner: TransactionRunner,
        @Inject(PLAN_CATALOG_SOURCE_TOKEN)
        private readonly planCatalogs: PlanCatalogSource,
        @Inject(PROMO_SERVICE_CONFIG_TOKEN)
        private readonly config: PromoServiceConfig,
        // Optional: an adapter without holds has none, and `holdForCheckout`
        // then refuses rather than holding nothing.
        @Optional()
        @Inject(PROMO_CODE_HOLD_REPOSITORY_TOKEN)
        private readonly holds: PromoCodeHoldRepository | null = null,
    ) {}

    // ─── ADMIN: Creation / Editing ─────────────────────────────────────────

    async create(input: CreatePromoCodeData): Promise<PromoCodeRecord> {
        const code = input.code.trim().toUpperCase();
        if (!CODE_PATTERN.test(code)) {
            throw new BadRequestException({
                code: PROMO_ERROR_CODES.PROMO_CODE_FORMAT_INVALID,
                message:
                    'The code may only contain upper-case letters, digits, "-" and "_" (4–32 characters).',
                params: {
                    promoCode: code,
                    minLength: CODE_MIN_LENGTH,
                    maxLength: CODE_MAX_LENGTH,
                },
            });
        }
        await assertCodeTerms(
            {
                valueType: input.valueType,
                value: input.value,
                durationType: input.durationType,
                durationValue: input.durationValue ?? null,
                validFrom: input.validFrom ?? null,
                validUntil: input.validUntil ?? null,
                appliesToPlans: input.appliesToPlans ?? [],
                minimumPlanAmountGross: input.minimumPlanAmountGross ?? null,
                allowZeroInvoice: input.allowZeroInvoice ?? false,
            },
            ALL_TERMS,
            this.ruleContext(),
        );

        const exists = await this.promoRepo.findByCode(code);
        if (exists) {
            throw new BadRequestException({
                code: PROMO_ERROR_CODES.PROMO_CODE_ALREADY_EXISTS,
                message: 'The code already exists.',
                params: { promoCode: code },
            });
        }

        return this.promoRepo.create({ ...input, code });
    }

    /**
     * Changes a code under the rules a new one is held to, asking the rules the
     * named fields bear on: the terms as they stand after the change have to be
     * ones `create` would accept. Pausing alone is always possible.
     */
    async update(id: string, input: UpdatePromoCodeData): Promise<PromoCodeRecord> {
        const existing = await this.promoRepo.findById(id);
        if (!existing) {
            throw new NotFoundException({
                code: PROMO_ERROR_CODES.PROMO_CODE_NOT_FOUND,
                message: 'Code not found',
                params: { promoCodeId: id, promoCode: null },
            });
        }

        if (input.maxRedemptions != null && existing.maxRedemptions != null) {
            if (input.maxRedemptions < existing.maxRedemptions) {
                throw new BadRequestException({
                    code: PROMO_ERROR_CODES.PROMO_MAX_REDEMPTIONS_LOWERED,
                    message: 'maxRedemptions cannot be lowered.',
                    params: {
                        current: existing.maxRedemptions,
                        requested: input.maxRedemptions,
                    },
                });
            }
        }

        const changed = new Set(
            (Object.keys(input) as CodeTermField[]).filter((field) => input[field] !== undefined),
        );
        await assertCodeTerms(termsAfter(existing, input), changed, this.ruleContext());

        return this.promoRepo.update(id, input);
    }

    async softDelete(id: string): Promise<void> {
        const redemptions = await this.redemptionRepo.countByPromoCode(id);
        const held = await this.liveHeldCount(id);
        if (redemptions > 0 || held > 0) {
            throw new BadRequestException({
                code: PROMO_ERROR_CODES.PROMO_CODE_HAS_REDEMPTIONS,
                message:
                    'The code already has redemptions, or checkouts holding one — it cannot be soft-deleted. Pause it instead.',
                params: { promoCodeId: id, redemptions, held },
            });
        }
        await this.promoRepo.softDelete(id);
    }

    async findAll(filter: PromoCodeFilter = {}): Promise<PromoCodeRecord[]> {
        await this.lazyExpire();
        await this.holds?.expireDue(new Date());
        return this.promoRepo.findMany(filter);
    }

    async findOne(id: string): Promise<PromoCodeRecord> {
        await this.lazyExpire();
        await this.holds?.expireDue(new Date(), id);
        const code = await this.promoRepo.findById(id);
        if (!code || code.deletedAt) {
            throw new NotFoundException({
                code: PROMO_ERROR_CODES.PROMO_CODE_NOT_FOUND,
                message: 'Code not found',
                params: { promoCodeId: id, promoCode: null },
            });
        }
        return code;
    }

    async stats(id: string): Promise<PromoCodeStats> {
        const code = await this.findOne(id);
        const [active, total, reversed, expired, validations, revenueDeductionGross] =
            await Promise.all([
                this.redemptionRepo.countByPromoCode(id, 'ACTIVE'),
                this.redemptionRepo.countByPromoCode(id),
                this.redemptionRepo.countByPromoCode(id, 'REVERSED'),
                this.redemptionRepo.countByPromoCode(id, 'EXPIRED'),
                this.validationLogRepo.countValid(id),
                this.revenueAggregator.sumGrossForPromoCode(id),
            ]);
        return {
            code,
            validations,
            redemptions: { active, total, reversed, expired },
            held: code.heldCount,
            revenueDeductionGross,
        };
    }

    async listRedemptions(promoCodeId: string): Promise<PromoCodeRedemptionListItem[]> {
        return this.redemptionRepo.listByPromoCode(promoCodeId);
    }

    // ─── PUBLIC: Preview / Validation ──────────────────────────────────────

    async preview(input: PreviewInput, options: PreviewOptions = {}): Promise<PreviewResult> {
        const code = input.code.trim().toUpperCase();
        if (!CODE_PATTERN.test(code)) {
            await this.validationLogRepo.log({
                promoCodeId: null,
                codeAttempt: code,
                result: 'NOT_FOUND',
                ipHash: input.ipHash,
                sessionId: input.sessionId,
            });
            return { valid: false, reason: 'NOT_FOUND' };
        }

        await this.lazyExpire();

        const now = new Date();
        const promo = await this.findWithLiveHolds(code, now);
        const ownSlot =
            promo !== null &&
            options.checkoutOfferId !== undefined &&
            (await this.holdsLiveSlot(options.checkoutOfferId, promo, now));
        const verdict = await this.judge(promo, input, {
            ownSlot,
            held: ownSlot && options.concluding === true,
            countSlots: true,
        });
        await this.validationLogRepo.log({
            promoCodeId: promo?.id ?? null,
            codeAttempt: code,
            result: verdict.reason ?? 'VALID',
            ipHash: input.ipHash,
            sessionId: input.sessionId,
        });
        if (verdict.reason !== null) return { valid: false, reason: verdict.reason };

        const { catalog, planGross, discount } = verdict;
        const regularStartsAt = computeRegularStartsAt(
            now,
            input.billingCycle,
            verdict.promo.durationType,
            verdict.promo.durationValue,
        );
        return {
            valid: true,
            code: verdict.promo.code,
            label: buildLabel(verdict.promo, input.billingCycle),
            discount: {
                valueType: verdict.promo.valueType,
                value: Number(verdict.promo.value).toFixed(2),
                durationType: verdict.promo.durationType,
                durationValue: verdict.promo.durationValue,
            },
            price: {
                originalGross: planGross.toFixed(2),
                discountGross: discount.discountGross.toFixed(2),
                discountNet: netFromGross(discount.discountGross, catalog.vatRate).toFixed(2),
                discountedGross: discount.discountedGross.toFixed(2),
                includedVat: computeIncludedVat(discount.discountedGross, catalog.vatRate).toFixed(
                    2,
                ),
                nextRegularAmountGross: planGross.toFixed(2),
                regularStartsAt: regularStartsAt ? regularStartsAt.toISOString() : null,
            },
        };
    }

    // ─── Checkout: a slot held until the conclusion ────────────────────────

    /**
     * Holds a slot of the code for a checkout offer until `until`, after every
     * check a preview makes — so a customer who reaches the payment form keeps
     * the code however many others redeem it meanwhile. Starting the same
     * checkout again moves the expiry of the slot it holds rather than taking a
     * second — later, never earlier (`PromoCodeHoldRepository.extend`); a
     * checkout that held another code gives that one back.
     *
     * Refused with `PROMO_CODE_NOT_REDEEMABLE` and the reason a preview would
     * give, `EXHAUSTED` when every slot is redeemed or held — also when the
     * code changed between that check and taking the slot. Nothing is held
     * then, and a slot the offer held before stays with it until it expires.
     */
    async holdForCheckout(input: CheckoutHoldInput): Promise<void> {
        const holds = this.requireHolds();
        const offerId = input.checkoutOfferId;
        await this.lazyExpire();
        const promo = await this.findWithLiveHolds(input.code.trim().toUpperCase(), new Date());
        for (let attempt = 0; attempt < HOLD_ATTEMPTS; attempt += 1) {
            const own = await holds.findByCheckoutOffer(offerId);
            const ownSlot = own !== null && own.promoCodeId === promo?.id;
            // A checkout that holds a live slot of this code keeps the code as it
            // stood when the slot was taken, as its conclusion does: opening its
            // form again after the code was paused moves the slot, not refuses it.
            const held = ownSlot && own.expiresAt > new Date();
            const verdict = await this.judge(promo, input, {
                ownSlot,
                held,
                countSlots: true,
            });
            if (verdict.reason !== null) throw notRedeemable(verdict.reason);
            const promoCodeId = verdict.promo.id;

            if (ownSlot && (await holds.extend(offerId, promoCodeId, input.until))) return;
            if (own && !ownSlot) await holds.release(offerId);
            const taken = await holds.take({
                promoCodeId,
                checkoutOfferId: offerId,
                expiresAt: input.until,
            });
            if (taken.outcome === 'taken') return;
            if (taken.outcome === 'no-slot') throw notRedeemable(await this.whyNoSlot(promoCodeId));
            // 'offer-holds-one': a start of the same checkout took it a moment
            // ago. The next round finds that slot as this checkout's own.
        }
        throw new ConflictException({
            code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_CHANGED,
            message: `Checkout offer '${offerId}' changed while its promo code was being held. Load it again.`,
            params: { offerId },
        });
    }

    /** Gives back the slot a checkout offer holds, if it holds one. */
    async releaseCheckoutHold(checkoutOfferId: string, tx?: TransactionContext): Promise<void> {
        await this.holds?.release(checkoutOfferId, tx);
    }

    /**
     * Gives back the slot a checkout offer holds only while it still expires at
     * `expiresAt` — the hold as the caller wrote it. A slot another start of the
     * checkout moved since stays with the form that start opened.
     */
    async releaseCheckoutHoldIfUnmoved(checkoutOfferId: string, expiresAt: Date): Promise<void> {
        await this.holds?.releaseIfUnmoved(checkoutOfferId, expiresAt);
    }

    /**
     * Hands the offer's live hold to the redemption that runs on `tx`: redeeming
     * the code there takes the held slot instead of a free one, whatever
     * happened to the code since the hold was taken. The caller releases it
     * with `releaseCheckoutHold` on the same transaction once the redemption
     * had its chance — a hold the redemption did not take is not held any more.
     * False when the offer holds no live slot.
     */
    async handOverCheckoutHold(checkoutOfferId: string, tx: TransactionContext): Promise<boolean> {
        return (await this.holds?.handOver(checkoutOfferId, new Date(), tx)) ?? false;
    }

    // ─── Onboarding path: atomic redemption ────────────────────────────────

    /**
     * Wraps `redeemInTransaction` in its own transaction-runner call —
     * the default path when the caller has no external tx context
     * (e.g. POST /billing/promo/redeem as a stand-alone endpoint).
     */
    async redeem(input: RedeemInput): Promise<PromoCodeRedemptionRecord> {
        return this.transactionRunner.run((tx: TransactionContext) =>
            this.redeemInTransaction(input, tx),
        );
    }

    /**
     * Redeems a promo code within an EXTERNAL transaction — the caller
     * (typically `TenantSubscriptionWritePort.applyOnboardingSelection`)
     * already has `prisma.$transaction(...)` open and passes the `tx`
     * context through. This lands plan change, add-on insert, and redemption
     * insert in a single DB transaction (P10.1.1).
     *
     * A checkout that held a slot of the code, and whose conclusion handed it
     * over on this transaction, is redeemed on that slot: its state is not
     * asked again, and no free slot is taken. Otherwise a free one is claimed.
     * Either way the redemption is refused where a preview would refuse on the
     * price — an invoice of zero the code does not allow — and it records at
     * most the price it is redeemed against.
     */
    async redeemInTransaction(
        input: RedeemInput,
        tx: TransactionContext,
    ): Promise<PromoCodeRedemptionRecord> {
        const code = input.code.trim().toUpperCase();

        const promo = await this.promoRepo.findByCode(code, tx);
        if (!promo || promo.deletedAt) {
            throw new BadRequestException({
                code: PROMO_ERROR_CODES.PROMO_CODE_NOT_FOUND,
                // The lookup runs on the code string, so there is no id to report.
                message: 'Code not found',
                params: { promoCodeId: null, promoCode: code },
            });
        }

        const sub = await this.subscriptionLookup.findById(input.subscriptionId, tx);
        if (!sub) {
            throw new NotFoundException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
                message: 'Subscription not found',
                params: { tenantId: input.tenantId },
            });
        }
        if (sub.tenantId !== input.tenantId) {
            throw new BadRequestException({
                code: BILLING_ERROR_CODES.SUBSCRIPTION_TENANT_MISMATCH,
                message: 'Subscription does not belong to the tenant',
                params: { subscriptionId: sub.id, tenantId: input.tenantId },
            });
        }

        // Converted before the checks: a refusal below undoes it with the
        // transaction, and the hold is as it was.
        const held = (await this.holds?.convertHandedOver(promo.id, tx)) ?? false;
        const verdict = await this.judge(
            promo,
            { code, planId: sub.plan, billingCycle: sub.billingCycle, email: input.email },
            { held, countSlots: false, requireEmail: true },
        );
        if (verdict.reason !== null) throw notRedeemable(verdict.reason);

        if (!held) {
            await this.holds?.expireDue(new Date(), promo.id, tx);
            if (!(await this.promoRepo.claimSlot(promo.id, tx))) {
                throw notRedeemable('EXHAUSTED');
            }
        }
        await this.promoRepo.markExhaustedIfFull(promo.id, tx);

        const startsAt = sub.startedAt ?? new Date();
        const endsAt =
            promo.durationType === 'ONCE'
                ? null
                : computeRegularStartsAt(
                      startsAt,
                      sub.billingCycle,
                      promo.durationType,
                      promo.durationValue,
                  );

        return this.redemptionRepo.create(
            {
                promoCodeId: promo.id,
                subscriptionId: sub.id,
                tenantId: sub.tenantId,
                appliedValueType: promo.valueType,
                appliedValue: appliedValue(promo, verdict.planGross),
                appliedDurationType: promo.durationType,
                appliedDurationValue: promo.durationValue,
                startsAt,
                endsAt,
            },
            tx,
        );
    }

    /**
     * The code redeemed for a subscription, with the values it was redeemed
     * at, unless the redemption was reversed — or null.
     *
     * An expired redemption still counts. Its term is counted from the
     * subscription's start, which lies before a trial, while a contract counts
     * a discount from the first period that is paid: a code for one month
     * redeemed in a thirty-day trial has expired before the customer has paid
     * for anything. A code deleted since still names what was agreed, so it is
     * read without the refusal `findOne` gives.
     */
    async redeemedCodeFor(subscriptionId: string): Promise<RedeemedPromoCode | null> {
        const redemption = await this.redemptionRepo.findBySubscription(subscriptionId);
        if (!redemption || redemption.status === 'REVERSED') return null;
        const promo = await this.promoRepo.findById(redemption.promoCodeId);
        if (!promo) return null;
        return {
            code: promo.code,
            valueType: redemption.appliedValueType,
            value: redemption.appliedValue,
            durationType: redemption.appliedDurationType,
            durationValue: redemption.appliedDurationValue,
            redeemedAt: redemption.redeemedAt,
        };
    }

    async reverse(subscriptionId: string): Promise<PromoCodeRedemptionRecord | null> {
        return this.transactionRunner.run(async (tx: TransactionContext) => {
            const redemption = await this.redemptionRepo.findBySubscription(subscriptionId, tx);
            if (!redemption || redemption.status !== 'ACTIVE') return redemption;

            const updated = await this.redemptionRepo.setReversed(redemption.id, tx);
            await this.promoRepo.releaseSlot(redemption.promoCodeId, tx);
            return updated;
        });
    }

    // ─── Helpers ───────────────────────────────────────────────────────────

    /**
     * Why a code does not apply to a plan, or what it takes off it. The plans
     * are read only once the code itself has passed, so somebody trying codes
     * that do not exist costs no read of the plan tables.
     */
    private async judge(
        promo: PromoCodeRecord | null,
        input: { code: string; planId: string; billingCycle: BillingCycle; email?: string },
        options: JudgeOptions,
    ): Promise<Verdict> {
        const refused = this.checkCode(promo, input, options);
        if (refused) return { reason: refused };
        const found = promo as PromoCodeRecord;
        const catalog = await this.planCatalogs.current();
        const reason =
            this.checkPlanPrice(found, input, catalog) ??
            (await this.checkFirstTimeCustomer(found, input.email, options));
        if (reason) return { reason };
        const planGross = getPlanPriceGross(catalog, input.planId, input.billingCycle) as number;
        const discount = discountOnPlan(found, planGross);
        if (discount.zeroInvoice) return { reason: 'WOULD_PRODUCE_ZERO_INVOICE' };
        return { reason: null, promo: found, catalog, planGross, discount };
    }

    /** Everything about a code that needs no plan price: its state, its slots, and the plans it fits. */
    private checkCode(
        promo: PromoCodeRecord | null,
        input: { planId: string; billingCycle: BillingCycle },
        options: JudgeOptions,
    ): PreviewReason | null {
        if (!promo || promo.deletedAt) return 'NOT_FOUND';
        if (!options.held) {
            const state =
                this.checkState(promo) ??
                (options.countSlots ? checkFreeSlot(promo, options.ownSlot === true) : null);
            if (state) return state;
        }
        const blocked = this.config.nonRedeemablePlans ?? [];
        if (blocked.includes(input.planId)) {
            return 'PLAN_MISMATCH';
        }
        if (promo.appliesToPlans.length > 0 && !promo.appliesToPlans.includes(input.planId)) {
            return 'PLAN_MISMATCH';
        }
        if (promo.appliesToBilling && promo.appliesToBilling !== input.billingCycle) {
            return 'BILLING_MISMATCH';
        }
        return null;
    }

    /** Whether the code can be used now at all: its status and its validity window. */
    private checkState(promo: PromoCodeRecord): PreviewReason | null {
        if (promo.status === 'EXPIRED') return 'EXPIRED';
        if (promo.status === 'EXHAUSTED') return 'EXHAUSTED';
        if (promo.status === 'PAUSED') return 'PAUSED';

        const now = new Date();
        if (promo.validFrom && promo.validFrom > now) return 'EXPIRED';
        if (promo.validUntil && promo.validUntil < now) return 'EXPIRED';
        return null;
    }

    /** Whether the plan is sold at a price in this rhythm, and one the code's minimum allows. */
    private checkPlanPrice(
        promo: PromoCodeRecord,
        input: { planId: string; billingCycle: BillingCycle },
        catalog: PlanCatalog,
    ): PreviewReason | null {
        const planGross = getPlanPriceGross(catalog, input.planId, input.billingCycle);
        if (planGross == null) return 'PLAN_MISMATCH';

        if (promo.minimumPlanAmountGross && planGross < Number(promo.minimumPlanAmountGross)) {
            return 'BELOW_MINIMUM_AMOUNT';
        }

        return null;
    }

    private async checkFirstTimeCustomer(
        promo: PromoCodeRecord | null,
        email?: string,
        options: { requireEmail?: boolean } = {},
    ): Promise<PreviewReason | null> {
        if (!promo || !promo.firstTimeCustomersOnly) return null;
        if (!email) return options.requireEmail ? 'NOT_FIRST_TIME_CUSTOMER' : null;
        const existing = await this.firstTimeCheck.hasExistingCustomerForEmail(email);
        return existing ? 'NOT_FIRST_TIME_CUSTOMER' : null;
    }

    /**
     * Lazy expiry: sets codes whose validUntil has passed to EXPIRED.
     * Called before every find/preview — defense-in-depth alongside the cron.
     */
    private async lazyExpire(): Promise<void> {
        const now = new Date();
        await this.promoRepo.expireDueCodes(now);
        await this.redemptionRepo.expireDueRedemptions(now);
    }

    /**
     * The code with the slots of its expired holds given back, so that what
     * it counts as held is what is held now. One code at a time: this runs on
     * every preview, and a sweep of one code locks one row.
     */
    private async findWithLiveHolds(code: string, now: Date): Promise<PromoCodeRecord | null> {
        const promo = await this.promoRepo.findByCode(code);
        if (!promo || !this.holds) return promo;
        const ended = await this.holds.expireDue(now, promo.id);
        return ended > 0 ? this.promoRepo.findByCode(code) : promo;
    }

    /**
     * Why a code the checks passed a moment ago had no slot to take: it may
     * have been paused, deleted or run past its validity in between, and a
     * refusal that says "exhausted" for any of them misleads the customer and
     * the log a support answer is built on.
     */
    private async whyNoSlot(promoCodeId: string): Promise<PreviewReason> {
        const now = await this.promoRepo.findById(promoCodeId);
        if (!now || now.deletedAt) return 'NOT_FOUND';
        return this.checkState(now) ?? 'EXHAUSTED';
    }

    /** Whether the checkout offer holds a slot of this code that has not expired. */
    private async holdsLiveSlot(
        checkoutOfferId: string,
        promo: PromoCodeRecord,
        now: Date,
    ): Promise<boolean> {
        const hold = await this.holds?.findByCheckoutOffer(checkoutOfferId);
        return hold != null && hold.promoCodeId === promo.id && hold.expiresAt > now;
    }

    /** The slots of a code held right now, its expired holds given back first. */
    private async liveHeldCount(promoCodeId: string): Promise<number> {
        if (!this.holds) return 0;
        await this.holds.expireDue(new Date(), promoCodeId);
        return (await this.promoRepo.findById(promoCodeId))?.heldCount ?? 0;
    }

    private requireHolds(): PromoCodeHoldRepository {
        if (!this.holds) {
            throw new Error(
                'Holding a promo code for a checkout needs a PromoCodeHoldRepository: the shipped ' +
                    'persistence bundles provide one as `promo.holdRepository`; pass it to ' +
                    'PromoCodesModule.forRoot as `holdRepository` when wiring the module by hand.',
            );
        }
        return this.holds;
    }

    private ruleContext(): CodeRuleContext {
        return {
            nonRedeemablePlans: this.config.nonRedeemablePlans ?? [],
            lowestApplicablePlanGross: async (plans) =>
                this.lowestApplicablePlanGross(await this.planCatalogs.current(), plans),
        };
    }

    /**
     * Lowest applicable plan price. With a whitelist it takes the minimum
     * from the whitelist, otherwise across all marketed plans of the catalog
     * (except non-redeemable).
     */
    private lowestApplicablePlanGross(
        catalog: PlanCatalog,
        plans: readonly string[],
    ): number | null {
        const blocked = new Set(this.config.nonRedeemablePlans ?? []);
        const candidates: readonly string[] =
            plans.length > 0
                ? plans
                : (catalog.plans ?? [])
                      .filter((p) => p.marketed !== false && !blocked.has(p.id))
                      .map((p) => p.id);
        let min: number | null = null;
        for (const p of candidates) {
            const g = getPlanPriceGross(catalog, p, 'MONTHLY');
            if (g == null) continue;
            if (min == null || g < min) min = g;
        }
        return min;
    }
}

/**
 * Whether every slot of a limited code is redeemed or held by somebody else.
 * The caller's own hold, when it has one, is its slot and not counted.
 */
function checkFreeSlot(promo: PromoCodeRecord, ownSlot: boolean): PreviewReason | null {
    if (promo.maxRedemptions == null) return null;
    const taken = promo.redemptionsCount + promo.heldCount - (ownSlot ? 1 : 0);
    return taken >= promo.maxRedemptions ? 'EXHAUSTED' : null;
}

/** The terms of a code as they stand once a change is applied to it. */
function termsAfter(existing: PromoCodeRecord, change: UpdatePromoCodeData): CodeTerms {
    const kept = <T>(changed: T | undefined, current: T): T =>
        changed !== undefined ? changed : current;
    return {
        valueType: kept(change.valueType, existing.valueType),
        value: kept(change.value, Number(existing.value)),
        durationType: kept(change.durationType, existing.durationType),
        durationValue: kept(change.durationValue, existing.durationValue),
        validFrom: kept(change.validFrom, existing.validFrom),
        validUntil: kept(change.validUntil, existing.validUntil),
        appliesToPlans: kept(change.appliesToPlans, existing.appliesToPlans),
        minimumPlanAmountGross: kept(
            change.minimumPlanAmountGross,
            existing.minimumPlanAmountGross == null
                ? null
                : Number(existing.minimumPlanAmountGross),
        ),
        allowZeroInvoice: kept(change.allowZeroInvoice, existing.allowZeroInvoice),
    };
}
