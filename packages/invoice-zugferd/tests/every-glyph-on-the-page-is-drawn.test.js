// Every character on a rendered page has an outline to draw — the one thing a
// validator and a text extraction both miss: a subset font whose glyph data
// is read from the wrong place still maps each glyph to its character, and
// passes PDF/A, while the page shows a few letters only. pdf-lib's subsetting
// does that to a TrueType font whose glyph data has odd lengths; the shipped
// fonts have none, a font an application passes may (`tests/fixtures/`).

// @requirement SC-PRIC-078 — The shipped renderer issues an invoice the format's own validators accept

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';

import { withEvenGlyphs, zugferdInvoiceRenderer } from '../dist/index.js';
import { SAMPLES } from './support/invoices.js';

const bytesOf = (stream) => decodePDFRawStream(stream).decode();

/** Each font embedded in `content`: the subset itself, and its glyphs' characters. */
async function embeddedFonts(content) {
    const pdf = await PDFDocument.load(content);
    const fonts = [];
    for (const [, object] of pdf.context.enumerateIndirectObjects()) {
        if (!(object instanceof PDFDict)) continue;
        if (object.get(PDFName.of('Subtype'))?.toString() !== '/Type0') continue;
        const descendant = object.lookup(PDFName.of('DescendantFonts')).lookup(0, PDFDict);
        const file = descendant
            .lookup(PDFName.of('FontDescriptor'), PDFDict)
            .lookup(PDFName.of('FontFile2'));
        const cmap = new TextDecoder().decode(bytesOf(object.lookup(PDFName.of('ToUnicode'))));
        const characters = new Map();
        for (const line of cmap.split('\n')) {
            const parts = line.split(' ');
            if (parts.length === 2 && parts[0].startsWith('<') && parts[1].startsWith('<')) {
                characters.set(
                    parseInt(parts[0].slice(1, -1), 16),
                    String.fromCodePoint(parseInt(parts[1].slice(1, -1), 16)),
                );
            }
        }
        fonts.push({ font: fontkit.create(Buffer.from(bytesOf(file))), characters });
    }
    return fonts;
}

const oddFont = () =>
    readFile(new URL('./fixtures/Roboto-Regular-odd-glyphs.ttf', import.meta.url));

/** The characters of `content` that its fonts have no outline for. */
async function undrawnCharacters(content) {
    const fonts = await embeddedFonts(content);
    assert.equal(fonts.length > 0, true);
    return fonts.flatMap(({ font, characters }) =>
        [...characters]
            .filter(([, character]) => character.trim() !== '')
            .filter(([glyph]) => font.getGlyph(glyph).path.commands.length === 0)
            .map(([, character]) => character),
    );
}

describe('a rendered page', () => {
    for (const { name, invoice } of SAMPLES) {
        test(`(${name}) draws every character it shows`, async () => {
            const { content } = await zugferdInvoiceRenderer().render(invoice);

            assert.deepEqual(await undrawnCharacters(content), []);
        });
    }

    test('set in a font of the application whose glyph data has odd lengths, draws every character it shows', async () => {
        const font = await oddFont();
        const renderer = zugferdInvoiceRenderer({ fonts: { regular: font, bold: font } });

        const { content } = await renderer.render(
            SAMPLES.find(({ name }) => name === 'standard').invoice,
        );

        assert.deepEqual(await undrawnCharacters(content), []);
    });
});

describe('a font whose glyph data has odd lengths, padded', () => {
    test('has every glyph at an even offset, its outline and its advance as they were', async () => {
        const original = await oddFont();
        const padded = withEvenGlyphs(original);
        const before = fontkit.create(original);
        const after = fontkit.create(Buffer.from(padded));

        const oddLengths = (font) =>
            font.loca.offsets.filter((offset, index, all) => (all[index + 1] ?? offset) % 2 !== 0)
                .length;
        assert.ok(oddLengths(before) > 0, 'the fixture has no odd glyph data to pad');
        assert.equal(oddLengths(after), 0);
        assert.equal(after.numGlyphs, before.numGlyphs);
        assert.equal(after.head.indexToLocFormat, 1);
        for (const character of 'AÖßg€?') {
            const [glyph] = before.layout(character).glyphs;
            assert.equal(after.getGlyph(glyph.id).path.toSVG(), glyph.path.toSVG(), character);
            assert.equal(after.getGlyph(glyph.id).advanceWidth, glyph.advanceWidth, character);
        }
    });

    test('keeps the checksum a font carries over its whole file', async () => {
        const padded = withEvenGlyphs(await oddFont());
        const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
        let sum = 0;
        for (let at = 0; at < padded.byteLength; at += 4) sum = (sum + view.getUint32(at)) >>> 0;

        assert.equal(sum, 0xb1b0afba);
    });

    test('leaves the bytes it was handed as they were', async () => {
        const original = await oddFont();
        const copy = Buffer.from(original);

        withEvenGlyphs(original);

        assert.deepEqual(original, copy);
    });

    test('padded again is the same font', async () => {
        const once = withEvenGlyphs(await oddFont());

        assert.deepEqual(withEvenGlyphs(once), once);
    });

    test('without TrueType outlines is left as it came', () => {
        // An sfnt holding a single `name` table of four bytes.
        const font = new Uint8Array(32);
        const view = new DataView(font.buffer);
        view.setUint32(0, 0x4f54544f); // 'OTTO'
        view.setUint16(4, 1);
        font.set([0x6e, 0x61, 0x6d, 0x65], 12); // 'name'
        view.setUint32(20, 28);
        view.setUint32(24, 4);

        assert.equal(withEvenGlyphs(font), font);
    });
});
