// The fonts a document is set in: the Roboto the package ships, or a pair an
// application passes, embedded as subsets as PDF/A requires.

import { readFile } from 'node:fs/promises';

import fontkit from '@pdf-lib/fontkit';
import type { PDFDocument } from 'pdf-lib';

import type { Fonts } from './letter.js';
import { withEvenGlyphs } from './truetype.js';

/** A font's bytes: TrueType or OpenType. */
export type FontFile = Uint8Array;

/** The Roboto the package ships, read once from beside its build. */
let shipped: Promise<{ regular: FontFile; bold: FontFile }> | undefined;

function shippedFonts(): Promise<{ regular: FontFile; bold: FontFile }> {
    shipped ??= Promise.all([
        readFile(new URL('../fonts/Roboto-Regular.ttf', import.meta.url)),
        readFile(new URL('../fonts/Roboto-Bold.ttf', import.meta.url)),
    ]).then(([regular, bold]) => ({ regular, bold }));
    return shipped;
}

/** Embeds `chosen`, or the shipped fonts where it is not given, into `pdf`. */
export async function embedFonts(
    pdf: PDFDocument,
    chosen: { regular: FontFile; bold: FontFile } | undefined,
): Promise<Fonts> {
    const files = chosen ?? (await shippedFonts());
    pdf.registerFontkit(fontkit);
    return {
        regular: await pdf.embedFont(withEvenGlyphs(files.regular), { subset: true }),
        bold: await pdf.embedFont(withEvenGlyphs(files.bold), { subset: true }),
    };
}
