// Whether the tax adapter the application binds is the one `config/saas.yaml`
// names, and whether it can work at all — checked once, at the start, so a
// misconfiguration is a refusal to start rather than a refusal at a customer's
// first contract.

import type { PlanCatalogSettings, TaxAdapter, TaxAdapterFactory } from '@saasicat/core';

import { domesticOrigin, shownTaxPeriod, taxIssuerOf } from './tax-treatments.js';
import { knowsTimeZone } from './time-zone.js';

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Whether a bound adapter's domestic decision works, or why not. */
function sampleProblem(
    settings: PlanCatalogSettings,
    adapter: TaxAdapter,
    now: Date,
): string | null {
    try {
        const decision = adapter.decide({
            issuer: taxIssuerOf(settings),
            origin: domesticOrigin(taxIssuerOf(settings)),
            period: shownTaxPeriod(now, 'MONTHLY'),
            timeZone: settings.timeZone as string,
        });
        if (decision.supported) return null;
        return `the tax adapter ${adapter.name} cannot decide a charge to a subscriber in the issuer's country: ${decision.reason}`;
    } catch (error) {
        return `the tax adapter ${adapter.name} fails to decide a charge to a subscriber in the issuer's country: ${messageOf(error)}`;
    }
}

/** What prevents `factory` from being the adapter `settings` name; empty when nothing does. */
export function taxBindingProblems(
    settings: PlanCatalogSettings,
    factory: TaxAdapterFactory | undefined,
    now: Date = new Date(),
): string[] {
    const named = settings.tax?.adapter;
    if (named === undefined && factory === undefined) {
        // The loader refuses a file with neither; a catalogue handed over in
        // code never meets the loader, and would start with no rate at all.
        return settings.vatRate === undefined
            ? [
                  'config/saas.yaml names neither vatRate nor a tax adapter under tax: name the rate the installation charges, or the adapter that decides it.',
              ]
            : [];
    }
    if (named === undefined) {
        return [
            `the application binds the tax adapter ${factory?.adapterName}, and config/saas.yaml#tax names none.`,
        ];
    }
    if (factory === undefined) {
        return [
            `config/saas.yaml#tax names the tax adapter ${named}, and the application binds none (SaaSiCatModule.forRoot({ tax: { adapter } })).`,
        ];
    }
    if (factory.adapterName !== named) {
        return [
            `config/saas.yaml#tax names the tax adapter ${named}, and the application binds ${factory.adapterName}.`,
        ];
    }
    const problems: string[] = [];
    if (settings.vatRate !== undefined) {
        problems.push('vatRate is not allowed beside tax: the adapter decides every rate.');
    }
    if (settings.timeZone === undefined) {
        problems.push('config/saas.yaml#timeZone is required with tax.');
    } else if (!knowsTimeZone(settings.timeZone)) {
        problems.push(
            `config/saas.yaml#timeZone names ${settings.timeZone}, which is not a time zone this runtime knows.`,
        );
    }
    if (problems.length > 0) return problems;
    let adapter: TaxAdapter;
    try {
        adapter = factory.create(settings.tax?.options ?? {});
    } catch (error) {
        return [
            `the tax adapter ${named} cannot be built from config/saas.yaml#tax.options: ${messageOf(error)}`,
        ];
    }
    if (adapter.name !== named) {
        return [`the factory for ${named} builds an adapter named ${adapter.name}.`];
    }
    const sample = sampleProblem(settings, adapter, now);
    return sample === null ? [] : [sample];
}

/**
 * The adapter `settings` name, built by `factory`, or `null` where neither
 * names one. Throws when the two do not fit, listing every problem.
 */
export function bindTaxAdapter(
    settings: PlanCatalogSettings,
    factory: TaxAdapterFactory | undefined,
    now: Date = new Date(),
): TaxAdapter | null {
    const problems = taxBindingProblems(settings, factory, now);
    if (problems.length > 0) {
        throw new Error(
            `Tax cannot start:\n${problems.map((problem) => `- ${problem}`).join('\n')}`,
        );
    }
    if (factory === undefined) return null;
    return factory.create(settings.tax?.options ?? {});
}
