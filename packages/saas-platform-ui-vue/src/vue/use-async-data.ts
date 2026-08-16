// One async read, with the state a page otherwise writes by hand.
//
// The counterpart to `useAsyncAction`: that one is for something the operator
// set off, this one is for something the page needs in order to render. The
// difference shows in what happens on failure — an action reports and stops,
// a read has to leave the page in a state it can still draw.
//
// On failure `data` goes back to `initial`. That is what `useApiList` already
// does (it resets `items` to `[]` and `total` to 0), and it is the safer of the
// two options: stale rows under an error message read as current data, and
// nothing on the page says which reload they came from.

import { ref, watch, type Ref, type WatchSource } from 'vue';

import { toAdminError, type AdminError } from '../client/admin-error.js';

export interface AsyncData<T> {
    /** The loaded value, or `initial` before the first load and after a failure. */
    data: Ref<T>;
    /** True while a load is in flight. */
    pending: Ref<boolean>;
    /** The last failure, or `null`. Cleared at the start of every load. */
    error: Ref<AdminError | null>;
    /** Loads again — after a mutation, or from a retry button. */
    reload: () => Promise<void>;
}

export interface UseAsyncDataOptions<T> {
    /** Value before the first load, and the value restored when one fails. */
    initial: T;
    /** Load once on creation. Default `true`. */
    immediate?: boolean;
    /** Reload whenever any of these changes — a filter, a selected row, a locale. */
    watch?: WatchSource[];
}

export function useAsyncData<T>(
    fn: () => Promise<T>,
    options: UseAsyncDataOptions<T>,
): AsyncData<T> {
    const data = ref(options.initial) as Ref<T>;
    const pending = ref(false);
    const error = ref<AdminError | null>(null);

    // Which load is the current one. A watched source that changes twice in
    // quick succession starts a second request before the first answers, and
    // without this the loser writes last: the older result overwrites the
    // newer, its `finally` clears `pending` while the newer request is still
    // running, and — worst — its `catch` resets `data` to `initial` and raises
    // an error for a filter the operator has already left.
    let generation = 0;

    async function reload(): Promise<void> {
        const mine = ++generation;
        pending.value = true;
        error.value = null;
        try {
            const result = await fn();
            if (mine !== generation) return;
            data.value = result;
        } catch (err: unknown) {
            if (mine !== generation) return;
            error.value = toAdminError(err);
            data.value = options.initial;
        } finally {
            // Only the newest load owns the flag; a superseded one leaving it
            // false would announce a page that is still loading as settled.
            if (mine === generation) pending.value = false;
        }
    }

    if (options.watch?.length) {
        watch(options.watch, () => void reload());
    }

    if (options.immediate !== false) {
        // One microtask later, so the composable does not block `setup()`
        // during the initial synchronous phase — same reasoning as useApiList.
        void Promise.resolve().then(() => reload());
    }

    return { data, pending, error, reload };
}
