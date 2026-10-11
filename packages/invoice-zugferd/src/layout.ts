// The page a person reads: an A4 letter laid out after DIN 5008 — the sender
// above the address field, the issuer and the invoice's facts to the right,
// the lines in a table that runs on over as many pages as it needs, the tax
// per rate, the total, the treatment's note, and the footer lines on every
// page. Every figure on it is the one the XML states.

import { PDFName, grayscale, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import type { SubscriptionInvoiceRecord } from '@saasicat/core';

import { vatCategoryOf } from './categories.js';
import { pageAmount, pageDay, pageRate } from './format.js';
import { LABELS, bilingual, type Label } from './labels.js';

/** A4, in points. */
const PAGE = { width: 595.28, height: 841.89 };
/** 1 mm in points. */
const MM = 72 / 25.4;
const LEFT = 25 * MM;
const RIGHT = PAGE.width - 20 * MM;
/** Where the issuer's block and the invoice's facts begin. */
const SIDE = 125 * MM;
/** The least height kept free at the foot of a page, for its footer lines and number. */
const FOOT = 32 * MM;
/** The lowest a footer line's baseline goes. */
const BOTTOM = 8 * MM;
const FOOTER_SIZE = 7;
const FOOTER_LEADING = 9;
const BLACK = grayscale(0);
const GREY = grayscale(0.35);

/** The columns of the table of lines, as left edges; the net column ends at `RIGHT`. */
const COLUMNS = { position: LEFT, description: LEFT + 17 * MM, period: 118 * MM, net: RIGHT };
const DESCRIPTION_WIDTH = COLUMNS.period - COLUMNS.description - 3 * MM;

export interface Fonts {
    regular: PDFFont;
    bold: PDFFont;
}

/** Writes text in a font, putting `?` for a character the font has no glyph for. */
class Pen {
    private readonly covered = new Map<PDFFont, Set<number>>();

    constructor(private readonly fonts: Fonts) {}

    font(bold: boolean): PDFFont {
        return bold ? this.fonts.bold : this.fonts.regular;
    }

    /**
     * `text` as the font can set it. PDF/A forbids showing a glyph a font does
     * not have (ISO 19005-3, 6.2.11.8), and a subscriber's name may hold any
     * character at all; line breaks and tabs become spaces.
     */
    settable(text: string, font: PDFFont): string {
        let covered = this.covered.get(font);
        if (!covered) {
            covered = new Set(font.getCharacterSet());
            this.covered.set(font, covered);
        }
        let out = '';
        for (const char of text.replace(/[\t\r\n]/g, ' ')) {
            out += covered.has(char.codePointAt(0)!) ? char : '?';
        }
        return out;
    }

    width(text: string, size: number, bold = false): number {
        const font = this.font(bold);
        return font.widthOfTextAtSize(this.settable(text, font), size);
    }

    write(
        page: PDFPage,
        text: string,
        x: number,
        y: number,
        size: number,
        { bold = false, grey = false, alignRight = false } = {},
    ): void {
        const font = this.font(bold);
        const settable = this.settable(text, font);
        const left = alignRight ? x - font.widthOfTextAtSize(settable, size) : x;
        page.drawText(settable, { x: left, y, size, font, color: grey ? GREY : BLACK });
    }

    /** `text` broken into lines no wider than `width`, a word longer than that broken where it must. */
    wrap(text: string, width: number, size: number, bold = false): string[] {
        const lines: string[] = [];
        let current = '';
        for (const word of text.split(' ').filter((part) => part !== '')) {
            const candidate = current === '' ? word : `${current} ${word}`;
            if (this.width(candidate, size, bold) <= width) {
                current = candidate;
                continue;
            }
            if (current !== '') lines.push(current);
            current = '';
            for (const char of word) {
                if (current !== '' && this.width(current + char, size, bold) > width) {
                    lines.push(current);
                    current = '';
                }
                current += char;
            }
        }
        if (current !== '') lines.push(current);
        return lines.length > 0 ? lines : [''];
    }
}

/** Lays an invoice out on as many pages as it needs. */
export function layOut(pdf: PDFDocument, invoice: SubscriptionInvoiceRecord, fonts: Fonts): void {
    const pen = new Pen(fonts);
    const pages: PDFPage[] = [];
    const newPage = (): PDFPage => {
        const page = pdf.addPage([PAGE.width, PAGE.height]);
        pages.push(page);
        return page;
    };

    const foot = footOf(pen, invoice);
    let page = newPage();
    let y = firstPage(page, pen, invoice);
    y = tableHeader(page, pen, invoice, y);
    for (const entry of invoice.lines) {
        const description = pen.wrap(entry.title, DESCRIPTION_WIDTH, 9);
        const height = description.length * 11 + 4;
        if (y - height < foot.top + 10 * MM) {
            page = newPage();
            y = followingPage(page, pen, invoice);
            y = tableHeader(page, pen, invoice, y);
        }
        pen.write(page, String(entry.position), COLUMNS.position, y, 9);
        description.forEach((text, index) =>
            pen.write(page, text, COLUMNS.description, y - index * 11, 9),
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

/**
 * Makes the page's grey a device-independent one. PDF/A lets a page draw in
 * DeviceGray only where a DefaultGray says what it means (ISO 19005-3,
 * 6.2.4.3); a calibrated grey with the white point and gamma of sRGB says so
 * without an ICC profile to ship.
 */
function calibrateGray(pdf: PDFDocument, page: PDFPage): void {
    page.node.Resources()!.set(
        PDFName.of('ColorSpace'),
        pdf.context.obj({
            DefaultGray: [PDFName.of('CalGray'), { WhitePoint: [0.9505, 1, 1.089], Gamma: 2.2 }],
        }),
    );
}

/** The letterhead, the address field, the facts and the title; answers where the table begins. */
function firstPage(page: PDFPage, pen: Pen, invoice: SubscriptionInvoiceRecord): number {
    const { issuer, subscriber } = invoice;
    const top = PAGE.height;

    let y = top - 20 * MM;
    pen.write(page, issuer.legalName, SIDE, y, 10, { bold: true });
    for (const text of addressLines(issuer)) {
        y -= 12;
        pen.write(page, text, SIDE, y, 9);
    }
    if (issuer.vatId) {
        y -= 12;
        pen.write(page, `${bilingual(LABELS.vatId)}: ${issuer.vatId}`, SIDE, y, 8, { grey: true });
    }
    if (issuer.taxNumber) {
        y -= 11;
        pen.write(page, `${bilingual(LABELS.taxNumber)}: ${issuer.taxNumber}`, SIDE, y, 8, {
            grey: true,
        });
    }

    // DIN 5008, form B: the return address in the first line of the field.
    const field = top - 50 * MM;
    pen.write(page, [issuer.legalName, ...addressLines(issuer)].join(' · '), LEFT, field, 7, {
        grey: true,
    });
    let x = field - 16;
    pen.write(page, subscriber.legalName, LEFT, x, 10, { bold: true });
    for (const text of addressLines(subscriber)) {
        x -= 13;
        pen.write(page, text, LEFT, x, 10);
    }
    // Both parties' VAT ids stand on an invoice under the reverse charge
    // (§ 14a (1) UStG); the subscriber's is named wherever its record holds one.
    if (subscriber.vatId) {
        x -= 14;
        pen.write(page, `${bilingual(LABELS.vatId)}: ${subscriber.vatId}`, LEFT, x, 8, {
            grey: true,
        });
    }

    let facts = top - 55 * MM;
    for (const [label, value] of [
        [LABELS.number, invoice.number],
        [LABELS.issueDate, pageDay(invoice.issueDate)],
        [
            LABELS.servicePeriod,
            `${pageDay(invoice.servicePeriodFrom)} – ${pageDay(invoice.servicePeriodUntil)}`,
        ],
        [LABELS.customerNumber, subscriber.customerNumber],
        [LABELS.dueDate, pageDay(invoice.dueDate)],
    ] as Array<[Label, string]>) {
        pen.write(page, bilingual(label), SIDE, facts, 7.5, { grey: true });
        pen.write(page, value, SIDE, facts - 10, 9.5, { bold: true });
        facts -= 23;
    }

    const title = top - 110 * MM;
    pen.write(page, `${bilingual(LABELS.title)} ${invoice.number}`, LEFT, title, 15, {
        bold: true,
    });
    return title - 12 * MM;
}

/** A page the table runs on to: the invoice named at its head. */
function followingPage(page: PDFPage, pen: Pen, invoice: SubscriptionInvoiceRecord): number {
    const y = PAGE.height - 20 * MM;
    pen.write(page, `${bilingual(LABELS.title)} ${invoice.number}`, LEFT, y, 10, { bold: true });
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

/** The totals and the treatment's note: how tall they are, and how to draw them from `y` down. */
function closingLines(
    pen: Pen,
    invoice: SubscriptionInvoiceRecord,
): { height: number; draw: (page: PDFPage, y: number) => void } {
    const tax = vatCategoryOf(invoice.taxTreatment);
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
    rows.push({
        label: `${bilingual(LABELS.grandTotal)} (${invoice.currency})`,
        amount: invoice.totalGross,
        bold: true,
    });
    const note = invoice.taxTreatment.note
        ? pen.wrap(invoice.taxTreatment.note, RIGHT - LEFT, 8.5)
        : [];
    const height = 8 + rows.length * 14 + (note.length > 0 ? 10 + note.length * 11 : 0);

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
            y -= 10;
            for (const text of note) {
                pen.write(page, text, LEFT, y, 8.5);
                y -= 11;
            }
        },
    };
}

/** The footer lines of every page, and how high the foot they need reaches. */
interface Foot {
    /** The invoice's footer lines, each broken where it is wider than the page. */
    lines: string[];
    /** The height above the page's lower edge that the table keeps clear of. */
    top: number;
}

/**
 * The footer lines as the page sets them. A line the configuration accepts can
 * still be wider than the page, in wide letters or a wide font of the
 * application's, and it is the issuer's legal details: it is broken onto the
 * next line rather than cut off, and the foot grows upwards to hold it.
 */
function footOf(pen: Pen, invoice: SubscriptionInvoiceRecord): Foot {
    const lines = invoice.footer.flatMap((line) => pen.wrap(line, RIGHT - LEFT, FOOTER_SIZE));
    const first = Math.max(FOOT - 8 * MM, BOTTOM + (lines.length - 1) * FOOTER_LEADING);
    return { lines, top: first + 8 * MM };
}

/** The footer lines and the page's number at the foot of the page. */
function drawFoot(page: PDFPage, pen: Pen, foot: Foot, number: number, count: number): void {
    let y = foot.top - 8 * MM;
    for (const text of foot.lines) {
        pen.write(page, text, LEFT, y, FOOTER_SIZE, { grey: true });
        y -= FOOTER_LEADING;
    }
    pen.write(
        page,
        `${LABELS.page.de} ${number} ${LABELS.of.de} ${count} / ${LABELS.page.en} ${number} ${LABELS.of.en} ${count}`,
        RIGHT,
        // Above the footer lines, which may run the width of the page.
        foot.top - 3 * MM,
        FOOTER_SIZE,
        { grey: true, alignRight: true },
    );
}

/** German names of countries, read once: `AT` is `Österreich`. */
const COUNTRY_NAMES = new Intl.DisplayNames(['de'], { type: 'region', fallback: 'code' });

/**
 * A party's address as the lines of a letter: the country, for an address
 * abroad, as its name in capitals on a line of its own (DIN 5008).
 */
function addressLines(party: {
    addressLine1: string | null;
    addressLine2: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
}): string[] {
    return [
        party.addressLine1,
        party.addressLine2,
        [party.postalCode, party.city].filter(Boolean).join(' '),
        party.country && party.country !== 'DE'
            ? (COUNTRY_NAMES.of(party.country) ?? party.country).toUpperCase()
            : null,
    ].filter((text): text is string => Boolean(text));
}
