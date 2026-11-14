import {
    Controller,
    Get,
    Header,
    Inject,
    MethodNotAllowedException,
    Optional,
    Req,
    StreamableFile,
    UseGuards,
} from '@nestjs/common';

import { TenantAccessService } from '../tenant-access/tenant-access.service.js';
import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { exportTakerOf, isHead, type ExportTakerResolvers } from './export-taker.js';
import { downloadOf } from './invoices/archived-download.js';
import { TenantAdminGuard } from './tenant-admin.guard.js';
import {
    AUDIT_CONTEXT_RESOLVER_TOKEN,
    TENANT_ID_RESOLVER_TOKEN,
    USER_EMAIL_RESOLVER_TOKEN,
    USER_ID_RESOLVER_TOKEN,
    type AuditContextResolver,
    type TenantIdResolver,
    type UserEmailResolver,
    type UserIdResolver,
} from './tenant-billing.tokens.js';
import { TenantDataExportService } from './tenant-data-export.service.js';

/**
 * `GET billing/export` — the tenant's full export as one file, for its own
 * administrator, once its subscription has ended (`SC-PRIV-020`), mounted where
 * the application hands the file over rather than delivering it itself. The
 * tenant is the session's, never a value the request carries; every download is
 * recorded before the file is sent.
 */
@Controller('billing')
@UseGuards(ComposedTenantAuthGuard)
export class TenantDataExportController {
    constructor(
        @Inject(TenantDataExportService) private readonly exports: TenantDataExportService,
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
        // What says the operator is acting as the tenant; without it — tenant
        // billing wired by hand without `SaaSiCatModule` — only `SUPER_ADMIN`
        // does.
        @Optional()
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService | null = null,
    ) {}

    // No access mark: a `GET` reads, and the record of the download it writes
    // is the platform's evidence, as an audit entry is — not a write of the
    // tenant's data, which read-only exists to stop. So a read-only tenant
    // takes it, which is what the period is for, and a suspension or a
    // deletion under way refuses it as it refuses every read.
    //
    // Express and Fastify both answer a `HEAD` with the `GET` handler and drop
    // the body, so a `HEAD` let through would ask the application and record a
    // download whose file nobody receives. It is refused before either, as
    // `405` with `Allow: GET`: Nest writes the header once the guards have let
    // the request through, before the handler runs.
    @Get('export')
    @Header('Allow', 'GET')
    @UseGuards(TenantAdminGuard)
    async export(@Req() request: unknown): Promise<StreamableFile> {
        if (isHead(request)) throw new MethodNotAllowedException();
        // `TenantAdminGuard` lets the operator through as an administrator;
        // the export is not theirs to take, since each download is recorded as
        // the tenant's acknowledgement (`SC-PRIV-017`).
        const { tenantId, actor } = exportTakerOf(
            request,
            this.resolvers(),
            this.access?.actsAsOperator(request) ?? false,
        );
        return downloadOf(await this.exports.take(tenantId, actor, new Date()), 'export');
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
