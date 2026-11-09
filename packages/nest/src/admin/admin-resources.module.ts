import {
    Body,
    type CanActivate,
    ConflictException,
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
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import type {
    AdminActor,
    AdminAuditListFilter,
    AdminResourcesPort,
    AdminSubscriptionListRow,
    AdminTenantDetail,
    AdminTenantAccessReason,
    AdminTenantDetailEntry,
    AdminTenantListEntry,
    AdminTenantListFilter,
    AdminTenantListRow,
    AdminTenantStateResult,
    AdminTenantSummary,
    AdminUserListFilter,
    AdminUserListRow,
    AuditEntry,
    TenantAccess,
    TenantAccessHold,
    TenantAccessState,
} from '@saasicat/core';
import { BILLING_ERROR_CODES, TENANT_ACCESS_ERROR_CODES, holdsEveryoneBack } from '@saasicat/core';
import { actorTagOf } from '../core/web-audit.js';
import { codedError } from '../errors/coded-error.js';
import { TenantAccessService, type NamedInvoice } from '../tenant-access/tenant-access.service.js';
import { asProvider, type ProviderSpec } from '../core/di.js';
import { AdminAuditService } from './admin-audit.service.js';
import { EnforceMfa } from './enforce-mfa.decorator.js';
import { AllowDuringMaintenance } from '../maintenance/allow-during-maintenance.js';
import { UseRouteGuards } from './use-route-guards.decorator.js';

export const ADMIN_RESOURCES_PORT_TOKEN = Symbol.for('saasicat/nest/AdminResourcesPort');

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
        @Inject(TenantAccessService)
        private readonly access: TenantAccessService,
    ) {}

    /**
     * The application's tenants with the platform's state beside each.
     *
     * Whether a tenant may act is the application's flag and the platform's
     * suspension together, so `ACTIVE` and `INACTIVE` are answered here — as
     * filters the application applies in its query, before it cuts the list
     * to a page. Filtering the rows afterwards would lose every tenant past
     * that page. Any other status goes to the application as it is.
     */
    async listTenants(query: AdminTenantListFilter): Promise<AdminTenantListEntry[]> {
        const filter = askedFor(query);
        const { status, ...rest } = filter;
        const mayAct = mayActFilterOf(status);
        if (mayAct === undefined)
            return this.withAccessOf(await this.resources.listTenants(filter));
        const heldBackTenantIds = await this.access.tenantsHeldBack();
        const rows = await this.resources.listTenants({ ...rest, mayAct, heldBackTenantIds });
        // Again on the rows, which changes nothing where the application
        // applied the filter, and keeps a port that ignores it from listing
        // suspended tenants as active.
        return (await this.withAccessOf(rows)).filter((row) => row.isActive === mayAct);
    }

    private async withAccessOf(rows: AdminTenantListRow[]): Promise<AdminTenantListEntry[]> {
        const access = await this.access.accessOfEach(rows.map((row) => row.id));
        return rows.map((row) => withAccess(row, access.get(row.id)));
    }

    /**
     * The tenant with its state and every reason it is held back for, the
     * oldest first, an invoice named by its number (`SC-ADM-053`).
     */
    async getTenantDetail(slug: string): Promise<AdminTenantDetailEntry> {
        const tenant = await this.tenantNamed(slug);
        const access = await this.access.accessOf(tenant.id);
        const named = await this.access.invoicesNamed(
            access.holds.flatMap((hold) =>
                hold.kind === 'overdue' && hold.reference ? [hold.reference] : [],
            ),
        );
        return {
            ...withAccess(tenant, access),
            accessReasons: [...access.holds]
                .sort((a, b) => a.since.getTime() - b.since.getTime())
                .map((hold) => reasonOf(hold, named)),
        };
    }

    /** The tenants among `tenantIds` the application still has; one it no longer has is left out. */
    findTenantsByIds(tenantIds: readonly string[]): Promise<AdminTenantSummary[]> {
        return this.resources.findTenantsByIds([...new Set(tenantIds)]);
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

    /**
     * Records the operator's suspension as a reason the tenant is held back
     * (`SC-ADM-052`). Nothing of the application's is written — neither its
     * tenant row nor a subscription: a suspension is not an overdue invoice,
     * and reactivating must not turn a cancelled subscription active again.
     */
    async suspendTenant(
        slug: string,
        reason: string | undefined,
        actor: AdminActor,
    ): Promise<AdminTenantStateResult> {
        const tenant = await this.tenantNamed(slug);
        const note = reason ?? '';
        const suspended = await this.access.suspend(tenant.id, note, actorTagOf(actor), new Date());
        if (!suspended) {
            throw new ConflictException(
                codedError(TENANT_ACCESS_ERROR_CODES.TENANT_ALREADY_SUSPENDED, { slug }),
            );
        }
        return this.answer(tenant, actor, 'TENANT_SUSPEND', { slug, reason: note });
    }

    /** Lifts the suspension and no other reason the tenant is held back for. */
    async reactivateTenant(slug: string, actor: AdminActor): Promise<AdminTenantStateResult> {
        const tenant = await this.tenantNamed(slug);
        const lifted = await this.access.reactivate(tenant.id, actorTagOf(actor), new Date());
        if (!lifted) {
            throw new ConflictException(
                codedError(TENANT_ACCESS_ERROR_CODES.TENANT_NOT_SUSPENDED, { slug }),
            );
        }
        return this.answer(tenant, actor, 'TENANT_REACTIVATE', { slug });
    }

    private async tenantNamed(slug: string): Promise<AdminTenantDetail> {
        const tenant = await this.resources.getTenantDetail(slug);
        if (!tenant) {
            throw new NotFoundException(codedError(BILLING_ERROR_CODES.TENANT_NOT_FOUND, { slug }));
        }
        return tenant;
    }

    private async answer(
        tenant: AdminTenantDetail,
        actor: AdminActor,
        action: 'TENANT_SUSPEND' | 'TENANT_REACTIVATE',
        changes: { slug: string; reason?: string },
    ): Promise<AdminTenantStateResult> {
        await this.audit.log({ actor, entity: 'Tenant', entityId: tenant.id, action, changes });
        const { state } = await this.access.accessOf(tenant.id);
        return { ok: true, id: tenant.id, slug: tenant.slug, access: state };
    }
}

/** A reason as the administration shows it, an invoice named where it is one of `named`. */
function reasonOf(hold: TenantAccessHold, named: readonly NamedInvoice[]): AdminTenantAccessReason {
    return {
        kind: hold.kind,
        since: hold.since.toISOString(),
        note: hold.kind === 'suspended' ? hold.note : null,
        invoice:
            hold.kind === 'overdue'
                ? (named.find((invoice) => invoice.id === hold.reference) ?? null)
                : null,
        subscriptionId: hold.kind === 'ended' ? hold.reference : null,
    };
}

/**
 * A row with the platform's state beside it, and `isActive` narrowed to
 * whether the tenant may act at all — so a page that reads `isActive` alone
 * still shows a suspended tenant as suspended.
 */
function withAccess<Row extends AdminTenantListRow | AdminTenantDetail>(
    row: Row,
    access: TenantAccess | undefined,
): Row & { access: TenantAccessState } {
    const state = access?.state ?? 'open';
    const entry = { ...row, access: state };
    entry.isActive = row.isActive && !holdsEveryoneBack(state);
    return entry;
}

/**
 * What a caller may ask the list for: a status, a plan, a search. The other
 * fields of `AdminTenantListFilter` are the platform's to set when it answers
 * a status, and arrive on the route as strings from a query it does not
 * validate, so they are dropped here rather than handed to the application.
 */
function askedFor(query: AdminTenantListFilter): AdminTenantListFilter {
    const asked: AdminTenantListFilter = {};
    if (query.status !== undefined) asked.status = query.status;
    if (query.plan !== undefined) asked.plan = query.plan;
    if (query.search !== undefined) asked.search = query.search;
    return asked;
}

/**
 * The status filters the platform answers itself: `ACTIVE` for a tenant that
 * may act, `INACTIVE` or `SUSPENDED` for one that may not. Undefined for any
 * other value, which goes to the application as before.
 */
function mayActFilterOf(status: string | undefined): boolean | undefined {
    const normalized = status?.toUpperCase();
    if (normalized === 'ACTIVE') return true;
    if (normalized === 'INACTIVE' || normalized === 'SUSPENDED') return false;
    return undefined;
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
    @AllowDuringMaintenance()
    @UseRouteGuards(...guards)
    class GeneratedAdminResourcesController {
        constructor(
            @Inject(AdminResourcesService)
            private readonly resources: AdminResourcesService,
        ) {}

        @Get('tenants')
        listTenants(
            @Query() query: { status?: string; plan?: string; search?: string },
        ): Promise<AdminTenantListEntry[]> {
            return this.resources.listTenants(query);
        }

        @Get('tenants/:slug')
        getTenant(@Param('slug') slug: string): Promise<AdminTenantDetailEntry> {
            return this.resources.getTenantDetail(slug);
        }

        @Post('tenants/:slug/suspend')
        @EnforceMfa()
        suspendTenant(
            @Req() request: AdminRequest,
            @Param('slug') slug: string,
            @Body() dto: SuspendTenantDto,
        ): Promise<AdminTenantStateResult> {
            return this.resources.suspendTenant(slug, dto.reason, actorFromRequest(request));
        }

        @Post('tenants/:slug/reactivate')
        @EnforceMfa()
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
