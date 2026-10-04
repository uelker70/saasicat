// The tax port: how an installation learns which tax a subscriber is charged.
//
// SaaSiCat interprets no tax law (ADR 0013). An adapter for the country of the
// issuer does, as a package of its own — `@saasicat/tax-de` is the first — and
// SaaSiCat records each answer with the adapter's name and version, so that a
// document keeps saying why it carries its tax after the adapter is updated or
// replaced.
//
// This file holds the half of the port a contract needs: the subscriber's tax
// origin, the treatment an adapter decides from it, and the check of a VAT
// identification number. How an invoice computes its tax, what it has to
// contain and the format it takes join the port with invoicing.

/** The adapter that gave an answer, recorded beside the answer. */
export interface TaxAdapterIdentity {
    /** The adapter's package name, such as `@saasicat/tax-de`. */
    name: string;
    /** The adapter's version as published, such as `1.0.0`. */
    version: string;
}

/** The kinds of tax treatment every adapter shares, in the order they are named. */
export const TAX_TREATMENT_KINDS = [
    'standard',
    'reduced',
    'exempt',
    'reverse-charge',
    'not-taxable',
    'small-business',
] as const;

/**
 * What a tax treatment is, in the words every adapter shares.
 *
 * - `standard` and `reduced`: the issuer's country taxes the charge at a rate.
 * - `exempt`: the charge is exempt in the issuer's country.
 * - `reverse-charge`: the subscriber, a business in another country, owes the
 *   tax instead of the issuer.
 * - `not-taxable`: the charge is not taxable in the issuer's country at all,
 *   such as a service to a business outside the European Union.
 * - `small-business`: the issuer charges no tax under a small business scheme.
 */
export type TaxTreatmentKind = (typeof TAX_TREATMENT_KINDS)[number];

/** The treatment an adapter decided, as a contract and an invoice record it. */
export interface TaxTreatment {
    kind: TaxTreatmentKind;
    /** The rate in percent, such as `19`; `0` for every kind that charges no tax. */
    rate: number;
    /**
     * The sentence the document has to carry for this treatment, such as the
     * reference to the reverse charge; `null` where the law asks for none.
     */
    note: string | null;
    /** Who decided it. */
    adapter: TaxAdapterIdentity;
}

/**
 * Where a subscriber stands for tax purposes, as its record stands: what an
 * adapter decides a treatment from.
 */
export interface SubscriberTaxOrigin {
    /** The country of the billing address, ISO 3166-1 alpha-2; `null` while unknown. */
    country: string | null;
    /**
     * Whether the subscriber is a business, as sign-up or the operator recorded
     * it; `null` while nobody has said. Never derived from a tax identifier: a
     * business outside the European Union may have none.
     */
    business: boolean | null;
    /** The VAT identification number as entered, validated or not. */
    vatId: string | null;
    /**
     * The same number, only when its latest completed check found it valid;
     * otherwise `null`. An adapter decides as though a subscriber whose number
     * is not validated had none (`SC-PRIC-040`).
     */
    validatedVatId: string | null;
}

/** The issuer as an adapter needs it: the operator, as `config/saas.yaml` names it. */
export interface TaxIssuer {
    /** ISO 3166-1 alpha-2; `null` where the configuration names none. */
    country: string | null;
    vatId: string | null;
}

/** What an adapter decides a treatment for. */
export interface TaxDecisionRequest {
    issuer: TaxIssuer;
    origin: SubscriberTaxOrigin;
    /**
     * The period the charge covers, as a charge records it: from `from` up to
     * `until`, which is the first moment after it. A rate that changed in
     * between is the adapter's to see.
     */
    period: { from: Date; until: Date };
    /**
     * The installation's time zone, an IANA name such as `Europe/Berlin`: the
     * calendar in which the days of the period count (`SC-PRIC-045`).
     */
    timeZone: string;
}

/**
 * An adapter's answer: a treatment, or a sentence saying the case is not
 * supported. An unsupported case is refused before a contract exists rather
 * than invoiced with a guessed tax (`SC-PRIC-039`).
 */
export type TaxDecision =
    { supported: true; treatment: TaxTreatment } | { supported: false; reason: string };

/**
 * A completed check of a VAT identification number, with its date and what
 * the service returned (`SC-PRIC-040`). Every check is recorded for the
 * subscriber and never rewritten: a reverse charge rests on the confirmation
 * that held when the invoice was issued, and neither a later check nor a
 * corrected number may take it away.
 */
export interface VatIdCheck {
    /** The number checked, exactly as it was stored when the check ran. */
    vatId: string;
    /**
     * When the service's answer was received, by the platform's clock, to the
     * millisecond. `keepsVatIdCheck` makes the check with the latest one count,
     * so a date of day precision — such as the request date VIES returns —
     * would make two checks of one day tie, and a date in the future would hold
     * back every check after it. Such a date belongs in `confirmation`.
     */
    checkedAt: Date;
    /** Whether the service confirmed the number as valid. */
    valid: boolean;
    /** The service that answered, such as `VIES`. */
    service: string;
    /**
     * What the service returned as its confirmation — a request identifier, the
     * name and address it holds for the number — as text, as the service sent it.
     */
    confirmation: Record<string, string>;
}

/**
 * How a check ended. A check that could not complete, such as while the
 * service is unavailable, is not a result: it leaves the number unvalidated
 * and is never read as valid.
 */
export type VatIdCheckOutcome =
    { completed: true; check: VatIdCheck } | { completed: false; reason: string };

/**
 * The tax adapter of an installation: a package for the country of its issuer,
 * named in `config/saas.yaml`. An adapter is a template, not tax advice; its
 * documentation says what it decides and on which basis.
 */
export interface TaxAdapter extends TaxAdapterIdentity {
    /** The treatment of a charge, or why the case is not supported. Decides only; writes nothing. */
    decide(request: TaxDecisionRequest): TaxDecision;
    /**
     * Checks a VAT identification number with the service the adapter names.
     * Resolves to an outcome whatever the service does: an error, a timeout and
     * an answer the adapter cannot read are each a check that did not complete.
     */
    checkVatId(vatId: string, issuer: TaxIssuer): Promise<VatIdCheckOutcome>;
}
