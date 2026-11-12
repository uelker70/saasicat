import { StreamableFile } from '@nestjs/common';
import type { InvoiceDocument, TenantDataExport } from '@saasicat/core';

/**
 * The file name a download offers, kept to characters that cannot end the
 * header it stands in: the name comes from a renderer or the application, and
 * a quote or a line break in it would let it write a header of its own, a
 * path separator would name a directory.
 */
function downloadNameOf(fileName: string, fallback: string): string {
    const kept = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
    return kept === '' ? fallback : kept;
}

/**
 * A file as a download hands it out, under the name it carries: an archived
 * invoice or confirmation, or a tenant's export as the application produced it.
 */
export function downloadOf(
    file: InvoiceDocument | TenantDataExport,
    fallback: string,
): StreamableFile {
    return new StreamableFile(file.content, {
        type: file.mediaType,
        length: file.content.byteLength,
        disposition: `attachment; filename="${downloadNameOf(file.fileName, fallback)}"`,
    });
}
