import {
    Body,
    type CanActivate,
    Controller,
    type DynamicModule,
    type ForwardReference,
    Get,
    Inject,
    Injectable,
    Module,
    NotFoundException,
    Param,
    Post,
    Query,
    Req,
    type Type,
    UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type {
    AdminActor,
    AdminAuditListFilter,
    AdminResourcesPort,
    AdminSubscriptionListRow,
    AdminTenantDetail,
    AdminTenantListFilter,
    AdminTenantListRow,
    AdminTenantStateResult,
    AdminUserListFilter,
    AdminUserListRow,
    AuditEntry,
} from '@saasicat/types';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { AdminAuditService } from './admin-audit.service.js';

export const ADMIN_RESOURCES_PORT_TOKEN = Symbol.for('saas-platform/AdminResourcesPort');

export class SuspendTenantDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string;
}

interface AdminRequest {
    user?: {
        id?: string;
        userId?: string;
        email?: string;
        sessionId?: string;
    };
}

@Injectable()
export class AdminResourcesService {
    constructor(
        @Inject(ADMIN_RESOURCES_PORT_TOKEN)
        private readonly resources: AdminResourcesPort,
        @Inject(AdminAuditService)
        private readonly audit: AdminAuditService,
    ) {}

    listTenants(filter: AdminTenantListFilter): Promise<AdminTenantListRow[]> {
        return this.resources.listTenants(filter);
    }

    async getTenantDetail(slug: string): Promise<AdminTenantDetail> {
        const tenant = await this.resources.getTenantDetail(slug);
        if (!tenant) throw new NotFoundException(`Tenant ${slug} not found`);
        return tenant;
    }

    listUsers(filter: AdminUserListFilter): Promise<AdminUserListRow[]> {
        return this.resources.listUsers(filter);
    }

    listAudit(filter: AdminAuditListFilter): Promise<AuditEntry[]> {
        return this.resources.listAudit(filter);
    }

    listSubscriptions(): Promise<AdminSubscriptionListRow[]> {
        return this.resources.listSubscriptions();
    }

    suspendTenant(
        slug: string,
        reason: string | undefined,
        actor: AdminActor,
    ): Promise<AdminTenantStateResult> {
        return this.setTenantActive(slug, false, 'PAST_DUE', actor, {
            action: 'TENANT_SUSPEND',
            reason: reason ?? '',
        });
    }

    reactivateTenant(slug: string, actor: AdminActor): Promise<AdminTenantStateResult> {
        return this.setTenantActive(slug, true, 'ACTIVE', actor, {
            action: 'TENANT_REACTIVATE',
            reason: '',
        });
    }

    private async setTenantActive(
        slug: string,
        active: boolean,
        subscriptionStatus: string,
        actor: AdminActor,
        audit: { action: string; reason: string },
    ): Promise<AdminTenantStateResult> {
        const result = await this.resources.setTenantActive(slug, active, subscriptionStatus);
        if (!result) throw new NotFoundException(`Tenant ${slug} not found`);
        await this.audit.log({
            actor,
            entity: 'Tenant',
            entityId: result.id,
            action: audit.action,
            changes: { slug, reason: audit.reason },
        });
        return result;
    }
}

export interface AdminResourcesModuleOptions {
    resources: ProviderSpec<AdminResourcesPort>;
    guards: Array<Type<CanActivate>>;
    imports?: Array<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
    global?: boolean;
}

function actorFromRequest(request: AdminRequest): AdminActor {
    const userId = request.user?.id ?? request.user?.userId ?? 'unknown';
    return {
        userId,
        email: request.user?.email ?? `${userId}@unknown`,
        source: 'web',
        context: request.user?.sessionId ?? 'unknown',
    };
}

function buildAdminResourcesController(guards: Array<Type<CanActivate>>): Type {
    @Controller('admin')
    @UseGuards(...guards)
    class GeneratedAdminResourcesController {
        constructor(
            @Inject(AdminResourcesService)
            private readonly resources: AdminResourcesService,
        ) {}

        @Get('tenants')
        listTenants(
            @Query() query: { status?: string; plan?: string; search?: string },
        ): Promise<AdminTenantListRow[]> {
            return this.resources.listTenants(query);
        }

        @Get('tenants/:slug')
        getTenant(@Param('slug') slug: string): Promise<AdminTenantDetail> {
            return this.resources.getTenantDetail(slug);
        }

        @Post('tenants/:slug/suspend')
        suspendTenant(
            @Req() request: AdminRequest,
            @Param('slug') slug: string,
            @Body() dto: SuspendTenantDto,
        ): Promise<AdminTenantStateResult> {
            return this.resources.suspendTenant(slug, dto.reason, actorFromRequest(request));
        }

        @Post('tenants/:slug/reactivate')
        reactivateTenant(
            @Req() request: AdminRequest,
            @Param('slug') slug: string,
        ): Promise<AdminTenantStateResult> {
            return this.resources.reactivateTenant(slug, actorFromRequest(request));
        }

        @Get('users')
        listUsers(@Query() query: { q?: string; tenant?: string }): Promise<AdminUserListRow[]> {
            return this.resources.listUsers(query);
        }

        @Get('audit')
        listAudit(
            @Query()
            query: {
                actor?: string;
                action?: string;
                entity?: string;
                since?: string;
                limit?: string;
            },
        ): Promise<AuditEntry[]> {
            return this.resources.listAudit({
                actor: query.actor,
                action: query.action,
                entity: query.entity,
                since: query.since,
                limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
            });
        }

        @Get('subscriptions')
        listSubscriptions(): Promise<AdminSubscriptionListRow[]> {
            return this.resources.listSubscriptions();
        }
    }

    return GeneratedAdminResourcesController;
}

@Module({})
export class AdminResourcesModule {
    static forRoot(options: AdminResourcesModuleOptions): DynamicModule {
        return {
            module: AdminResourcesModule,
            global: options.global ?? false,
            imports: options.imports ?? [],
            controllers: [buildAdminResourcesController(options.guards)],
            providers: [
                asProvider(ADMIN_RESOURCES_PORT_TOKEN, options.resources),
                AdminResourcesService,
            ],
            exports: [ADMIN_RESOURCES_PORT_TOKEN, AdminResourcesService],
        };
    }
}
