// translation-catalogue: the German half of this file is German on purpose.
// The register of every invoice the installation issued: the months it is
// read for, what they add up to, and the invoices themselves. How an invoice
// stands to another, and its cancellation, are worded where the subscriber's
// record words them (`subscribers.payments`), so both screens say it alike.
import { defineMessages } from '../define.js';

export const invoicesMessages = defineMessages(
    {
        title: 'Rechnungen',
        subtitle:
            'Jede ausgestellte Rechnung der gewählten Monate – mit ihren Summen je Monat, Steuerbehandlung und Satz, so wie sie die Steuerberatung braucht.',
        from: 'Von (Monat)',
        until: 'Bis (Monat)',
        monthHint: 'JJJJ-MM',
        monthInvalid: 'Ein Monat wird als JJJJ-MM angegeben, etwa 2026-07.',
        loadFailed: 'Die Rechnungen konnten nicht geladen werden.',
        totalsTitle: 'Summen',
        totalsSubtitle:
            'Je Monat, Währung, Steuerbehandlung und Satz. Eine Stornorechnung zählt mit negativem Vorzeichen in dem Monat, in dem sie ausgestellt wurde.',
        wholeSpan: 'Gesamt {from} bis {until}',
        noInvoices: 'Keine Rechnung',
        columnMonth: 'Monat',
        columnTreatment: 'Steuer',
        columnNet: 'Netto',
        columnTax: 'Steuerbetrag',
        columnGross: 'Brutto',
        listTitle: 'Ausgestellte Rechnungen',
        listSubtitle: 'Nach Rechnungsdatum, dann nach Nummer.',
        empty: 'In diesen Monaten wurde keine Rechnung ausgestellt.',
        columnSubscriber: 'Vertragspartner',
        columnDocument: 'Dokument',
        documentArchived: 'archiviert',
        documentAwaited: 'ausstehend',
        openRecord: 'Vertragspartnerakte von {customerNumber} öffnen',
        more: 'Weitere laden',
        export: 'Exportieren',
        exportTitle: 'Rechnungen für die Steuerberatung exportieren',
        exportSubtitle:
            'Die Rechnungen von {from} bis {until} mit ihren Positionen und Zahlungen, so wie sie zum gewählten Stand erfasst waren – als ZIP mit Prüfsummen. Derselbe Stand ergibt dieselbe Datei.',
        exportAsOf: 'Stand (Tag und Uhrzeit)',
        exportAsOfHint:
            'Auf der Uhr der Installation. Leer gelassen: vor fünf Minuten. Später als vor fünf Minuten geht nicht, weil noch laufende Buchungen fehlen könnten.',
        exportAsOfInvalid: 'Ein Stand wird als Tag und Uhrzeit angegeben.',
        exportLocale: 'Sprache der Tabellen',
        exportLocaleDe: 'Deutsch (Semikolon, Dezimalkomma)',
        exportLocaleEn: 'Englisch (Komma, Dezimalpunkt)',
        exportSubmit: 'ZIP herunterladen',
        exported:
            'Der Export wurde heruntergeladen. Sein Dateiname nennt die Monate, den Stand und die Sprache.',
    },
    {
        title: 'Invoices',
        subtitle:
            'Every invoice issued in the months picked — with what it adds up to per month, tax treatment and rate, as a tax advisor needs it.',
        from: 'From (month)',
        until: 'Until (month)',
        monthHint: 'YYYY-MM',
        monthInvalid: 'A month is given as YYYY-MM, such as 2026-07.',
        loadFailed: 'The invoices could not be loaded.',
        totalsTitle: 'Totals',
        totalsSubtitle:
            'Per month, currency, tax treatment and rate. A cancellation invoice counts with a negative sign in the month it was issued.',
        wholeSpan: 'Total {from} to {until}',
        noInvoices: 'No invoice',
        columnMonth: 'Month',
        columnTreatment: 'Tax',
        columnNet: 'Net',
        columnTax: 'Tax amount',
        columnGross: 'Gross',
        listTitle: 'Issued invoices',
        listSubtitle: 'By issue date, then by number.',
        empty: 'No invoice was issued in these months.',
        columnSubscriber: 'Subscriber',
        columnDocument: 'Document',
        documentArchived: 'archived',
        documentAwaited: 'awaited',
        openRecord: 'Open the record of {customerNumber}',
        more: 'Load more',
        export: 'Export',
        exportTitle: 'Export the invoices for a tax advisor',
        exportSubtitle:
            'The invoices of {from} to {until} with their lines and payments, as recorded by the moment picked — as a ZIP with checksums. The same moment gives the same file.',
        exportAsOf: 'As of (day and time)',
        exportAsOfHint:
            'On the installation’s clock. Left empty: five minutes ago. A later moment is refused, because postings still under way could be missing.',
        exportAsOfInvalid: 'A moment is given as a day and a time.',
        exportLocale: 'Language of the tables',
        exportLocaleDe: 'German (semicolon, decimal comma)',
        exportLocaleEn: 'English (comma, decimal point)',
        exportSubmit: 'Download ZIP',
        exported:
            'The export was downloaded. Its file name names the months, the moment and the language.',
    },
);
