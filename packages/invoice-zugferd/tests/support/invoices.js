// Invoices as the store reads them back, one for each treatment the German
// adapter decides and one long enough to run on to further pages. The tests
// render them, and CI hands the files to the format's own validators
// (`scripts/write-samples.mjs`).

const ISSUED_AT = new Date('2026-02-01T05:15:00.000Z');

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

const SUBSCRIBER = {
    customerNumber: 'K-10001',
    legalName: 'Autohaus Müller GmbH & Co. KG',
    vatId: null,
    taxNumber: null,
    addressLine1: 'Ringstraße 1',
    addressLine2: 'Hinterhaus',
    postalCode: '20095',
    city: 'Hamburg',
    country: 'DE',
};

const FOOTER = [
    'Amtsgericht München HRB 123456 · Geschäftsführerin: Erika Muster',
    'Bankverbindung: IBAN DE02 1203 0000 0000 2020 51 · BIC BYLADEM1001',
];

/**
 * The widest footer the configuration accepts: six lines of 120 characters,
 * each in letters wide enough to run past the page's edge.
 */
const WIDEST_FOOTER = [
    'W'.repeat(120),
    ...Array.from({ length: 5 }, (_, index) =>
        `${index + 2}. ${'WMW '.repeat(30)}`.slice(0, 120).trimEnd(),
    ),
];

const ADAPTER = { name: '@saasicat/tax-de', version: '1.0.0-rc.26' };

/** A line as the store reads it back. */
function line(position, title, amountNet, taxRate, overrides = {}) {
    return {
        id: `line-${position}`,
        invoiceId: 'invoice-1',
        position,
        chargeId: `charge-${position}`,
        contractLineItemId: `contract-line-${position}`,
        title,
        origin: 'renewal',
        source: amountNet < 0 ? 'discount' : 'plan',
        periodFrom: '2026-02-01',
        periodUntil: '2026-02-28',
        amountNet,
        taxRate,
        ...overrides,
    };
}

/** An invoice of `lines` under `treatment`, its tax computed once per rate. */
function invoice(
    name,
    { treatment, lines, issuer = ISSUER, subscriber = SUBSCRIBER, footer = FOOTER, number },
) {
    const net = Math.round(lines.reduce((sum, each) => sum + each.amountNet * 100, 0)) / 100;
    const tax = Math.round(net * treatment.rate) / 100;
    return {
        name,
        invoice: {
            id: `invoice-${name}`,
            number: number ?? 'AHP-2026-000123',
            numberPrefix: 'AHP',
            numberYear: 2026,
            numberSequence: 123,
            tenantId: 'tenant-1',
            subscriberId: 'subscriber-1',
            subscriptionId: 'sub-1',
            contractId: 'contract-1',
            issuedAt: ISSUED_AT,
            issueDate: '2026-02-01',
            dueDate: '2026-02-15',
            servicePeriodFrom: '2026-02-01',
            servicePeriodUntil: '2026-02-28',
            currency: 'EUR',
            issuer,
            subscriber,
            footer,
            taxTreatment: { ...treatment, adapter: ADAPTER },
            taxes: [{ rate: treatment.rate, net, tax }],
            totalNet: net,
            totalTax: tax,
            totalGross: Math.round((net + tax) * 100) / 100,
            lines,
            createdAt: ISSUED_AT,
        },
    };
}

export const SAMPLES = [
    invoice('standard', {
        treatment: { kind: 'standard', rate: 19, note: null },
        lines: [
            line(1, 'Standard, monatlich', 49, 19),
            line(2, 'Zusatzmodul Werkstattplanung', 19.9, 19),
            line(3, 'Willkommensrabatt 10 %', -4.9, 19),
        ],
    }),
    invoice('small-business', {
        treatment: {
            kind: 'small-business',
            rate: 0,
            note: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
        },
        lines: [line(1, 'Standard, monatlich', 49, 0)],
    }),
    invoice('small-business-tax-number-only', {
        treatment: {
            kind: 'small-business',
            rate: 0,
            note: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.',
        },
        issuer: { ...ISSUER, legalName: 'Erika Muster IT-Service', vatId: null },
        lines: [line(1, 'Standard, monatlich', 49, 0)],
    }),
    invoice('reverse-charge', {
        treatment: {
            kind: 'reverse-charge',
            rate: 0,
            note: 'Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG) / Reverse charge',
        },
        subscriber: {
            ...SUBSCRIBER,
            legalName: 'Autohaus Gruber GmbH',
            vatId: 'ATU12345678',
            addressLine1: 'Mariahilfer Straße 10',
            addressLine2: null,
            postalCode: '1070',
            city: 'Wien',
            country: 'AT',
        },
        lines: [line(1, 'Standard, monatlich', 49, 0)],
    }),
    invoice('not-taxable', {
        treatment: {
            kind: 'not-taxable',
            rate: 0,
            note: 'Nicht im Inland steuerbare Leistung / Service not taxable in Germany',
        },
        subscriber: {
            ...SUBSCRIBER,
            legalName: 'Garage Dupont SA',
            vatId: 'CHE-123.456.789',
            addressLine1: 'Rue du Lac 12',
            addressLine2: null,
            postalCode: '1201',
            city: 'Genève',
            country: 'CH',
        },
        lines: [line(1, 'Standard, monatlich', 49, 0)],
    }),
    invoice('unusual-characters', {
        treatment: { kind: 'standard', rate: 19, note: null },
        subscriber: {
            ...SUBSCRIBER,
            // A vertical tab and a form feed, pasted with the name and the
            // address: XML cannot hold either at all.
            legalName: '株式会社 Müller &\vSöhne <GmbH>',
            addressLine1: 'Ringstraße 1\f',
            addressLine2: 'z. Hd. Γιώργος Παπαδόπουλος / Ольга Иванова',
        },
        lines: [line(1, 'Paket „Premium“ – 50 % auf <alles> & mehr 🚗', 49, 19)],
    }),
    invoice('long-names', {
        treatment: { kind: 'standard', rate: 19, note: null },
        issuer: {
            ...ISSUER,
            legalName: 'SaaSiCat Software Entwicklungs- und Vertriebsgesellschaft mbH & Co. KG',
            addressLine1: 'Gewerbepark an der Alten Ziegelei, Halle 7, Aufgang C, 3. Obergeschoss',
            addressLine2:
                'c/o Huber & Partner Steuerberatungsgesellschaft mbB, Zweigniederlassung Oberland',
            city: 'Garmisch-Partenkirchen',
        },
        subscriber: {
            ...SUBSCRIBER,
            legalName: 'Müller & Söhne Gebäudereinigung und Hausmeisterservice GmbH & Co. KG',
            vatId: 'DE111111111',
            // Up to the 200 characters the billing details accept, in each line.
            addressLine1:
                'Industriestraße 12–14, Gebäude B, Eingang über den Hof hinter der Tankstelle, zweite Tür links, Anlieferung nur werktags zwischen 7 und 15 Uhr, bitte vorher beim Pförtner melden und den Ausweis zeigen',
            addressLine2:
                'Donaudampfschifffahrtsgesellschaftskapitänswitwenrentenversicherungsanstalt, Abteilung Gebäudemanagement, Referat Liegenschaften Nord, Sachgebiet Reinigung und Instandhaltung, Zimmer 4.117',
        },
        lines: [line(1, 'Standard, monatlich', 49, 19)],
    }),
    invoice('widest-footer', {
        treatment: { kind: 'standard', rate: 19, note: null },
        footer: WIDEST_FOOTER,
        lines: Array.from({ length: 30 }, (_, index) =>
            line(index + 1, `Zusatzmodul ${index + 1}`, 9.95, 19),
        ),
    }),
    invoice('many-lines', {
        treatment: { kind: 'standard', rate: 19, note: null },
        footer: [...FOOTER, 'Sitz der Gesellschaft: München', 'www.autohauspro.example'],
        lines: Array.from({ length: 48 }, (_, index) =>
            line(
                index + 1,
                index % 7 === 0
                    ? `Zusatzmodul ${index + 1} mit einer Beschreibung, die über mehr als eine Zeile der Spalte läuft und dort umbricht`
                    : `Zusatzmodul ${index + 1}`,
                index % 5 === 4 ? -2.5 : 9.95,
                19,
            ),
        ),
    }),
];
