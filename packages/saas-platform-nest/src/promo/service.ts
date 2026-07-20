import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
    BillingCycle,
    CreatePromoCodeData,
    FirstTimeCustomerCheck,
    PlanCatalog,
    PromoCodeFilter,
    PromoCodeRecord,
    PromoCodeRedemptionListItem,
    PromoCodeRedemptionRecord,
    PromoCodeRedemptionRepository,
    PromoCodeRepository,
    PromoCodeValidationLogRepository,
    PromoRevenueDeductionAggregator,
    PromoSubscriptionLookup,
    TransactionContext,
    TransactionRunner,
    UpdatePromoCodeData,
} from '@saasicat/types';
import { PLAN_CATALOG_TOKEN } from '../billing/plan-catalog.module.js';
import { getPlanPriceGross } from '../billing/plan-helpers.js';
import {
    PROMO_CODE_REDEMPTION_REPOSITORY_TOKEN,
    PROMO_CODE_REPOSITORY_TOKEN,
    PROMO_CODE_VALIDATION_LOG_REPOSITORY_TOKEN,
    PROMO_FIRST_TIME_CUSTOMER_CHECK_TOKEN,
    PROMO_REVENUE_DEDUCTION_AGGREGATOR_TOKEN,
    PROMO_SERVICE_CONFIG_TOKEN,
    PROMO_SUBSCRIPTION_LOOKUP_TOKEN,
    PROMO_TRANSACTION_RUNNER_TOKEN,
} from './tokens.js';
import {
    buildLabel,
    computeDiscountGross,
    computeDiscountedGross,
    computeRegularStartsAt,
} from './calculator.js';
import { computeIncludedVat } from './math.js';

const CODE_PATTERN = /^[A-Z0-9_-]{4,32}$/;

export type PreviewReason =
    | 'NOT_FOUND'
    | 'EXPIRED'
    | 'EXHAUSTED'
    | 'PAUSED'
    | 'PLAN_MISMATCH'
    | 'BILLING_MISMATCH'
    | 'BELOW_MINIMUM_AMOUNT'
    | 'WOULD_PRODUCE_ZERO_INVOICE'
    | 'NOT_FIRST_TIME_CUSTOMER'
    | 'RATE_LIMITED';

export type PreviewInvalid = { valid: false; reason: PreviewReason };

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

export interface RedeemInput {
    code: string;
    subscriptionId: string;
    tenantId: string;
    /** For the firstTimeCustomersOnly check in the final redeem path. */
    email?: string;
}

export interface PromoServiceConfig {
    /** Plans that are not discountable (e.g. 'ENTERPRISE'). */
    nonRedeemablePlans?: readonly string[];
}

export interface PromoCodeStats {
    code: PromoCodeRecord;
    validations: number;
    redemptions: { active: number; total: number; reversed: number; expired: number };
    /** Decimal-as-string ('0.00' if no aggregator is available). */
    revenueDeductionGross: string;
}

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
        @Inject(PLAN_CATALOG_TOKEN)
        private readonly planCatalog: PlanCatalog,
        @Inject(PROMO_SERVICE_CONFIG_TOKEN)
        private readonly config: PromoServiceConfig,
    ) {}

    // ─── ADMIN: Creation / Editing ─────────────────────────────────────────

    async create(input: CreatePromoCodeData): Promise<PromoCodeRecord> {
        const code = input.code.trim().toUpperCase();
        if (!CODE_PATTERN.test(code)) {
            throw new BadRequestException(
                'Code darf nur Großbuchstaben, Ziffern, „-" und „_" enthalten (4–32 Zeichen).',
            );
        }
        if (input.valueType === 'PERCENT') {
            if (!(input.value > 0 && input.value <= 100)) {
                throw new BadRequestException('Prozentsatz muss zwischen 0 und 100 liegen.');
            }
        } else if (!(input.value > 0)) {
            throw new BadRequestException('Betrag muss positiv sein.');
        }

        if (input.durationType === 'ONCE') {
            if (input.durationValue != null) {
                throw new BadRequestException(
                    'Bei einmaligem Rabatt darf keine Laufzeit gesetzt sein.',
                );
            }
        } else {
            const v = input.durationValue;
            if (v == null || v < 1 || v > 24) {
                throw new BadRequestException(
                    'Laufzeit ungültig (max. 24 Monate bzw. Abrechnungsperioden).',
                );
            }
        }

        if (input.validFrom && input.validUntil && input.validFrom >= input.validUntil) {
            throw new BadRequestException('Gültigkeits-Fenster ungültig.');
        }

        const plans = input.appliesToPlans ?? [];
        const blocked = this.config.nonRedeemablePlans ?? [];
        for (const p of plans) {
            if (blocked.includes(p)) {
                throw new BadRequestException(`${p}-Plan kann nicht rabattiert werden.`);
            }
        }

        if (input.minimumPlanAmountGross != null && input.minimumPlanAmountGross <= 0) {
            throw new BadRequestException('Mindest-Plan-Brutto muss positiv sein.');
        }

        if (input.valueType === 'ABSOLUTE' && !input.allowZeroInvoice) {
            const lowestApplicableGross = this.lowestApplicablePlanGross(plans);
            if (lowestApplicableGross != null && input.value >= lowestApplicableGross) {
                throw new BadRequestException(
                    'Bei Absolutbeträgen muss der Rabatt unter dem niedrigsten anwendbaren Plan-Preis liegen oder allowZeroInvoice aktiviert sein.',
                );
            }
        }

        const exists = await this.promoRepo.findByCode(code);
        if (exists) throw new BadRequestException('Code existiert bereits.');

        return this.promoRepo.create({ ...input, code });
    }

    async update(id: string, input: UpdatePromoCodeData): Promise<PromoCodeRecord> {
        const existing = await this.promoRepo.findById(id);
        if (!existing) throw new NotFoundException('Code nicht gefunden');

        if (input.maxRedemptions != null && existing.maxRedemptions != null) {
            if (input.maxRedemptions < existing.maxRedemptions) {
                throw new BadRequestException('maxRedemptions kann nicht gesenkt werden.');
            }
        }

        return this.promoRepo.update(id, input);
    }

    async softDelete(id: string): Promise<void> {
        const redemptions = await this.redemptionRepo.countByPromoCode(id);
        if (redemptions > 0) {
            throw new BadRequestException(
                'Code hat bereits Einlösungen — Soft-Delete nicht möglich. Stattdessen pausieren.',
            );
        }
        await this.promoRepo.softDelete(id);
    }

    async findAll(filter: PromoCodeFilter = {}): Promise<PromoCodeRecord[]> {
        await this.lazyExpire();
        return this.promoRepo.findMany(filter);
    }

    async findOne(id: string): Promise<PromoCodeRecord> {
        await this.lazyExpire();
        const code = await this.promoRepo.findById(id);
        if (!code || code.deletedAt) throw new NotFoundException('Code nicht gefunden');
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
            revenueDeductionGross,
        };
    }

    async listRedemptions(promoCodeId: string): Promise<PromoCodeRedemptionListItem[]> {
        return this.redemptionRepo.listByPromoCode(promoCodeId);
    }

    // ─── PUBLIC: Preview / Validation ──────────────────────────────────────

    async preview(input: PreviewInput): Promise<PreviewResult> {
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

        const promo = await this.promoRepo.findByCode(code);
        const reason =
            this.checkEligibility(promo, input) ??
            (await this.checkFirstTimeCustomer(promo, input.email));
        if (reason) {
            await this.validationLogRepo.log({
                promoCodeId: promo?.id ?? null,
                codeAttempt: code,
                result: reason,
                ipHash: input.ipHash,
                sessionId: input.sessionId,
            });
            return { valid: false, reason };
        }

        const planGross = getPlanPriceGross(this.planCatalog, input.planId, input.billingCycle)!;
        const discountGross = Math.min(
            computeDiscountGross({ gross: planGross }, promo!),
            planGross,
        );
        const discountedGross = computeDiscountedGross(planGross, discountGross);
        const includedVat = computeIncludedVat(discountedGross, this.planCatalog.vatRate);

        if (!promo!.allowZeroInvoice && discountedGross <= 0) {
            await this.validationLogRepo.log({
                promoCodeId: promo!.id,
                codeAttempt: code,
                result: 'WOULD_PRODUCE_ZERO_INVOICE',
                ipHash: input.ipHash,
                sessionId: input.sessionId,
            });
            return { valid: false, reason: 'WOULD_PRODUCE_ZERO_INVOICE' };
        }

        const startsAt = new Date();
        const regularStartsAt = computeRegularStartsAt(
            startsAt,
            input.billingCycle,
            promo!.durationType,
            promo!.durationValue,
        );

        await this.validationLogRepo.log({
            promoCodeId: promo!.id,
            codeAttempt: code,
            result: 'VALID',
            ipHash: input.ipHash,
            sessionId: input.sessionId,
        });

        return {
            valid: true,
            code: promo!.code,
            label: buildLabel(promo!, input.billingCycle),
            discount: {
                valueType: promo!.valueType,
                value: Number(promo!.value).toFixed(2),
                durationType: promo!.durationType,
                durationValue: promo!.durationValue,
            },
            price: {
                originalGross: planGross.toFixed(2),
                discountGross: discountGross.toFixed(2),
                discountedGross: discountedGross.toFixed(2),
                includedVat: includedVat.toFixed(2),
                nextRegularAmountGross: planGross.toFixed(2),
                regularStartsAt: regularStartsAt ? regularStartsAt.toISOString() : null,
            },
        };
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
     */
    async redeemInTransaction(
        input: RedeemInput,
        tx: TransactionContext,
    ): Promise<PromoCodeRedemptionRecord> {
        const code = input.code.trim().toUpperCase();

        const promo = await this.promoRepo.findByCode(code, tx);
        if (!promo || promo.deletedAt) {
            throw new BadRequestException('Code nicht gefunden');
        }

        const sub = await this.subscriptionLookup.findById(input.subscriptionId, tx);
        if (!sub) throw new NotFoundException('Subscription nicht gefunden');
        if (sub.tenantId !== input.tenantId) {
            throw new BadRequestException('Subscription gehört nicht zum Tenant');
        }

        const reason = this.checkEligibility(promo, {
            code,
            planId: sub.plan,
            billingCycle: sub.billingCycle,
        });
        if (reason) throw new BadRequestException(`Code nicht einlösbar: ${reason}`);

        const firstTimeReason = await this.checkFirstTimeCustomer(promo, input.email, {
            requireEmail: true,
        });
        if (firstTimeReason) {
            throw new BadRequestException(`Code nicht einlösbar: ${firstTimeReason}`);
        }

        const claimed = await this.promoRepo.claimSlot(promo.id, tx);
        if (!claimed) {
            throw new BadRequestException('Code nicht einlösbar: EXHAUSTED');
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
                appliedValue: promo.value,
                appliedDurationType: promo.durationType,
                appliedDurationValue: promo.durationValue,
                startsAt,
                endsAt,
            },
            tx,
        );
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

    private checkEligibility(
        promo: PromoCodeRecord | null,
        input: { code: string; planId: string; billingCycle: BillingCycle; email?: string },
    ): PreviewReason | null {
        if (!promo || promo.deletedAt) return 'NOT_FOUND';
        if (promo.status === 'EXPIRED') return 'EXPIRED';
        if (promo.status === 'EXHAUSTED') return 'EXHAUSTED';
        if (promo.status === 'PAUSED') return 'PAUSED';

        const now = new Date();
        if (promo.validFrom && promo.validFrom > now) return 'EXPIRED';
        if (promo.validUntil && promo.validUntil < now) return 'EXPIRED';

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

        const planGross = getPlanPriceGross(this.planCatalog, input.planId, input.billingCycle);
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
     * Lowest applicable plan price. With a whitelist it takes the minimum
     * from the whitelist, otherwise across all marketed plans of the catalog
     * (except non-redeemable).
     */
    private lowestApplicablePlanGross(plans: readonly string[]): number | null {
        const blocked = new Set(this.config.nonRedeemablePlans ?? []);
        const candidates: readonly string[] =
            plans.length > 0
                ? plans
                : (this.planCatalog.plans ?? [])
                      .filter((p) => p.marketed !== false && !blocked.has(p.id))
                      .map((p) => p.id);
        let min: number | null = null;
        for (const p of candidates) {
            const g = getPlanPriceGross(this.planCatalog, p, 'MONTHLY');
            if (g == null) continue;
            if (min == null || g < min) min = g;
        }
        return min;
    }
}
