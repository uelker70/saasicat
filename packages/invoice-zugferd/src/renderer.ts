// The default `InvoiceRenderer`: an issued invoice as ZUGFeRD in the EN 16931
// profile — a PDF/A-3b a person reads, carrying `factur-x.xml` as its
// alternative, which a program reads (`SC-PRIC-042`, `SC-PRIC-078`).
//
// Rendered from what the invoice records and nothing else: every date the file
// carries is the invoice's moment of issue, its identifier is derived from the
// invoice, and nothing random reaches it, so the same invoice renders into the
// same bytes every time (`SC-AUD-019`).

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import fontkit from '@pdf-lib/fontkit';
import { AFRelationship, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import type { InvoiceDocument, InvoiceRenderer, SubscriptionInvoiceRecord } from '@saasicat/core';

import { ciiOf } from './cii.js';
import { layOut, type Fonts } from './layout.js';
import { withEvenGlyphs } from './truetype.js';
import { xmpOf } from './xmp.js';

/** The name the Factur-X standard gives the embedded XML. */
const FACTUR_X_XML = 'factur-x.xml';
/** The Factur-X conformance level of the EN 16931 profile. */
const EN_16931_LEVEL = 'EN 16931';
const PRODUCER = 'SaaSiCat';
const CREATOR = '@saasicat/invoice-zugferd';

/** A font's bytes: TrueType or OpenType. */
export type FontFile = Uint8Array;

export interface ZugferdRendererOptions {
    /**
     * Fonts to set the page in instead of the Roboto the package ships, for an
     * application with a typeface of its own. Embedded as PDF/A requires; a
     * character neither has a glyph for is shown as `?`.
     */
    fonts?: { regular: FontFile; bold: FontFile };
}

/** The Roboto the package ships, read once from beside its build. */
let shipped: Promise<{ regular: FontFile; bold: FontFile }> | undefined;

function shippedFonts(): Promise<{ regular: FontFile; bold: FontFile }> {
    shipped ??= Promise.all([
        readFile(new URL('../fonts/Roboto-Regular.ttf', import.meta.url)),
        readFile(new URL('../fonts/Roboto-Bold.ttf', import.meta.url)),
    ]).then(([regular, bold]) => ({ regular, bold }));
    return shipped;
}

/** Sixteen bytes that identify the file of `invoice`, the same for every rendering of it. */
function fileIdOf(invoice: SubscriptionInvoiceRecord): string {
    return createHash('sha256')
        .update(`${invoice.id}|${invoice.number}`)
        .digest('hex')
        .slice(0, 32)
        .toUpperCase();
}

export class ZugferdInvoiceRenderer implements InvoiceRenderer {
    constructor(private readonly options: ZugferdRendererOptions = {}) {}

    async render(invoice: SubscriptionInvoiceRecord): Promise<InvoiceDocument> {
        const files = this.options.fonts ?? (await shippedFonts());
        // pdf-lib's suffixes for the names it gives fonts and resources come
        // from a generator seeded alike for every document, so they repeat
        // from one rendering to the next; the suite that renders twice says so.
        const pdf = await PDFDocument.create({ updateMetadata: false });
        pdf.registerFontkit(fontkit);
        const fonts: Fonts = {
            regular: await pdf.embedFont(withEvenGlyphs(files.regular), { subset: true }),
            bold: await pdf.embedFont(withEvenGlyphs(files.bold), { subset: true }),
        };

        layOut(pdf, invoice, fonts);

        const title = `Rechnung ${invoice.number}`;
        pdf.setTitle(title);
        pdf.setProducer(PRODUCER);
        pdf.setCreator(CREATOR);
        pdf.setCreationDate(invoice.issuedAt);
        pdf.setModificationDate(invoice.issuedAt);
        const metadata = pdf.context.stream(
            xmpOf({
                title,
                producer: PRODUCER,
                creatorTool: CREATOR,
                at: invoice.issuedAt,
                fileName: FACTUR_X_XML,
                conformanceLevel: EN_16931_LEVEL,
            }),
            { Type: 'Metadata', Subtype: 'XML' },
        );
        pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(metadata));
        const id = PDFHexString.of(fileIdOf(invoice));
        pdf.context.trailerInfo.ID = pdf.context.obj([id, id]);

        await pdf.attach(new TextEncoder().encode(ciiOf(invoice)), FACTUR_X_XML, {
            mimeType: 'text/xml',
            description: 'Factur-X invoice',
            creationDate: invoice.issuedAt,
            modificationDate: invoice.issuedAt,
            afRelationship: AFRelationship.Alternative,
        });

        const content = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
        return { content, mediaType: 'application/pdf', fileName: `${invoice.number}.pdf` };
    }
}

/** The default renderer, to pass as `tenantBilling.chargeJournal.invoices.renderer`. */
export function zugferdInvoiceRenderer(options: ZugferdRendererOptions = {}): InvoiceRenderer {
    return new ZugferdInvoiceRenderer(options);
}
