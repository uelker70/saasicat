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
    page: { de: 'Seite', en: 'Page' },
    of: { de: 'von', en: 'of' },
} as const satisfies Record<string, Label>;

/** A label as the page shows it: `Rechnung / Invoice`. */
export function bilingual(label: Label): string {
    return `${label.de} / ${label.en}`;
}
