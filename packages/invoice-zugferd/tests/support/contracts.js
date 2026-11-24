// Contracts as the store reads them back, to render into the confirmation
// their subscriber keeps.

const ISSUER = {
    legalName: 'AutohausPro Software GmbH',
    vatId: 'DE123456789',
    taxNumber: '143/123/45678',
    addressLine1: 'Werkstraße 5',
    addressLine2: null,
    postalCode: '80331',
    city: 'München',
    country: 'DE',
};

/** A contract line as the freeze writes it. */
export function line(title, priceNet, overrides = {}) {
    return {
        id: `line-${title}`,
        contractId: 'contract-1',
        kind: 'plan',
        sourceKey: title,
        sourceVersionId: null,
        titleSnapshot: title,
        descriptionSnapshot: null,
        quantity: 1,
        unit: null,
        priceNet,
        priceGross: priceNet,
        billingCycle: 'monthly',
        currency: 'EUR',
        taxRate: 19,
        taxAmount: 0,
        minimumTermUntil: null,
        featuresSnapshot: [],
        quotaEffectsSnapshot: {},
        metadata: null,
        createdAt: new Date('2026-01-31T23:30:00.000Z'),
        ...overrides,
    };
}

/** A contract concluded half an hour after midnight in Berlin, on 1 February. */
export function aContract(overrides = {}) {
    return {
        id: 'contract-1',
        tenantId: 't1',
        subscriberId: 's1',
        subscriber: {
            customerNumber: 'K-10001',
            legalName: 'Autohaus Müller GmbH & Co. KG',
            vatId: null,
            taxNumber: null,
            addressLine1: 'Ringstraße 1',
            addressLine2: null,
            postalCode: '20095',
            city: 'Hamburg',
            country: 'DE',
        },
        issuer: ISSUER,
        partiesMigrated: false,
        taxTreatment: {
            kind: 'standard',
            rate: 19,
            note: null,
            adapter: { name: '@saasicat/tax-de', version: '1.0.0' },
        },
        cancellationNoticeDays: 14,
        termsVersion: '2026-10',
        agreedAt: new Date('2026-01-31T23:30:00.000Z'),
        status: 'active',
        effectiveFrom: new Date('2026-01-31T23:00:00.000Z'),
        effectiveUntil: null,
        originalOfferId: null,
        originalPlanVersionId: null,
        originalBundleVersionIds: [],
        entitlementSnapshot: null,
        priceSnapshot: {
            currency: 'EUR',
            billingCycle: 'monthly',
            subtotalNet: 64,
            discountNet: 4.9,
            totalNet: 59.1,
            vatRate: 19,
            totalGross: 70.33,
        },
        promotionSnapshots: [],
        promoCodeSnapshots: [],
        termsSnapshot: null,
        lineItems: [
            line('Standard, monatlich', 49, {
                minimumTermUntil: new Date('2027-01-31T23:00:00.000Z'),
            }),
            line('Zusatzmodul Werkstatt', 15),
            line('Willkommensrabatt 10 %', -4.9),
        ],
        createdAt: new Date('2026-01-31T23:30:00.000Z'),
        updatedAt: new Date('2026-01-31T23:30:00.000Z'),
        ...overrides,
    };
}

/** The footer lines of the issuer's letters. */
export const FOOTER = ['Amtsgericht München HRB 123456 · Geschäftsführerin: Erika Muster'];

/** What a confirmation of `contract` is rendered from, made live unless `testOperation` says otherwise. */
export function toConfirm(contract = aContract(), { footer = FOOTER, testOperation = false } = {}) {
    return { contract, footer, timeZone: 'Europe/Berlin', testOperation };
}
