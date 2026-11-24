// translation-catalogue — the wording below is German on purpose, with English
// beside it.
//
// What a document issued in a test operation says it is: its title, and the
// notice that stands under the title, at the foot of every page and, on an
// invoice, as the first note of its XML. Kept in this one place, so that every
// renderer, the shipped one and an application's own, says the same.
//
// The notice does not say that nothing is owed: an invoice of a test
// operation falls due and is collected as any other, and a document that
// said otherwise would contradict what the software does with it.

/** A text in German and in English. */
export interface TestOperationText {
    readonly de: string;
    readonly en: string;
}

/** What each kind of document is titled when it is issued in a test operation. */
export const TEST_OPERATION_TITLE = {
    /** An invoice, a replacement among them. */
    invoice: { de: 'Testrechnung', en: 'Test invoice' },
    cancellation: { de: 'Test-Stornorechnung', en: 'Test cancellation invoice' },
    confirmation: { de: 'Test-Vertragsbestätigung', en: 'Test contract confirmation' },
} as const satisfies Record<string, TestOperationText>;

/** What a document issued in a test operation says it is not. */
export const TEST_OPERATION_NOTICE = {
    /** Every invoice: a cancellation invoice and a replacement too. */
    invoice: {
        de: 'Testrechnung – keine Rechnung im Sinne des UStG',
        en: 'Test invoice – not an invoice for VAT purposes',
    },
    confirmation: {
        de: 'Test-Vertragsbestätigung – bestätigt keinen Vertrag',
        en: 'Test contract confirmation – confirms no contract',
    },
} as const satisfies Record<string, TestOperationText>;
