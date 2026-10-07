import { readFileSync } from 'node:fs';
import {
    taxPerRate,
    type InvoiceContentDraft,
    type InvoiceTaxLine,
    type TaxAdapter,
    type TaxAdapterFactory,
    type TaxDecision,
    type TaxDecisionRequest,
    type TaxIssuer,
    type TaxPerRate,
    type VatIdCheckOutcome,
} from '@saasicat/core';
import { germanInvoiceContentGaps } from './invoice-content.js';
import { decideGermanTax } from './rules.js';
import { checkVatIdWithVies } from './vies.js';

/** The package name every answer of this adapter is recorded with. */
const GERMAN_TAX_ADAPTER = '@saasicat/tax-de';

/** How long a VIES check may take by default before it counts as not completed. */
const DEFAULT_VIES_TIMEOUT_MS = 10_000;

/**
 * The version this package was published as, read from its own manifest at
 * runtime rather than written into the build: the first publish of a new
 * package sets the version after the build (CONTRIBUTING, "A new package
 * needs one manual first publish"), and the answer has to name the version
 * that was published.
 */
function publishedVersion(): string {
    const manifest: unknown = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const version = (manifest as { version?: unknown }).version;
    if (typeof version !== 'string') {
        throw new Error(`${GERMAN_TAX_ADAPTER}: its package.json names no version.`);
    }
    return version;
}

export interface GermanTaxAdapterOptions {
    /**
     * The issuer uses the small business exemption of § 19 UStG: a subscriber
     * in Germany is charged no VAT, and the invoice says why. It reaches
     * subscribers in Germany only.
     */
    smallBusiness?: boolean;
    /** How long a VIES check may take before it counts as not completed. */
    viesTimeoutMs?: number;
    /** The fetch to reach VIES with; for a proxy, and for tests against a local server. */
    fetch?: typeof globalThis.fetch;
    /** The clock a check is dated by; for tests. */
    now?: () => Date;
}

/**
 * The tax adapter for an issuer in Germany. A template, not tax advice: what
 * it decides and on which basis is in its README, and the operator stays
 * responsible for the tax it charges.
 */
export class GermanTaxAdapter implements TaxAdapter {
    readonly name = GERMAN_TAX_ADAPTER;
    readonly version: string;
    private readonly smallBusiness: boolean;
    private readonly viesTimeoutMs: number;
    private readonly fetchVies: typeof globalThis.fetch;
    private readonly now: () => Date;

    constructor(options: GermanTaxAdapterOptions = {}) {
        this.version = publishedVersion();
        this.smallBusiness = options.smallBusiness ?? false;
        this.viesTimeoutMs = options.viesTimeoutMs ?? DEFAULT_VIES_TIMEOUT_MS;
        if (!(Number.isInteger(this.viesTimeoutMs) && this.viesTimeoutMs > 0)) {
            throw new RangeError(
                `${GERMAN_TAX_ADAPTER}: viesTimeoutMs is a whole number of milliseconds above zero.`,
            );
        }
        this.fetchVies = options.fetch ?? globalThis.fetch;
        this.now = options.now ?? (() => new Date());
    }

    decide(request: TaxDecisionRequest): TaxDecision {
        return decideGermanTax(
            request,
            { smallBusiness: this.smallBusiness },
            { name: this.name, version: this.version },
        );
    }

    checkVatId(vatId: string, issuer: TaxIssuer): Promise<VatIdCheckOutcome> {
        return checkVatIdWithVies(vatId, issuer.vatId, {
            fetch: this.fetchVies,
            timeoutMs: this.viesTimeoutMs,
            now: this.now,
        });
    }

    /** The rule of EN 16931, which ZUGFeRD computes the invoice's tax by: once per rate. */
    invoiceTax(lines: readonly InvoiceTaxLine[]): TaxPerRate {
        return taxPerRate(lines);
    }

    invoiceContentGaps(draft: InvoiceContentDraft): readonly string[] {
        return germanInvoiceContentGaps(draft);
    }
}

/** What `config/saas.yaml#tax.options` may name for this adapter. */
const FILE_OPTIONS: ReadonlySet<string> = new Set(['smallBusiness']);

/** The options the file gives, checked: the operator's typo is an error at the start, not a default. */
function fileOptions(options: Readonly<Record<string, unknown>>): { smallBusiness: boolean } {
    const unknown = Object.keys(options).filter((key) => !FILE_OPTIONS.has(key));
    if (unknown.length > 0) {
        throw new Error(
            `${GERMAN_TAX_ADAPTER}: config/saas.yaml#tax.options names ${unknown.join(', ')}, which the adapter does not take; it takes smallBusiness.`,
        );
    }
    const smallBusiness = options['smallBusiness'] ?? false;
    if (typeof smallBusiness !== 'boolean') {
        throw new Error(
            `${GERMAN_TAX_ADAPTER}: config/saas.yaml#tax.options.smallBusiness is true or false.`,
        );
    }
    return { smallBusiness };
}

/**
 * The factory an application binds, building the adapter from the options in
 * `config/saas.yaml#tax.options`. What only code can give — the fetch to reach
 * VIES with, its timeout, a clock — is passed here; what the operator declares
 * comes from the file.
 */
export function germanTaxAdapterFactory(
    codeOptions: Omit<GermanTaxAdapterOptions, 'smallBusiness'> = {},
): TaxAdapterFactory {
    return {
        adapterName: GERMAN_TAX_ADAPTER,
        create: (options) => new GermanTaxAdapter({ ...codeOptions, ...fileOptions(options) }),
    };
}
