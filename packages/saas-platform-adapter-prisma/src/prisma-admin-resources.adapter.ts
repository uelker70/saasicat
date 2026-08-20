import type {
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
import type { PrismaLike, PrismaModelDelegateLike } from './prisma-client-token.js';
import { getPrismaDelegate } from './prisma-plan-binding.js';
import { PrismaAuditQueryAdapter } from './prisma-audit-query.adapter.js';
import {
    type AdminResourcesDelegates,
    type AdminResourcesFields,
    type ResolvedAdminResourcesSchema,
    assertDelegatesExist,
    resolveAdminResourcesSchema,
} from './admin-resources-schema.js';

const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_AUDIT_LIMIT = 100;

export interface PrismaAdminResourcesOptions {
    /**
     * Relation counters exposed on tenant rows and tenant details. The names
     * must match relations on the app's Tenant model. Default: `['users']`.
     */
    tenantMetrics?: readonly string[];
    listLimit?: number;
    /**
     * Delegate names, when the app's models are not called `tenant`, `user`
     * and `subscription`. Checked against the client at construction.
     */
    delegates?: AdminResourcesDelegates;
    /** Field names, when the app's columns differ. See `AdminResourcesFields`. */
    fields?: AdminResourcesFields;
}

/**
 * A tenant row as the DEFAULT mapping names it.
 *
 * The mapped fields are read through `read()` rather than off these
 * properties, because a mapped client returns them under the app's names.
 * They stay declared here for the unmapped fields around them — `id` and
 * `createdAt` are not mappable, and the relations are the shape the adapter
 * requires rather than the vocabulary it tolerates.
 */
interface AdminTenantRow {
    id: string;
    slug: string;
    name: string;
    isActive: boolean;
    deletedAt?: Date | null;
    createdAt: Date;
    subscription?: {
        plan: string;
        status: string;
        billingCycle: string;
        isPilot: boolean;
        trialEndsAt: Date | null;
        pilotEndsAt: Date | null;
    } | null;
    users?: AdminUserRow[];
    _count?: Record<string, number>;
}

interface AdminUserRow {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    role?: string | null;
    platformRole?: string | null;
    isActive?: boolean;
    lastLoginAt?: Date | null;
    createdAt: Date;
    tenant?: { slug: string } | null;
}

interface AdminSubscriptionRow {
    id: string;
    plan: string;
    status: string;
    billingCycle: string;
    currentPeriodEnd?: Date | null;
    tenant: { slug: string; name: string };
    planVersion?: { monthlyNet: unknown } | null;
}

/**
 * Convention-based adapter for the standard SuperAdmin resource pages.
 *
 * It expects the common Prisma delegate names `tenant`, `user`,
 * `subscription` and `auditLog`, and the common scalar fields shown by the
 * platform UI. Apps with a different schema implement `AdminResourcesPort`;
 * they do not need to replace controllers or DTOs.
 */
export class PrismaAdminResourcesAdapter implements AdminResourcesPort {
    private readonly metrics: readonly string[];
    private readonly listLimit: number;
    private readonly audit: PrismaAuditQueryAdapter;
    private readonly schema: ResolvedAdminResourcesSchema;

    constructor(
        private readonly prisma: PrismaLike,
        options: PrismaAdminResourcesOptions = {},
    ) {
        this.listLimit = options.listLimit ?? DEFAULT_LIST_LIMIT;
        this.audit = new PrismaAuditQueryAdapter(prisma);
        this.schema = resolveAdminResourcesSchema(options.delegates, options.fields);
        // Defaults to the MAPPED users relation, not the literal `users`: an
        // app that renamed it to `members` would otherwise get
        // `_count: { select: { users: true } }` and a PrismaClientValidationError
        // on the very page this adapter exists to serve.
        this.metrics = options.tenantMetrics ?? [this.schema.tenant.users];
        // See `assertDelegatesExist` for why only a mapped one is checked here.
        if (options.delegates) assertDelegatesExist(prisma, this.schema);
    }

    async listTenants(filter: AdminTenantListFilter): Promise<AdminTenantListRow[]> {
        const t = this.schema.tenant;
        const where: Record<string, unknown> = {};
        const active = parseActiveFilter(filter.status);
        if (active !== undefined) where[t.isActive] = active;
        if (filter.search) {
            where.OR = [
                { [t.slug]: { contains: filter.search, mode: 'insensitive' } },
                { [t.name]: { contains: filter.search, mode: 'insensitive' } },
            ];
        }
        if (filter.plan) where[t.subscription] = { plan: filter.plan };

        const rows = await this.tenants().findMany({
            where,
            include: {
                [t.subscription]: { select: { plan: true, status: true } },
                _count: { select: metricSelect(this.metrics) },
            },
            orderBy: { createdAt: 'desc' },
            take: this.listLimit,
        });

        return rows.map((row) => ({
            id: row.id,
            slug: this.read<string>(row, t.slug) ?? '',
            name: this.read<string>(row, t.name) ?? '',
            isActive: this.read<boolean>(row, t.isActive) ?? true,
            deletedAt: this.read<Date | null>(row, t.deletedAt)?.toISOString() ?? null,
            plan: this.subscriptionOf(row)?.plan ?? null,
            status: this.subscriptionOf(row)?.status ?? null,
            createdAt: row.createdAt.toISOString(),
            ...(row._count ?? {}),
        }));
    }

    async getTenantDetail(slug: string): Promise<AdminTenantDetail | null> {
        const t = this.schema.tenant;
        const row = await this.tenants().findUnique({
            where: { [t.slug]: slug },
            include: {
                [t.subscription]: true,
                [t.users]: { orderBy: { createdAt: 'asc' } },
                _count: { select: metricSelect(this.metrics) },
            },
        });
        if (!row) return null;

        return {
            id: row.id,
            slug: this.read<string>(row, t.slug) ?? slug,
            name: this.read<string>(row, t.name) ?? '',
            isActive: this.read<boolean>(row, t.isActive) ?? true,
            subscription: this.subscriptionOf(row)
                ? {
                      plan: this.subscriptionOf(row)!.plan,
                      status: this.subscriptionOf(row)!.status,
                      billingCycle: this.subscriptionOf(row)!.billingCycle,
                      isPilot: this.subscriptionOf(row)!.isPilot,
                      trialEndsAt: this.subscriptionOf(row)!.trialEndsAt?.toISOString() ?? null,
                      pilotEndsAt: this.subscriptionOf(row)!.pilotEndsAt?.toISOString() ?? null,
                  }
                : null,
            users: (this.read<AdminUserRow[]>(row, t.users) ?? []).map((user) => ({
                id: user.id,
                email: this.read<string>(user, this.schema.user.email) ?? '',
                firstName: this.read<string>(user, this.schema.user.firstName) ?? undefined,
                lastName: this.read<string>(user, this.schema.user.lastName) ?? undefined,
                createdAt: user.createdAt.toISOString(),
            })),
            counts: row._count ?? {},
        };
    }

    async setTenantActive(
        slug: string,
        active: boolean,
        subscriptionStatus: string,
    ): Promise<AdminTenantStateResult | null> {
        const t = this.schema.tenant;
        const tenant = await this.tenants().findUnique({ where: { [t.slug]: slug } });
        if (!tenant) return null;

        await this.tenants().update({
            where: { id: tenant.id },
            data: { [t.isActive]: active },
        });
        await this.subscriptions().updateMany({
            where: { tenantId: tenant.id },
            data: { status: subscriptionStatus },
        });

        return {
            ok: true,
            id: tenant.id,
            slug,
            isActive: active,
            status: subscriptionStatus,
        };
    }

    async listUsers(filter: AdminUserListFilter): Promise<AdminUserListRow[]> {
        const u = this.schema.user;
        const tenantSlug = this.schema.tenant.slug;
        const where: Record<string, unknown> = {};
        if (filter.q) where[u.email] = { contains: filter.q, mode: 'insensitive' };
        if (filter.tenant) where[u.tenant] = { [tenantSlug]: filter.tenant };

        const rows = await this.users().findMany({
            where,
            include: { [u.tenant]: { select: { [tenantSlug]: true } } },
            orderBy: { createdAt: 'desc' },
            take: this.listLimit,
        });

        return rows.map((row) => ({
            id: row.id,
            email: this.read<string>(row, u.email) ?? '',
            firstName: this.read<string>(row, u.firstName) ?? '',
            lastName: this.read<string>(row, u.lastName) ?? '',
            role: row.platformRole ?? row.role ?? 'MEMBER',
            isActive: this.read<boolean>(row, u.isActive) ?? true,
            tenantSlug: this.tenantSlugOf(row, u.tenant, tenantSlug),
            lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
        }));
    }

    listAudit(filter: AdminAuditListFilter): Promise<AuditEntry[]> {
        return this.audit.list({
            actorTag: filter.actor ? `*${filter.actor}*` : undefined,
            action: filter.action,
            entity: filter.entity,
            from: validDateString(filter.since),
            pageSize:
                filter.limit && filter.limit > 0
                    ? Math.min(filter.limit, this.listLimit)
                    : DEFAULT_AUDIT_LIMIT,
        });
    }

    async listSubscriptions(): Promise<AdminSubscriptionListRow[]> {
        const t = this.schema.tenant;
        const rows = await this.subscriptions().findMany({
            include: {
                tenant: { select: { [t.slug]: true, [t.name]: true } },
                planVersion: { select: { monthlyNet: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: this.listLimit,
        });

        return rows.map((row) => ({
            id: row.id,
            tenant: {
                slug: this.read<string>(row.tenant, t.slug) ?? '',
                name: this.read<string>(row.tenant, t.name) ?? '',
            },
            plan: row.plan,
            status: row.status,
            billingCycle: row.billingCycle,
            periodEndsAt: row.currentPeriodEnd?.toISOString() ?? null,
            monthlyNet:
                row.planVersion?.monthlyNet === undefined
                    ? null
                    : String(row.planVersion.monthlyNet),
        }));
    }

    private tenants(): PrismaModelDelegateLike<AdminTenantRow> {
        return getPrismaDelegate(this.prisma, this.schema.delegates.tenant);
    }

    private users(): PrismaModelDelegateLike<AdminUserRow> {
        return getPrismaDelegate(this.prisma, this.schema.delegates.user);
    }

    private subscriptions(): PrismaModelDelegateLike<AdminSubscriptionRow> {
        return getPrismaDelegate(this.prisma, this.schema.delegates.subscription);
    }

    /** The subscription relation of a tenant row, under whatever it is called. */
    private subscriptionOf(
        row: AdminTenantRow,
    ): NonNullable<AdminTenantRow['subscription']> | null {
        return (
            this.read<NonNullable<AdminTenantRow['subscription']>>(
                row,
                this.schema.tenant.subscription,
            ) ?? null
        );
    }

    /** The tenant slug on a user row, through both mapped names. */
    private tenantSlugOf(row: AdminUserRow, relation: string, slugField: string): string | null {
        const tenant = this.read<object>(row, relation);
        return tenant ? (this.read<string>(tenant, slugField) ?? null) : null;
    }

    /**
     * Reads a mapped field off a row.
     *
     * The rows come back keyed by the APP's field names, so every read of a
     * mapped field goes through here — and the row type stays the shape the
     * adapter promises rather than becoming `Record<string, unknown>`.
     */
    private read<T>(row: object, field: string): T | undefined {
        return (row as Record<string, unknown>)[field] as T | undefined;
    }
}

function metricSelect(metrics: readonly string[]): Record<string, true> {
    return Object.fromEntries(metrics.map((metric) => [metric, true]));
}

function parseActiveFilter(status: string | undefined): boolean | undefined {
    if (!status) return undefined;
    const normalized = status.toUpperCase();
    if (normalized === 'ACTIVE') return true;
    if (normalized === 'INACTIVE' || normalized === 'SUSPENDED') return false;
    return undefined;
}

function validDateString(value: string | undefined): string | undefined {
    if (!value) return undefined;
    return Number.isNaN(new Date(value).getTime()) ? undefined : value;
}
