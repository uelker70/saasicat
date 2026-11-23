// The XML a rendered invoice carries, as a program reads it out of the PDF.

import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

/** The embedded XML of a rendered file. */
export async function embeddedXml(content) {
    const pdf = await PDFDocument.load(content);
    const names = pdf.catalog.lookup(PDFName.of('Names'));
    const tree = names.lookup(PDFName.of('EmbeddedFiles'));
    const spec = tree.lookup(PDFName.of('Names')).lookup(1);
    const stream = spec.lookup(PDFName.of('EF')).lookup(PDFName.of('F'), PDFRawStream);
    return new TextDecoder().decode(decodePDFRawStream(stream).decode());
}
