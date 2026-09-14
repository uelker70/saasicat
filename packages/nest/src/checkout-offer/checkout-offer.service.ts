// CheckoutOfferService — package snapshot website → onboarding → billing
//
// `create` is called by the pricing page, `getById`/`update` by
// onboarding (customization), `consume` on subscription completion
// (freezes the offer → `Subscription.packageSnapshot`). Every amount on an
// offer comes from `CheckoutOfferPricing`; a caller only chooses.

import {
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import type {
    BundleRepository,
    CatalogEntryRepository,
    CheckoutOfferFilter,
    CheckoutOfferLineItem,
    CheckoutOfferRepository,
    CheckoutOfferRow,
    CheckoutOfferSelection,
    CheckoutOfferSelectionUpdate,
    PlanRepository,
} from '@saasicat/core';
import {
    CONTRACT_ERROR_CODES,
    buildFeatureRequiresIndex,
    collectUnsatisfiedRequires,
} from '@saasicat/core';

import {
    BUNDLE_REPOSITORY_TOKEN,
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
} from '../catalog/catalog.tokens.js';
import { bundleVersionNotBookableReason, isValidUntilExpired } from './bundle-version-bookable.js';
import { CheckoutOfferPricing } from './checkout-offer-pricing.js';
import { CHECKOUT_OFFER_REPOSITORY_TOKEN } from './checkout-offer.tokens.js';

/** The language an offer is described in when the caller names none. */
const DEFAULT_OFFER_LOCALE = 'de';

@Injectable()
export class CheckoutOfferService {
    constructor(
        @Inject(CHECKOUT_OFFER_REPOSITORY_TOKEN)
        private readonly repo: CheckoutOfferRepository,
        @Inject(CheckoutOfferPricing)
        private readonly pricing: CheckoutOfferPricing,
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository | null = null,
        // Plan features of the selected PlanVersion for the requires
        // validation (#35 P6).
        @Optional()
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository | null = null,
        // Optional for the requires validation (#35 P6): without the adapter
        // there is no requires data → validation is skipped.
        @Optional()
        @Inject(CATALOG_ENTRY_REPOSITORY_TOKEN)
        private readonly catalogEntries: CatalogEntryRepository | null = null,
    ) {}

    list(filter: CheckoutOfferFilter): Promise<CheckoutOfferRow[]> {
        return this.repo.list(filter);
    }

    async getById(id: string): Promise<CheckoutOfferRow> {
        const row = await this.repo.findById(id);
        if (!row) {
            throw new NotFoundException({
                code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_NOT_FOUND,
                message: `CheckoutOffer '${id}' not found`,
                params: { offerId: id },
            });
        }
        return row;
    }

    /** Prices what the caller chose and stores it as an open offer. */
    async create(selection: CheckoutOfferSelection): Promise<CheckoutOfferRow> {
        const locale = selection.locale ?? DEFAULT_OFFER_LOCALE;
        const priced = await this.pricing.price({
            planKey: selection.planKey,
            billingCycle: selection.billingCycle,
            bundleVersionIds: selection.bundleVersionIds ?? [],
            promoCode: selection.promoCode ?? null,
            locale,
        });
        await this.assertFeatureRequiresSatisfied({
            planKey: selection.planKey,
            planVersionId: priced.planVersionId,
            bundleVersionIds: priced.bundleVersionIds,
            lineItems: priced.lineItems,
        });
        return this.repo.create({
            planKey: selection.planKey,
            billingCycle: selection.billingCycle,
            locale,
            validUntil: selection.validUntil ?? null,
            ...priced,
        });
    }

    /**
     * Customization in onboarding — only while the offer is `open`. The plan
     * stays; whatever else changes, the whole offer is priced again.
     */
    async update(id: string, change: CheckoutOfferSelectionUpdate): Promise<CheckoutOfferRow> {
        const existing = await this.getById(id);
        this.assertOpen(existing, 'changed');
        const billingCycle = change.billingCycle ?? existing.billingCycle;
        const locale = change.locale ?? existing.locale;
        const priced = await this.pricing.price({
            planKey: existing.planKey,
            billingCycle,
            bundleVersionIds: change.bundleVersionIds ?? existing.bundleVersionIds ?? [],
            promoCode: change.promoCode !== undefined ? change.promoCode : existing.promoCode,
            locale,
        });
        await this.assertFeatureRequiresSatisfied({
            planKey: existing.planKey,
            planVersionId: priced.planVersionId,
            bundleVersionIds: priced.bundleVersionIds,
            lineItems: priced.lineItems,
        });
        return this.repo.update(id, {
            billingCycle,
            locale,
            ...(change.validUntil !== undefined ? { validUntil: change.validUntil } : {}),
            ...priced,
        });
    }

    /**
     * Freezes the offer (`status = 'consumed'`). Returns the final
     * snapshot — the caller (registration/billing) writes it
     * as `Subscription.packageSnapshot`.
     *
     * Refused unless every add-on is still bookable and the stored amounts are
     * what the catalogue makes of the offer's own selection, so an offer whose
     * amounts were written by anything but the pricing never becomes a contract.
     *
     * The plan, the add-ons and the promotions are priced as they stood when the
     * offer was priced; a promo code is checked with the promo module as it
     * stands now. A code is redeemed when the contract is concluded, so one that
     * has expired or run out of redemptions since refuses the offer.
     */
    async consume(id: string): Promise<CheckoutOfferRow> {
        const existing = await this.getById(id);
        this.assertOpen(existing, 'consumed');
        await this.assertBundleVersionsStillBookable(existing);
        await this.pricing.assertPricedByCatalogue(existing);
        return this.repo.consume(id);
    }

    /**
     * #35 P6 — server-side requires validation: the dependencies of all
     * features (plan ∪ selected bundles) must be covered within the
     * selection, otherwise an offer would be created whose features cannot
     * work at the tenant (an app-specific validateModuleDependencies check is
     * thereby replaced on the platform side). The requires source are the
     * curated FeatureCatalogEntries; without CatalogEntryRepository it is
     * skipped (graceful — no requires data available).
     */
    private async assertFeatureRequiresSatisfied(input: {
        planKey: string;
        planVersionId: string | null;
        bundleVersionIds: string[];
        lineItems: CheckoutOfferLineItem[];
    }): Promise<void> {
        if (!this.catalogEntries) return;
        const entries = await this.catalogEntries.listFeatures({});
        const requiresIndex = buildFeatureRequiresIndex(entries);
        if (requiresIndex.size === 0) return;

        const selected = new Set<string>([
            ...(await this.resolvePlanFeatures(input)),
            ...(await this.resolveBundleFeatures(input)),
        ]);
        const missingRequires = collectUnsatisfiedRequires([...selected], requiresIndex);
        if (missingRequires.length > 0) {
            throw new UnprocessableEntityException({
                code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED,
                message:
                    'The selected plan does not cover all feature dependencies: ' +
                    `[${missingRequires.join(', ')}] are missing from the plan + selected bundles.`,
                missingRequires,
            });
        }
    }

    /**
     * Plan features preferably from the server SSOT (PlanRepository); fallback
     * is the frozen featuresSnapshot of the plan LineItem (adapter without
     * PlanRepository wiring).
     */
    private async resolvePlanFeatures(input: {
        planKey: string;
        planVersionId: string | null;
        lineItems: CheckoutOfferLineItem[];
    }): Promise<string[]> {
        if (this.plans) {
            const version = input.planVersionId
                ? await this.plans.findVersionById?.(input.planVersionId)
                : null;
            const resolved =
                version ??
                (await this.plans.findActivePlanVersion?.(input.planKey)) ??
                (await this.plans.findLatestLivePlanVersion?.(input.planKey));
            if (resolved) return resolved.features ?? [];
        }
        return input.lineItems
            .filter((item) => item.kind === 'plan')
            .flatMap((item) => item.featuresSnapshot ?? []);
    }

    /** Bundle features from the BundleVersions; fallback featuresSnapshot. */
    private async resolveBundleFeatures(input: {
        bundleVersionIds: string[];
        lineItems: CheckoutOfferLineItem[];
    }): Promise<string[]> {
        if (this.bundles) {
            const features: string[] = [];
            let allResolved = true;
            for (const bundleVersionId of input.bundleVersionIds) {
                const version = await this.bundles.findVersionById(bundleVersionId);
                if (!version) {
                    allResolved = false;
                    break;
                }
                features.push(...(version.features ?? []));
            }
            if (allResolved) return features;
        }
        return input.lineItems
            .filter((item) => item.kind === 'bundle')
            .flatMap((item) => item.featuresSnapshot ?? []);
    }

    private async assertBundleVersionsStillBookable(offer: CheckoutOfferRow): Promise<void> {
        if (!this.bundles || !offer.bundleVersionIds || offer.bundleVersionIds.length === 0) {
            return;
        }
        const now = Date.now();
        const violations: Array<{ bundleVersionId: string; reason: string }> = [];
        for (const bundleVersionId of offer.bundleVersionIds) {
            const version = await this.bundles.findVersionById(bundleVersionId);
            if (!version) {
                violations.push({ bundleVersionId, reason: 'missing' });
                continue;
            }
            const reason = bundleVersionNotBookableReason(version, now);
            if (reason) violations.push({ bundleVersionId, reason });
        }
        if (violations.length > 0) {
            throw new UnprocessableEntityException({
                code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE,
                message:
                    'At least one bundle version from the checkout offer is no longer bookable.',
                violations,
            });
        }
    }

    private assertOpen(existing: CheckoutOfferRow, action: 'changed' | 'consumed'): void {
        if (existing.status === 'consumed') {
            throw new ConflictException({
                code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_ALREADY_CONSUMED,
                message: `Checkout offer '${existing.id}' has already been consumed and cannot be ${action}`,
                params: { offerId: existing.id, action },
            });
        }
        if (existing.status === 'expired') {
            throw new ConflictException({
                code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_EXPIRED,
                message: `Checkout offer '${existing.id}' has expired and cannot be ${action}`,
                params: { offerId: existing.id, action, validUntil: existing.validUntil ?? null },
            });
        }
        if (this.isExpired(existing)) {
            throw new ConflictException({
                code: CONTRACT_ERROR_CODES.CHECKOUT_OFFER_EXPIRED,
                message: `CheckoutOffer '${existing.id}' has expired and cannot be ${action}`,
                params: { offerId: existing.id, action, validUntil: existing.validUntil ?? null },
            });
        }
    }

    private isExpired(row: CheckoutOfferRow): boolean {
        return isValidUntilExpired(row.validUntil, Date.now());
    }
}
