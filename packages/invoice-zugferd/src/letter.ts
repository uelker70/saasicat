// The letter every document is printed on: an A4 page laid out after DIN
// 5008 — the sender above the address field, the issuer and the document's
// facts to the right, the footer lines and the page's number at the foot of
// every page — and the pen that writes on it in the embedded fonts, which
// PDF/A asks to show only glyphs they have.

import { PDFName, grayscale, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';
import type { LegalIdentity, PartyAddress } from '@saasicat/core';

import { LABELS, bilingual, type Label } from './labels.js';

/** A4, in points. */
export const PAGE = { width: 595.28, height: 841.89 };
/** 1 mm in points. */
export const MM = 72 / 25.4;
export const LEFT = 25 * MM;
export const RIGHT = PAGE.width - 20 * MM;
/** Where the issuer's block and the document's facts begin. */
export const SIDE = 125 * MM;
/** The right edge of the address field of DIN 5008, form B: 20 mm in, 85 mm wide. */
const ADDRESS_RIGHT = 105 * MM;
/** The least height kept free at the foot of a page, for its footer lines and number. */
const FOOT = 32 * MM;
/** The lowest a footer line's baseline goes. */
const BOTTOM = 8 * MM;
const FOOTER_SIZE = 7;
const FOOTER_LEADING = 9;
export const BLACK = grayscale(0);
const GREY = grayscale(0.35);

export interface Fonts {
    regular: PDFFont;
    bold: PDFFont;
}

/** Writes text in a font, putting `?` for a character the font has no glyph for. */
export class Pen {
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

    /**
     * `text` broken to `width` and written from `y` down, `leading` apart.
     * Answers the baseline of its last line, for what follows it.
     */
    writeWrapped(
        page: PDFPage,
        text: string,
        {
            x,
            y,
            size,
            width,
            leading,
        }: { x: number; y: number; size: number; width: number; leading: number },
        options: { bold?: boolean; grey?: boolean } = {},
    ): number {
        const lines = this.wrap(text, width, size, options.bold);
        lines.forEach((line, index) =>
            this.write(page, line, x, y - index * leading, size, options),
        );
        return y - (lines.length - 1) * leading;
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

/**
 * Makes the page's grey a device-independent one. PDF/A lets a page draw in
 * DeviceGray only where a DefaultGray says what it means (ISO 19005-3,
 * 6.2.4.3); a calibrated grey with the white point and gamma of sRGB says so
 * without an ICC profile to ship.
 */
export function calibrateGray(pdf: PDFDocument, page: PDFPage): void {
    page.node.Resources()!.set(
        PDFName.of('ColorSpace'),
        pdf.context.obj({
            DefaultGray: [PDFName.of('CalGray'), { WhitePoint: [0.9505, 1, 1.089], Gamma: 2.2 }],
        }),
    );
}

/** A party as a letter names it: who it is, and where. */
export type LetterParty = LegalIdentity & PartyAddress;

/**
 * The letterhead and the address field: the issuer to the right, its return
 * address above the field and the recipient in it. Answers the baseline of the
 * issuer's last line and of the recipient's, for what follows each. A name or
 * an address line wider than its column — and the subscriber writes its own —
 * goes on in the next line, and what follows moves down with it.
 */
export function letterhead(
    page: PDFPage,
    pen: Pen,
    issuer: LetterParty,
    recipient: LetterParty,
): { side: number; address: number } {
    const top = PAGE.height;

    const side = { x: SIDE, width: RIGHT - SIDE };
    let y = pen.writeWrapped(
        page,
        issuer.legalName,
        { ...side, y: top - 20 * MM, size: 10, leading: 12 },
        { bold: true },
    );
    for (const text of addressLines(issuer)) {
        y = pen.writeWrapped(page, text, { ...side, y: y - 12, size: 9, leading: 11 });
    }
    if (issuer.vatId) {
        y = pen.writeWrapped(
            page,
            `${bilingual(LABELS.vatId)}: ${issuer.vatId}`,
            { ...side, y: y - 12, size: 8, leading: 10 },
            { grey: true },
        );
    }
    if (issuer.taxNumber) {
        y = pen.writeWrapped(
            page,
            `${bilingual(LABELS.taxNumber)}: ${issuer.taxNumber}`,
            { ...side, y: y - 11, size: 8, leading: 10 },
            { grey: true },
        );
    }

    // DIN 5008, form B: the return address in the first line of the field. A
    // longer one rises into the zone above it rather than into the address.
    const field = top - 50 * MM;
    const fieldWidth = ADDRESS_RIGHT - LEFT;
    const sender = pen.wrap([issuer.legalName, ...addressLines(issuer)].join(' · '), fieldWidth, 7);
    sender.forEach((text, index) =>
        pen.write(page, text, LEFT, field + (sender.length - 1 - index) * 8, 7, { grey: true }),
    );
    const address = { x: LEFT, width: fieldWidth };
    let below = pen.writeWrapped(
        page,
        recipient.legalName,
        { ...address, y: field - 16, size: 10, leading: 12 },
        { bold: true },
    );
    for (const text of addressLines(recipient)) {
        below = pen.writeWrapped(page, text, { ...address, y: below - 13, size: 10, leading: 12 });
    }
    // Both parties' VAT ids stand on an invoice under the reverse charge
    // (§ 14a (1) UStG); the recipient's is named wherever its record holds one.
    if (recipient.vatId) {
        below = pen.writeWrapped(
            page,
            `${bilingual(LABELS.vatId)}: ${recipient.vatId}`,
            { ...address, y: below - 14, size: 8, leading: 10 },
            { grey: true },
        );
    }
    return { side: y, address: below };
}

/**
 * The document's facts beside the address field, from below the issuer's
 * block down; answers the baseline of the last one.
 */
export function writeFacts(
    page: PDFPage,
    pen: Pen,
    facts: ReadonlyArray<readonly [Label, string]>,
    side: number,
): number {
    let y = Math.min(PAGE.height - 55 * MM, side - 8 * MM);
    for (const [label, value] of facts) {
        pen.write(page, bilingual(label), SIDE, y, 7.5, { grey: true });
        pen.write(page, value, SIDE, y - 10, 9.5, { bold: true });
        y -= 23;
    }
    return y + 23 - 10;
}

/** Where a document's title stands: below the address field and the facts, whichever ends lower. */
export function titleBaseline(head: { address: number }, lastFact: number): number {
    return Math.min(PAGE.height - 110 * MM, Math.min(head.address, lastFact) - 15 * MM);
}

/** The footer lines of every page, and how high the foot they need reaches. */
export interface Foot {
    /** The document's footer lines, each broken where it is wider than the page. */
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
export function footOf(pen: Pen, footer: readonly string[]): Foot {
    const lines = footer.flatMap((line) => pen.wrap(line, RIGHT - LEFT, FOOTER_SIZE));
    const first = Math.max(FOOT - 8 * MM, BOTTOM + (lines.length - 1) * FOOTER_LEADING);
    return { lines, top: first + 8 * MM };
}

/** The footer lines and the page's number at the foot of the page. */
export function drawFoot(page: PDFPage, pen: Pen, foot: Foot, number: number, count: number): void {
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
export function addressLines(party: {
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
