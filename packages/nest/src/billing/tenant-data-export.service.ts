// A tenant's full export, taken by its administrator once its subscription has
// ended, and the record of each download — the tenant's acknowledgement that
// `SC-PRIV-017` names (`SC-PRIV-019`).
//
// The platform does not assemble the export: the application hands it over
// through `TenantDataExportPort`, asked for the session's tenant on every
// download. The order is what makes the record evidence. The application is
// asked first; only once it has handed a file over is the download recorded;
// only once it is recorded is the file sent. An application that fails, or
// answers something that is not a file, leaves no record and the tenant is
// refused; a record that cannot be written sends no file. So a file never
// leaves without its record, and a record never claims a file the application
// did not produce. Whether the browser saved it is beyond what the server can
// know.
//
// The export is offered from the moment an end of the tenant's subscription is
// recorded — found through the open `ended` reason, whose reference is the
// subscription — and still after its deletion day, while the data is there.
// A suspension and a deletion under way refuse it before it gets here, as they
// refuse every request.
//
// The whole file is held in memory while it is produced, recorded and sent, so
// one tenant produces one export at a time: a second request while the first
// is produced and recorded is refused rather than holding a second copy. The
// rule holds within one process — two instances each produce their own, and
// different tenants are not held up by each other — and the file a finished
// request is still sending is no longer counted.

import {
    ConflictException,
    Inject,
    Injectable,
    Logger,
    type OnModuleInit,
    Optional,
    ServiceUnavailableException,
} from '@nestjs/common';
import {
    TENANT_ACCESS_ERROR_CODES,
    type AdminActor,
    type RlsBypassPort,
    type SubscriptionEnd,
    type SubscriptionEndPort,
    type TenantDataExport,
    type TenantDataExportPort,
    type TenantExportDownload,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { actorTagOf } from '../core/web-audit.js';
import { codedError } from '../errors/coded-error.js';
import { referencesOf } from '../tenant-access/hold-references.js';
import {
    TenantAccessService,
    type EndedSubscriptionSource,
    type NamedEnd,
} from '../tenant-access/tenant-access.service.js';
import {
    SUBSCRIPTION_END_PORT_TOKEN,
    TENANT_DATA_EXPORT_PORT_TOKEN,
} from './tenant-billing.tokens.js';

/** The audit log's key for one download of a tenant's export. */
const TENANT_EXPORT_DOWNLOAD_ACTION = 'TENANT_EXPORT_DOWNLOAD';

/**
 * A media type as a header carries it: printable ASCII, at least one
 * character. One quantifier, over one class, so it cannot backtrack.
 */
const HEADER_TEXT = /^[\x20-\x7e]+$/;

/**
 * Why a start is refused where the ends of subscriptions are kept and the
 * application wires no export, naming the option the way `option` spells it.
 */
export function exportNotWired(option: string): string {
    return (
        `${option} is missing: wherever the end of a subscription is kept, the application ` +
        "hands over the tenant's full export through a TenantDataExportPort, because the " +
        'read-only period before the deletion day exists for the tenant to take it (SC-PRIV-019).'
    );
}

@Injectable()
export class TenantDataExportService implements OnModuleInit, EndedSubscriptionSource {
    private readonly logger = new Logger(TenantDataExportService.name);

    /** The tenants whose export this process is producing and recording now. */
    private readonly producing = new Set<string>();

    constructor(
        @Inject(SUBSCRIPTION_END_PORT_TOKEN) private readonly ends: SubscriptionEndPort,
        @Inject(TENANT_DATA_EXPORT_PORT_TOKEN) private readonly exports: TenantDataExportPort,
        // Absent only where tenant billing is wired by hand without
        // `SaaSiCatModule`: nothing records the `ended` reason then, so the
        // export is never offered.
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        // Without the administration's audit log — a minimal deploy — the
        // download is recorded beside the end alone.
        @Optional()
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService | null = null,
    ) {}

    onModuleInit(): void {
        this.access?.answerEndsFrom(this);
    }

    /**
     * The full export of `tenantId`, taken by `actor` at `now`, once its
     * download is recorded. Refused with `TENANT_EXPORT_NOT_OFFERED` where no
     * end of the tenant's subscription is recorded, with
     * `TENANT_EXPORT_IN_PROGRESS` while this process is producing the tenant's
     * export for another request, and with `TENANT_EXPORT_FAILED` where the
     * application hands no file over; a failure to record the download is
     * thrown as it is. Nothing is recorded on any of these paths, and nothing
     * is handed back on any.
     */
    async take(tenantId: string, actor: AdminActor, now: Date): Promise<TenantDataExport> {
        const end = await this.endOffered(tenantId);
        // Claimed with no `await` between the check and the claim, so of two
        // requests that reach this line together exactly one goes on.
        if (this.producing.has(tenantId)) {
            throw new ConflictException(
                codedError(TENANT_ACCESS_ERROR_CODES.TENANT_EXPORT_IN_PROGRESS),
            );
        }
        this.producing.add(tenantId);
        try {
            return await this.produceAndRecord(tenantId, end, actor, now);
        } finally {
            this.producing.delete(tenantId);
        }
    }

    /** The application's file for `tenantId`, once its download is recorded beside `end` and audited. */
    private async produceAndRecord(
        tenantId: string,
        end: SubscriptionEnd,
        actor: AdminActor,
        now: Date,
    ): Promise<TenantDataExport> {
        const file = await this.produce(tenantId);
        const download = await this.ends.recordExportDownload({
            tenantId,
            subscriptionId: end.subscriptionId,
            downloadedAt: now,
            downloadedBy: actorTagOf(actor),
            downloadedByUserId: actor.userId,
            size: file.content.byteLength,
        });
        await this.audited(actor, download, file);
        return file;
    }

    /**
     * Read in the frame the caller runs in and held to `tenantId`: the
     * download reads it within the tenant's own scope, the access check
     * through the bypass, where `tenantId` is all that bounds it
     * (`SC-SEC-019`).
     */
    async endsOf(tenantId: string, subscriptionIds: readonly string[]): Promise<SubscriptionEnd[]> {
        if (subscriptionIds.length === 0) return [];
        const ends = await this.ends.listFor(subscriptionIds);
        return ends.filter((end) => end.tenantId === tenantId);
    }

    /**
     * Read past the tenants' policy, as every read of the administration is
     * (`SC-SEC-019`): the operator's detail page asks outside any tenant's
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
     * The end the export is offered for: of the subscriptions the open `ended`
     * reasons name, the one whose end is recorded, the latest where there are
     * several.
     */
    private async endOffered(tenantId: string): Promise<SubscriptionEnd> {
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

    /** The file the application hands over for `tenantId`, or the refusal where it hands none. */
    private async produce(tenantId: string): Promise<TenantDataExport> {
        let file: unknown;
        try {
            file = await this.exports.export(tenantId);
        } catch (error) {
            this.logger.error(
                `The TenantDataExportPort failed for tenant ${tenantId}; nothing was recorded or sent.`,
                error instanceof Error ? error.stack : String(error),
            );
            throw exportFailed();
        }
        if (!isExportFile(file)) {
            this.logger.error(
                `The TenantDataExportPort answered tenant ${tenantId} with something that is not ` +
                    'a file — at least one byte as a Uint8Array, a media type in printable ASCII ' +
                    'and a file name; nothing was recorded or sent.',
            );
            throw exportFailed();
        }
        return file;
    }

    /**
     * Writes the download to the audit log, best effort: the download stands
     * whether or not its entry could be written (`SC-AUD-004`), and its record
     * beside the end is the evidence.
     */
    private async audited(
        actor: AdminActor,
        download: TenantExportDownload,
        file: TenantDataExport,
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
                    bytes: file.content.byteLength,
                },
            });
        } catch (error) {
            this.logger.error(
                `Download ${download.id} of tenant ${download.tenantId}'s export is recorded and ` +
                    'is sent, but writing its audit entry failed.',
                error instanceof Error ? error.stack : String(error),
            );
        }
    }
}

/** The refusal of a download the application handed no file for. */
function exportFailed(): ServiceUnavailableException {
    return new ServiceUnavailableException(
        codedError(TENANT_ACCESS_ERROR_CODES.TENANT_EXPORT_FAILED),
    );
}

/**
 * Whether the application's answer is a file the download can hand out as it
 * is: whole bytes, at least one, a media type a header can carry, and a file
 * name. An empty file exports nothing, and its record would claim an export
 * the application did not produce.
 */
function isExportFile(answer: unknown): answer is TenantDataExport {
    if (typeof answer !== 'object' || answer === null) return false;
    if (!('content' in answer) || !(answer.content instanceof Uint8Array)) return false;
    if (answer.content.byteLength === 0) return false;
    if (!('mediaType' in answer) || typeof answer.mediaType !== 'string') return false;
    if (!HEADER_TEXT.test(answer.mediaType)) return false;
    return 'fileName' in answer && typeof answer.fileName === 'string';
}
