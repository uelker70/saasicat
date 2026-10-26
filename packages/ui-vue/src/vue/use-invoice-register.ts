// The register of every invoice the installation issued (`SC-ADM-042`): the
// months the operator picks, their invoices a page at a time, and what they
// add up to. Months that cannot be read — one that is no month, the second
// before the first, more than a year — are said before anything is asked, by
// the rule the platform refuses them by. Until the operator picks, the
// platform's current month is shown, read in the installation's zone, which
// the browser does not know; the months it answers fill the inputs.
//
// A composable rather than page script, so the sequence — months changed while
// a page is on its way, a page read after they moved on — can be checked with
// `node --test` against `dist/`.

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
    catalogueSentenceFor,
    invoiceRegisterSpanOf,
    isCalendarMonth,
    type AdminInvoiceRegisterPage,
    type AdminInvoiceRegisterRow,
    type AdminInvoiceRegisterTotals,
    type CalendarMonth,
} from '@saasicat/core';

import { toAdminError, type AdminError } from '../client/admin-error.js';
import type { Bound } from '../client/resources/define-resource.js';
import type {
    InvoiceRegisterMonths,
    invoicesResource,
} from '../client/resources/invoices.resource.js';
import { useAsyncData } from './use-async-data.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/** The operations the register calls, already bound to the shell's client. */
export type InvoiceRegisterResource = Pick<
    Bound<(typeof invoicesResource)['ops']>,
    'list' | 'totals'
>;

export interface InvoiceRegister {
    /** The first month, `YYYY-MM`; empty until the first page names it. Changing it reads anew. */
    from: Ref<CalendarMonth>;
    /** The last month, as `from`. */
    until: Ref<CalendarMonth>;
    /** Why the months picked are not read, worded; `null` while they are. */
    refusal: ComputedRef<string | null>;
    /** The invoices read so far, by issue date and then number. */
    rows: ComputedRef<AdminInvoiceRegisterRow[]>;
    /** What the months add up to; `null` before they are read, and while they are refused. */
    totals: ComputedRef<AdminInvoiceRegisterTotals | null>;
    loading: ComputedRef<boolean>;
    /** The last read's failure — the page's or the totals' —, or `null`. */
    error: ComputedRef<AdminError | null>;
    /** Whether a further page is there to read. */
    hasMore: ComputedRef<boolean>;
    /** Reads the first page and the totals again — after a cancellation, or from a retry button. */
    reload(): Promise<void>;
    /**
     * Reads the next page and adds it. A page whose months were read anew while
     * it was on its way is dropped, and so is a page another call already added.
     */
    more(): Promise<void>;
}

/** The months as one text, the way two reads are told apart; `null` for none, the current month. */
function spanKeyOf(months: InvoiceRegisterMonths): string | null {
    const first = months.from ?? months.until;
    const last = months.until ?? months.from;
    return first === undefined ? null : `${first}..${last}`;
}

export function useInvoiceRegister(invoices: InvoiceRegisterResource): InvoiceRegister {
    const msg = useSaMessages('invoices');
    const errors = useSaMessages('errors');
    const from = ref<CalendarMonth>('');
    const until = ref<CalendarMonth>('');
    const later = ref<AdminInvoiceRegisterPage[]>([]);

    const asked = (): InvoiceRegisterMonths => {
        const months: InvoiceRegisterMonths = {};
        if (from.value !== '') months.from = from.value;
        if (until.value !== '') months.until = until.value;
        return months;
    };

    const refusal = computed<string | null>(() => {
        const months = asked();
        const given = months.from ?? months.until;
        if (given === undefined) return null;
        if (
            ![months.from, months.until].every(
                (each) => each === undefined || isCalendarMonth(each),
            )
        ) {
            return msg.value.monthInvalid;
        }
        // The day stands in only for a month left out, which the span reads as
        // the other one; it never decides anything here.
        const { refusal: refused } = invoiceRegisterSpanOf(months, `${given}-01`);
        if (!refused) return null;
        return catalogueSentenceFor(refused, errors.value.codes) ?? errors.value.validation;
    });

    // The months the page on screen was read for, as the platform answered
    // them, while no other read is on its way: filling the inputs with them is
    // not a change of what is asked. A read started for other months clears
    // it, so turning back to these while that read is out reads them again —
    // otherwise its answer, the newest, would stand under months it was not
    // read for.
    let readFor: string | null = null;
    // Every read of the first page counts, so a later page can tell whether it
    // still continues the list on screen.
    let firstReads = 0;
    const first = useAsyncData<AdminInvoiceRegisterPage | null>(
        async () => {
            firstReads += 1;
            const read = firstReads;
            later.value = [];
            readFor = null;
            if (refusal.value !== null) return null;
            const page = await invoices.list(asked());
            if (read === firstReads) {
                readFor = spanKeyOf({ from: page.from, until: page.until });
                if (from.value === '') from.value = page.from;
                if (until.value === '') until.value = page.until;
            }
            return page;
        },
        { initial: null },
    );
    const sums = useAsyncData<AdminInvoiceRegisterTotals | null>(
        () => (refusal.value === null ? invoices.totals(asked()) : Promise.resolve(null)),
        { initial: null },
    );

    async function reload(): Promise<void> {
        await Promise.all([first.reload(), sums.reload()]);
    }

    watch([from, until], () => {
        if (spanKeyOf(asked()) === readFor) return;
        void reload();
    });

    const pages = computed(() =>
        first.data.value ? [first.data.value, ...later.value] : later.value,
    );
    const rows = computed(() => pages.value.flatMap((page) => page.invoices));
    // Indexed rather than `.at(-1)`: the shipped source compiles at ES2021.
    const nextAfter = (): string | null => pages.value[pages.value.length - 1]?.next ?? null;

    // A button's handler: a failure is shown with the list rather than thrown
    // into nowhere.
    async function more(): Promise<void> {
        const after = nextAfter();
        if (!after) return;
        const read = firstReads;
        try {
            const page = await invoices.list({ ...asked(), after });
            if (read === firstReads && nextAfter() === after) later.value = [...later.value, page];
        } catch (err: unknown) {
            // A failure of a page for months no longer on screen says nothing
            // about the ones that are.
            if (read === firstReads) first.error.value = toAdminError(err);
        }
    }

    return {
        from,
        until,
        refusal,
        rows,
        totals: computed(() => sums.data.value),
        loading: computed(() => first.pending.value || sums.pending.value),
        error: computed(() => first.error.value ?? sums.error.value),
        hasMore: computed(() => nextAfter() !== null),
        reload,
        more,
    };
}
