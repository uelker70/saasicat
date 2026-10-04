import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import {
    TAX_ERROR_CODES,
    type BillingCycle,
    type PlanCatalogSettings,
    type SubscriberTaxOrigin,
    type TaxAdapter,
    type TaxAdapterIdentity,
    type TaxDecisionRequest,
    type TaxIssuer,
    type TaxTreatment,
} from '@saasicat/core';

import { initialPeriodWindow } from '../billing/billing-period.js';
import { codedError } from '../errors/coded-error.js';

/** The period a charge covers: from `from` up to `until`, which is the first moment after it. */
export type TaxPeriod = TaxDecisionRequest['period'];

/**
 * The rate a charge takes, and the treatment behind it where a tax adapter
 * decided; `null` where the rate is the file's `vatRate`.
 */
export interface AppliedTax {
    rate: number;
    treatment: TaxTreatment | null;
}

/** The file's `vatRate`, for an installation that names no tax adapter. */
export function rateOfTheFile(settings: Pick<PlanCatalogSettings, 'vatRate'>): AppliedTax {
    if (settings.vatRate === undefined) {
        throw new Error(
            'config/saas.yaml names no vatRate: with a tax adapter the rate comes from the adapter, and this path reads the file.',
        );
    }
    return { rate: settings.vatRate, treatment: null };
}

/** The issuer as a tax adapter needs it, from `config/saas.yaml#issuer`. */
export function taxIssuerOf(settings: Pick<PlanCatalogSettings, 'issuer'>): TaxIssuer {
    return { country: settings.issuer?.country ?? null, vatId: settings.issuer?.vatId ?? null };
}

/**
 * A subscriber in the issuer's own country whose other details are not known:
 * the origin a price is shown for before the subscriber says where it is
 * (`SC-PRIC-037`).
 */
export function domesticOrigin(issuer: TaxIssuer): SubscriberTaxOrigin {
    return { country: issuer.country, business: null, vatId: null, validatedVatId: null };
}

/** A billing rhythm in either spelling the platform uses. */
export type TaxRhythm = BillingCycle | 'monthly' | 'yearly';

function billingCycleOf(rhythm: TaxRhythm): BillingCycle {
    return rhythm === 'yearly' || rhythm === 'YEARLY' ? 'YEARLY' : 'MONTHLY';
}

/** The first period of `cycle` from `asOf`: what a price shown at `asOf` would first charge. */
export function shownTaxPeriod(asOf: Date, cycle: TaxRhythm): TaxPeriod {
    const { start, end } = initialPeriodWindow(asOf, billingCycleOf(cycle));
    return { from: start, until: end };
}

/**
 * The first period of a contract: one billing rhythm from `effectiveFrom`,
 * ending earlier where the contract itself ends earlier.
 */
export function contractTaxPeriod(contract: {
    effectiveFrom: Date;
    effectiveUntil?: Date | null;
    billingCycle: TaxRhythm;
}): TaxPeriod {
    const { start, end } = initialPeriodWindow(
        contract.effectiveFrom,
        billingCycleOf(contract.billingCycle),
    );
    const until = contract.effectiveUntil;
    const endsEarlier = until != null && until.getTime() > start.getTime() && until < end;
    return { from: start, until: endsEarlier ? until : end };
}

/**
 * Which rate a charge takes in this installation. With a tax adapter bound it
 * is the adapter's decision for the subscriber's origin; without one it is the
 * file's `vatRate`, as it always was.
 */
export class TaxTreatments {
    constructor(
        private readonly settings: PlanCatalogSettings,
        private readonly bound: TaxAdapter | null,
    ) {}

    /** The adapter that decides, or `null` where the file's rate applies. */
    get adapter(): TaxAdapterIdentity | null {
        return this.bound && { name: this.bound.name, version: this.bound.version };
    }

    /**
     * The rate a price shows before the subscriber's origin is known: the
     * adapter's answer for a subscriber in the issuer's country.
     */
    shown(asOf: Date, cycle: TaxRhythm): AppliedTax {
        if (!this.bound) return rateOfTheFile(this.settings);
        return this.decide(domesticOrigin(taxIssuerOf(this.settings)), shownTaxPeriod(asOf, cycle));
    }

    /**
     * The rate and treatment for a subscriber of this origin over `period`.
     * Refuses a case the adapter does not support with `422`, rather than
     * charging a guessed tax (`SC-PRIC-039`).
     */
    decide(origin: SubscriberTaxOrigin, period: TaxPeriod): AppliedTax {
        if (!this.bound) return rateOfTheFile(this.settings);
        const decision = this.bound.decide({
            issuer: taxIssuerOf(this.settings),
            origin,
            period,
            // Bound only with a zone: `taxBindingProblems` refuses the start without one.
            timeZone: this.settings.timeZone as string,
        });
        if (!decision.supported) {
            throw new UnprocessableEntityException(
                codedError(TAX_ERROR_CODES.TAX_TREATMENT_NOT_SUPPORTED, {
                    adapter: this.bound.name,
                    reason: decision.reason,
                }),
            );
        }
        return { rate: decision.treatment.rate, treatment: decision.treatment };
    }
}

/** Whether `error` is the refusal of a case the tax adapter does not support. */
export function isTaxNotSupported(error: unknown): boolean {
    const response =
        error instanceof HttpException ? (error.getResponse() as { code?: unknown }) : null;
    return response?.code === TAX_ERROR_CODES.TAX_TREATMENT_NOT_SUPPORTED;
}
