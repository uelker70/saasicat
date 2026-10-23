// Hands a downloaded file to the browser to save, under the name it was
// offered with. Framework-free, and the one place the admin reaches for
// `document` and `URL` to do so.

import type { DownloadedFile } from './resources/resource-request.js';

/**
 * How long a saved file's object URL is kept. A browser may read the blob
 * only after the click has returned, and one that starts the download later
 * than that would find the address gone and save an empty or failed file;
 * FileSaver.js keeps it this long for that reason. A file is held that long and
 * no longer.
 */
export const OBJECT_URL_LIFETIME_MS = 40_000;

/** What saving a file needs of the browser; a test passes its own. */
export interface SaveFileEnvironment {
    createObjectURL(file: Blob): string;
    revokeObjectURL(url: string): void;
    /** Clicks a link to `url` that downloads under `fileName`. */
    follow(url: string, fileName: string): void;
}

/** The browser's own, where there is one. */
export function browserSaveFileEnvironment(): SaveFileEnvironment {
    return {
        createObjectURL: (file) => URL.createObjectURL(file),
        revokeObjectURL: (url) => {
            setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS);
        },
        follow: (url, fileName) => {
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            link.remove();
        },
    };
}

/**
 * Saves `file`. The object URL is let go once the link was followed — by the
 * browser's environment `OBJECT_URL_LIFETIME_MS` later —, so the bytes are not
 * kept for as long as the page lives.
 */
export function saveFile(
    file: DownloadedFile,
    environment: SaveFileEnvironment = browserSaveFileEnvironment(),
): void {
    // A copy, because a `BlobPart` has to be a view over an `ArrayBuffer`, and
    // the file's own may be over a `SharedArrayBuffer`; `Blob` takes the
    // view's bytes alone either way.
    const bytes = file.content.slice();
    const url = environment.createObjectURL(new Blob([bytes], { type: file.mediaType }));
    try {
        environment.follow(url, file.fileName);
    } finally {
        environment.revokeObjectURL(url);
    }
}
