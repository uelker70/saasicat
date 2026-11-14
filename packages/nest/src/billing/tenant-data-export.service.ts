// A tenant's full export, taken by its administrator once its subscription has
// ended from `GET billing/export`, where the application hands the file over
// rather than delivering it itself (`SC-PRIV-020`), and the record of each
// download — the tenant's acknowledgement that `SC-PRIV-017` names.
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
    type SubscriptionEndPort,
    type TenantDataExport,
    type TenantDataExportPort,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { codedError } from '../errors/coded-error.js';
import { TenantAccessService } from '../tenant-access/tenant-access.service.js';
import {
    SUBSCRIPTION_END_PORT_TOKEN,
    TENANT_DATA_EXPORT_PORT_TOKEN,
} from './tenant-billing.tokens.js';
import { TenantExportDownloads, isRecordableFile } from './tenant-export-downloads.js';

@Injectable()
export class TenantDataExportService implements OnModuleInit {
    private readonly logger = new Logger(TenantDataExportService.name);
    private readonly downloads: TenantExportDownloads;

    /** The tenants whose export this process is producing and recording now. */
    private readonly producing = new Set<string>();

    constructor(
        @Inject(SUBSCRIPTION_END_PORT_TOKEN) ends: SubscriptionEndPort,
        @Inject(TENANT_DATA_EXPORT_PORT_TOKEN) private readonly exports: TenantDataExportPort,
        // Absent only where tenant billing is wired by hand without
        // `SaaSiCatModule`: nothing records the `ended` reason then, so the
        // export is never offered.
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        rlsBypass: RlsBypassPort | null = null,
        // Without the administration's audit log — a minimal deploy — the
        // download is recorded beside the end alone.
        @Optional()
        @Inject(AdminAuditService)
        audit: AdminAuditService | null = null,
    ) {
        this.downloads = new TenantExportDownloads(ends, access, rlsBypass, audit, 'platform');
    }

    onModuleInit(): void {
        this.access?.answerEndsFrom(this.downloads);
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
        const end = await this.downloads.endOffered(tenantId);
        // Claimed with no `await` between the check and the claim, so of two
        // requests that reach this line together exactly one goes on.
        if (this.producing.has(tenantId)) {
            throw new ConflictException(
                codedError(TENANT_ACCESS_ERROR_CODES.TENANT_EXPORT_IN_PROGRESS),
            );
        }
        this.producing.add(tenantId);
        try {
            const file = await this.produce(tenantId);
            await this.downloads.record(
                tenantId,
                end,
                actor,
                { size: file.content.byteLength, mediaType: file.mediaType },
                now,
            );
            return file;
        } finally {
            this.producing.delete(tenantId);
        }
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
 * name.
 */
function isExportFile(answer: unknown): answer is TenantDataExport {
    if (typeof answer !== 'object' || answer === null) return false;
    if (!('content' in answer) || !(answer.content instanceof Uint8Array)) return false;
    if (!('mediaType' in answer)) return false;
    if (!isRecordableFile(answer.content.byteLength, answer.mediaType)) return false;
    return 'fileName' in answer && typeof answer.fileName === 'string';
}
