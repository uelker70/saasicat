// What an offer costs, computed from the catalogue.
//
// A caller chooses a plan, a rhythm, add-ons and perhaps a promo code; the
// amounts are worked out here. The plan price comes from the plan version on
// sale, an add-on's from its bundle version with the price it carries for that
// plan, the promotion is the one the public catalogue shows for the same key,
// language and rhythm, and a promo code is whatever the promo module accepts.
// Nothing a request says is an amount.
//
// The same computation runs again when an offer is consumed, over the plan and
// bundle versions the offer froze and the promotions as they stood when it was
// last priced. Published versions do not change, so an offer this code priced
// comes out the same; one whose stored amounts it did not produce does not, and
// is refused rather than turned into a contract.

import { Inject, Injectable, Optional, UnprocessableEntityException } from '@nestjs/common';
import type {
    BundleRepository,
    BundleVersionRow,
    CheckoutOfferLineItem,
    CheckoutOfferPriceBreakdown,
    CheckoutOfferPromoCodeSnapshot,
    CheckoutOfferPromotionSnapshot,
    CheckoutOfferRow,
    PlanCatalogSettings,
    PlanRepository,
    PlanVersionRow,
    PromotionRepository,
    PromotionRow,
} from '@saasicat/core';
import { CONTRACT_ERROR_CODES, promotionOnPrice } from '@saasicat/core';

import { resolveBundlePriceNet } from '../billing/bundle-price.js';
import { PLAN_CATALOG_SETTINGS_TOKEN } from '../billing/plan-catalog.module.js';
import {
    BUNDLE_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
    PROMOTION_REPOSITORY_TOKEN,
} from '../catalog/catalog.tokens.js';
import { promoCodeDiscountNet } from '../promo/calculator.js';
import { grossFromNet, round2 } from '../promo/math.js';
import { PromoCodesService } from '../promo/promo.service.js';
import { appendImplicitDiscountLineItem } from './discount-line-items.js';
import { bundleVersionNotBookableReason } from './bundle-version-bookable.js';

/** The language a promotion's texts fall back to, as the public catalogue reads them. */
const DEFAULT_LOCALE = 'de';

type Cycle = 'monthly' | 'yearly';

/** What pricing needs to know about a selection. */
export interface CheckoutOfferPricingInput {
    planKey: string;
    billingCycle: Cycle;
    bundleVersionIds: readonly string[];
    promoCode: string | null;
    locale: string;
    /**
     * The offer when it is priced again. A slot of its promo code held for its
     * checkout is its own, not counted against it.
     */
    checkoutOfferId?: string;
    /**
     * Priced as the offer is concluded: its held slot also keeps the code as it
     * stood when the slot was taken.
     */
    concluding?: boolean;
}

/** The part of a stored offer the server computes. */
export interface PricedCheckoutOffer {
    planVersionId: string;
    bundles: string[];
    bundleVersionIds: string[];
    promotionId: string | null;
    promoCode: string | null;
    priceBreakdown: CheckoutOfferPriceBreakdown;
    lineItems: CheckoutOfferLineItem[];
    promotionSnapshots: CheckoutOfferPromotionSnapshot[];
    promoCodeSnapshot: CheckoutOfferPromoCodeSnapshot | null;
}

/** A priced line before the discount, with the promotion it earns. */
interface PricedLine {
    line: CheckoutOfferLineItem;
    promotion: CheckoutOfferPromotionSnapshot | null;
}

@Injectable()
export class CheckoutOfferPricing {
    constructor(
        @Inject(PLAN_CATALOG_SETTINGS_TOKEN) private readonly settings: PlanCatalogSettings,
        @Inject(PLAN_REPOSITORY_TOKEN) private readonly plans: PlanRepository,
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository | null = null,
        @Optional()
        @Inject(PROMOTION_REPOSITORY_TOKEN)
        private readonly promotions: PromotionRepository | null = null,
        @Optional()
        @Inject(PromoCodesService)
        private readonly promoCodes: PromoCodesService | null = null,
    ) {}

    /** Prices a selection against the plan version on sale now. */
    async price(
        input: CheckoutOfferPricingInput,
        asOf: Date = new Date(),
    ): Promise<PricedCheckoutOffer> {
        const planVersion = await this.planVersionOnSale(input.planKey, input.billingCycle, asOf);
        const bundleVersions = await this.bundleVersionsFor(input, asOf, true);
        return this.compute(input, planVersion, bundleVersions, asOf);
    }

    /**
     * Throws unless the offer's stored amounts are what this pricing makes of
     * its own selection: the plan and bundle versions it froze, and the
     * promotions as they stood when it was last priced.
     */
    async assertPricedByCatalogue(offer: CheckoutOfferRow): Promise<void> {
        const notCurrent = () =>
            new UnprocessableEntityException({
                code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_PRICE_NOT_CURRENT,
                message: `The prices of checkout offer '${offer.id}' no longer match the catalogue; create a new offer.`,
                params: { offerId: offer.id },
            });
        if (!offer.planVersionId) throw notCurrent();
        const planVersion = await this.plans.findVersionById?.(offer.planVersionId);
        if (!planVersion || planVersion.planId !== offer.planKey) throw notCurrent();

        const input: CheckoutOfferPricingInput = {
            planKey: offer.planKey,
            billingCycle: offer.billingCycle,
            bundleVersionIds: offer.bundleVersionIds ?? [],
            promoCode: offer.promoCode,
            locale: offer.locale,
            checkoutOfferId: offer.id,
            concluding: true,
        };
        const pricedAt = new Date(offer.updatedAt);
        let repriced: PricedCheckoutOffer;
        try {
            this.assertPlanPriced(planVersion, input.billingCycle);
            const bundleVersions = await this.bundleVersionsFor(input, pricedAt, false);
            repriced = await this.compute(input, planVersion, bundleVersions, pricedAt);
        } catch (error) {
            // A code the promo module no longer accepts is its own answer: the
            // prices still match, and a customer told that they changed would
            // rebuild an offer that fails the same way.
            if (refusesThePromoCode(error)) throw error;
            if (error instanceof UnprocessableEntityException) throw notCurrent();
            throw error;
        }
        if (moneyOf(repriced) !== moneyOf(offer)) throw notCurrent();
    }

    private async compute(
        input: CheckoutOfferPricingInput,
        planVersion: PlanVersionRow,
        bundleVersions: BundleVersionRow[],
        asOf: Date,
    ): Promise<PricedCheckoutOffer> {
        const vatRate = this.settings.vatRate;
        const promotions = this.promotions ? await this.promotions.list() : [];
        const plan = await this.plans.findByKey(input.planKey);

        const planLine = this.pricePlan(input, planVersion, plan?.label, promotions, asOf);
        const bundleLines = bundleVersions.map((version) =>
            this.priceBundle(input, version, promotions, asOf),
        );
        const promotionSnapshots = [planLine, ...bundleLines]
            .map((priced) => priced.promotion)
            .filter((promotion): promotion is CheckoutOfferPromotionSnapshot => promotion !== null);

        const planNet = planLine.line.priceNet;
        const bundlesNet = round2(
            bundleLines.reduce((sum, priced) => sum + priced.line.priceNet, 0),
        );
        const regularNet = round2(planNet + bundlesNet);
        const promotionDiscount = round2(
            promotionSnapshots.reduce((sum, promotion) => sum + promotion.resolvedAmountNet, 0),
        );
        const planNetAfterPromotion = round2(
            planNet - (planLine.promotion?.resolvedAmountNet ?? 0),
        );
        const promoCodeSnapshot = await this.pricePromoCode(input, planNetAfterPromotion, vatRate);
        const effectiveNet = Math.max(
            0,
            round2(regularNet - promotionDiscount - (promoCodeSnapshot?.resolvedAmountNet ?? 0)),
        );

        const priceBreakdown: CheckoutOfferPriceBreakdown = {
            currency: this.settings.currency,
            billingCycle: input.billingCycle,
            planNet,
            bundlesNet,
            regularNet,
            effectiveNet,
            vatRate,
            effectiveGross: grossFromNet(effectiveNet, vatRate),
        };
        const lineItems = appendImplicitDiscountLineItem({
            billingCycle: input.billingCycle,
            priceBreakdown,
            lineItems: [planLine.line, ...bundleLines.map((priced) => priced.line)],
            promotionSnapshots,
            promoCodeSnapshot,
        });

        return {
            planVersionId: planVersion.id,
            bundles: bundleVersions.map((version) => version.bundleKey),
            bundleVersionIds: bundleVersions.map((version) => version.id),
            promotionId: planLine.promotion?.id ?? null,
            promoCode: promoCodeSnapshot?.code ?? null,
            priceBreakdown,
            lineItems,
            promotionSnapshots,
            promoCodeSnapshot,
        };
    }

    /** The plan version on sale for new bookings, as the public catalogue resolves it. */
    private async planVersionOnSale(
        planKey: string,
        billingCycle: Cycle,
        asOf: Date,
    ): Promise<PlanVersionRow> {
        const version =
            (await this.plans.findActivePlanVersion?.(planKey, asOf)) ??
            (this.plans.findActivePlanVersion
                ? null
                : await this.plans.findLatestLivePlanVersion?.(planKey));
        if (!version) throw planNotOffered(planKey, billingCycle);
        this.assertPlanPriced(version, billingCycle);
        return version;
    }

    /** A plan without a list price is not sold at one (`SC-PRIC-011`). */
    private assertPlanPriced(version: PlanVersionRow, billingCycle: Cycle): void {
        if (version.marketed === false || priceOf(version, billingCycle) === null) {
            throw planNotOffered(version.planId, billingCycle);
        }
    }

    private async bundleVersionsFor(
        input: CheckoutOfferPricingInput,
        asOf: Date,
        checkBookable: boolean,
    ): Promise<BundleVersionRow[]> {
        const ids = input.bundleVersionIds;
        if (ids.length === 0) return [];
        const out: BundleVersionRow[] = [];
        for (const [index, bundleVersionId] of ids.entries()) {
            if (ids.indexOf(bundleVersionId) !== index) {
                throw bundleNotOffered(bundleVersionId, 'duplicate');
            }
            const version = this.bundles
                ? await this.bundles.findVersionById(bundleVersionId)
                : null;
            if (!version) throw bundleNotOffered(bundleVersionId, 'missing');
            if (checkBookable) {
                const notBookable = bundleVersionNotBookableReason(version, asOf.getTime());
                if (notBookable) throw bundleNotOffered(bundleVersionId, notBookable);
                if (!version.marketed) throw bundleNotOffered(bundleVersionId, 'not_marketed');
            }
            const planKeys = version.compatibility?.planIds ?? [];
            if (planKeys.length > 0 && !planKeys.includes(input.planKey)) {
                throw bundleNotOffered(bundleVersionId, 'incompatible_with_plan');
            }
            if (
                resolveBundlePriceNet(version, input.planKey, wireCycle(input.billingCycle)) ===
                null
            ) {
                throw bundleNotOffered(bundleVersionId, 'not_priced');
            }
            out.push(version);
        }
        return out;
    }

    private pricePlan(
        input: CheckoutOfferPricingInput,
        version: PlanVersionRow,
        label: string | undefined,
        promotions: PromotionRow[],
        asOf: Date,
    ): PricedLine {
        const priceNet = priceOf(version, input.billingCycle) as number;
        return {
            line: this.line({
                kind: 'plan',
                sourceKey: input.planKey,
                sourceVersionId: version.id,
                title: label ?? input.planKey,
                priceNet,
                billingCycle: input.billingCycle,
                features: version.features ?? [],
                quotas: version.quotas ?? {},
            }),
            promotion: promotionFor(promotions, input.planKey, 'PLAN', input, priceNet, asOf),
        };
    }

    private priceBundle(
        input: CheckoutOfferPricingInput,
        version: BundleVersionRow,
        promotions: PromotionRow[],
        asOf: Date,
    ): PricedLine {
        const priceNet = resolveBundlePriceNet(
            version,
            input.planKey,
            wireCycle(input.billingCycle),
        ) as number;
        return {
            line: this.line({
                kind: 'bundle',
                sourceKey: version.bundleKey,
                sourceVersionId: version.id,
                title: version.label,
                priceNet,
                billingCycle: input.billingCycle,
                features: version.features ?? [],
                quotas: version.quotas ?? {},
            }),
            promotion: promotionFor(promotions, version.bundleKey, 'BUNDLE', input, priceNet, asOf),
        };
    }

    private line(fields: {
        kind: 'plan' | 'bundle';
        sourceKey: string;
        sourceVersionId: string;
        title: string;
        priceNet: number;
        billingCycle: Cycle;
        features: string[];
        quotas: Record<string, number>;
    }): CheckoutOfferLineItem {
        return {
            kind: fields.kind,
            sourceKey: fields.sourceKey,
            sourceVersionId: fields.sourceVersionId,
            titleSnapshot: fields.title,
            descriptionSnapshot: null,
            quantity: 1,
            unit: null,
            priceNet: fields.priceNet,
            priceGross: grossFromNet(fields.priceNet, this.settings.vatRate),
            billingCycle: fields.billingCycle,
            featuresSnapshot: [...fields.features],
            quotaEffectsSnapshot: { ...fields.quotas },
            metadata: null,
        };
    }

    /**
     * The promo code's discount on the plan, after its promotion.
     *
     * Eligibility is the promo module's to decide, and it decides on its own
     * terms: status, validity, the plan and rhythm the code is limited to. Only
     * the amount is computed here, on the price this offer actually carries.
     */
    private async pricePromoCode(
        input: CheckoutOfferPricingInput,
        planNet: number,
        vatRate: number,
    ): Promise<CheckoutOfferPromoCodeSnapshot | null> {
        if (!input.promoCode) return null;
        if (!this.promoCodes) throw promoCodeNotAccepted('PROMO_CODES_NOT_AVAILABLE');
        const preview = await this.promoCodes.preview(
            {
                code: input.promoCode,
                planId: input.planKey,
                billingCycle: wireCycle(input.billingCycle),
            },
            { checkoutOfferId: input.checkoutOfferId, concluding: input.concluding },
        );
        if (!preview.valid) throw promoCodeNotAccepted(preview.reason);

        const resolvedAmountNet = promoCodeDiscountNet(planNet, vatRate, preview.discount);
        return {
            code: preview.code,
            label: preview.label,
            valueType: preview.discount.valueType,
            value: Number(preview.discount.value),
            resolvedAmountNet,
            durationType: preview.discount.durationType,
            durationValue: preview.discount.durationValue,
        };
    }
}

/** The one promotion the public catalogue shows for this key, language and rhythm, as a snapshot. */
function promotionFor(
    promotions: PromotionRow[],
    targetKey: string,
    targetType: 'PLAN' | 'BUNDLE',
    input: CheckoutOfferPricingInput,
    priceNet: number,
    asOf: Date,
): CheckoutOfferPromotionSnapshot | null {
    const shown = promotionOnPrice(
        promotions,
        targetKey,
        input.locale,
        input.billingCycle,
        priceNet,
        asOf,
        targetType,
    );
    if (!shown) return null;
    const { promotion } = shown;
    const resolvedAmountNet = round2(Math.max(0, priceNet - shown.result.discounted));
    if (resolvedAmountNet <= 0) return null;
    const texts = promotion.i18n?.[input.locale] ?? promotion.i18n?.[DEFAULT_LOCALE] ?? {};
    return {
        id: promotion.id,
        type: promotion.type,
        value: promotion.value,
        label: texts.badge || promotion.internalLabel,
        resolvedAmountNet,
        appliesTo: [targetKey],
        billingCycle: promotion.billingCycle,
    };
}

/** The version's net price for the rhythm, or `null` when it carries none. */
function priceOf(version: PlanVersionRow, billingCycle: Cycle): number | null {
    const raw = billingCycle === 'yearly' ? version.yearlyNet : version.monthlyNet;
    if (raw === null || raw === undefined) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

/** The billing module spells rhythms in capitals; an offer spells them in lower case. */
function wireCycle(billingCycle: Cycle): 'MONTHLY' | 'YEARLY' {
    return billingCycle === 'yearly' ? 'YEARLY' : 'MONTHLY';
}

/**
 * Everything about an offer that decides what is charged, in a stable order.
 *
 * Titles and feature snapshots are left out: a bundle renamed after the offer
 * was made changes its label, not its price.
 */
function moneyOf(offer: {
    planVersionId: string | null;
    bundleVersionIds?: string[];
    promotionId: string | null;
    promoCode: string | null;
    priceBreakdown: CheckoutOfferPriceBreakdown;
    lineItems?: CheckoutOfferLineItem[];
    promotionSnapshots?: CheckoutOfferPromotionSnapshot[];
    promoCodeSnapshot?: CheckoutOfferPromoCodeSnapshot | null;
}): string {
    const b = offer.priceBreakdown;
    return JSON.stringify({
        planVersionId: offer.planVersionId,
        bundleVersionIds: offer.bundleVersionIds ?? [],
        promotionId: offer.promotionId,
        promoCode: offer.promoCode,
        breakdown: [
            b.currency,
            b.billingCycle,
            b.planNet,
            b.bundlesNet,
            b.regularNet,
            b.effectiveNet,
            b.vatRate,
            b.effectiveGross,
        ],
        // A line's gross is not compared: it is its share of the tax on the
        // total, derived from the nets and the breakdown compared here, and the
        // contract derives it again when it is written. So an offer whose stored
        // lines carry a gross rounded another way still concludes, rather than
        // being refused over a cent that moved between two of its lines.
        lines: (offer.lineItems ?? []).map((item) => [
            item.kind,
            item.sourceKey,
            item.sourceVersionId ?? null,
            item.quantity,
            item.priceNet,
            item.billingCycle,
        ]),
        promotions: (offer.promotionSnapshots ?? []).map((p) => [p.id, p.resolvedAmountNet]),
        promoCodeDiscount: offer.promoCodeSnapshot
            ? [offer.promoCodeSnapshot.code, offer.promoCodeSnapshot.resolvedAmountNet]
            : null,
    });
}

function planNotOffered(planKey: string, billingCycle: Cycle): UnprocessableEntityException {
    return new UnprocessableEntityException({
        code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_PLAN_NOT_OFFERED,
        message: `Plan '${planKey}' is not offered with a ${billingCycle} price at the moment.`,
        params: { planKey, billingCycle },
    });
}

function bundleNotOffered(bundleVersionId: string, reason: string): UnprocessableEntityException {
    return new UnprocessableEntityException({
        code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_BUNDLE_NOT_OFFERED,
        message: `Bundle version '${bundleVersionId}' cannot be added to this offer (${reason}).`,
        params: { bundleVersionId, reason },
    });
}

function refusesThePromoCode(error: unknown): boolean {
    if (!(error instanceof UnprocessableEntityException)) return false;
    const body = error.getResponse();
    return (
        typeof body === 'object' &&
        body !== null &&
        (body as { code?: unknown }).code ===
            CONTRACT_ERROR_CODES.CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED
    );
}

function promoCodeNotAccepted(reason: string): UnprocessableEntityException {
    return new UnprocessableEntityException({
        code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED,
        message: `The promo code cannot be applied to this offer (${reason}).`,
        params: { reason },
    });
}
