// useTenantInvoices — the invoices of the tenant's subscription and its
// contract confirmations, in its billing area: `GET /billing/invoices` a page
// at a time, `GET /billing/contracts`, and the archived document of each.
//
// Behind the billing permission like the payment method, so a refusal that
// says this part is not for the user (`isHiddenFromThisUser`) turns
// `available` false, and anything else is an error the page reports. The
// server decides where each invoice stands and names every day; this only
// carries it to the page.

import { ref, type Ref } from 'vue';
import type {
    TenantContractConfirmation,
    TenantContractConfirmations,
    TenantInvoice,
    TenantInvoicePage,
} from '@saasicat/core';

import { httpStatusOf } from '../client/admin-error.js';
import { isHiddenFromThisUser } from '../client/billing-area.js';
import { getJson, trimTrailingSlashes } from '../client/http-json.js';
import { requestFile, type DownloadedFile } from '../client/resources/resource-request.js';
import { saveFile } from '../client/save-file.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseTenantInvoicesOptions {
    http?: HttpClient;
    /** The prefix the billing routes sit under, as for `useTenantBilling`. Default `/billing`. */
    apiPrefix?: string;
    /** Default `true`: loads once on the next tick. */
    autoLoad?: boolean;
    /** What a downloaded document is handed to. Default: the browser saves it. */
    save?: (file: DownloadedFile) => void;
}

export interface UseTenantInvoicesResult {
    /** The invoices read so far, the newest first. */
    invoices: Ref<TenantInvoice[]>;
    /** The contract confirmations, the newest first. */
    confirmations: Ref<TenantContractConfirmation[]>;
    /** Whether a further page of invoices is there to read. */
    hasMore: Ref<boolean>;
    /** Whether this user may see them here at all — false without the routes or the permission. */
    available: Ref<boolean>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    /** The id of the invoice or contract whose document is being downloaded, `null` otherwise. */
    downloading: Ref<string | null>;
    /** Reads the first page and the confirmations again. */
    reload(): Promise<void>;
    /** Reads the next page of invoices and adds it below. */
    more(): Promise<void>;
    /** Downloads an invoice's archived document; a refusal reaches the caller. */
    downloadInvoice(invoiceId: string): Promise<void>;
    /** Downloads a contract's archived confirmation; a refusal reaches the caller. */
    downloadConfirmation(contractId: string): Promise<void>;
}

function isInvoicePage(value: unknown): value is TenantInvoicePage {
    if (typeof value !== 'object' || value === null || !('invoices' in value)) return false;
    const next: unknown = 'next' in value ? value.next : undefined;
    return Array.isArray(value.invoices) && (next === null || typeof next === 'string');
}

function isConfirmations(value: unknown): value is TenantContractConfirmations {
    return (
        typeof value === 'object' &&
        value !== null &&
        'confirmations' in value &&
        Array.isArray(value.confirmations)
    );
}

export function useTenantInvoices(options: UseTenantInvoicesOptions = {}): UseTenantInvoicesResult {
    const prefix = trimTrailingSlashes(options.apiPrefix ?? '/billing');
    const http = options.http ?? defaultHttpClient();
    const save = options.save ?? ((file: DownloadedFile) => saveFile(file));

    const invoices = ref<TenantInvoice[]>([]);
    const confirmations = ref<TenantContractConfirmation[]>([]);
    const next = ref<string | null>(null);
    const hasMore = ref(false);
    const available = ref(false);
    const loading = ref(false);
    const error = ref<Error | null>(null);
    const downloading = ref<string | null>(null);

    async function pageAfter(after: string | null): Promise<TenantInvoicePage> {
        const query = after === null ? '' : `?after=${encodeURIComponent(after)}`;
        const answer = await getJson<unknown>(http, `${prefix}/invoices${query}`);
        // An empty list would read as a subscriber with no invoices, about one
        // the page simply could not read.
        if (!isInvoicePage(answer)) {
            throw new Error(`${prefix}/invoices did not answer with { invoices, next }.`);
        }
        return answer;
    }

    async function readConfirmations(): Promise<TenantContractConfirmation[]> {
        const answer = await getJson<unknown>(http, `${prefix}/contracts`);
        if (!isConfirmations(answer)) {
            throw new Error(`${prefix}/contracts did not answer with { confirmations }.`);
        }
        return answer.confirmations;
    }

    function showPage(page: TenantInvoicePage, below: TenantInvoice[]): void {
        invoices.value = [...below, ...page.invoices];
        next.value = page.next;
        hasMore.value = page.next !== null;
    }

    async function run(read: () => Promise<void>): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            await read();
            available.value = true;
        } catch (err) {
            available.value = !isHiddenFromThisUser(httpStatusOf(err));
            if (available.value) error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    function reload(): Promise<void> {
        return run(async () => {
            const [page, confirmed] = await Promise.all([pageAfter(null), readConfirmations()]);
            showPage(page, []);
            confirmations.value = confirmed;
        });
    }

    function more(): Promise<void> {
        const after = next.value;
        if (after === null) return Promise.resolve();
        return run(async () => showPage(await pageAfter(after), invoices.value));
    }

    async function download(id: string, url: string, fallbackName: string): Promise<void> {
        downloading.value = id;
        try {
            save(await requestFile(http, url, fallbackName));
        } finally {
            downloading.value = null;
        }
    }

    function downloadInvoice(invoiceId: string): Promise<void> {
        const url = `${prefix}/invoices/${encodeURIComponent(invoiceId)}/document`;
        return download(invoiceId, url, 'invoice.pdf');
    }

    function downloadConfirmation(contractId: string): Promise<void> {
        const url = `${prefix}/contracts/${encodeURIComponent(contractId)}/confirmation`;
        return download(contractId, url, 'contract-confirmation.pdf');
    }

    if (options.autoLoad !== false) {
        queueMicrotask(() => void reload());
    }

    return {
        invoices,
        confirmations,
        hasMore,
        available,
        loading,
        error,
        downloading,
        reload,
        more,
        downloadInvoice,
        downloadConfirmation,
    };
}
