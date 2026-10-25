// The list of subscribers: searched by what a caller gives — a customer
// number, a legal name, a VAT number —, narrowed to those without a live
// tenant, a page at a time (`SC-ADM-036`).
//
// A composable rather than page script, so the sequence — a search typed while
// a page is on its way, a page read after the search moved on — can be checked
// with `node --test` against `dist/`.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type { AdminSubscriberList, AdminSubscriberRow } from '@saasicat/core';

import { toAdminError, type AdminError } from '../client/admin-error.js';
import type { Bound } from '../client/resources/define-resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import { useAsyncData } from './use-async-data.js';

/** The operation the list calls, already bound to the shell's client. */
export type SubscribersListResource = Pick<Bound<(typeof subscribersResource)['ops']>, 'list'>;

export interface SubscribersList {
    /** What the operator typed; changing it reads the list from the first page. */
    query: Ref<string>;
    /** Only those whose every tenant link is closed; changing it reads from the first page. */
    withoutLiveTenant: Ref<boolean>;
    /** The subscribers read so far, the latest customer number first. */
    rows: ComputedRef<AdminSubscriberRow[]>;
    loading: Ref<boolean>;
    /** The last load's failure, or null. */
    error: Ref<AdminError | null>;
    /** Whether a further page is there to read. */
    hasMore: ComputedRef<boolean>;
    reload(): Promise<void>;
    /**
     * Reads the next page and adds it. A page whose list was read anew while it
     * was on its way — another search, a narrowing, a reload — is dropped, and
     * so is a page another call already added.
     */
    more(): Promise<void>;
}

const EMPTY: AdminSubscriberList = { subscribers: [], next: null };

export function useSubscribers(subscribers: SubscribersListResource): SubscribersList {
    const query = ref('');
    const withoutLiveTenant = ref(false);
    const later = ref<AdminSubscriberList[]>([]);
    const asked = () => ({ query: query.value, withoutLiveTenant: withoutLiveTenant.value });
    // Every change of what is asked reads the first page again, so counting
    // those reads is what tells a later page whether it still continues the
    // list on screen.
    let firstReads = 0;
    const first = useAsyncData<AdminSubscriberList>(
        () => {
            firstReads += 1;
            later.value = [];
            return subscribers.list(asked());
        },
        { initial: EMPTY, watch: [query, withoutLiveTenant] },
    );
    const pages = computed(() => [first.data.value, ...later.value]);
    const rows = computed(() => pages.value.flatMap((page) => page.subscribers));
    // Indexed rather than `.at(-1)`: the shipped source compiles at ES2021.
    const nextAfter = (): string | null => pages.value[pages.value.length - 1]?.next ?? null;
    const hasMore = computed(() => nextAfter() !== null);

    // A button's handler: a failure is shown with the list rather than thrown
    // into nowhere.
    async function more(): Promise<void> {
        const after = nextAfter();
        if (!after) return;
        const read = firstReads;
        try {
            const page = await subscribers.list({ ...asked(), after });
            if (read === firstReads && nextAfter() === after) later.value = [...later.value, page];
        } catch (err: unknown) {
            // A failure of a page for a list no longer on screen says nothing
            // about the one that is.
            if (read === firstReads) first.error.value = toAdminError(err);
        }
    }

    return {
        query,
        withoutLiveTenant,
        rows,
        loading: first.pending,
        error: first.error,
        hasMore,
        reload: first.reload,
        more,
    };
}
