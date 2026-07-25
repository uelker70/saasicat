import type {
    AdminAuditListFilter,
    AdminSubscriptionListRow,
    AdminTenantDetail,
    AdminUserListFilter,
    AdminUserListRow,
    AuditEntry,
    PromoCodeRecord,
} from '@saasicat/types';
import type { HttpClient } from './types.js';

export interface AdminResourceClientOptions {
    http: HttpClient;
    /** Default `/api/v1/admin`. */
    adminBase?: string;
}

/** Filters accepted by the standard PromoCodesPage, including its "all" state. */
export interface AdminPromoListFilter {
    search?: string;
    status?: string | null;
}

/** Promo row shape used by the extensible standard Admin table. */
export interface AdminPromoListRow extends PromoCodeRecord {
    [extra: string]: unknown;
}

/**
 * Ready-to-use client for the standard SaaSiCat AdminResources and promo
 * controllers. App wrappers pass these functions straight to the standard
 * pages; no repeated fetch/error/query-string plumbing is needed.
 */
export function createAdminResourceClient(options: AdminResourceClientOptions) {
    const base = options.adminBase ?? '/api/v1/admin';
    const tenantsEndpoint = `${base}/tenants`;

    const getJson = async <T>(url: string): Promise<T> => {
        const response = await options.http(url, { method: 'GET' });
        assertSuccess(response.status, 'GET', url);
        return (await response.json()) as T;
    };

    const sendJson = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
        const response = await options.http(url, {
            method,
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        assertSuccess(response.status, method, url);
        return (await response.json()) as T;
    };

    return {
        tenantsEndpoint,
        loadTenantDetail: (slug: string) =>
            getJson<AdminTenantDetail>(`${tenantsEndpoint}/${encodeURIComponent(slug)}`),
        loadUsers: (filter: AdminUserListFilter) =>
            getJson<AdminUserListRow[]>(
                `${base}/users${queryString({ q: filter.q, tenant: filter.tenant })}`,
            ),
        loadAudit: (filter: AdminAuditListFilter) =>
            getJson<AuditEntry[]>(
                `${base}/audit${queryString({
                    actor: filter.actor,
                    action: filter.action,
                    entity: filter.entity,
                    since: filter.since,
                    limit: filter.limit,
                })}`,
            ),
        loadSubscriptions: () => getJson<AdminSubscriptionListRow[]>(`${base}/subscriptions`),
        loadPromos: (filter: AdminPromoListFilter) =>
            getJson<AdminPromoListRow[]>(
                `${base}/promo-codes${queryString({
                    search: filter.search,
                    status: filter.status,
                })}`,
            ),
        createPromo: async (payload: unknown): Promise<void> => {
            await sendJson('POST', `${base}/promo-codes`, payload);
        },
        updatePromo: async (id: string, payload: unknown): Promise<void> => {
            await sendJson('PATCH', `${base}/promo-codes/${encodeURIComponent(id)}`, payload);
        },
        deletePromo: async (id: string): Promise<void> => {
            await sendJson('DELETE', `${base}/promo-codes/${encodeURIComponent(id)}`);
        },
        suspendTenant: (slug: string, reason: string): Promise<unknown> =>
            sendJson('POST', `${tenantsEndpoint}/${encodeURIComponent(slug)}/suspend`, {
                reason,
            }),
        reactivateTenant: (slug: string): Promise<unknown> =>
            sendJson('POST', `${tenantsEndpoint}/${encodeURIComponent(slug)}/reactivate`),
    };
}

function assertSuccess(status: number, method: string, url: string): void {
    if (status < 200 || status >= 300) {
        throw new Error(`${method} ${url} → HTTP ${status}`);
    }
}

function queryString(params: Record<string, string | number | null | undefined>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        search.set(key, String(value));
    }
    const value = search.toString();
    return value ? `?${value}` : '';
}
