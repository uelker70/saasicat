// translation-catalogue: the German half of this file is German on purpose.
import { defineMessages } from '../define.js';

export const reconciliationMessages = defineMessages(
    {
        title: 'Abgleich',
        subtitle:
            'Was das Gateway meldete und zu nichts passte: eine Erstattung, die kein Guthaben deckt, eine Rückbuchung, die auf ein schon ausgezahltes Guthaben trifft. Jeder Fall wird mit einer Notiz geschlossen.',
        loadFailed: 'Die Fälle konnten nicht geladen werden.',
        open: 'Offen',
        closed: 'Geschlossen',
        emptyOpen: 'Nichts abzugleichen.',
        emptyClosed: 'Noch kein Fall geschlossen.',
        more: 'Weitere laden',
        kinds: {
            REFUND_UNMATCHED: 'Erstattung ohne Guthaben',
            REVERSAL_UNMATCHED: 'Rückbuchung ohne Guthaben',
        },
        columns: {
            recordedAt: 'Erfasst am',
            kind: 'Fall',
            subscriber: 'Kunde',
            payment: 'Zahlung',
            reference: 'Referenz',
            amount: 'Betrag',
            closedAt: 'Geschlossen am',
            note: 'Notiz',
        },
        payment: '{paymentRef} zu {invoiceNumber}',
        unknownInvoice: 'unbekannte Rechnung',
        closedBySaaSiCat: 'von SaaSiCat',
        close: 'Schließen',
        mfaClose: 'Fall schließen. TOTP-Code eingeben.',
        dialog: {
            title: 'Fall schließen',
            intro: '{kind} über {amount}, Referenz {reference}.',
            note: 'Notiz',
            noteHint:
                'Warum der Fall erledigt ist — etwa die Überweisung, mit der er ausgeglichen wurde.',
            submit: 'Schließen',
            done: 'Fall geschlossen.',
        },
    },
    {
        title: 'Reconciliation',
        subtitle:
            'What the gateway reported and nothing matched: a refund no credit covers, a reversal that meets a credit already paid out. Each case is closed with a note.',
        loadFailed: 'The cases could not be loaded.',
        open: 'Open',
        closed: 'Closed',
        emptyOpen: 'Nothing to reconcile.',
        emptyClosed: 'No case closed yet.',
        more: 'Load more',
        kinds: {
            REFUND_UNMATCHED: 'Refund without a credit',
            REVERSAL_UNMATCHED: 'Reversal without a credit',
        },
        columns: {
            recordedAt: 'Recorded on',
            kind: 'Case',
            subscriber: 'Customer',
            payment: 'Payment',
            reference: 'Reference',
            amount: 'Amount',
            closedAt: 'Closed on',
            note: 'Note',
        },
        payment: '{paymentRef} for {invoiceNumber}',
        unknownInvoice: 'unknown invoice',
        closedBySaaSiCat: 'by SaaSiCat',
        close: 'Close',
        mfaClose: 'Close the case. Enter the TOTP code.',
        dialog: {
            title: 'Close case',
            intro: '{kind} of {amount}, reference {reference}.',
            note: 'Note',
            noteHint: 'Why the case is settled — such as the transfer that evened it out.',
            submit: 'Close',
            done: 'Case closed.',
        },
    },
);
