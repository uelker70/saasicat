// The open items of the installation (`SC-ADM-044`): the invoices that still
// owe something — all, or the overdue ones alone —, the credits the operator
// still owes, each list a page at a time, what both add up to, and the payout
// of a credit from its row, behind the second factor as from the subscriber's
// record. A payout changes what is open, so the credits and the totals are read
// again after it.
//
// A composable rather than page script, so the sequence — the filter changed
// while a page is on its way, a page read after the list moved on — can be
// checked with `node --test` against `dist/`.

import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue';
import {
    SUBSCRIBER_PAYOUT_CAPABILITY,
    type AdminManifest,
    type AdminOpenCredit,
    type AdminOpenCreditPage,
    type AdminOpenInvoice,
    type AdminOpenInvoicePage,
    type AdminOpenItemTotals,
    type AdminSubscriberCredits,
    type AdminSubscriberPayout,
} from '@saasicat/core';

import { toAdminError, type AdminError } from '../client/admin-error.js';
import type { Bound } from '../client/resources/define-resource.js';
import type { openItemsResource } from '../client/resources/open-items.resource.js';
import type { subscribersResource } from '../client/resources/subscribers.resource.js';
import { report } from './report.js';
import type { UiNotify } from './ui-notify.js';
import { useAsyncData, type AsyncData } from './use-async-data.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/** The operations the open items call, already bound to the shell's client. */
export type OpenItemsResource = Pick<
    Bound<(typeof openItemsResource)['ops']>,
    'invoices' | 'credits' | 'totals'
>;

/** The payout of a credit, as the subscriber's record records it. */
export type OpenItemsPayoutResource = Pick<
    Bound<(typeof subscribersResource)['ops']>,
    'recordPayout'
>;

export interface OpenItemsPorts {
    notify: UiNotify;
    mfa: Pick<MfaPrompt, 'run'>;
}

/** One list of the open items, read a page at a time. */
export interface OpenItemList<Row> {
    rows: ComputedRef<Row[]>;
    loading: Ref<boolean>;
    error: Ref<AdminError | null>;
    hasMore: ComputedRef<boolean>;
    reload(): Promise<void>;
    /**
     * Reads the next page and adds it. A page whose list was read anew while
     * it was on its way is dropped, and so is a page another call already added.
     */
    more(): Promise<void>;
}

export interface OpenItems {
    /** Only the invoices overdue today; changing it reads them from the first page. */
    overdueOnly: Ref<boolean>;
    invoices: OpenItemList<AdminOpenInvoice>;
    credits: OpenItemList<AdminOpenCredit>;
    /** The installation's zone a payout's day is judged in; `null` before the credits are read. */
    timeZone: ComputedRef<string | null>;
    totals: AsyncData<AdminOpenItemTotals | null>;
    /** Whether the platform takes a payout; nothing is offered without it. */
    canPayOut: ComputedRef<boolean>;
    /** For a form dialog's `submit`: rejects on a failure, `null` where the second factor was not given. */
    payOut(
        credit: AdminOpenCredit,
        payout: AdminSubscriberPayout,
    ): Promise<AdminSubscriberCredits | null>;
    /** Reads both lists and the totals again — from a retry button, or the refresh. */
    reload(): Promise<void>;
}

/** A list read a page at a time, each page naming the row the next one continues after. */
function usePagedList<Page extends { next: string | null }, Row>(
    read: (after?: string) => Promise<Page>,
    rowsOf: (page: Page) => Row[],
    watchSources: Ref<unknown>[] = [],
): OpenItemList<Row> & { first: AsyncData<Page | null> } {
    // Replaced whole, never changed in place: a shallow ref is all it needs.
    const later = shallowRef<Page[]>([]);
    // Every read of the first page counts, so a later page can tell whether
    // it still continues the list on screen.
    let firstReads = 0;
    const first = useAsyncData<Page | null>(
        () => {
            firstReads += 1;
            later.value = [];
            return read();
        },
        { initial: null, watch: watchSources },
    );
    const pages = computed(() => (first.data.value ? [first.data.value, ...later.value] : []));
    // Indexed rather than `.at(-1)`: the shipped source compiles at ES2021.
    const nextAfter = (): string | null => pages.value[pages.value.length - 1]?.next ?? null;

    // A button's handler: a failure is shown with the list rather than thrown
    // into nowhere.
    async function more(): Promise<void> {
        const after = nextAfter();
        if (!after) return;
        const asked = firstReads;
        try {
            const page = await read(after);
            if (asked === firstReads && nextAfter() === after) later.value = [...later.value, page];
        } catch (err: unknown) {
            if (asked === firstReads) first.error.value = toAdminError(err);
        }
    }

    return {
        first,
        rows: computed(() => pages.value.flatMap(rowsOf)),
        loading: first.pending,
        error: first.error,
        hasMore: computed(() => nextAfter() !== null),
        reload: first.reload,
        more,
    };
}

export function useOpenItems(
    manifest: Ref<AdminManifest | null>,
    openItems: OpenItemsResource,
    subscribers: OpenItemsPayoutResource,
    ports: OpenItemsPorts,
): OpenItems {
    const msg = useSaMessages('subscribers');
    const shell = useSaMessages('shell');
    const overdueOnly = ref(false);
    const invoices = usePagedList<AdminOpenInvoicePage, AdminOpenInvoice>(
        (after) =>
            openItems.invoices(
                after === undefined
                    ? { overdue: overdueOnly.value }
                    : { overdue: overdueOnly.value, after },
            ),
        (page) => page.invoices,
        [overdueOnly],
    );
    const credits = usePagedList<AdminOpenCreditPage, AdminOpenCredit>(
        (after) => openItems.credits(after === undefined ? {} : { after }),
        (page) => page.credits,
    );
    const totals = useAsyncData<AdminOpenItemTotals | null>(() => openItems.totals(), {
        initial: null,
    });

    async function payOut(
        credit: AdminOpenCredit,
        payout: AdminSubscriberPayout,
    ): Promise<AdminSubscriberCredits | null> {
        const outcome = await ports.mfa.run(
            msg.value.credits.mfaPayout,
            shell.value.mfa.invalidCode,
            (code) => subscribers.recordPayout(credit.subscriber.id, credit.id, payout, code),
        );
        if (!outcome.done) return null;
        report(() => ports.notify('positive', msg.value.credits.paidOut));
        await Promise.all([credits.reload(), totals.reload()]);
        return outcome.value;
    }

    return {
        overdueOnly,
        invoices,
        credits,
        timeZone: computed(() => credits.first.data.value?.timeZone ?? null),
        totals,
        canPayOut: computed(
            () => manifest.value?.capabilities?.[SUBSCRIBER_PAYOUT_CAPABILITY] === true,
        ),
        payOut,
        async reload() {
            await Promise.all([invoices.reload(), credits.reload(), totals.reload()]);
        },
    };
}
