// useTenantFeatureWithdrawals — the features withdrawn from the tenant's
// subscription for a reason outside the platform, beside its plan:
// `GET /billing/feature-withdrawals`, and ending the subscription or one
// booking at once while one is withdrawn, with what it would credit read
// first.
//
// The list is open to every user of the tenant; ending at once is the tenant
// administrator's, and the server refuses anybody else. An installation that
// does not withdraw features does not mount the routes, and the refusal that
// says so (`isHiddenFromThisUser`) turns `available` false so the page shows
// nothing.

import { getCurrentScope, onScopeDispose, ref, type Ref } from 'vue';
import type { EndAtOncePreview, EndedAtOnce, TenantFeatureWithdrawal } from '@saasicat/core';

import { httpStatusOf } from '../client/admin-error.js';
import { isHiddenFromThisUser } from '../client/billing-area.js';
import { getJson, postJson, trimTrailingSlashes } from '../client/http-json.js';
import { defaultHttpClient, type HttpClient } from '../client/types.js';

export interface UseTenantFeatureWithdrawalsOptions {
    http?: HttpClient;
    /** The prefix the billing routes sit under, as for `useTenantBilling`. Default `/billing`. */
    apiPrefix?: string;
    /** Default `true`: loads once on the next tick. */
    autoLoad?: boolean;
}

export interface UseTenantFeatureWithdrawalsResult {
    /** The withdrawals the subscription was told of that are not over. */
    withdrawals: Ref<TenantFeatureWithdrawal[]>;
    /** Whether the installation withdraws features at all; false hides every trace of it. */
    available: Ref<boolean>;
    loading: Ref<boolean>;
    error: Ref<Error | null>;
    reload(): Promise<void>;
    /**
     * What ending at once now would credit: the subscription, and every add-on
     * with it, for a null `subscriptionBundleId`; that one booking otherwise.
     */
    previewEnd(
        withdrawalId: string,
        subscriptionBundleId: string | null,
    ): Promise<EndAtOncePreview>;
    /** Ends at once what `previewEnd` was asked about, and reads the list again. */
    end(withdrawalId: string, subscriptionBundleId: string | null): Promise<EndedAtOnce>;
}

/** The longest delay a timer keeps; a moment further off is looked at again then. */
const LONGEST_TIMER_MS = 2_147_483_647;
/** Read a little after a moment rather than on it, so the server has reached it too. */
const AFTER_THE_MOMENT_MS = 1_000;
/**
 * Where the browser's clock has passed a moment the server has not reached
 * yet, how soon it is asked again: the two clocks need not agree.
 */
const SERVER_BEHIND_MS = 5_000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether `value` is a withdrawal as the card reads it. Checked at the
 * boundary rather than trusted: a route answering something else — another
 * list, a stub, a proxy's page — must not take the tenant's page down when the
 * card reads its lines (`SC-UI-020`).
 */
function isTenantFeatureWithdrawal(value: unknown): value is TenantFeatureWithdrawal {
    return (
        isRecord(value) &&
        typeof value.withdrawalId === 'string' &&
        typeof value.featureLabel === 'string' &&
        typeof value.reason === 'string' &&
        typeof value.effectiveFrom === 'string' &&
        Array.isArray(value.lines) &&
        value.lines.every(isRecord) &&
        isRecord(value.endable) &&
        Array.isArray(value.endable.subscriptionBundleIds)
    );
}

export function useTenantFeatureWithdrawals(
    options: UseTenantFeatureWithdrawalsOptions = {},
): UseTenantFeatureWithdrawalsResult {
    const route = `${trimTrailingSlashes(options.apiPrefix ?? '/billing')}/feature-withdrawals`;
    const http = options.http ?? defaultHttpClient();

    const withdrawals = ref<TenantFeatureWithdrawal[]>([]);
    const available = ref(false);
    const loading = ref(false);
    const error = ref<Error | null>(null);

    // The list is read again at the next moment a withdrawal takes effect or
    // is lifted: what the card offers — ending at once — opens and closes
    // then, and a page left open would otherwise keep offering what is gone or
    // withhold what is due.
    let nextRead: ReturnType<typeof setTimeout> | null = null;
    function stopReading(): void {
        if (nextRead !== null) clearTimeout(nextRead);
        nextRead = null;
    }
    function readAgainAtTheNextMoment(): void {
        stopReading();
        const now = Date.now();
        const waits = withdrawals.value.flatMap((withdrawal) => {
            const moments = [
                ...(withdrawal.inEffect ? [] : [withdrawal.effectiveFrom]),
                ...(withdrawal.liftedFrom ? [withdrawal.liftedFrom] : []),
            ];
            return moments.map((moment) => {
                const at = Date.parse(moment);
                return at > now ? at - now + AFTER_THE_MOMENT_MS : SERVER_BEHIND_MS;
            });
        });
        if (waits.length === 0) return;
        nextRead = setTimeout(
            () => {
                nextRead = null;
                void reload();
            },
            Math.min(Math.min(...waits), LONGEST_TIMER_MS),
        );
    }
    if (getCurrentScope()) onScopeDispose(stopReading);

    async function reload(): Promise<void> {
        loading.value = true;
        error.value = null;
        try {
            const answer = await getJson<unknown>(http, route);
            if (!Array.isArray(answer) || !answer.every(isTenantFeatureWithdrawal)) {
                // An empty list would say "nothing withdrawn" about a
                // subscription the page knows nothing about.
                throw new Error(`${route} did not answer with a list of withdrawals.`);
            }
            withdrawals.value = answer;
            available.value = true;
            readAgainAtTheNextMoment();
        } catch (err) {
            stopReading();
            withdrawals.value = [];
            available.value = !isHiddenFromThisUser(httpStatusOf(err));
            if (available.value) error.value = err instanceof Error ? err : new Error(String(err));
        } finally {
            loading.value = false;
        }
    }

    function endUrl(withdrawalId: string, subscriptionBundleId: string | null): string {
        const withdrawal = `${route}/${encodeURIComponent(withdrawalId)}`;
        return subscriptionBundleId === null
            ? `${withdrawal}/end`
            : `${withdrawal}/bookings/${encodeURIComponent(subscriptionBundleId)}/end`;
    }

    function previewEnd(
        withdrawalId: string,
        subscriptionBundleId: string | null,
    ): Promise<EndAtOncePreview> {
        return getJson<EndAtOncePreview>(http, endUrl(withdrawalId, subscriptionBundleId));
    }

    async function end(
        withdrawalId: string,
        subscriptionBundleId: string | null,
    ): Promise<EndedAtOnce> {
        const ended = await postJson<EndedAtOnce>(
            http,
            endUrl(withdrawalId, subscriptionBundleId),
            {},
        );
        await reload();
        return ended;
    }

    if (options.autoLoad !== false) {
        Promise.resolve().then(() => void reload());
    }

    return { withdrawals, available, loading, error, reload, previewEnd, end };
}
