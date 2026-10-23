// The default `ContractConfirmationRenderer`: a contract's confirmation as a
// PDF on the letter its invoices are printed on, labelled in German with
// English beside it (`SC-AUD-016`).
//
// Rendered from what the contract records and nothing else: every date the
// file carries is the moment the contract was written, its identifier is
// derived from the contract, and nothing random reaches it, so the same
// contract renders into the same bytes every time — which the record of its
// confirmation relies on to archive the file whose checksum it recorded.

import { createHash } from 'node:crypto';

import { PDFDocument, PDFHexString } from 'pdf-lib';
import type {
    ContractConfirmationDocument,
    ContractConfirmationRenderer,
    ContractToConfirm,
} from '@saasicat/core';

import { layOutConfirmation } from './confirmation-layout.js';
import { embedFonts } from './fonts.js';
import { CONFIRMATION_LABELS } from './labels.js';
import type { ZugferdRendererOptions } from './renderer.js';

const PRODUCER = 'SaaSiCat';
const CREATOR = '@saasicat/invoice-zugferd';

export class PdfContractConfirmationRenderer implements ContractConfirmationRenderer {
    constructor(private readonly options: ZugferdRendererOptions = {}) {}

    async render(confirmation: ContractToConfirm): Promise<ContractConfirmationDocument> {
        const { contract } = confirmation;
        const pdf = await PDFDocument.create({ updateMetadata: false });
        const fonts = await embedFonts(pdf, this.options.fonts);

        layOutConfirmation(pdf, confirmation, fonts);

        pdf.setTitle(`${CONFIRMATION_LABELS.title.de} ${contract.id}`);
        pdf.setProducer(PRODUCER);
        pdf.setCreator(CREATOR);
        pdf.setCreationDate(contract.createdAt);
        pdf.setModificationDate(contract.createdAt);
        const id = PDFHexString.of(
            createHash('sha256')
                .update(`confirmation|${contract.id}`)
                .digest('hex')
                .slice(0, 32)
                .toUpperCase(),
        );
        pdf.context.trailerInfo.ID = pdf.context.obj([id, id]);

        const content = await pdf.save({ useObjectStreams: false, updateFieldAppearances: false });
        return {
            content,
            mediaType: 'application/pdf',
            fileName: `contract-confirmation-${contract.id}.pdf`,
        };
    }
}

/**
 * The default confirmation renderer, to pass as
 * `tenantBilling.chargeJournal.invoices.confirmations.renderer`.
 */
export function contractConfirmationRenderer(
    options: ZugferdRendererOptions = {},
): ContractConfirmationRenderer {
    return new PdfContractConfirmationRenderer(options);
}
