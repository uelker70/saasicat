import { readFileSync } from 'node:fs';
import type {
    TaxAdapter,
    TaxDecision,
    TaxDecisionRequest,
    TaxIssuer,
    VatIdCheckOutcome,
} from '@saasicat/core';
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
}
