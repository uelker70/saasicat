// The files the operator downloads beside a tenant: an invoice's archived
// document and a contract's confirmation, each offered where the manifest
// announces the route that answers it.

import { computed, type ComputedRef, type Ref } from 'vue';
import {
    CONTRACT_CONFIRMATIONS_CAPABILITY,
    INVOICE_DOCUMENT_CAPABILITY,
    type AdminManifest,
} from '@saasicat/core';

import type { Bound } from '../client/resources/define-resource.js';
import type { tenantsResource } from '../client/resources/tenants.resource.js';
import { useFileDownload, type FileDownload, type FileDownloadPorts } from './use-file-download.js';

/** The tenant operations the downloads call, already bound to the shell's client. */
export type TenantDownloadsResource = Pick<
    Bound<(typeof tenantsResource)['ops']>,
    'invoiceDocument' | 'contractConfirmation'
>;

export interface TenantDownloads {
    /** An invoice's archived document; `null` where the platform does not serve it. */
    invoices: ComputedRef<FileDownload | null>;
    /** A contract's archived confirmation; `null` where the platform does not serve it. */
    confirmations: ComputedRef<FileDownload | null>;
}

export function useTenantDownloads(
    manifest: Ref<AdminManifest | null>,
    tenants: TenantDownloadsResource,
    ports: FileDownloadPorts,
): TenantDownloads {
    const served = (capability: string) => manifest.value?.capabilities?.[capability] === true;
    const invoices = useFileDownload((id) => tenants.invoiceDocument(id), ports);
    const confirmations = useFileDownload((id) => tenants.contractConfirmation(id), ports);
    return {
        invoices: computed(() => (served(INVOICE_DOCUMENT_CAPABILITY) ? invoices : null)),
        confirmations: computed(() =>
            served(CONTRACT_CONFIRMATIONS_CAPABILITY) ? confirmations : null,
        ),
    };
}
