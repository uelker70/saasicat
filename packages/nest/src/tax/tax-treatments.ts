import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import {
    TAX_ERROR_CODES,
    type BillingCycle,
    type InvoiceContentDraft,
    type InvoiceTaxLine,
    type PlanCatalogSettings,
    type SubscriberTaxOrigin,
    type TaxAdapter,
    type TaxAdapterIdentity,
    type TaxDecisionRequest,
    type TaxIssuer,
    type TaxPerRate,
    type TaxTreatment,
    type VatIdCheckOutcome,
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

    /**
     * The country a shown rate applies to: the issuer's where an adapter
     * decides, `null` where the file's one rate applies to everyone.
     */
    get shownFor(): string | null {
        return this.bound ? taxIssuerOf(this.settings).country : null;
    }

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
     * charging a guessed tax (`SC-PRIC-039`). `issuer` is the party the
     * document names where that is not the file's issuer: an invoice names the
     * issuer of its contract (`SC-PRIC-026`), and its treatment is that
     * party's.
     */
    decide(origin: SubscriberTaxOrigin, period: TaxPeriod, issuer?: TaxIssuer): AppliedTax {
        if (!this.bound) return rateOfTheFile(this.settings);
        const decision = this.bound.decide({
            issuer: issuer ?? taxIssuerOf(this.settings),
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

    /** The tax of an invoice's lines, by the adapter's rule (`SC-PRIC-041`); only where an adapter decides. */
    invoiceTax(lines: readonly InvoiceTaxLine[]): TaxPerRate {
        return this.requireBound('computes no invoice tax').invoiceTax(lines);
    }

    /**
     * What the law the adapter names requires of an invoice and `draft` lacks
     * (`SC-PRIC-027`); empty where nothing is missing. Only where an adapter
     * decides.
     */
    invoiceContentGaps(draft: InvoiceContentDraft): readonly string[] {
        return this.requireBound('checks no invoice content').invoiceContentGaps(draft);
    }

    /**
     * Checks a VAT identification number with the service the adapter names,
     * the issuer's own number as the requester. An outcome whatever the service
     * does; only where an adapter decides.
     */
    checkVatId(vatId: string): Promise<VatIdCheckOutcome> {
        return this.requireBound('checks no VAT identification number').checkVatId(
            vatId,
            taxIssuerOf(this.settings),
        );
    }

    private requireBound(what: string): TaxAdapter {
        if (!this.bound) throw new Error(`No tax adapter is bound, so it ${what}.`);
        return this.bound;
    }
}

/** Whether `error` is the refusal of a case the tax adapter does not support. */
export function isTaxNotSupported(error: unknown): boolean {
    const response =
        error instanceof HttpException ? (error.getResponse() as { code?: unknown }) : null;
    return response?.code === TAX_ERROR_CODES.TAX_TREATMENT_NOT_SUPPORTED;
}

/**
 * The adapter's sentence where it supports no treatment for `origin` over
 * `period`, or `null` where it supports one. An error that is not such a
 * refusal comes through: a failing adapter is not an answer.
 */
export function taxRefusalOf(
    taxes: TaxTreatments,
    origin: SubscriberTaxOrigin,
    period: TaxPeriod,
): string | null {
    try {
        taxes.decide(origin, period);
        return null;
    } catch (error) {
        if (!isTaxNotSupported(error)) throw error;
        const response = (error as HttpException).getResponse() as {
            params?: { reason?: unknown };
        };
        return String(response.params?.reason ?? '');
    }
}
