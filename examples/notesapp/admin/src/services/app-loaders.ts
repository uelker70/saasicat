// Loader/mutation callbacks for the app-owned SuperAdmin pages (tenants, users,
// audit, subscriptions, promo codes). These call the app's own controllers
// (NotesPlatformPagesModule) through `platformHttp` — the same client the
// catalog pages use — and return the exact shapes the platform standard pages
// read. Endpoints live under the `/api/v1/admin` prefix.
//
// The row interfaces mirror the (non-exported) types inside the platform
// `pages-standard/*.vue`; they are structurally compatible, so the thin
// wrappers pass these callbacks straight into the page props.

import type { PromoCodeCreatePayload, PromoCodeUpdatePayload } from '@saasicat/ui-vue';
import { platformHttp } from './http';

const ADMIN_BASE = '/api/v1/admin';

export const TENANTS_ENDPOINT = `${ADMIN_BASE}/tenants`;

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

export interface UserRow {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    tenantSlug: string | null;
    lastLoginAt: string | null;
    createdAt: string;
    [extra: string]: unknown;
}

export interface AuditRow {
    id: string;
    createdAt: string;
    action: string;
    entity: string;
    entityId: string;
    changes: Record<string, unknown> | null;
    userEmail: string | null;
}

export interface SubscriptionRow {
    id: string;
    tenant: { slug: string; name: string };
    plan: string;
    status: string;
    billingCycle: string;
    periodEndsAt: string | null;
    monthlyNet: string | null;
    [extra: string]: unknown;
}

export interface PromoRow {
    id: string;
    code: string;
    valueType: string;
    value: string | number;
    status: string;
    redemptionsCount: number;
    maxRedemptions: number | string | null;
    validUntil: string | null;
    campaignTag: string | null;
    [extra: string]: unknown;
}

export interface UserListFilter {
    q?: string;
    tenant?: string;
}

export interface AuditListFilter {
    actor?: string;
    action?: string;
    entity?: string;
    since?: string;
    limit?: number;
}

export interface PromoListFilter {
    search?: string;
    status?: string | null;
}

async function getJson<T>(url: string): Promise<T> {
    const res = await platformHttp(url, { method: 'GET' });
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`GET ${url} → HTTP ${res.status}`);
    }
    return (await res.json()) as T;
}

async function sendJson<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await platformHttp(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`${method} ${url} → HTTP ${res.status}`);
    }
    return (await res.json()) as T;
}

function queryString(params: Record<string, string | number | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === '') continue;
        search.set(key, String(value));
    }
    const qs = search.toString();
    return qs ? `?${qs}` : '';
}

export function loadTenantDetail(slug: string): Promise<TenantDetailData> {
    return getJson<TenantDetailData>(`${TENANTS_ENDPOINT}/${encodeURIComponent(slug)}`);
}

export function loadUsers(filter: UserListFilter): Promise<UserRow[]> {
    return getJson<UserRow[]>(
        `${ADMIN_BASE}/users${queryString({ q: filter.q, tenant: filter.tenant })}`,
    );
}

export function loadAudit(filter: AuditListFilter): Promise<AuditRow[]> {
    return getJson<AuditRow[]>(
        `${ADMIN_BASE}/audit${queryString({
            actor: filter.actor,
            action: filter.action,
            entity: filter.entity,
            since: filter.since,
            limit: filter.limit,
        })}`,
    );
}

export function loadSubscriptions(): Promise<SubscriptionRow[]> {
    return getJson<SubscriptionRow[]>(`${ADMIN_BASE}/subscriptions`);
}

export function loadPromos(filter: PromoListFilter): Promise<PromoRow[]> {
    return getJson<PromoRow[]>(
        `${ADMIN_BASE}/promo-codes${queryString({
            search: filter.search,
            status: filter.status ?? undefined,
        })}`,
    );
}

export async function createPromo(payload: PromoCodeCreatePayload): Promise<void> {
    await sendJson('POST', `${ADMIN_BASE}/promo-codes`, payload);
}

export async function updatePromo(id: string, payload: PromoCodeUpdatePayload): Promise<void> {
    await sendJson('PATCH', `${ADMIN_BASE}/promo-codes/${encodeURIComponent(id)}`, payload);
}

export async function deletePromo(id: string): Promise<void> {
    await sendJson('DELETE', `${ADMIN_BASE}/promo-codes/${encodeURIComponent(id)}`);
}

export function suspendTenant(slug: string, reason: string): Promise<unknown> {
    return sendJson('POST', `${TENANTS_ENDPOINT}/${encodeURIComponent(slug)}/suspend`, { reason });
}

export function reactivateTenant(slug: string): Promise<unknown> {
    return sendJson('POST', `${TENANTS_ENDPOINT}/${encodeURIComponent(slug)}/reactivate`);
}
