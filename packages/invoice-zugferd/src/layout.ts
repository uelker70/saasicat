// The page a person reads: an A4 letter laid out after DIN 5008 — the sender
// above the address field, the issuer and the invoice's facts to the right,
// the lines in a table that runs on over as many pages as it needs, the tax
// per rate, the total, the treatment's note, how the invoice is paid, and the
// footer lines on every page. Every figure on it is the one the XML states.

import type { PDFDocument, PDFPage } from 'pdf-lib';
import type { SubscriptionInvoiceRecord } from '@saasicat/core';

import { taxStatementOf } from './categories.js';
import {
    amountDueOf,
    correctionNoteOf,
    isCancellation,
    lineCorrectionOf,
    titleOf,
} from './correction.js';
import { pageAmount, pageDay, pageRate } from './format.js';
import { LABELS, bilingual, type Label } from './labels.js';
import {
    BLACK,
    LEFT,
    MM,
    PAGE,
    Pen,
    RIGHT,
    calibrateGray,
    drawFoot,
    footOf,
    letterhead,
    titleBaseline,
    writeFacts,
    type Fonts,
} from './letter.js';
import { paymentNoteOf } from './payment-note.js';

export type { Fonts } from './letter.js';

/** The columns of the table of lines, as left edges; the net column ends at `RIGHT`. */
const COLUMNS = { position: LEFT, description: LEFT + 17 * MM, period: 118 * MM, net: RIGHT };
const DESCRIPTION_WIDTH = COLUMNS.period - COLUMNS.description - 3 * MM;
/** The line under a line's description naming the line of the corrected invoice it stands for. */
const REFERENCE_SIZE = 7.5;
const REFERENCE_LEADING = 9;

/** Lays an invoice out on as many pages as it needs. */
export function layOut(pdf: PDFDocument, invoice: SubscriptionInvoiceRecord, fonts: Fonts): void {
    const pen = new Pen(fonts);
    const pages: PDFPage[] = [];
    const newPage = (): PDFPage => {
        const page = pdf.addPage([PAGE.width, PAGE.height]);
        pages.push(page);
        return page;
    };

    const foot = footOf(pen, invoice.footer);
    let page = newPage();
    let y = firstPage(page, pen, invoice);
    y = tableHeader(page, pen, invoice, y);
    for (const entry of invoice.lines) {
        const description = pen.wrap(entry.title, DESCRIPTION_WIDTH, 9);
        const corrected = lineCorrectionOf(invoice, entry);
        const reference = corrected
            ? pen.wrap(bilingual(corrected), DESCRIPTION_WIDTH, REFERENCE_SIZE)
            : [];
        const height = description.length * 11 + reference.length * REFERENCE_LEADING + 4;
        if (y - height < foot.top + 10 * MM) {
            page = newPage();
            y = followingPage(page, pen, invoice);
            y = tableHeader(page, pen, invoice, y);
        }
        pen.write(page, String(entry.position), COLUMNS.position, y, 9);
        description.forEach((text, index) =>
            pen.write(page, text, COLUMNS.description, y - index * 11, 9),
        );
        const below = y - description.length * 11 + 2;
        reference.forEach((text, index) =>
            pen.write(
                page,
                text,
                COLUMNS.description,
                below - index * REFERENCE_LEADING,
                REFERENCE_SIZE,
                { grey: true },
            ),
        );
        pen.write(
            page,
            `${pageDay(entry.periodFrom)} – ${pageDay(entry.periodUntil)}`,
            COLUMNS.period,
            y,
            9,
        );
        pen.write(page, pageAmount(entry.amountNet), COLUMNS.net, y, 9, { alignRight: true });
        y -= height;
    }

    const closing = closingLines(pen, invoice);
    if (y - closing.height < foot.top + 5 * MM) {
        page = newPage();
        y = followingPage(page, pen, invoice);
    }
    closing.draw(page, y);

    pages.forEach((each, index) => drawFoot(each, pen, foot, index + 1, pages.length));
    for (const each of pages) calibrateGray(pdf, each);
}

/** The letterhead, the address field, the facts and the title; answers where the table begins. */
function firstPage(page: PDFPage, pen: Pen, invoice: SubscriptionInvoiceRecord): number {
    const head = letterhead(page, pen, invoice.issuer, invoice.subscriber);
    const lastFact = writeFacts(page, pen, factsOf(invoice), head.side);

    const title = titleBaseline(head, lastFact);
    pen.write(page, `${bilingual(titleOf(invoice))} ${invoice.number}`, LEFT, title, 15, {
        bold: true,
    });
    const correction = correctionNoteOf(invoice);
    if (!correction) return title - 12 * MM;
    // Which invoice it corrects and why, in German and then English, under the title.
    let next = title - 8 * MM;
    for (const text of [correction.de, correction.en]) {
        next = pen.writeWrapped(page, text, {
            x: LEFT,
            y: next,
            size: 9,
            width: RIGHT - LEFT,
            leading: 11,
        });
        next -= 13;
    }
    return next - 6 * MM;
}

/**
 * The facts beside the address field. A cancellation invoice asks for nothing,
 * so it is due on no day; a correction names the invoice it corrects.
 */
function factsOf(invoice: SubscriptionInvoiceRecord): Array<[Label, string]> {
    const facts: Array<[Label, string]> = [
        [LABELS.number, invoice.number],
        [LABELS.issueDate, pageDay(invoice.issueDate)],
        [
            LABELS.servicePeriod,
            `${pageDay(invoice.servicePeriodFrom)} – ${pageDay(invoice.servicePeriodUntil)}`,
        ],
        [LABELS.customerNumber, invoice.subscriber.customerNumber],
    ];
    const { correction } = invoice;
    if (correction) {
        facts.push([
            correction.kind === 'cancellation' ? LABELS.cancels : LABELS.replaces,
            `${correction.of.number} (${pageDay(correction.of.issueDate)})`,
        ]);
    }
    if (!isCancellation(invoice)) facts.push([LABELS.dueDate, pageDay(invoice.dueDate)]);
    return facts;
}

/** A page the table runs on to: the invoice named at its head. */
function followingPage(page: PDFPage, pen: Pen, invoice: SubscriptionInvoiceRecord): number {
    const y = PAGE.height - 20 * MM;
    pen.write(page, `${bilingual(titleOf(invoice))} ${invoice.number}`, LEFT, y, 10, {
        bold: true,
    });
    return y - 12 * MM;
}

function tableHeader(
    page: PDFPage,
    pen: Pen,
    invoice: SubscriptionInvoiceRecord,
    y: number,
): number {
    pen.write(page, bilingual(LABELS.position), COLUMNS.position, y, 7.5, { bold: true });
    pen.write(page, bilingual(LABELS.description), COLUMNS.description, y, 7.5, { bold: true });
    pen.write(page, bilingual(LABELS.period), COLUMNS.period, y, 7.5, { bold: true });
    pen.write(page, `${bilingual(LABELS.net)} (${invoice.currency})`, COLUMNS.net, y, 7.5, {
        bold: true,
        alignRight: true,
    });
    page.drawLine({
        start: { x: LEFT, y: y - 5 },
        end: { x: RIGHT, y: y - 5 },
        thickness: 0.6,
        color: BLACK,
    });
    return y - 18;
}

/**
 * The totals, the treatment's note and how the invoice is paid: how tall they
 * are, and how to draw them from `y` down.
 */
function closingLines(
    pen: Pen,
    invoice: SubscriptionInvoiceRecord,
): { height: number; draw: (page: PDFPage, y: number) => void } {
    const tax = taxStatementOf(invoice.taxTreatment);
    const rows: Array<{ label: string; amount: number; bold?: boolean }> = [
        { label: bilingual(LABELS.netTotal), amount: invoice.totalNet },
    ];
    if (tax.category === 'S') {
        for (const entry of invoice.taxes) {
            rows.push({
                label:
                    `${LABELS.vat.de} ${pageRate(entry.rate)} ${LABELS.on.de} ${pageAmount(entry.net)} / ` +
                    `${LABELS.vat.en} ${pageRate(entry.rate)} ${LABELS.on.en} ${pageAmount(entry.net)}`,
                amount: entry.tax,
            });
        }
    }
    // A replacement states what was paid for the invoice it replaces, and
    // what is left to pay (`SC-PRIC-095`).
    const prepaid = invoice.paidOnIssue > 0;
    rows.push({
        label: `${bilingual(LABELS.grandTotal)} (${invoice.currency})`,
        amount: invoice.totalGross,
        bold: !prepaid,
    });
    if (prepaid) {
        rows.push(
            { label: bilingual(LABELS.alreadyPaid), amount: -invoice.paidOnIssue },
            {
                label: `${bilingual(LABELS.amountDue)} (${invoice.currency})`,
                amount: amountDueOf(invoice),
                bold: true,
            },
        );
    }
    const note = invoice.taxTreatment.note
        ? pen.wrap(invoice.taxTreatment.note, RIGHT - LEFT, 8.5)
        : [];
    const paymentNote = paymentNoteOf(invoice);
    // German first, then English, each a paragraph of its own.
    const payment = paymentNote
        ? [paymentNote.de, paymentNote.en].map((text) => pen.wrap(text, RIGHT - LEFT, 8.5))
        : [];
    const paragraphs = [note, ...payment].filter((lines) => lines.length > 0);
    const height =
        8 +
        rows.length * 14 +
        paragraphs.reduce((total, lines) => total + 10 + lines.length * 11, 0);

    return {
        height,
        draw(page, top) {
            page.drawLine({
                start: { x: COLUMNS.period, y: top + 4 },
                end: { x: RIGHT, y: top + 4 },
                thickness: 0.6,
                color: BLACK,
            });
            let y = top - 8;
            for (const row of rows) {
                pen.write(page, row.label, COLUMNS.period - 40 * MM, y, 9, { bold: row.bold });
                pen.write(page, pageAmount(row.amount), COLUMNS.net, y, 9, {
                    bold: row.bold,
                    alignRight: true,
                });
                y -= 14;
            }
            for (const lines of paragraphs) {
                y -= 10;
                for (const text of lines) {
                    pen.write(page, text, LEFT, y, 8.5);
                    y -= 11;
                }
            }
        },
    };
}
