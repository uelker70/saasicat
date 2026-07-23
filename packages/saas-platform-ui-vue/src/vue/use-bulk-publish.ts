// useBulkPublish — bulk-publish modal orchestration.
//
// SuperAdmin selects N drafts from the versions page list, enters a shared
// `changeNote` and triggers the publish. The platform composable runs the
// publishes **in parallel** and tracks the status per draft (pending/
// publishing/published/failed) — the modal renders a live table with a
// progress bar per item.
//
// What the platform does NOT do: TOTP code entry + setting the MFA header.
// The consumer shell (Quasar modal or similar) does that and passes the
// `mfaCode` parameter through.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { defaultHttpClient, type HttpClient } from '../client/types.js';
import { useSaMessages } from './use-super-admin-i18n.js';

export type BulkItemKind = 'plan';

export type BulkItemStatus = 'pending' | 'publishing' | 'published' | 'failed';

export interface BulkPublishItem {
    /** Composite ID: `<kind>:<draftId>`. Unique within the bulk set. */
    key: string;
    kind: BulkItemKind;
    draftId: string;
    /** Display label in the modal (e.g. "STANDARD v3"). */
    label: string;
    status: BulkItemStatus;
    error?: string;
    /** Server response when status='published'. */
    result?: unknown;
}

export interface UseBulkPublishOptions {
    /**
     * Endpoint mapping per kind. **Required** — the platform does not know
     * the app's globalPrefix (e.g. `/api/admin/...` or
     * `/api/v1/admin/...`), so consumers supply the full URL per kind.
     */
    endpoints: Record<BulkItemKind, (draftId: string) => string>;
    http?: HttpClient;
    getAuthToken?: () => string | null;
}

export interface UseBulkPublishResult {
    items: Ref<BulkPublishItem[]>;
    /** Fraction of items already completed (0..1). */
    progress: ComputedRef<number>;
    /** Returns `true` once all items are either `published` or `failed`. */
    done: ComputedRef<boolean>;
    /** Number of successful publishes. */
    successCount: ComputedRef<number>;
    /** Number of failed publishes. */
    failureCount: ComputedRef<number>;
    /** Resets the bulk set — e.g. after modal open. */
    setItems: (items: Array<Omit<BulkPublishItem, 'status'>>) => void;
    /**
     * Triggers the bulk publish. `changeNote` is required for all
     * drafts; `mfaCode` is optional and is sent in the `X-Mfa-Code`
     * header when present.
     */
    run: (input: { changeNote: string; mfaCode?: string }) => Promise<void>;
}

export function useBulkPublish(options: UseBulkPublishOptions): UseBulkPublishResult {
    const msg = useSaMessages('planVersions');
    if (!options?.endpoints) {
        throw new Error(
            'useBulkPublish: `endpoints` is required (mapping plan → URL builder). ' +
                'The platform has no default because apps use different ' +
                'globalPrefix conventions.',
        );
    }
    const http = options.http ?? defaultHttpClient();
    const endpoints = options.endpoints;
    const items = ref<BulkPublishItem[]>([]) as Ref<BulkPublishItem[]>;

    const successCount = computed(() => items.value.filter((i) => i.status === 'published').length);
    const failureCount = computed(() => items.value.filter((i) => i.status === 'failed').length);
    const progress = computed(() => {
        if (items.value.length === 0) return 0;
        const done = successCount.value + failureCount.value;
        return done / items.value.length;
    });
    const done = computed(
        () =>
            items.value.length > 0 &&
            items.value.every((i) => i.status === 'published' || i.status === 'failed'),
    );

    function setItems(next: Array<Omit<BulkPublishItem, 'status'>>): void {
        items.value = next.map((i) => ({ ...i, status: 'pending' as BulkItemStatus }));
    }

    async function publishOne(
        item: BulkPublishItem,
        body: { changeNote: string },
        mfaCode?: string,
    ): Promise<void> {
        item.status = 'publishing';
        try {
            const url = endpoints[item.kind](item.draftId);
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };
            const token = options.getAuthToken?.();
            if (token) headers.Authorization = `Bearer ${token}`;
            if (mfaCode) headers['X-Mfa-Code'] = mfaCode;
            const res = await http(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
            });
            if (res.status >= 200 && res.status < 300) {
                item.result = await res.json();
                item.status = 'published';
            } else {
                item.error = `HTTP ${res.status}: ${await res.text()}`;
                item.status = 'failed';
            }
        } catch (err) {
            item.error = err instanceof Error ? err.message : String(err);
            item.status = 'failed';
        }
    }

    async function run(input: { changeNote: string; mfaCode?: string }): Promise<void> {
        const note = input.changeNote.trim();
        if (note.length === 0) {
            // Mark all items as failed with a clear reason.
            for (const item of items.value) {
                item.status = 'failed';
                item.error = msg.value.bulkPublish.changeNoteRequired;
            }
            return;
        }
        // Parallel publishes — the server enforces an optimistic lock per draft.
        await Promise.all(
            items.value.map((item) => publishOne(item, { changeNote: note }, input.mfaCode)),
        );
    }

    return {
        items,
        progress,
        done,
        successCount,
        failureCount,
        setItems,
        run,
    };
}
