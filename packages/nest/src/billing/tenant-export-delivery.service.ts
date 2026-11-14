// A tenant's full export that the application delivers itself (`SC-PRIV-020`),
// where `subscriptionEnds.export` declares `{ deliveredBy: 'application' }`.
//
// Such an export goes out from a download of the application's own — streamed,
// as one too large to hold in memory has to be — and the platform neither
// produces nor sends it. What the platform keeps is the record: once the whole
// file has gone out, the application calls `recordDelivered`, and the download
// is recorded beside the end and audited exactly as one the platform served,
// as the tenant's acknowledgement (`SC-PRIV-017`). So here the order is the
// other way round from the platform's route: the file has left before its
// record is written, and a download that broke off, or that the application
// never reports, leaves none. Nor does a `HEAD`: the application's `GET`
// handler answers it, its stream is accepted to the end, and no file reaches
// anybody. One download of a tenant at a time, and how long one may take, are
// the application's to bound on this path.
//
// The tenant and who took the export are read from the request the application
// served it on, by the rules the platform's route reads them by: its own
// administrator, never the operator acting as the tenant. The end is read and
// the download written through the bypass, by that tenant (`SC-SEC-020`): the
// application reports once its stream has gone out, after its handler returned
// and in whatever frame the response's last event runs in.

import {
    Inject,
    Injectable,
    Logger,
    MethodNotAllowedException,
    type OnModuleInit,
    Optional,
    ServiceUnavailableException,
} from '@nestjs/common';
import {
    TENANT_ACCESS_ERROR_CODES,
    type DeliveredTenantExport,
    type RlsBypassPort,
    type SubscriptionEndPort,
    type TenantExportDownload,
} from '@saasicat/core';

import { AdminAuditService } from '../admin/admin-audit.service.js';
import { RLS_BYPASS_PORT_TOKEN } from '../admin/admin.tokens.js';
import { readAcrossTenants } from '../admin/read-across-tenants.js';
import { codedError } from '../errors/coded-error.js';
import { TenantAccessService } from '../tenant-access/tenant-access.service.js';
import { exportTakerOf, isHead, type ExportTakerResolvers } from './export-taker.js';
import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    SUBSCRIPTION_END_PORT_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    USER_ID_RESOLVER_TOKEN,
    type AuditContextResolver,
    type TenantIdResolver,
    type UserEmailResolver,
    type UserIdResolver,
} from './tenant-billing.tokens.js';
import { TenantExportDownloads, isRecordableFile } from './tenant-export-downloads.js';

@Injectable()
export class TenantExportDeliveryService implements OnModuleInit {
    private readonly logger = new Logger(TenantExportDeliveryService.name);
    private readonly downloads: TenantExportDownloads;

    constructor(
        @Inject(SUBSCRIPTION_END_PORT_TOKEN) ends: SubscriptionEndPort,
        // Absent only where tenant billing is wired by hand without
        // `SaaSiCatModule`: nothing records the `ended` reason then, so no
        // download is recorded, and nothing says the operator is acting as the
        // tenant but `SUPER_ADMIN`.
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
        @Optional()
        @Inject(RLS_BYPASS_PORT_TOKEN)
        private readonly rlsBypass: RlsBypassPort | null = null,
        @Optional()
        @Inject(AdminAuditService)
        audit: AdminAuditService | null = null,
        @Optional()
        @Inject(TENANT_ID_RESOLVER_TOKEN)
        private readonly tenantIdResolver: TenantIdResolver | null = null,
        @Optional()
        @Inject(USER_ID_RESOLVER_TOKEN)
        private readonly userIdResolver: UserIdResolver | null = null,
        @Optional()
        @Inject(USER_EMAIL_RESOLVER_TOKEN)
        private readonly userEmailResolver: UserEmailResolver | null = null,
        @Optional()
        @Inject(AUDIT_CONTEXT_RESOLVER_TOKEN)
        private readonly auditContextResolver: AuditContextResolver | null = null,
    ) {
        this.downloads = new TenantExportDownloads(ends, access, rlsBypass, audit, 'application');
    }

    onModuleInit(): void {
        this.access?.answerEndsFrom(this.downloads);
    }

    /**
     * Records that the tenant's export went out in full on `request`, the
     * request the application served it on, as `delivered` describes it, at
     * `now`, and answers the download as recorded. Call it once the whole file
     * has gone out — not when the download starts, and not for one that broke
     * off.
     *
     * Refused with `405 Method Not Allowed` where `request` is a `HEAD`, which
     * carries no file whatever the stream reported; with `TENANT_EXPORT_FAILED`
     * where `delivered` is not a whole file — no bytes, a size that is not a
     * whole number, or a media type outside printable ASCII —; with
     * `TENANT_EXPORT_NOT_FOR_OPERATOR` for the operator, with
     * `TENANT_ADMIN_REQUIRED` for a user who is not the tenant's administrator,
     * with `TENANT_CONTEXT_MISSING` where the session names no tenant or no
     * user, and with `TENANT_EXPORT_NOT_OFFERED` where no end of the tenant's
     * subscription is recorded. A failure to record is thrown as
     * it is. Nothing is recorded or audited on any of these paths; the
     * application keeps its own trace of the download.
     */
    async recordDelivered(
        request: unknown,
        delivered: DeliveredTenantExport,
        now: Date = new Date(),
    ): Promise<TenantExportDownload> {
        // The same answer the platform's route gives a `HEAD`, checked first,
        // since the size a stream reports for one is the whole file's.
        if (isHead(request)) {
            throw new MethodNotAllowedException(
                'A HEAD request carries no file, so no download of the export is recorded for it.',
            );
        }
        if (!isRecordableFile(delivered.size, delivered.mediaType)) {
            this.logger.error(
                'A delivered export was reported that is not a whole file — at least one byte, ' +
                    'as a whole number, and a media type in printable ASCII; nothing was recorded.',
            );
            throw new ServiceUnavailableException(
                codedError(TENANT_ACCESS_ERROR_CODES.TENANT_EXPORT_FAILED),
            );
        }
        const { tenantId, actor } = exportTakerOf(
            request,
            this.resolvers(),
            this.access?.actsAsOperator(request) ?? false,
        );
        return readAcrossTenants(this.rlsBypass, async () => {
            const end = await this.downloads.endOffered(tenantId);
            return this.downloads.record(
                tenantId,
                end,
                actor,
                { size: delivered.size, mediaType: delivered.mediaType },
                now,
            );
        });
    }

    private resolvers(): ExportTakerResolvers {
        return {
            tenantId: this.tenantIdResolver,
            userId: this.userIdResolver,
            email: this.userEmailResolver,
            context: this.auditContextResolver,
        };
    }
}
