// CheckoutOfferService — Paket-Snapshot Webseite → Onboarding → Abrechnung
// (METAMODELL §17a).
//
// `create` wird von der Pricing-Page gerufen, `getById`/`update` vom
// Onboarding (Individualisierung), `consume` beim Subscription-Abschluss
// (friert den Offer ein → `Subscription.packageSnapshot`).
//
// Spec: yada-services/handoff/superadmin/SUPERADMIN_TENANT_METAMODELL.md §17a

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
    CreateCheckoutOfferData,
    PlanRepository,
    UpdateCheckoutOfferData,
} from '@saasicat/types';
import {
    buildFeatureRequiresIndex,
    collectUnsatisfiedRequires,
    startOfUtcDay,
} from '@saasicat/types';

import {
    BUNDLE_REPOSITORY_TOKEN,
    CATALOG_ENTRY_REPOSITORY_TOKEN,
    PLAN_REPOSITORY_TOKEN,
} from '../catalog/tokens.js';
import { appendImplicitDiscountLineItem } from './discount-line-items.js';
import { CHECKOUT_OFFER_REPOSITORY_TOKEN } from './tokens.js';

@Injectable()
export class CheckoutOfferService {
    constructor(
        @Inject(CHECKOUT_OFFER_REPOSITORY_TOKEN)
        private readonly repo: CheckoutOfferRepository,
        @Optional()
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository | null = null,
        // Optional für die requires-Validierung (#35 P6): Plan-Features der
        // gewählten PlanVersion. Fehlt der Adapter, Fallback auf die
        // featuresSnapshot der Plan-LineItem.
        @Optional()
        @Inject(PLAN_REPOSITORY_TOKEN)
        private readonly plans: PlanRepository | null = null,
        // Optional für die requires-Validierung (#35 P6): ohne Adapter gibt
        // es keine requires-Daten → Validierung wird übersprungen (graceful,
        // Verhalten wie vor #35).
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
            throw new NotFoundException(`CheckoutOffer '${id}' nicht gefunden`);
        }
        return row;
    }

    async create(data: CreateCheckoutOfferData): Promise<CheckoutOfferRow> {
        const normalized = this.normalizeCreateData(data);
        await this.assertFeatureRequiresSatisfied({
            projectKey: normalized.projectKey,
            planKey: normalized.planKey,
            planVersionId: normalized.planVersionId ?? null,
            bundleVersionIds: normalized.bundleVersionIds ?? [],
            lineItems: normalized.lineItems ?? [],
        });
        return this.repo.create(normalized);
    }

    /** Individualisierung im Onboarding — nur solange der Offer `open` ist. */
    async update(id: string, data: UpdateCheckoutOfferData): Promise<CheckoutOfferRow> {
        const existing = await this.getById(id);
        this.assertOpen(existing, 'ändern');
        const next = this.normalizeUpdateData(existing, data);
        await this.assertFeatureRequiresSatisfied({
            projectKey: existing.projectKey,
            planKey: existing.planKey,
            planVersionId: existing.planVersionId,
            bundleVersionIds: next.bundleVersionIds ?? [],
            lineItems: next.lineItems ?? [],
        });
        return this.repo.update(id, next);
    }

    /**
     * Friert den Offer ein (`status = 'consumed'`). Liefert den finalen
     * Snapshot zurück — der Aufrufer (Registration/Billing) schreibt ihn
     * als `Subscription.packageSnapshot`.
     */
    async consume(id: string): Promise<CheckoutOfferRow> {
        const existing = await this.getById(id);
        this.assertOpen(existing, 'verbrauchen');
        await this.assertBundleVersionsStillBookable(existing);
        return this.repo.consume(id);
    }

    /**
     * #35 P6 — serverseitige requires-Validierung: Die Abhängigkeiten aller
     * Features (Plan ∪ gewählte Bundles) müssen innerhalb der Auswahl
     * gedeckt sein, sonst entstünde ein Offer, dessen Features beim Tenant
     * nicht funktionieren können (vereinsfux validateModuleDependencies
     * wird damit plattformseitig abgelöst). requires-Quelle sind die
     * kuratierten FeatureCatalogEntries; ohne CatalogEntryRepository wird
     * übersprungen (graceful — keine requires-Daten verfügbar).
     */
    private async assertFeatureRequiresSatisfied(input: {
        projectKey: string;
        planKey: string;
        planVersionId: string | null;
        bundleVersionIds: string[];
        lineItems: CheckoutOfferLineItem[];
    }): Promise<void> {
        if (!this.catalogEntries) return;
        const entries = await this.catalogEntries.listFeatures({
            projectKey: input.projectKey,
        });
        const requiresIndex = buildFeatureRequiresIndex(entries);
        if (requiresIndex.size === 0) return;

        const selected = new Set<string>([
            ...(await this.resolvePlanFeatures(input)),
            ...(await this.resolveBundleFeatures(input)),
        ]);
        const missingRequires = collectUnsatisfiedRequires([...selected], requiresIndex);
        if (missingRequires.length > 0) {
            throw new UnprocessableEntityException({
                code: 'CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED',
                message:
                    'Die Paket-Auswahl deckt nicht alle Feature-Abhängigkeiten: ' +
                    `[${missingRequires.join(', ')}] fehlen in Plan + gewählten Bundles.`,
                missingRequires,
            });
        }
    }

    /**
     * Plan-Features bevorzugt aus der Server-SSOT (PlanRepository); Fallback
     * ist die eingefrorene featuresSnapshot der Plan-LineItem (Adapter ohne
     * PlanRepository-Wiring).
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

    /** Bundle-Features aus den BundleVersions; Fallback featuresSnapshot. */
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
            if (version.publishedAt === null) {
                violations.push({ bundleVersionId, reason: 'not_published' });
                continue;
            }
            if (version.supersededAt !== null) {
                violations.push({ bundleVersionId, reason: 'superseded' });
                continue;
            }
            if (this.dateIsAfterNow(version.validFrom, now)) {
                violations.push({ bundleVersionId, reason: 'not_yet_valid' });
                continue;
            }
            if (this.isValidUntilExpired(version.validUntil, now)) {
                violations.push({ bundleVersionId, reason: 'expired' });
            }
        }
        if (violations.length > 0) {
            throw new UnprocessableEntityException({
                code: 'CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE',
                message:
                    'Mindestens eine BundleVersion aus dem CheckoutOffer ist nicht mehr buchbar.',
                violations,
            });
        }
    }

    private normalizeCreateData(data: CreateCheckoutOfferData): CreateCheckoutOfferData {
        const lineItems = this.resolveLineItems({
            planKey: data.planKey,
            billingCycle: data.billingCycle,
            priceBreakdown: data.priceBreakdown,
            lineItems: data.lineItems,
            bundleVersionIds: data.bundleVersionIds ?? [],
            promotionSnapshots: data.promotionSnapshots ?? [],
            promoCodeSnapshot: data.promoCodeSnapshot ?? null,
        });
        return {
            ...data,
            bundles: data.bundles ?? [],
            bundleVersionIds: data.bundleVersionIds ?? [],
            lineItems,
            promotionSnapshots: data.promotionSnapshots ?? [],
            promoCodeSnapshot: data.promoCodeSnapshot ?? null,
            locale: data.locale ?? 'de',
            validUntil: data.validUntil ?? null,
        };
    }

    private normalizeUpdateData(
        existing: CheckoutOfferRow,
        data: UpdateCheckoutOfferData,
    ): UpdateCheckoutOfferData {
        const priceBreakdown = data.priceBreakdown ?? existing.priceBreakdown;
        const billingCycle = data.billingCycle ?? existing.billingCycle;
        const bundleVersionIds = data.bundleVersionIds ?? existing.bundleVersionIds ?? [];
        const lineItems = this.resolveLineItems({
            planKey: existing.planKey,
            billingCycle,
            priceBreakdown,
            lineItems: data.lineItems ?? existing.lineItems,
            bundleVersionIds,
            promotionSnapshots: data.promotionSnapshots ?? existing.promotionSnapshots ?? [],
            promoCodeSnapshot:
                data.promoCodeSnapshot !== undefined
                    ? data.promoCodeSnapshot
                    : (existing.promoCodeSnapshot ?? null),
        });
        return {
            ...data,
            bundleVersionIds,
            lineItems,
            promotionSnapshots: data.promotionSnapshots ?? existing.promotionSnapshots ?? [],
            promoCodeSnapshot:
                data.promoCodeSnapshot !== undefined
                    ? data.promoCodeSnapshot
                    : (existing.promoCodeSnapshot ?? null),
        };
    }

    private resolveLineItems(input: {
        planKey: string;
        billingCycle: 'monthly' | 'yearly';
        priceBreakdown: CreateCheckoutOfferData['priceBreakdown'];
        lineItems: CheckoutOfferLineItem[] | undefined;
        bundleVersionIds: string[];
        promotionSnapshots: CreateCheckoutOfferData['promotionSnapshots'];
        promoCodeSnapshot: CreateCheckoutOfferData['promoCodeSnapshot'];
    }): CheckoutOfferLineItem[] {
        const lineItems =
            input.lineItems && input.lineItems.length > 0
                ? input.lineItems
                : [
                      this.defaultPlanLineItem(
                          input.planKey,
                          input.billingCycle,
                          input.priceBreakdown,
                      ),
                  ];
        const hasPlan = lineItems.some((item) => item.kind === 'plan');
        if (!hasPlan) {
            throw new UnprocessableEntityException({
                code: 'CHECKOUT_OFFER_PLAN_LINE_ITEM_REQUIRED',
                message: 'CheckoutOffer benötigt eine eingefrorene Plan-LineItem.',
            });
        }
        const missingBundleVersionIds = input.bundleVersionIds.filter(
            (versionId) =>
                !lineItems.some(
                    (item) => item.kind === 'bundle' && item.sourceVersionId === versionId,
                ),
        );
        if (missingBundleVersionIds.length > 0) {
            throw new UnprocessableEntityException({
                code: 'CHECKOUT_OFFER_BUNDLE_LINE_ITEMS_REQUIRED',
                message:
                    'Jede ausgewählte BundleVersion benötigt eine eingefrorene Bundle-LineItem.',
                bundleVersionIds: missingBundleVersionIds,
            });
        }
        return appendImplicitDiscountLineItem({
            billingCycle: input.billingCycle,
            priceBreakdown: input.priceBreakdown,
            lineItems,
            promotionSnapshots: input.promotionSnapshots ?? [],
            promoCodeSnapshot: input.promoCodeSnapshot ?? null,
        });
    }

    private defaultPlanLineItem(
        planKey: string,
        billingCycle: 'monthly' | 'yearly',
        priceBreakdown: CreateCheckoutOfferData['priceBreakdown'],
    ): CheckoutOfferLineItem {
        const priceNet = priceBreakdown.planNet;
        return {
            kind: 'plan',
            sourceKey: planKey,
            sourceVersionId: null,
            titleSnapshot: planKey,
            descriptionSnapshot: null,
            quantity: 1,
            unit: null,
            priceNet,
            priceGross: Math.round(priceNet * (1 + priceBreakdown.vatRate) * 100) / 100,
            billingCycle,
            featuresSnapshot: [],
            quotaEffectsSnapshot: {},
            metadata: null,
        };
    }

    private assertOpen(existing: CheckoutOfferRow, action: 'ändern' | 'verbrauchen'): void {
        if (existing.status === 'consumed') {
            throw new ConflictException(
                `CheckoutOffer '${existing.id}' ist bereits verbraucht und kann nicht ${action} werden`,
            );
        }
        if (existing.status === 'expired') {
            throw new ConflictException(
                `CheckoutOffer '${existing.id}' ist abgelaufen und kann nicht ${action} werden`,
            );
        }
        if (this.isExpired(existing)) {
            throw new ConflictException(
                `CheckoutOffer '${existing.id}' ist abgelaufen und kann nicht ${action} werden`,
            );
        }
    }

    private isExpired(row: CheckoutOfferRow): boolean {
        return this.isValidUntilExpired(row.validUntil, Date.now());
    }

    private dateIsAfterNow(value: string | null, now: number): boolean {
        if (!value) return false;
        const time = new Date(value).getTime();
        return Number.isNaN(time) || time > now;
    }

    // `validUntil` ist tag-inklusiv (Tagesdatum, UTC-Mitternacht): abgelaufen
    // erst ab dem Folgetag, also wenn validUntil < Tagesbeginn(now). Symmetrisch
    // zum Katalog-Resolver (buildActivePlanVersionWhere).
    private isValidUntilExpired(value: string | null | undefined, nowMs: number): boolean {
        if (!value) return false;
        const validUntil = new Date(value).getTime();
        if (Number.isNaN(validUntil)) return true;
        return validUntil < startOfUtcDay(new Date(nowMs)).getTime();
    }
}
