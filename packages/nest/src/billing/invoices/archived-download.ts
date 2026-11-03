import { StreamableFile } from '@nestjs/common';
import type { InvoiceDocument } from '@saasicat/core';

/**
 * The file name a download offers, kept to characters that cannot end the
 * header it stands in: the name comes from the renderer, and a quote or a line
 * break in it would let it write a header of its own.
 */
function downloadNameOf(fileName: string, fallback: string): string {
    const kept = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    return kept === '' ? fallback : kept;
}

/** An archived file as the download hands it out, under the name it was archived with. */
export function downloadOf(file: InvoiceDocument, fallback: string): StreamableFile {
    return new StreamableFile(file.content, {
        type: file.mediaType,
        length: file.content.byteLength,
        disposition: `attachment; filename="${downloadNameOf(file.fileName, fallback)}"`,
    });
}
