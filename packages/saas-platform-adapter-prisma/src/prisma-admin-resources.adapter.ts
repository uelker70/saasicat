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

const DEFAULT_LIST_LIMIT = 200;
const DEFAULT_AUDIT_LIMIT = 100;

export interface PrismaAdminResourcesOptions {
    /**
     * Relation counters exposed on tenant rows and tenant details. The names
     * must match relations on the app's Tenant model. Default: `['users']`.
     */
    tenantMetrics?: readonly string[];
    listLimit?: number;
}

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

    constructor(
        private readonly prisma: PrismaLike,
        options: PrismaAdminResourcesOptions = {},
    ) {
        this.metrics = options.tenantMetrics ?? ['users'];
        this.listLimit = options.listLimit ?? DEFAULT_LIST_LIMIT;
        this.audit = new PrismaAuditQueryAdapter(prisma);
    }

    async listTenants(filter: AdminTenantListFilter): Promise<AdminTenantListRow[]> {
        const where: Record<string, unknown> = {};
        const active = parseActiveFilter(filter.status);
        if (active !== undefined) where.isActive = active;
        if (filter.search) {
            where.OR = [
                { slug: { contains: filter.search, mode: 'insensitive' } },
                { name: { contains: filter.search, mode: 'insensitive' } },
            ];
        }
        if (filter.plan) where.subscription = { plan: filter.plan };

        const rows = await this.tenants().findMany({
            where,
            include: {
                subscription: { select: { plan: true, status: true } },
                _count: { select: metricSelect(this.metrics) },
            },
            orderBy: { createdAt: 'desc' },
            take: this.listLimit,
        });

        return rows.map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.name,
            isActive: row.isActive,
            deletedAt: row.deletedAt?.toISOString() ?? null,
            plan: row.subscription?.plan ?? null,
            status: row.subscription?.status ?? null,
            createdAt: row.createdAt.toISOString(),
            ...(row._count ?? {}),
        }));
    }

    async getTenantDetail(slug: string): Promise<AdminTenantDetail | null> {
        const row = await this.tenants().findUnique({
            where: { slug },
            include: {
                subscription: true,
                users: { orderBy: { createdAt: 'asc' } },
                _count: { select: metricSelect(this.metrics) },
            },
        });
        if (!row) return null;

        return {
            id: row.id,
            slug: row.slug,
            name: row.name,
            isActive: row.isActive,
            subscription: row.subscription
                ? {
                      plan: row.subscription.plan,
                      status: row.subscription.status,
                      billingCycle: row.subscription.billingCycle,
                      isPilot: row.subscription.isPilot,
                      trialEndsAt: row.subscription.trialEndsAt?.toISOString() ?? null,
                      pilotEndsAt: row.subscription.pilotEndsAt?.toISOString() ?? null,
                  }
                : null,
            users: (row.users ?? []).map((user) => ({
                id: user.id,
                email: user.email,
                firstName: user.firstName ?? undefined,
                lastName: user.lastName ?? undefined,
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
        const tenant = await this.tenants().findUnique({ where: { slug } });
        if (!tenant) return null;

        await this.tenants().update({
            where: { id: tenant.id },
            data: { isActive: active },
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
        const where: Record<string, unknown> = {};
        if (filter.q) where.email = { contains: filter.q, mode: 'insensitive' };
        if (filter.tenant) where.tenant = { slug: filter.tenant };

        const rows = await this.users().findMany({
            where,
            include: { tenant: { select: { slug: true } } },
            orderBy: { createdAt: 'desc' },
            take: this.listLimit,
        });

        return rows.map((row) => ({
            id: row.id,
            email: row.email,
            firstName: row.firstName ?? '',
            lastName: row.lastName ?? '',
            role: row.platformRole ?? row.role ?? 'MEMBER',
            isActive: row.isActive ?? true,
            tenantSlug: row.tenant?.slug ?? null,
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
        const rows = await this.subscriptions().findMany({
            include: {
                tenant: { select: { slug: true, name: true } },
                planVersion: { select: { monthlyNet: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: this.listLimit,
        });

        return rows.map((row) => ({
            id: row.id,
            tenant: row.tenant,
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
        return getPrismaDelegate(this.prisma, 'tenant');
    }

    private users(): PrismaModelDelegateLike<AdminUserRow> {
        return getPrismaDelegate(this.prisma, 'user');
    }

    private subscriptions(): PrismaModelDelegateLike<AdminSubscriptionRow> {
        return getPrismaDelegate(this.prisma, 'subscription');
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
