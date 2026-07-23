import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PromoCodeStatus, SubscriptionStatus, type PromoCode } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { CreatePromoCodeDto, UpdatePromoCodeDto } from './admin-pages.dto';

// Data layer for the app-owned SuperAdmin pages (Tenant/User/Note/Subscription
// and PromoCode are app tables — the platform does not serve them). The row
// shapes below are the exact contracts the platform standard pages read:
//   - listTenants   → TenantsPage `useTenants` rows (TenantDto + plan/usage)
//   - getTenantDetail→ TenantDetailPage `loadDetail`
//   - listUsers     → UsersPage `loadUsers`
//   - listAudit     → AuditPage `loadAudit`
//   - listSubscriptions → SubscriptionsPage `loadSubscriptions`
//   - list/create/update/deletePromoCode → PromoCodesPage `loadPromos`/`submit*`
// autohauspro's `admin.service.ts` is the structural blueprint.

/** Actor email baked into the audit trail — the demo has no real user identity. */
const DEMO_ADMIN_EMAIL = 'admin@notesapp.example';

const LIST_LIMIT = 200;
const AUDIT_LIMIT = 100;

export interface TenantListRow {
    id: string;
    slug: string;
    name: string;
    isActive: boolean;
    deletedAt: string | null;
    plan: string | null;
    status: string | null;
    notes: number;
    users: number;
    createdAt: string;
}

export interface TenantDetailData {
    id: string;
    slug: string;
    name: string;
    isActive: boolean;
    subscription: {
        plan: string;
        status: string;
        billingCycle: string;
        isPilot: boolean;
        trialEndsAt: string | null;
        pilotEndsAt: string | null;
    } | null;
    users: Array<{ id: string; email: string; createdAt: string }>;
    counts: { notes: number; users: number };
}

export interface UserListRow {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    tenantSlug: string | null;
    lastLoginAt: string | null;
    createdAt: string;
}

export interface AuditListRow {
    id: string;
    createdAt: string;
    action: string;
    entity: string;
    entityId: string;
    changes: Prisma.JsonValue | null;
    userEmail: string | null;
}

export interface SubscriptionListRow {
    id: string;
    tenant: { slug: string; name: string };
    plan: string;
    status: string;
    billingCycle: string;
    periodEndsAt: string | null;
    monthlyNet: string | null;
}

export interface TenantListFilterInput {
    status?: string;
    plan?: string;
    search?: string;
}

export interface UserListFilterInput {
    q?: string;
    tenant?: string;
}

export interface AuditListFilterInput {
    actor?: string;
    action?: string;
    entity?: string;
    since?: string;
    limit?: number;
}

export interface PromoListFilterInput {
    status?: string;
    search?: string;
}

@Injectable()
export class NotesPlatformPagesService {
    constructor(private readonly prisma: PrismaService) {}

    // ─── Tenants ────────────────────────────────────────────────────────

    async listTenants(filter: TenantListFilterInput): Promise<TenantListRow[]> {
        const where: Prisma.TenantWhereInput = {};
        const active = parseActiveFilter(filter.status);
        if (active !== undefined) where.isActive = active;
        if (filter.search) {
            where.OR = [
                { slug: { contains: filter.search, mode: 'insensitive' } },
                { name: { contains: filter.search, mode: 'insensitive' } },
            ];
        }
        if (filter.plan) where.subscription = { plan: filter.plan };

        const tenants = await this.prisma.tenant.findMany({
            where,
            include: {
                subscription: { select: { plan: true, status: true } },
                _count: { select: { notes: true, users: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: LIST_LIMIT,
        });

        return tenants.map((t) => ({
            id: t.id,
            slug: t.slug,
            name: t.name,
            isActive: t.isActive,
            deletedAt: null,
            plan: t.subscription?.plan ?? null,
            status: t.subscription?.status ?? null,
            notes: t._count.notes,
            users: t._count.users,
            createdAt: t.createdAt.toISOString(),
        }));
    }

    async getTenantDetail(slug: string): Promise<TenantDetailData> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { slug },
            include: {
                subscription: true,
                users: {
                    select: { id: true, email: true, createdAt: true },
                    orderBy: { createdAt: 'asc' },
                },
                _count: { select: { notes: true, users: true } },
            },
        });
        if (!tenant) throw new NotFoundException(`Tenant ${slug} not found`);

        return {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.name,
            isActive: tenant.isActive,
            subscription: tenant.subscription
                ? {
                      plan: tenant.subscription.plan,
                      status: tenant.subscription.status,
                      billingCycle: tenant.subscription.billingCycle,
                      isPilot: tenant.subscription.isPilot,
                      trialEndsAt: tenant.subscription.trialEndsAt?.toISOString() ?? null,
                      pilotEndsAt: tenant.subscription.pilotEndsAt?.toISOString() ?? null,
                  }
                : null,
            users: tenant.users.map((u) => ({
                id: u.id,
                email: u.email,
                createdAt: u.createdAt.toISOString(),
            })),
            counts: { notes: tenant._count.notes, users: tenant._count.users },
        };
    }

    async suspendTenant(
        slug: string,
        reason: string | undefined,
        actorUserId: string,
    ): Promise<{ ok: true; slug: string; isActive: boolean; status: string | null }> {
        return this.setTenantActive(slug, false, SubscriptionStatus.PAST_DUE, {
            action: 'TENANT_SUSPEND',
            reason: reason ?? '',
            actorUserId,
        });
    }

    async reactivateTenant(
        slug: string,
        actorUserId: string,
    ): Promise<{ ok: true; slug: string; isActive: boolean; status: string | null }> {
        return this.setTenantActive(slug, true, SubscriptionStatus.ACTIVE, {
            action: 'TENANT_REACTIVATE',
            reason: '',
            actorUserId,
        });
    }

    private async setTenantActive(
        slug: string,
        isActive: boolean,
        subscriptionStatus: SubscriptionStatus,
        audit: { action: string; reason: string; actorUserId: string },
    ): Promise<{ ok: true; slug: string; isActive: boolean; status: string | null }> {
        const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
        if (!tenant) throw new NotFoundException(`Tenant ${slug} not found`);

        await this.prisma.tenant.update({ where: { id: tenant.id }, data: { isActive } });
        // updateMany: tenants without a Subscription must not raise here.
        await this.prisma.subscription.updateMany({
            where: { tenantId: tenant.id },
            data: { status: subscriptionStatus },
        });
        await this.writeAudit({
            entity: 'Tenant',
            entityId: tenant.id,
            action: audit.action,
            changes: { slug, reason: audit.reason },
            actorUserId: audit.actorUserId,
        });

        return { ok: true, slug, isActive, status: subscriptionStatus };
    }

    // ─── Users ──────────────────────────────────────────────────────────

    async listUsers(filter: UserListFilterInput): Promise<UserListRow[]> {
        const where: Prisma.UserWhereInput = {};
        if (filter.q) where.email = { contains: filter.q, mode: 'insensitive' };
        if (filter.tenant) where.tenant = { slug: filter.tenant };

        const users = await this.prisma.user.findMany({
            where,
            include: { tenant: { select: { slug: true } } },
            orderBy: { createdAt: 'desc' },
            take: LIST_LIMIT,
        });

        // The app User model carries only email/createdAt; the platform UsersPage
        // renders name/role/status/last-login columns, so synthesize neutral
        // defaults for the fields this example does not model.
        return users.map((u) => ({
            id: u.id,
            email: u.email,
            firstName: '',
            lastName: '',
            role: 'MEMBER',
            isActive: true,
            tenantSlug: u.tenant?.slug ?? null,
            lastLoginAt: null,
            createdAt: u.createdAt.toISOString(),
        }));
    }

    // ─── Audit ──────────────────────────────────────────────────────────

    async listAudit(filter: AuditListFilterInput): Promise<AuditListRow[]> {
        const where: Prisma.AuditLogWhereInput = {};
        if (filter.action) where.action = filter.action;
        if (filter.entity) where.entity = filter.entity;
        if (filter.actor) where.actorTag = { contains: filter.actor, mode: 'insensitive' };
        if (filter.since) {
            const since = new Date(filter.since);
            if (!Number.isNaN(since.getTime())) where.createdAt = { gte: since };
        }

        const logs = await this.prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take:
                filter.limit && filter.limit > 0 ? Math.min(filter.limit, LIST_LIMIT) : AUDIT_LIMIT,
        });

        return logs.map((log) => ({
            id: log.id,
            createdAt: log.createdAt.toISOString(),
            action: log.action,
            entity: log.entity,
            entityId: log.entityId,
            changes: log.changes ?? null,
            userEmail: emailFromActorTag(log.actorTag),
        }));
    }

    // ─── Subscriptions ──────────────────────────────────────────────────

    async listSubscriptions(): Promise<SubscriptionListRow[]> {
        const subs = await this.prisma.subscription.findMany({
            include: {
                tenant: { select: { slug: true, name: true } },
                planVersion: { select: { monthlyNet: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: LIST_LIMIT,
        });

        return subs.map((s) => ({
            id: s.id,
            tenant: { slug: s.tenant.slug, name: s.tenant.name },
            plan: s.plan,
            status: s.status,
            billingCycle: s.billingCycle,
            periodEndsAt: s.currentPeriodEnd?.toISOString() ?? null,
            monthlyNet: s.planVersion ? s.planVersion.monthlyNet.toString() : null,
        }));
    }

    // ─── Promo codes ────────────────────────────────────────────────────

    async listPromoCodes(filter: PromoListFilterInput): Promise<PromoCode[]> {
        const where: Prisma.PromoCodeWhereInput = { deletedAt: null };
        if (filter.status && isPromoStatus(filter.status)) where.status = filter.status;
        if (filter.search) where.code = { contains: filter.search.toUpperCase() };
        return this.prisma.promoCode.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: LIST_LIMIT,
        });
    }

    async createPromoCode(dto: CreatePromoCodeDto, actorUserId: string): Promise<PromoCode> {
        const created = await this.prisma.promoCode.create({
            data: {
                code: dto.code.toUpperCase(),
                valueType: dto.valueType,
                value: dto.value,
                durationType: dto.durationType,
                durationValue: dto.durationValue ?? null,
                maxRedemptions: dto.maxRedemptions ?? null,
                validFrom: parseDate(dto.validFrom),
                validUntil: parseDate(dto.validUntil),
                appliesToPlans: dto.appliesToPlans ?? [],
                appliesToBilling: dto.appliesToBilling ?? null,
                firstTimeCustomersOnly: dto.firstTimeCustomersOnly ?? true,
                minimumPlanAmountGross: dto.minimumPlanAmountGross ?? null,
                allowZeroInvoice: dto.allowZeroInvoice ?? false,
                revenueDeductionAccount: dto.revenueDeductionAccount ?? null,
                campaignTag: dto.campaignTag ?? null,
                description: dto.description ?? null,
                createdById: actorUserId,
            },
        });
        await this.writeAudit({
            entity: 'PromoCode',
            entityId: created.id,
            action: 'PROMO_CODE_CREATE',
            changes: { code: created.code },
            actorUserId,
        });
        return created;
    }

    async updatePromoCode(
        id: string,
        dto: UpdatePromoCodeDto,
        actorUserId: string,
    ): Promise<PromoCode> {
        await this.assertPromoExists(id);
        // Whitelist instead of spread: `code` stays stable after creation and
        // unknown keys must not slip through.
        const data: Prisma.PromoCodeUpdateInput = {};
        if (dto.status !== undefined) data.status = dto.status;
        if (dto.valueType !== undefined) data.valueType = dto.valueType;
        if (dto.value !== undefined) data.value = dto.value;
        if (dto.durationType !== undefined) data.durationType = dto.durationType;
        if (dto.durationValue !== undefined) data.durationValue = dto.durationValue;
        if (dto.maxRedemptions !== undefined) data.maxRedemptions = dto.maxRedemptions;
        if (dto.validFrom !== undefined) data.validFrom = parseDate(dto.validFrom);
        if (dto.validUntil !== undefined) data.validUntil = parseDate(dto.validUntil);
        if (dto.appliesToPlans !== undefined) data.appliesToPlans = dto.appliesToPlans;
        if (dto.appliesToBilling !== undefined) data.appliesToBilling = dto.appliesToBilling;
        if (dto.firstTimeCustomersOnly !== undefined)
            data.firstTimeCustomersOnly = dto.firstTimeCustomersOnly;
        if (dto.minimumPlanAmountGross !== undefined)
            data.minimumPlanAmountGross = dto.minimumPlanAmountGross;
        if (dto.allowZeroInvoice !== undefined) data.allowZeroInvoice = dto.allowZeroInvoice;
        if (dto.revenueDeductionAccount !== undefined)
            data.revenueDeductionAccount = dto.revenueDeductionAccount;
        if (dto.campaignTag !== undefined) data.campaignTag = dto.campaignTag;
        if (dto.description !== undefined) data.description = dto.description;

        const updated = await this.prisma.promoCode.update({ where: { id }, data });
        await this.writeAudit({
            entity: 'PromoCode',
            entityId: id,
            action: 'PROMO_CODE_UPDATE',
            changes: { fields: Object.keys(data) },
            actorUserId,
        });
        return updated;
    }

    async deletePromoCode(id: string, actorUserId: string): Promise<{ ok: true }> {
        await this.assertPromoExists(id);
        // Soft delete — never hard-delete for audit reasons (schema note).
        await this.prisma.promoCode.update({ where: { id }, data: { deletedAt: new Date() } });
        await this.writeAudit({
            entity: 'PromoCode',
            entityId: id,
            action: 'PROMO_CODE_DELETE',
            changes: {},
            actorUserId,
        });
        return { ok: true };
    }

    private async assertPromoExists(id: string): Promise<void> {
        const promo = await this.prisma.promoCode.findFirst({ where: { id, deletedAt: null } });
        if (!promo) throw new NotFoundException(`Promo code ${id} not found`);
    }

    // ─── Audit helper ───────────────────────────────────────────────────

    private async writeAudit(input: {
        entity: string;
        entityId: string;
        action: string;
        changes: Prisma.InputJsonValue;
        actorUserId: string;
    }): Promise<void> {
        await this.prisma.auditLog.create({
            data: {
                entity: input.entity,
                entityId: input.entityId,
                action: input.action,
                changes: input.changes,
                userId: input.actorUserId,
                actorTag: `web:${DEMO_ADMIN_EMAIL}`,
            },
        });
    }
}

function parseActiveFilter(status: string | undefined): boolean | undefined {
    if (!status) return undefined;
    const normalized = status.toUpperCase();
    if (normalized === 'ACTIVE') return true;
    if (normalized === 'INACTIVE' || normalized === 'SUSPENDED') return false;
    return undefined;
}

function parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function emailFromActorTag(actorTag: string | null): string | null {
    if (!actorTag) return null;
    // Format `web:<email>:<sessionId>` (audit-event.schema.json actorTag).
    const parts = actorTag.split(':');
    return parts[1] ?? actorTag;
}

function isPromoStatus(value: string): value is PromoCodeStatus {
    return (Object.values(PromoCodeStatus) as string[]).includes(value);
}
