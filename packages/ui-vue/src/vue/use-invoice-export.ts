// The export of the invoice register for a tax advisor (`SC-ADM-043`): the
// months the register shows, as of a moment the operator may name — a day and a
// time on the installation's clock, five minutes ago where none is —, in the
// language the CSV is written in, handed to the browser as the ZIP the platform
// serves. A moment that is none is said before anything is asked, by the rule
// the platform refuses it by.
//
// A composable rather than page script, so what is asked for can be checked
// with `node --test` against `dist/`.

import type { Ref } from 'vue';
import {
    INVOICE_EXPORT_LOCALES,
    isLocalMoment,
    type CalendarMonth,
    type InvoiceExportLocale,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { invoicesResource } from '../client/resources/invoices.resource.js';
import type { DownloadedFile } from '../client/resources/resource-request.js';
import { saveFile } from '../client/save-file.js';

/** The operation the export calls, already bound to the shell's client. */
export type InvoiceExportResource = Pick<Bound<(typeof invoicesResource)['ops']>, 'export'>;

export interface InvoiceExportPorts {
    /** Hands the archive to the browser; `saveFile` unless a test says otherwise. */
    save?: (file: DownloadedFile) => void;
}

/** What a dialog asks of an export: the moment and the language. */
export interface InvoiceExportDraft {
    /** The moment as a `datetime-local` input holds it; empty for five minutes ago. */
    asOf: string;
    /** The language of the CSV tables. */
    locale: InvoiceExportLocale;
}

export interface InvoiceExport {
    /** What a dialog starts from: five minutes ago, in the screen's language. */
    draft(): InvoiceExportDraft;
    /** Whether the platform reads the draft's moment as one; an empty one it does. */
    isValid(draft: InvoiceExportDraft): boolean;
    /**
     * Downloads the archive of the months as the draft asks and hands it to
     * the browser. A refusal is thrown, for the dialog that asked to say.
     */
    download(draft: InvoiceExportDraft): Promise<DownloadedFile>;
}

/**
 * The language the tables are written in where the operator picks none: the
 * screen's, where the export writes it, and English otherwise.
 */
export function invoiceExportLocaleOf(screen: string): InvoiceExportLocale {
    return (
        INVOICE_EXPORT_LOCALES.find((each) => screen === each || screen.startsWith(`${each}-`)) ??
        'en'
    );
}

export function useInvoiceExport(
    invoices: InvoiceExportResource,
    months: { from: Ref<CalendarMonth>; until: Ref<CalendarMonth> },
    screen: Ref<string>,
    ports: InvoiceExportPorts = {},
): InvoiceExport {
    const save = ports.save ?? saveFile;
    return {
        draft: () => ({ asOf: '', locale: invoiceExportLocaleOf(screen.value) }),
        isValid: (draft) => draft.asOf === '' || isLocalMoment(draft.asOf),
        async download(draft) {
            // An empty input is no moment asked for, as an empty month is none.
            const file = await invoices.export({
                from: months.from.value || undefined,
                until: months.until.value || undefined,
                asOf: draft.asOf || undefined,
                locale: draft.locale,
            });
            save(file);
            return file;
        },
    };
}
