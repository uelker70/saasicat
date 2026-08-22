import type {
    AdminAuditListFilter,
    AdminSubscriptionListRow,
    AdminTenantDetail,
    AdminUserListFilter,
    AdminUserListRow,
    AuditEntry,
    PromoCodeRecord,
} from '@saasicat/core';
import { filterQueryString } from './resources/list-resource.js';
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
                `${base}/users${filterQueryString({ q: filter.q, tenant: filter.tenant })}`,
            ),
        loadAudit: (filter: AdminAuditListFilter) =>
            getJson<AuditEntry[]>(
                `${base}/audit${filterQueryString({
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
                `${base}/promo-codes${filterQueryString({
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

// The query string these endpoints take is `filterQueryString` — the same
// omit-the-empties rule the paginated lists apply, minus the pagination these
// controllers do not offer. It used to be written out again here, which is one
// decision in two places: the copies agreed by coincidence, and either could
// have started sending `status=null` on its own.
