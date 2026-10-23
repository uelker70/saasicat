// The page a subscriber keeps of the contract they are bound by: on the same
// letter as an invoice, the parties, the facts of the contract, its lines with
// their rhythm, minimum term and price, what the contract costs per billing
// period with its tax, the treatment's note, the notice period and the terms
// it was concluded under (`SC-AUD-016`). Every day on it is read in the
// installation's zone.

import { dayInZone, type ContractToConfirm, type SubscriptionContractRecord } from '@saasicat/core';
import type { PDFDocument, PDFPage } from 'pdf-lib';

import { centsOf, pageAmount, pageDay, pageRate } from './format.js';
import { CONFIRMATION_LABELS, LABELS, bilingual, termsNoteOf, type Label } from './labels.js';
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

/** The columns of the table of lines, as left edges; the net column ends at `RIGHT`. */
const COLUMNS = { description: LEFT, billing: 105 * MM, term: 130 * MM, net: RIGHT };
const DESCRIPTION_WIDTH = COLUMNS.billing - COLUMNS.description - 3 * MM;
const ROW_LEADING = 11;
const PARAGRAPH_SIZE = 8.5;

/** Lays a contract's confirmation out on as many pages as it needs. */
export function layOutConfirmation(
    pdf: PDFDocument,
    confirmation: ContractToConfirm,
    fonts: Fonts,
): void {
    const { contract, timeZone } = confirmation;
    if (!contract.issuer) {
        throw new Error(`Contract ${contract.id} names no issuer, so it is not confirmed.`);
    }
    const pen = new Pen(fonts);
    const pages: PDFPage[] = [];
    const newPage = (): PDFPage => {
        const page = pdf.addPage([PAGE.width, PAGE.height]);
        pages.push(page);
        return page;
    };
    const day = (at: Date) => pageDay(dayInZone(at, timeZone));

    const foot = footOf(pen, confirmation.footer);
    let page = newPage();
    const head = letterhead(page, pen, contract.issuer, contract.subscriber);
    const lastFact = writeFacts(page, pen, factsOf(contract, day), head.side);
    const title = titleBaseline(head, lastFact);
    pen.write(page, `${bilingual(CONFIRMATION_LABELS.title)} ${contract.id}`, LEFT, title, 15, {
        bold: true,
    });
    let y = tableHeader(page, pen, contract, title - 12 * MM);
    for (const entry of contract.lineItems) {
        const description = pen.wrap(entry.titleSnapshot, DESCRIPTION_WIDTH, 9);
        const height = description.length * ROW_LEADING + 4;
        if (y - height < foot.top + 10 * MM) {
            page = newPage();
            y = tableHeader(page, pen, contract, followingPage(page, pen, contract));
        }
        description.forEach((text, index) =>
            pen.write(page, text, COLUMNS.description, y - index * ROW_LEADING, 9),
        );
        pen.write(page, rhythmOf(entry.billingCycle), COLUMNS.billing, y, 9);
        const term = entry.minimumTermUntil ? day(entry.minimumTermUntil) : '–';
        pen.write(page, term, COLUMNS.term, y, 9);
        pen.write(page, pageAmount(entry.priceNet), COLUMNS.net, y, 9, { alignRight: true });
        y -= height;
    }

    const closing = closingLines(pen, contract);
    if (y - closing.height < foot.top + 5 * MM) {
        page = newPage();
        y = followingPage(page, pen, contract);
    }
    closing.draw(page, y);

    pages.forEach((each, index) => drawFoot(each, pen, foot, index + 1, pages.length));
    for (const each of pages) calibrateGray(pdf, each);
}

/** A rhythm as the page names it: `monatlich / monthly`. */
function rhythmOf(cycle: 'monthly' | 'yearly'): string {
    return bilingual(CONFIRMATION_LABELS[cycle]);
}

function factsOf(
    contract: SubscriptionContractRecord,
    day: (at: Date) => string,
): Array<[Label, string]> {
    return [
        [CONFIRMATION_LABELS.contract, contract.id],
        [CONFIRMATION_LABELS.concludedOn, day(contract.createdAt)],
        [LABELS.customerNumber, contract.subscriber.customerNumber],
        [CONFIRMATION_LABELS.start, day(contract.effectiveFrom)],
        [CONFIRMATION_LABELS.billing, rhythmOf(contract.priceSnapshot.billingCycle)],
    ];
}

/** A page the table runs on to: the contract named at its head. */
function followingPage(page: PDFPage, pen: Pen, contract: SubscriptionContractRecord): number {
    const y = PAGE.height - 20 * MM;
    pen.write(page, `${bilingual(CONFIRMATION_LABELS.title)} ${contract.id}`, LEFT, y, 10, {
        bold: true,
    });
    return y - 12 * MM;
}

function tableHeader(
    page: PDFPage,
    pen: Pen,
    contract: SubscriptionContractRecord,
    y: number,
): number {
    const currency = contract.priceSnapshot.currency;
    pen.write(page, bilingual(LABELS.description), COLUMNS.description, y, 7.5, { bold: true });
    pen.write(page, bilingual(CONFIRMATION_LABELS.billing), COLUMNS.billing, y, 7.5, {
        bold: true,
    });
    pen.write(page, bilingual(CONFIRMATION_LABELS.minimumTerm), COLUMNS.term, y, 7.5, {
        bold: true,
    });
    pen.write(page, `${bilingual(LABELS.net)} (${currency})`, COLUMNS.net, y, 7.5, {
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
 * What the contract costs per billing period, the treatment's note, the
 * notice period and the terms: how tall they are, and how to draw them from
 * `y` down.
 */
function closingLines(
    pen: Pen,
    contract: SubscriptionContractRecord,
): { height: number; draw: (page: PDFPage, y: number) => void } {
    const price = contract.priceSnapshot;
    const rows: Array<{ label: string; amount: number; bold?: boolean }> = [];
    if (price.discountNet !== 0) {
        rows.push(
            { label: bilingual(CONFIRMATION_LABELS.subtotal), amount: price.subtotalNet },
            { label: bilingual(CONFIRMATION_LABELS.discount), amount: -price.discountNet },
        );
    }
    rows.push(
        { label: bilingual(LABELS.netTotal), amount: price.totalNet },
        {
            label: `${LABELS.vat.de} ${pageRate(price.vatRate)} / ${LABELS.vat.en} ${pageRate(price.vatRate)}`,
            // In cents, as the amounts are kept: the difference of two
            // amounts in floating point is not one to the cent.
            amount: (centsOf(price.totalGross) - centsOf(price.totalNet)) / 100,
        },
        {
            label: `${bilingual(LABELS.grandTotal)} (${price.currency})`,
            amount: price.totalGross,
            bold: true,
        },
    );
    const notice = CONFIRMATION_LABELS.noticePeriod;
    const days = CONFIRMATION_LABELS.days;
    const terms = termsNoteOf(contract.termsVersion);
    const width = RIGHT - LEFT;
    const paragraphs = [
        bilingual(CONFIRMATION_LABELS.perPeriod),
        contract.taxTreatment?.note ?? null,
        `${notice.de}: ${contract.cancellationNoticeDays} ${days.de} / ` +
            `${notice.en}: ${contract.cancellationNoticeDays} ${days.en}`,
        terms.de,
        terms.en,
    ]
        .filter((text): text is string => Boolean(text))
        .map((text) => pen.wrap(text, width, PARAGRAPH_SIZE));
    const height =
        8 +
        rows.length * 14 +
        paragraphs.reduce((total, lines) => total + 10 + lines.length * 11, 0);

    return {
        height,
        draw(page, top) {
            page.drawLine({
                start: { x: COLUMNS.billing, y: top + 4 },
                end: { x: RIGHT, y: top + 4 },
                thickness: 0.6,
                color: BLACK,
            });
            let y = top - 8;
            for (const row of rows) {
                pen.write(page, row.label, COLUMNS.billing - 25 * MM, y, 9, { bold: row.bold });
                pen.write(page, pageAmount(row.amount), COLUMNS.net, y, 9, {
                    bold: row.bold,
                    alignRight: true,
                });
                y -= 14;
            }
            for (const lines of paragraphs) {
                y -= 10;
                for (const text of lines) {
                    pen.write(page, text, LEFT, y, PARAGRAPH_SIZE);
                    y -= 11;
                }
            }
        },
    };
}
