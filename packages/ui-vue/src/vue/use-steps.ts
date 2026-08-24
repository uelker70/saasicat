import { computed, nextTick, ref, type ComputedRef, type Ref } from 'vue';

/** Where a step sits relative to the one in progress. */
export type StepStatus = 'done' | 'current' | 'upcoming';

export interface UseStepsOptions<TStep extends string> {
    /** The steps, in order. The first is where the wizard starts. */
    steps: readonly TStep[];
    /**
     * Whether the wizard may leave this step forwards. Called on every `next()`
     * and read by `canAdvance`, so a button can be disabled by the same
     * predicate that refuses the move — one answer, not two.
     */
    canLeave?: (step: TStep) => boolean;
}

export interface Steps<TStep extends string> {
    readonly current: Ref<TStep>;
    readonly index: ComputedRef<number>;
    readonly isFirst: ComputedRef<boolean>;
    readonly isLast: ComputedRef<boolean>;
    /** False on the last step, and whenever the guard refuses. */
    readonly canAdvance: ComputedRef<boolean>;
    /** Bind on the current step's heading. Focus lands here after a move. */
    readonly headingRef: Ref<HTMLElement | null>;
    /** Put on that heading: focusable by script, not in the tab order. */
    readonly headingProps: Record<string, string>;
    statusOf(step: TStep): StepStatus;
    /** Moves forward. Returns whether it did — the guard may refuse. */
    next(): boolean;
    /** Moves back. Returns whether it did. */
    back(): boolean;
    /** Back to the first step, for reopening the wizard. */
    reset(): void;
}

/**
 * A linear wizard's position, its guard, and where focus goes when it moves.
 *
 * The focus move is the part that has no visual output and therefore no
 * baseline: pressing "next" replaces the panel, and the button that was
 * pressed is gone. Without moving focus deliberately it falls to `<body>` and
 * a screen reader says nothing at all — the step changed and the user was not
 * told. So every successful move puts focus on the new step's heading, which
 * is the one element that says where they now are.
 *
 * The step HEADER is a progress list here rather than a set of controls, and
 * that is not a reduction: Quasar's `q-stepper` only makes its header
 * navigable under `header-nav`, which this wizard never set. Turning the
 * header into buttons would be adding a control the wizard never had, in the
 * step where its framework is being removed.
 */
export function useSteps<TStep extends string>(options: UseStepsOptions<TStep>): Steps<TStep> {
    const { steps } = options;
    if (steps.length === 0) throw new Error('useSteps needs at least one step');

    const first = steps[0]!;
    const current = ref(first) as Ref<TStep>;
    const headingRef = ref<HTMLElement | null>(null);

    const index = computed(() => steps.indexOf(current.value));
    const isFirst = computed(() => index.value <= 0);
    const isLast = computed(() => index.value === steps.length - 1);
    const canAdvance = computed(() => !isLast.value && mayLeave(current.value));

    function mayLeave(step: TStep): boolean {
        return options.canLeave?.(step) ?? true;
    }

    function moveTo(step: TStep): void {
        current.value = step;
        // The heading belongs to the panel this move renders, so it does not
        // exist yet on the tick the move happens.
        void nextTick(() => headingRef.value?.focus());
    }

    return {
        current,
        index,
        isFirst,
        isLast,
        canAdvance,
        headingRef,
        headingProps: { tabindex: '-1' },

        statusOf(step) {
            const at = steps.indexOf(step);
            if (at < index.value) return 'done';
            if (at === index.value) return 'current';
            return 'upcoming';
        },

        next() {
            if (!canAdvance.value) return false;
            moveTo(steps[index.value + 1]!);
            return true;
        },

        back() {
            if (isFirst.value) return false;
            moveTo(steps[index.value - 1]!);
            return true;
        },

        reset() {
            current.value = first;
        },
    };
}
