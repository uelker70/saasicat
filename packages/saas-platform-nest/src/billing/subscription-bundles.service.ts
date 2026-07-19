// SubscriptionBundlesService — fachliche Schicht über der
// `subscription_bundles`-Junction (SPEC_V2 §11.1 M6 Pack 2e, P11.7.3).
//
// Aufgaben:
//   1. `addBundleToSubscription`: prüft Bundle-Existenz + Veröffentlichungs-
//      Status + Plan-Kompat (`bundle.compatibility.planIds`) + Idempotenz
//      (keine doppelten aktiven Buchungen derselben BundleVersion); setzt
//      Mindestlaufzeit-Default (12 Monate, konfigurierbar via Token).
//   2. `cancelBundleFromSubscription`: rechnet
//      `canceledEffectiveAt = max(currentPeriodEnd, minimumTermEndsAt)`
//      — Bestand bleibt damit bis zur längeren der beiden Grenzen aktiv.
//
// Bewusst Subscription-Repo-frei: der Caller (Tenant-Self-Service-
// Controller, Onboarding-Service, Admin-Endpoint) liefert die fachlichen
// Daten (`currentPlanKey`, `currentPeriodEnd`) selbst. So bleibt der
// Service in Tests trivial isolierbar und ohne Tenant-Lookup.

import {
    Inject,
    Injectable,
    NotFoundException,
    Optional,
    UnprocessableEntityException,
} from '@nestjs/common';
import type {
    BundleRepository,
    SubscriptionBundleRecord,
    SubscriptionBundleRepository,
    SubscriptionBundleView,
} from '@saasicat/types';

import { BUNDLE_REPOSITORY_TOKEN } from '../catalog/tokens.js';
import {
    SELF_SERVICE_BLOCKED_BUNDLES_TOKEN,
    type SelfServiceBlockedBundles,
} from './self-service-policy.js';
import {
    SUBSCRIPTION_BUNDLE_CONFIG_TOKEN,
    SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN,
} from './subscription-bundles.tokens.js';

export interface SubscriptionBundleConfig {
    /** Default Mindestlaufzeit in Monaten beim `add`. Default = 12. */
    defaultMinimumTermMonths?: number;
}

export interface AddBundleToSubscriptionInput {
    subscriptionId: string;
    bundleVersionId: string;
    /** PlanKey der aktuellen Subscription für die Plan-Kompat-Prüfung. */
    currentPlanKey: string;
    /** Default = now (Service-Zeit). */
    startedAt?: Date;
    /**
     * Override für die Mindestlaufzeit (Monate). Default = Config oder
     * 12. `0` heißt explizit „keine Mindestlaufzeit"
     * (`minimumTermEndsAt = null`).
     */
    minimumTermMonths?: number;
}

export interface CancelBundleFromSubscriptionInput {
    subscriptionBundleId: string;
    /** Default = now. */
    canceledAt?: Date;
    /**
     * Periodenende der Subscription, ab dem die Kündigung wirken könnte.
     * Wirksamkeits-Datum = `max(currentPeriodEnd, minimumTermEndsAt)`.
     * Wenn nicht gesetzt, wird `canceledAt` als Periodenende interpretiert
     * (= sofortige Wirksamkeit, sofern Mindestlaufzeit schon abgelaufen).
     */
    currentPeriodEnd?: Date;
}

@Injectable()
export class SubscriptionBundlesService {
    private readonly defaultMinTermMonths: number;

    constructor(
        @Inject(SUBSCRIPTION_BUNDLE_REPOSITORY_TOKEN)
        private readonly repo: SubscriptionBundleRepository,
        @Inject(BUNDLE_REPOSITORY_TOKEN)
        private readonly bundles: BundleRepository,
        @Optional()
        @Inject(SUBSCRIPTION_BUNDLE_CONFIG_TOKEN)
        config: SubscriptionBundleConfig = {},
        @Optional()
        @Inject(SELF_SERVICE_BLOCKED_BUNDLES_TOKEN)
        private readonly blockedBundles: SelfServiceBlockedBundles | null = null,
    ) {
        this.defaultMinTermMonths = config.defaultMinimumTermMonths ?? 12;
    }

    /** Alle Bundle-Buchungen einer Subscription (für „Meine Bundles"-Seite). */
    async listForSubscription(subscriptionId: string): Promise<SubscriptionBundleView[]> {
        const records = await this.repo.listBySubscription(subscriptionId);
        // Label/Key/Preis aus der gebuchten BundleVersion auflösen, damit die UI
        // gebuchte Bundles ohne Katalog-Join anzeigt (sonst UUID-Fallback, weil
        // der Katalog gefilterte/abgelöste Versionen ausschließen kann).
        return Promise.all(
            records.map(async (r) => {
                const bv = await this.bundles.findVersionById(r.bundleVersionId);
                return {
                    ...r,
                    bundleKey: bv?.bundleKey ?? null,
                    label: bv?.label ?? null,
                    monthlyNet: bv?.monthlyNet ?? null,
                };
            }),
        );
    }

    async addBundleToSubscription(
        input: AddBundleToSubscriptionInput,
    ): Promise<SubscriptionBundleRecord> {
        const bundleVersion = await this.bundles.findVersionById(input.bundleVersionId);
        if (!bundleVersion) {
            throw new NotFoundException(`BundleVersion '${input.bundleVersionId}' nicht gefunden`);
        }
        if (bundleVersion.publishedAt === null) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_NOT_PUBLISHED',
                message: `BundleVersion '${input.bundleVersionId}' ist nicht published und kann nicht gebucht werden.`,
            });
        }
        if (bundleVersion.supersededAt !== null) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_VERSION_SUPERSEDED',
                message: `BundleVersion '${input.bundleVersionId}' wurde durch eine Nachfolge-Version abgelöst.`,
            });
        }

        // Self-Service-Policy (#37): Vertriebs-only-Bundles blocken.
        if (this.blockedBundles?.bundleKeys?.includes(bundleVersion.bundleKey)) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_NOT_SELF_SERVICE',
                message:
                    `Bundle '${bundleVersion.bundleKey}' wird nur per Sondervertrag aktiviert. ` +
                    'Bitte den Vertragsbetreuer kontaktieren.',
            });
        }

        // Plan-Kompat: leeres planIds-Array = alle Pläne erlaubt.
        const planIds = bundleVersion.compatibility?.planIds ?? [];
        if (planIds.length > 0 && !planIds.includes(input.currentPlanKey)) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_INCOMPATIBLE_WITH_PLAN',
                message:
                    `BundleVersion '${input.bundleVersionId}' ist nicht mit Plan ` +
                    `'${input.currentPlanKey}' kompatibel. Erlaubt: [${planIds.join(', ')}].`,
            });
        }

        // Idempotenz: schon eine aktive Buchung dieser BundleVersion?
        const active = await this.repo.listActiveBySubscription(input.subscriptionId);
        if (active.some((b) => b.bundleVersionId === input.bundleVersionId)) {
            throw new UnprocessableEntityException({
                code: 'BUNDLE_ALREADY_SUBSCRIBED',
                message: `Subscription '${input.subscriptionId}' hat dieses Bundle bereits aktiv gebucht.`,
            });
        }

        const startedAt = input.startedAt ?? new Date();
        const minimumTermMonths = input.minimumTermMonths ?? this.defaultMinTermMonths;
        const minimumTermEndsAt =
            minimumTermMonths > 0 ? addMonths(startedAt, minimumTermMonths) : null;

        return this.repo.add({
            subscriptionId: input.subscriptionId,
            bundleVersionId: input.bundleVersionId,
            startedAt,
            minimumTermEndsAt,
        });
    }

    async cancelBundleFromSubscription(
        input: CancelBundleFromSubscriptionInput,
    ): Promise<SubscriptionBundleRecord> {
        const existing = await this.repo.findById(input.subscriptionBundleId);
        if (!existing) {
            throw new NotFoundException(
                `SubscriptionBundle '${input.subscriptionBundleId}' nicht gefunden`,
            );
        }
        if (existing.canceledAt !== null) {
            throw new UnprocessableEntityException({
                code: 'SUBSCRIPTION_BUNDLE_ALREADY_CANCELED',
                message: `SubscriptionBundle '${input.subscriptionBundleId}' ist bereits gekündigt.`,
            });
        }

        const canceledAt = input.canceledAt ?? new Date();
        const canceledEffectiveAt = resolveBundleCancelEffectiveAt({
            canceledAt,
            currentPeriodEnd: input.currentPeriodEnd ?? null,
            minimumTermEndsAt: existing.minimumTermEndsAt,
        });

        return this.repo.cancel(input.subscriptionBundleId, {
            canceledAt,
            canceledEffectiveAt,
        });
    }

    /**
     * „Kündigung rückgängig" — nur solange die Kündigung noch nicht wirksam ist
     * (Bundle läuft bis `canceledEffectiveAt`). Danach ist Neu-Buchung der Weg.
     */
    async reactivateBundle(subscriptionBundleId: string): Promise<SubscriptionBundleRecord> {
        const existing = await this.repo.findById(subscriptionBundleId);
        if (!existing) {
            throw new NotFoundException(
                `SubscriptionBundle '${subscriptionBundleId}' nicht gefunden`,
            );
        }
        if (existing.canceledAt === null) {
            throw new UnprocessableEntityException({
                code: 'SUBSCRIPTION_BUNDLE_NOT_CANCELED',
                message: `SubscriptionBundle '${subscriptionBundleId}' ist nicht gekündigt.`,
            });
        }
        if (existing.canceledEffectiveAt !== null && existing.canceledEffectiveAt <= new Date()) {
            throw new UnprocessableEntityException({
                code: 'SUBSCRIPTION_BUNDLE_CANCELLATION_EFFECTIVE',
                message: 'Kündigung bereits wirksam — bitte das Bundle neu buchen.',
            });
        }
        return this.repo.reactivate(subscriptionBundleId);
    }
}

/**
 * Wirksamkeits-Datum einer Bundle-Kündigung:
 * `max(currentPeriodEnd, minimumTermEndsAt)` — fehlende Werte fallen auf
 * `canceledAt` zurück (= sofortige Wirksamkeit). Geteilt zwischen
 * Kündigungs-Mutation und Preview (#37).
 */
export function resolveBundleCancelEffectiveAt(input: {
    canceledAt: Date;
    currentPeriodEnd: Date | null;
    minimumTermEndsAt: Date | null;
}): Date {
    const periodEnd = input.currentPeriodEnd ?? input.canceledAt;
    const minTermEnd = input.minimumTermEndsAt ?? input.canceledAt;
    return periodEnd.getTime() >= minTermEnd.getTime() ? periodEnd : minTermEnd;
}

/**
 * Addiert `months` zu `date` und behält den UTC-Tag bei. Edge-Case
 * 31.01 + 1 Monat → 28./29.02 (JS-Date macht das automatisch, indem
 * setMonth den Tag normalisiert).
 */
export function addMonths(date: Date, months: number): Date {
    const out = new Date(date.getTime());
    out.setUTCMonth(out.getUTCMonth() + months);
    return out;
}
