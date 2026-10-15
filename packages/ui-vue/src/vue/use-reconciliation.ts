// The reconciliation page's list: the cases open or closed, a page at a time,
// and closing one with a note.
//
// A composable rather than page script, so the sequence — second factor,
// write, reload — and its failure states can be checked with `node --test`
// against `dist/`. The resource and the second-factor prompt are handed in:
// this layer knows no Quasar, and the page renders the prompt's dialog.
//
// Closing goes through a form dialog, whose submit is the note, and then asks
// for the second factor: it declares a mismatch of money reconciled for good.

import { computed, ref, type ComputedRef, type Ref } from 'vue';
import type {
    AdminReconciliationCase,
    AdminReconciliationCases,
    ReconciliationCaseState,
} from '@saasicat/core';

import { toAdminError, type AdminError } from '../client/admin-error.js';
import type { Bound } from '../client/resources/define-resource.js';
import type { reconciliationResource } from '../client/resources/reconciliation.resource.js';
import type { MfaPrompt } from './use-mfa-prompt.js';
import { useAsyncData } from './use-async-data.js';
import { useSaMessages } from './use-super-admin-i18n.js';

/** The operations the page calls, already bound to the shell's client. */
export type ReconciliationResource = Bound<(typeof reconciliationResource)['ops']>;

export interface ReconciliationState {
    /** Which cases are listed; changing it reads them from the first page. */
    state: Ref<ReconciliationCaseState>;
    /** The cases read so far, the oldest first. */
    rows: ComputedRef<AdminReconciliationCase[]>;
    loading: Ref<boolean>;
    /** The last load's failure, or null. */
    error: Ref<AdminError | null>;
    /** Whether a further page is there to read. */
    hasMore: ComputedRef<boolean>;
    reload(): Promise<void>;
    /** Reads the next page and adds it; a page read for another state is dropped. */
    more(): Promise<void>;
    /**
     * Closes `row` with `note` behind the second factor, for a form dialog's
     * `submit`: rejects with the refusal, so the dialog keeps the form and
     * shows why, and resolves `null` where the operator stepped back from the
     * second factor.
     */
    close(row: AdminReconciliationCase, note: string): Promise<AdminReconciliationCase | null>;
}

const EMPTY: AdminReconciliationCases = { cases: [], next: null };

export function useReconciliation(
    reconciliation: Pick<ReconciliationResource, 'cases' | 'close'>,
    mfa: Pick<MfaPrompt, 'run'>,
): ReconciliationState {
    const msg = useSaMessages('reconciliation');
    const shell = useSaMessages('shell');
    const state = ref<ReconciliationCaseState>('open');
    const later = ref<AdminReconciliationCases[]>([]);
    const first = useAsyncData<AdminReconciliationCases>(
        () => {
            later.value = [];
            return reconciliation.cases(state.value);
        },
        { initial: EMPTY, watch: [state] },
    );
    const pages = computed(() => [first.data.value, ...later.value]);
    const rows = computed(() => pages.value.flatMap((page) => page.cases));
    // Indexed rather than `.at(-1)`: the shipped source compiles at ES2021.
    const nextAfter = (): string | null => pages.value[pages.value.length - 1]?.next ?? null;
    const hasMore = computed(() => nextAfter() !== null);

    // A button's handler: a failure is shown with the list rather than thrown
    // into nowhere.
    async function more(): Promise<void> {
        const asked = state.value;
        const after = nextAfter();
        if (!after) return;
        try {
            const page = await reconciliation.cases(asked, after);
            if (state.value === asked && nextAfter() === after) {
                later.value = [...later.value, page];
            }
        } catch (err: unknown) {
            first.error.value = toAdminError(err);
        }
    }

    async function close(
        row: AdminReconciliationCase,
        note: string,
    ): Promise<AdminReconciliationCase | null> {
        const outcome = await mfa.run(msg.value.mfaClose, shell.value.mfa.invalidCode, (code) =>
            reconciliation.close(row.id, note, code),
        );
        if (!outcome.done) return null;
        await first.reload();
        return outcome.value;
    }

    return {
        state,
        rows,
        loading: first.pending,
        error: first.error,
        hasMore,
        reload: first.reload,
        more,
        close,
    };
}
