// useTenantExport — the tenant's full export, `GET /billing/export`, which its
// administrator takes once its subscription has ended and before its data is
// deleted (`SC-PRIV-020`), where the platform serves it. Whether it is offered
// to this user, and by whom, is the access state's to say
// (`TenantAccessView.mayExport`, `exportDeliveredBy`); this downloads it and
// hands the file over, under the name the server offers, as an invoice's
// archived document is downloaded.

import { readonly, ref, type Ref } from 'vue';

import { trimTrailingSlashes } from '../client/http-json.js';
import { requestFile, type DownloadedFile } from '../client/resources/resource-request.js';
import { saveFile } from '../client/save-file.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

/** The name the file is saved under where the server offers none. */
const FALLBACK_FILE_NAME = 'export';

export interface UseTenantExportOptions {
    http?: HttpClient;
    /** The prefix the billing routes sit under, as for `useTenantBilling`. Default `/billing`. */
    apiPrefix?: string;
    /** What the downloaded export is handed to. Default: the browser saves it. */
    save?: (file: DownloadedFile) => void;
}

export interface UseTenantExportResult {
    /** Whether the export is being downloaded. */
    downloading: Readonly<Ref<boolean>>;
    /**
     * Downloads the export and hands it over; a refusal reaches the caller and
     * nothing is saved. One at a time: a second call while one runs does
     * nothing, as the server records every download it sends.
     */
    download(): Promise<void>;
}

export function useTenantExport(options: UseTenantExportOptions = {}): UseTenantExportResult {
    const url = `${trimTrailingSlashes(options.apiPrefix ?? '/billing')}/export`;
    const http = options.http ?? defaultHttpClient();
    const save = options.save ?? ((file: DownloadedFile) => saveFile(file));
    const downloading = ref(false);

    async function download(): Promise<void> {
        if (downloading.value) return;
        downloading.value = true;
        try {
            save(await requestFile(http, url, FALLBACK_FILE_NAME));
        } finally {
            downloading.value = false;
        }
    }

    return { downloading: readonly(downloading), download };
}
