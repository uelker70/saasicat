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

import { ComposedTenantAuthGuard } from './composed-tenant-auth.guard.js';
import { downloadOf } from './invoices/archived-download.js';
import { TenantAdminGuard } from './tenant-admin.guard.js';
import {
    requireTenantUserId,
    tenantActorOf,
    type TenantAuditResolvers,
} from './tenant-audit-actor.js';
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
import { tenantIdOf } from './tenant-id.js';

/**
 * `GET billing/export` — the tenant's full export as one file, for its
 * administrator, once its subscription has ended (`SC-PRIV-019`). The tenant is
 * the session's, never a value the request carries; every download is recorded
 * before the file is sent.
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
        const tenantId = tenantIdOf(this.tenantIdResolver, request);
        const resolvers = this.resolvers();
        const actor = tenantActorOf(request, requireTenantUserId(request, resolvers), resolvers);
        return downloadOf(await this.exports.take(tenantId, actor, new Date()), 'export');
    }

    private resolvers(): TenantAuditResolvers {
        return {
            userId: this.userIdResolver,
            email: this.userEmailResolver,
            context: this.auditContextResolver,
        };
    }
}

/** Whether `request` is a `HEAD`, which a download answers without its file. */
function isHead(request: unknown): boolean {
    return (
        typeof request === 'object' &&
        request !== null &&
        'method' in request &&
        typeof request.method === 'string' &&
        request.method.toUpperCase() === 'HEAD'
    );
}
