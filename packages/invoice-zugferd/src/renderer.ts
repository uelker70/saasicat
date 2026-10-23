// The default `InvoiceRenderer`: an issued invoice as ZUGFeRD in the EN 16931
// profile — a PDF/A-3b a person reads, carrying `factur-x.xml` as its
// alternative, which a program reads (`SC-PRIC-042`, `SC-PRIC-078`).
//
// Rendered from what the invoice records and nothing else: every date the file
// carries is the invoice's moment of issue, its identifier is derived from the
// invoice, and nothing random reaches it, so the same invoice renders into the
// same bytes every time (`SC-AUD-019`).

import { createHash } from 'node:crypto';

import { AFRelationship, PDFDocument, PDFHexString, PDFName } from 'pdf-lib';
import type { InvoiceDocument, InvoiceRenderer, SubscriptionInvoiceRecord } from '@saasicat/core';

import { ciiOf } from './cii.js';
import { titleOf } from './correction.js';
import { embedFonts, type FontFile } from './fonts.js';
import { layOut } from './layout.js';
import { xmpOf } from './xmp.js';

/** The name the Factur-X standard gives the embedded XML. */
const FACTUR_X_XML = 'factur-x.xml';
/** The Factur-X conformance level of the EN 16931 profile. */
const EN_16931_LEVEL = 'EN 16931';
const PRODUCER = 'SaaSiCat';
const CREATOR = '@saasicat/invoice-zugferd';

export type { FontFile } from './fonts.js';

export interface ZugferdRendererOptions {
    /**
     * Fonts to set the page in instead of the Roboto the package ships, for an
     * application with a typeface of its own. Embedded as PDF/A requires; a
     * character neither has a glyph for is shown as `?`.
     */
    fonts?: { regular: FontFile; bold: FontFile };
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
        // pdf-lib's suffixes for the names it gives fonts and resources come
        // from a generator seeded alike for every document, so they repeat
        // from one rendering to the next; the suite that renders twice says so.
        const pdf = await PDFDocument.create({ updateMetadata: false });
        const fonts = await embedFonts(pdf, this.options.fonts);

        layOut(pdf, invoice, fonts);

        const title = `${titleOf(invoice).de} ${invoice.number}`;
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
