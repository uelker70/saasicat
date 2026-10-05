// A tax adapter in the shape of `@saasicat/tax-de`, without depending on it:
// the German rate in Germany, the reverse charge to a business elsewhere in the
// Union with a validated number, nothing to a business outside it, and no
// treatment for anything else.

import { TaxTreatments } from '../../dist/billing/index.js';
import { SubscriberService } from '../../dist/subscriber/index.js';
import { FakeSubscriberRepository } from '../../dist/testing/index.js';

const EU = new Set(['AT', 'FR', 'IT', 'NL']);

/** The name and version the adapter records on every treatment it decides. */
export const TEST_TAX_ADAPTER_IDENTITY = { name: 'test-tax', version: '3.0.0' };

const treated = (kind, rate) => ({
    supported: true,
    treatment: { kind, rate, note: null, adapter: TEST_TAX_ADAPTER_IDENTITY },
});

export const TEST_TAX_ADAPTER = {
    ...TEST_TAX_ADAPTER_IDENTITY,
    decide: ({ origin }) => {
        if (origin.country === 'DE') return treated('standard', 19);
        if (origin.business !== true)
            return { supported: false, reason: 'A consumer outside Germany is not supported.' };
        if (EU.has(origin.country)) {
            return origin.validatedVatId
                ? treated('reverse-charge', 0)
                : { supported: false, reason: 'No validated VAT number.' };
        }
        return treated('not-taxable', 0);
    },
    checkVatId: async () => ({ completed: false, reason: 'not asked' }),
};

/** What `config/saas.yaml` says in an installation that names the adapter above. */
export const TAX_SETTINGS = {
    currency: 'EUR',
    timeZone: 'Europe/Berlin',
    tax: { adapter: 'test-tax' },
    issuer: { legalName: 'Issuer GmbH', country: 'DE', vatId: 'DE123456789' },
};

/** The rates of an installation whose settings name the adapter above. */
export const taxesDeciding = (settings = TAX_SETTINGS) =>
    new TaxTreatments(settings, TEST_TAX_ADAPTER);

/** A subscriber's tax origin as the adapter reads it. */
export const originIn = (country, { business = false, validatedVatId = null } = {}) => ({
    country,
    business,
    vatId: validatedVatId,
    validatedVatId,
});

/** What the rates throw for a case the adapter supports no treatment for. */
export function unsupportedTaxCase() {
    const period = {
        from: new Date('2026-06-01T00:00:00.000Z'),
        until: new Date('2026-07-01T00:00:00.000Z'),
    };
    try {
        taxesDeciding().decide(originIn('FR'), period);
    } catch (error) {
        return error;
    }
    throw new Error('the test adapter treats a consumer in France');
}

/**
 * What the platform throws, where an adapter decides, for a subscriber whose
 * invoice address lacks `missing` — asked of the subscribers themselves rather
 * than built here, so a test holds the refusal as it is thrown.
 */
export async function incompleteAddressRefusal(missing) {
    const subscribers = new SubscriberService(new FakeSubscriberRepository(), {
        ...TAX_SETTINGS,
        app: { name: 'Test App' },
    });
    const address = {
        addressLine1: 'Main Street 1',
        postalCode: '10115',
        city: 'Berlin',
        country: 'DE',
    };
    for (const field of missing) address[field] = null;
    await subscribers.createForTenant('tenant-incomplete', {
        legalName: 'Customer GmbH',
        ...address,
    });
    try {
        await subscribers.contractPartyFor('tenant-incomplete', { forTaxAdapter: true });
    } catch (error) {
        return error;
    }
    throw new Error(`a subscriber without ${missing.join(', ')} was not refused`);
}
