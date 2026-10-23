// Downloading an archived file — an invoice's document, a contract's
// confirmation — from a row of a list: which row is downloading, and a
// failure said to the operator rather than lost.

import { readonly, ref, type Ref } from 'vue';

import { adminErrorMessage } from '../client/admin-error.js';
import type { DownloadedFile } from '../client/resources/resource-request.js';
import { saveFile } from '../client/save-file.js';
import type { UiNotify } from './ui-notify.js';
import { report } from './report.js';
import { useSaMessages } from './use-super-admin-i18n.js';

export interface FileDownloadPorts {
    notify: UiNotify;
    /** Hands the file to the browser; `saveFile` unless a test says otherwise. */
    save?: (file: DownloadedFile) => void;
}

export interface FileDownload {
    /** The id whose file is being fetched, or `null`; one at a time. */
    downloading: Readonly<Ref<string | null>>;
    /** Fetches the file of `id` and saves it; a failure is notified, not thrown. */
    download(id: string): Promise<void>;
}

export function useFileDownload(
    fetchFile: (id: string) => Promise<DownloadedFile>,
    ports: FileDownloadPorts,
): FileDownload {
    const errors = useSaMessages('errors');
    const downloading = ref<string | null>(null);
    const save = ports.save ?? saveFile;

    async function download(id: string): Promise<void> {
        // One at a time, which the buttons show by being disabled meanwhile;
        // a click that reaches here anyway would fetch a second file at once.
        if (downloading.value !== null) return;
        downloading.value = id;
        try {
            save(await fetchFile(id));
        } catch (err) {
            report(() => ports.notify('negative', adminErrorMessage(err, errors.value)));
        } finally {
            downloading.value = null;
        }
    }

    return { downloading: readonly(downloading), download };
}
