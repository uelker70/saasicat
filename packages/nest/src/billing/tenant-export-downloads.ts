// The record of each download of a tenant's export, kept beside the end of its
// subscription — the tenant's acknowledgement `SC-PRIV-017` names — and what
// the tenant's state and the operator's page read of those ends.
//
// One record, whoever delivers the file (`SC-PRIV-020`): the platform's own
// route (`TenantDataExportService`) and a download of the application's own
// (`TenantExportDeliveryService`) find the end the export is offered for, write
// the same row and the same audit entry, through this. Which of the two
// delivers is fixed when the module starts, and the tenant's state says it.

import { ConflictException, Logger } from '@nestjs/common';
import {
    TENANT_ACCESS_ERROR_CODES,
    type AdminActor,
    type DeliveredTenantExport,
    type RlsBypassPort,
    type SubscriptionEnd,
    type SubscriptionEndPort,
    type TenantExportDeliverer,
    type TenantExportDownload,
} from '@saasicat/core';

import type { AdminAuditService } from '../admin/admin-audit.service.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { actorTagOf } from '../core/web-audit.js';
import { codedError } from '../errors/coded-error.js';
import { referencesOf } from '../tenant-access/hold-references.js';
import type {
    EndedSubscriptionSource,
    NamedEnd,
    TenantAccessService,
} from '../tenant-access/tenant-access.service.js';

/** The audit log's key for one download of a tenant's export. */
const TENANT_EXPORT_DOWNLOAD_ACTION = 'TENANT_EXPORT_DOWNLOAD';

/**
 * A media type as a header carries it: printable ASCII, at least one
 * character. One quantifier, over one class, so it cannot backtrack.
 */
const HEADER_TEXT = /^[\x20-\x7e]+$/;

/**
 * Whether a file of `size` bytes with `mediaType` can be recorded as a
 * download: a whole number of bytes, at least one, and a media type in
 * printable ASCII. An empty file exports nothing, and its record would claim
 * an export nobody delivered.
 */
export function isRecordableFile(size: unknown, mediaType: unknown): boolean {
    return (
        typeof size === 'number' &&
        Number.isSafeInteger(size) &&
        size >= 1 &&
        typeof mediaType === 'string' &&
        HEADER_TEXT.test(mediaType)
    );
}

export class TenantExportDownloads implements EndedSubscriptionSource {
    private readonly logger = new Logger(TenantExportDownloads.name);

    constructor(
        private readonly ends: SubscriptionEndPort,
        // Absent only where tenant billing is wired by hand without
        // `SaaSiCatModule`: nothing records the `ended` reason then, so the
        // export is never offered.
        private readonly access: TenantAccessService | null,
        private readonly rlsBypass: RlsBypassPort | null,
        // Without the administration's audit log — a minimal deploy — the
        // download is recorded beside the end alone.
        private readonly audit: AdminAuditService | null,
        readonly exportDeliveredBy: TenantExportDeliverer,
    ) {}

    /**
     * Read in the frame the caller runs in and held to `tenantId`: the
     * platform's download reads it within the tenant's own scope, the access
     * check and the record of a delivery through the bypass, where `tenantId`
     * is all that bounds it (`SC-SEC-020`).
     */
    async endsOf(tenantId: string, subscriptionIds: readonly string[]): Promise<SubscriptionEnd[]> {
        if (subscriptionIds.length === 0) return [];
        const ends = await this.ends.listFor(subscriptionIds);
        return ends.filter((end) => end.tenantId === tenantId);
    }

    /**
     * Read past the tenants' policy, as every read of the administration is
     * (`SC-SEC-020`): the operator's detail page asks outside any tenant's
     * scope. Held to `tenantId`, one read of the ends and one of the downloads.
     */
    async endsWithDownloadsOf(
        tenantId: string,
        subscriptionIds: readonly string[],
    ): Promise<NamedEnd[]> {
        if (subscriptionIds.length === 0) return [];
        const [ends, downloads] = await readAcrossTenants(this.rlsBypass, () =>
            Promise.all([
                this.ends.listFor(subscriptionIds),
                this.ends.listExportDownloadsFor(subscriptionIds),
            ]),
        );
        return ends
            .filter((end) => end.tenantId === tenantId)
            .map((end) => ({
                subscriptionId: end.subscriptionId,
                deletesOn: end.deletesOn,
                downloads: downloads.filter(
                    (download) =>
                        download.tenantId === tenantId &&
                        download.subscriptionId === end.subscriptionId,
                ),
            }));
    }

    /**
     * The end the export of `tenantId` is offered for: of the subscriptions
     * the open `ended` reasons name, the one whose end is recorded, the latest
     * where there are several. Refused with `TENANT_EXPORT_NOT_OFFERED` where
     * there is none.
     */
    async endOffered(tenantId: string): Promise<SubscriptionEnd> {
        const holds = this.access ? (await this.access.accessOf(tenantId)).holds : [];
        const [latest] = (await this.endsOf(tenantId, referencesOf(holds, 'ended'))).sort(
            (a, b) => b.endsAt.getTime() - a.endsAt.getTime(),
        );
        if (!latest) {
            throw new ConflictException(
                codedError(TENANT_ACCESS_ERROR_CODES.TENANT_EXPORT_NOT_OFFERED),
            );
        }
        return latest;
    }

    /**
     * Records that `actor` took `file`, the export of `tenantId`, at `now`,
     * beside `end`, and audits it. A failure to record is thrown as it is, and
     * nothing is audited then.
     */
    async record(
        tenantId: string,
        end: SubscriptionEnd,
        actor: AdminActor,
        file: DeliveredTenantExport,
        now: Date,
    ): Promise<TenantExportDownload> {
        const download = await this.ends.recordExportDownload({
            tenantId,
            subscriptionId: end.subscriptionId,
            downloadedAt: now,
            downloadedBy: actorTagOf(actor),
            downloadedByUserId: actor.userId,
            size: file.size,
        });
        await this.audited(actor, download, file);
        return download;
    }

    /**
     * Writes the download to the audit log, best effort: the download stands
     * whether or not its entry could be written (`SC-AUD-004`), and its record
     * beside the end is the evidence.
     */
    private async audited(
        actor: AdminActor,
        download: TenantExportDownload,
        file: DeliveredTenantExport,
    ): Promise<void> {
        if (!this.audit) return;
        try {
            await this.audit.log({
                actor,
                entity: 'Tenant',
                entityId: download.tenantId,
                action: TENANT_EXPORT_DOWNLOAD_ACTION,
                changes: {
                    subscriptionId: download.subscriptionId,
                    downloadId: download.id,
                    mediaType: file.mediaType,
                    bytes: file.size,
                },
            });
        } catch (error) {
            this.logger.error(
                `Download ${download.id} of tenant ${download.tenantId}'s export is recorded and ` +
                    'stands, but writing its audit entry failed.',
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}
