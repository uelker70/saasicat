// The invoice register's export as of a stated moment (`SC-ADM-043`): which
// moment an export may be as of, what it holds as of that moment, and the files
// it is written to. Pure, so the same source as of the same moment gives the
// same rows and the same bytes every time; the archive and the checksums are
// the caller's, which has the runtime for them.
//
// As of a moment means: the invoices issued by then, the settlements and the
// cancellations recorded by then — after the period ended too — and a
// document's checksum where the archive had confirmed it by then. Nothing a
// store records later changes a row of an earlier moment; a later moment shows
// it beside them.

import { INVOICE_ERROR_CODES } from './error-codes.js';
import type {
    InvoiceExport,
    InvoiceExportFile,
    InvoiceExportInvoiceRow,
    InvoiceExportLineRow,
    InvoiceExportLocale,
    InvoiceExportManifest,
    InvoiceExportSettlementRow,
    InvoiceExportSource,
} from './invoice-export.types.js';
import { INVOICE_EXPORT_FORMAT_VERSION, INVOICE_EXPORT_SETTLE_MS } from './invoice-export.types.js';
import type { InvoiceRegisterSpan } from './invoice-register.js';
import type { SubscriptionInvoiceRecord } from './subscription-invoice.types.js';
import { firstMomentInZone, localMomentInZone, type LocalMoment } from './zoned-day.js';

const MS_PER_SECOND = 1000;

/** A refusal of the moment an export was asked for, with what the message needs. */
export interface InvoiceExportAsOfRefusal {
    code: typeof INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_EXPORT_AS_OF_TOO_LATE;
    params: { asOf: LocalMoment; latest: LocalMoment };
}

/**
 * The moment an export is as of: the one `asked` names on a clock of the
 * installation's zone, or, where none is asked for, the latest one an export
 * may be as of — `INVOICE_EXPORT_SETTLE_MS` before `now` — to the whole second,
 * so that the moment the manifest names, asked for again, reads the same rows.
 * Refused where `asked` lies after that latest moment. Throws a `RangeError`
 * for an `asked` that is no day and time.
 */
export function invoiceExportAsOfOf(
    asked: LocalMoment | undefined,
    now: Date,
    timeZone: string,
): { asOf: Date; refusal: null } | { asOf: null; refusal: InvoiceExportAsOfRefusal } {
    const settled = now.getTime() - INVOICE_EXPORT_SETTLE_MS;
    const latest = new Date(Math.floor(settled / MS_PER_SECOND) * MS_PER_SECOND);
    if (asked === undefined) return { asOf: latest, refusal: null };
    const asOf = firstMomentInZone(asked, timeZone);
    if (asOf.getTime() > latest.getTime()) {
        return {
            asOf: null,
            refusal: {
                code: INVOICE_ERROR_CODES.SUBSCRIPTION_INVOICE_EXPORT_AS_OF_TOO_LATE,
                params: { asOf: asked, latest: localMomentInZone(latest, timeZone) },
            },
        };
    }
    return { asOf, refusal: null };
}

/** What an invoice is, read off what it corrects. */
function kindOf(invoice: SubscriptionInvoiceRecord): InvoiceExportInvoiceRow['kind'] {
    return invoice.correction?.kind ?? 'invoice';
}

const iso = (at: Date | null): string | null => (at ? at.toISOString() : null);
const byOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The export of the invoices `source` holds for `span`, as of `asOf`: those
 * issued by then, each with the cancellation that cancelled it by then, its
 * document's checksum where archived by then, its lines, and the settlements
 * recorded against it by then. The invoices by issue date and number, as the
 * store hands them, each one's lines by position, the settlements by invoice,
 * then by when each was recorded.
 */
export function invoiceExportOf(input: {
    span: Pick<InvoiceRegisterSpan, 'from' | 'until'>;
    asOf: Date;
    timeZone: string;
    source: InvoiceExportSource;
}): InvoiceExport {
    const { span, asOf, timeZone, source } = input;
    const by = asOf.getTime();
    const invoices = source.invoices
        .map(({ invoice }) => invoice)
        .filter((invoice) => invoice.issuedAt.getTime() <= by);
    // Every invoice a row names by its number, whichever span it was issued in:
    // the invoices themselves, what each corrects, and what cancelled each.
    const numberOf = new Map<string, string>();
    for (const { invoice, cancelledBy } of source.invoices) {
        numberOf.set(invoice.id, invoice.number);
        if (invoice.correction)
            numberOf.set(invoice.correction.of.invoiceId, invoice.correction.of.number);
        if (cancelledBy) numberOf.set(cancelledBy.invoiceId, cancelledBy.number);
    }
    const cancellations = source.cancellations.filter((each) => each.cancelledAt.getTime() <= by);
    const cancellationOf = new Map(cancellations.map((each) => [each.cancelledInvoiceId, each]));
    const cancelledThrough = new Map(cancellations.map((each) => [each.id, each]));
    const documents = new Map(
        source.documents
            .filter((document) => document.archivedAt && document.archivedAt.getTime() <= by)
            .map((document) => [document.invoiceId, document]),
    );
    const listed = new Set(invoices.map((invoice) => invoice.id));

    const invoiceRows = invoices.map((invoice): InvoiceExportInvoiceRow => {
        const cancellation = cancellationOf.get(invoice.id);
        const document = documents.get(invoice.id);
        const party = invoice.subscriber;
        return {
            invoiceId: invoice.id,
            number: invoice.number,
            kind: kindOf(invoice),
            corrects: invoice.correction?.of.number ?? null,
            issueDate: invoice.issueDate,
            issuedAt: invoice.issuedAt.toISOString(),
            dueDate: invoice.dueDate,
            servicePeriodFrom: invoice.servicePeriodFrom,
            servicePeriodUntil: invoice.servicePeriodUntil,
            currency: invoice.currency,
            totalNet: invoice.totalNet,
            totalTax: invoice.totalTax,
            totalGross: invoice.totalGross,
            taxTreatment: invoice.taxTreatment.kind,
            taxRate: invoice.taxTreatment.rate,
            taxNote: invoice.taxTreatment.note,
            subscriberId: invoice.subscriberId,
            tenantId: invoice.tenantId,
            customerNumber: party.customerNumber,
            legalName: party.legalName,
            vatId: party.vatId,
            taxNumber: party.taxNumber,
            addressLine1: party.addressLine1,
            addressLine2: party.addressLine2,
            postalCode: party.postalCode,
            city: party.city,
            country: party.country,
            cancelledBy: cancellation
                ? (numberOf.get(cancellation.cancellationInvoiceId) ?? null)
                : null,
            cancelledAt: iso(cancellation?.cancelledAt ?? null),
            documentChecksum: document?.checksum ?? null,
            documentArchivedAt: iso(document?.archivedAt ?? null),
            documentFileName: document?.fileName ?? null,
        };
    });

    const lineRows = invoices.flatMap((invoice) =>
        [...invoice.lines]
            .sort((a, b) => a.position - b.position)
            .map((line): InvoiceExportLineRow => ({
                invoiceId: invoice.id,
                invoiceNumber: invoice.number,
                position: line.position,
                title: line.title,
                origin: line.origin,
                source: line.source,
                periodFrom: line.periodFrom,
                periodUntil: line.periodUntil,
                amountNet: line.amountNet,
                taxTreatment: invoice.taxTreatment.kind,
                taxRate: line.taxRate,
                correctsPosition: line.correctedPosition,
            })),
    );

    const order = new Map(invoices.map((invoice, index) => [invoice.id, index]));
    const currencyOf = new Map(invoices.map((invoice) => [invoice.id, invoice.currency]));
    const settlementRows = source.settlements
        .filter((each) => listed.has(each.invoiceId) && each.recordedAt.getTime() <= by)
        .sort(
            (a, b) =>
                (order.get(a.invoiceId) ?? 0) - (order.get(b.invoiceId) ?? 0) ||
                a.recordedAt.getTime() - b.recordedAt.getTime() ||
                byOrder(a.id, b.id),
        )
        .map((each): InvoiceExportSettlementRow => {
            const cancellation = each.cancellationId
                ? cancelledThrough.get(each.cancellationId)
                : undefined;
            return {
                settlementId: each.id,
                invoiceId: each.invoiceId,
                invoiceNumber: numberOf.get(each.invoiceId) ?? each.invoiceId,
                kind: each.kind,
                amount: each.amount,
                currency: currencyOf.get(each.invoiceId) ?? '',
                recordedAt: each.recordedAt.toISOString(),
                paymentId: each.payment.id,
                provider: each.payment.provider,
                gatewayAccount: each.payment.gatewayAccount,
                paymentReference: each.payment.gatewayRef,
                reversalReference: each.reversal?.gatewayRef ?? null,
                cancellationOf: cancellation
                    ? (numberOf.get(cancellation.cancelledInvoiceId) ??
                      cancellation.cancelledInvoiceId)
                    : null,
            };
        });

    return {
        formatVersion: INVOICE_EXPORT_FORMAT_VERSION,
        period: { from: span.from, until: span.until },
        asOf: asOf.toISOString(),
        asOfLocal: localMomentInZone(asOf, timeZone),
        timeZone,
        invoices: invoiceRows,
        lines: lineRows,
        settlements: settlementRows,
    };
}

/** How a cell is written: as text, or as an amount or a number in the locale's notation. */
type CellKind = 'text' | 'amount' | 'number';
type Columns<Row> = ReadonlyArray<readonly [keyof Row & string, CellKind]>;

const INVOICE_COLUMNS: Columns<InvoiceExportInvoiceRow> = [
    ['invoiceId', 'text'],
    ['number', 'text'],
    ['kind', 'text'],
    ['corrects', 'text'],
    ['issueDate', 'text'],
    ['issuedAt', 'text'],
    ['dueDate', 'text'],
    ['servicePeriodFrom', 'text'],
    ['servicePeriodUntil', 'text'],
    ['currency', 'text'],
    ['totalNet', 'amount'],
    ['totalTax', 'amount'],
    ['totalGross', 'amount'],
    ['taxTreatment', 'text'],
    ['taxRate', 'number'],
    ['taxNote', 'text'],
    ['subscriberId', 'text'],
    ['tenantId', 'text'],
    ['customerNumber', 'text'],
    ['legalName', 'text'],
    ['vatId', 'text'],
    ['taxNumber', 'text'],
    ['addressLine1', 'text'],
    ['addressLine2', 'text'],
    ['postalCode', 'text'],
    ['city', 'text'],
    ['country', 'text'],
    ['cancelledBy', 'text'],
    ['cancelledAt', 'text'],
    ['documentChecksum', 'text'],
    ['documentArchivedAt', 'text'],
    ['documentFileName', 'text'],
];

const LINE_COLUMNS: Columns<InvoiceExportLineRow> = [
    ['invoiceId', 'text'],
    ['invoiceNumber', 'text'],
    ['position', 'number'],
    ['title', 'text'],
    ['origin', 'text'],
    ['source', 'text'],
    ['periodFrom', 'text'],
    ['periodUntil', 'text'],
    ['amountNet', 'amount'],
    ['taxTreatment', 'text'],
    ['taxRate', 'number'],
    ['correctsPosition', 'number'],
];

const SETTLEMENT_COLUMNS: Columns<InvoiceExportSettlementRow> = [
    ['settlementId', 'text'],
    ['invoiceId', 'text'],
    ['invoiceNumber', 'text'],
    ['kind', 'text'],
    ['amount', 'amount'],
    ['currency', 'text'],
    ['recordedAt', 'text'],
    ['paymentId', 'text'],
    ['provider', 'text'],
    ['gatewayAccount', 'text'],
    ['paymentReference', 'text'],
    ['reversalReference', 'text'],
    ['cancellationOf', 'text'],
];

/** The separators each language writes its CSV with. */
const NOTATION: Readonly<
    Record<InvoiceExportLocale, { delimiter: string; decimalSeparator: string }>
> = {
    de: { delimiter: ';', decimalSeparator: ',' },
    en: { delimiter: ',', decimalSeparator: '.' },
};

/**
 * The first characters a spreadsheet takes for the start of a formula. A text
 * cell beginning with one is written with an apostrophe before it, which a
 * spreadsheet shows as text and drops; an amount is a number and never is.
 */
const FORMULA_STARTS = ['=', '+', '-', '@', '\t', '\r'];

const BYTE_ORDER_MARK = '﻿';
const LINE_END = '\r\n';

/** One cell, written for `locale`: quoted where it holds a separator, a quote or a line break. */
function cellOf(value: unknown, kind: CellKind, locale: InvoiceExportLocale): string {
    if (value === null || value === undefined) return '';
    const { delimiter, decimalSeparator } = NOTATION[locale];
    let text: string;
    if (kind === 'amount' && typeof value === 'number') {
        text = value.toFixed(2).replace('.', decimalSeparator);
    } else if (kind === 'number' && typeof value === 'number') {
        text = String(value).replace('.', decimalSeparator);
    } else {
        text = String(value);
        if (FORMULA_STARTS.some((start) => text.startsWith(start))) text = `'${text}`;
    }
    const quoted =
        text.includes(delimiter) ||
        text.includes('"') ||
        text.includes('\n') ||
        text.includes('\r');
    return quoted ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A table: its header of column names, which every language writes alike, and a row per entry. */
function csvOf<Row>(
    rows: readonly Row[],
    columns: Columns<Row>,
    locale: InvoiceExportLocale,
): string {
    const { delimiter } = NOTATION[locale];
    const header = columns.map(([name]) => name).join(delimiter);
    const body = rows.map((row) =>
        columns.map(([name, kind]) => cellOf(row[name], kind, locale)).join(delimiter),
    );
    return BYTE_ORDER_MARK + [header, ...body].map((line) => line + LINE_END).join('');
}

/** The files an export is written to, in the order the archive holds them; the manifest follows them. */
export function invoiceExportFilesOf(
    exported: InvoiceExport,
    locale: InvoiceExportLocale,
): InvoiceExportFile[] {
    return [
        { name: 'invoices.csv', content: csvOf(exported.invoices, INVOICE_COLUMNS, locale) },
        { name: 'lines.csv', content: csvOf(exported.lines, LINE_COLUMNS, locale) },
        {
            name: 'settlements.csv',
            content: csvOf(exported.settlements, SETTLEMENT_COLUMNS, locale),
        },
        { name: 'export.json', content: `${JSON.stringify(exported, null, 2)}\n` },
    ];
}

/** The manifest of `exported` written for `locale`, naming every file with what the caller measured of it. */
export function invoiceExportManifestOf(
    exported: InvoiceExport,
    locale: InvoiceExportLocale,
    files: readonly { name: string; bytes: number; sha256: string }[],
): InvoiceExportManifest {
    return {
        formatVersion: INVOICE_EXPORT_FORMAT_VERSION,
        period: exported.period,
        asOf: exported.asOf,
        asOfLocal: exported.asOfLocal,
        timeZone: exported.timeZone,
        locale,
        csv: {
            ...NOTATION[locale],
            encoding: 'UTF-8, with a byte order mark',
            lineEnding: 'CRLF',
        },
        counts: {
            invoices: exported.invoices.length,
            lines: exported.lines.length,
            settlements: exported.settlements.length,
        },
        files: files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
    };
}

/**
 * The archive's file name: the period, the moment it is as of and the language,
 * which together decide its bytes, with nothing a file system refuses.
 */
export function invoiceExportFileNameOf(
    exported: InvoiceExport,
    locale: InvoiceExportLocale,
): string {
    const moment = exported.asOfLocal.replaceAll(':', '-');
    return `invoices-${exported.period.from}-${exported.period.until}-as-of-${moment}-${locale}.zip`;
}
