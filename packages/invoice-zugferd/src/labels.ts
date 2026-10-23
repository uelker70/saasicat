// translation-catalogue — the labels below are German on purpose, with English
// beside them.
//
// What the page calls each part of an invoice: in German, with English beside
// it, so that a subscriber abroad reads it too — the notes for the treatments
// that reach one are bilingual already.

/** A label in German and in English. */
export interface Label {
    de: string;
    en: string;
}

export const LABELS = {
    title: { de: 'Rechnung', en: 'Invoice' },
    // A cancellation is "Stornorechnung": "Gutschrift" is the word German VAT
    // law reads as self-billing by the recipient (`SC-PRIC-089`).
    cancellationTitle: { de: 'Stornorechnung', en: 'Cancellation invoice' },
    cancels: { de: 'Storniert Rechnung', en: 'Cancels invoice' },
    replaces: { de: 'Ersetzt Rechnung', en: 'Replaces invoice' },
    number: { de: 'Rechnungsnummer', en: 'Invoice no.' },
    issueDate: { de: 'Rechnungsdatum', en: 'Invoice date' },
    servicePeriod: { de: 'Leistungszeitraum', en: 'Service period' },
    customerNumber: { de: 'Kundennummer', en: 'Customer no.' },
    dueDate: { de: 'Fällig am', en: 'Due date' },
    vatId: { de: 'USt-IdNr.', en: 'VAT ID' },
    taxNumber: { de: 'Steuernummer', en: 'Tax number' },
    position: { de: 'Pos.', en: 'Item' },
    description: { de: 'Leistung', en: 'Description' },
    period: { de: 'Zeitraum', en: 'Period' },
    net: { de: 'Netto', en: 'Net' },
    netTotal: { de: 'Summe netto', en: 'Net total' },
    vat: { de: 'USt', en: 'VAT' },
    on: { de: 'auf', en: 'on' },
    grandTotal: { de: 'Gesamtbetrag', en: 'Total' },
    alreadyPaid: { de: 'Bereits bezahlt', en: 'Already paid' },
    amountDue: { de: 'Zu zahlen', en: 'Amount due' },
    page: { de: 'Seite', en: 'Page' },
    of: { de: 'von', en: 'of' },
} as const satisfies Record<string, Label>;

/** What a contract's confirmation calls each of its parts, as the invoice's are called. */
export const CONFIRMATION_LABELS = {
    title: { de: 'Vertragsbestätigung', en: 'Contract confirmation' },
    contract: { de: 'Vertrag', en: 'Contract' },
    concludedOn: { de: 'Geschlossen am', en: 'Concluded on' },
    start: { de: 'Beginn', en: 'Start' },
    billing: { de: 'Abrechnung', en: 'Billing' },
    minimumTerm: { de: 'Mindestlaufzeit bis', en: 'Minimum term until' },
    subtotal: { de: 'Zwischensumme netto', en: 'Subtotal net' },
    discount: { de: 'Rabatt', en: 'Discount' },
    perPeriod: { de: 'Alle Beträge je Abrechnungszeitraum', en: 'All amounts per billing period' },
    noticePeriod: { de: 'Kündigungsfrist', en: 'Notice period' },
    days: { de: 'Tage', en: 'days' },
    monthly: { de: 'monatlich', en: 'monthly' },
    yearly: { de: 'jährlich', en: 'yearly' },
} as const satisfies Record<string, Label>;

/** Which terms the contract was concluded under, in German and in English. */
export function termsNoteOf(version: string | null): Label {
    if (version === null) {
        return {
            de: 'Für diesen Vertrag wurden keine Allgemeinen Geschäftsbedingungen vereinbart.',
            en: 'No terms and conditions were agreed for this contract.',
        };
    }
    return {
        de: `Es gelten die Allgemeinen Geschäftsbedingungen in der Fassung ${version}; sie liegen dieser Bestätigung bei.`,
        en: `The terms and conditions of version ${version} apply; they are attached to this confirmation.`,
    };
}

/** A label as the page shows it: `Rechnung / Invoice`. */
export function bilingual(label: Label): string {
    return `${label.de} / ${label.en}`;
}
