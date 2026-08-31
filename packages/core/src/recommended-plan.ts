// At most one plan in a catalogue is the recommended one — pure function.
//
// `highlight` is a boolean on a marketing projection, and a projection belongs
// to one plan version and one language, so nothing about a single row can keep
// that promise. Two ways past it, and each row is correct on its own:
//
//   - two rows in the same language carry the mark;
//   - one carries it in the default language and reaches another language
//     through the fallback that fills in a missing translation.
//
// The catalogue is where it is decidable, because only there are the live
// versions, the language that was asked for and the fallback known at once. A
// row written *for* that language outranks one inherited from the default,
// which is how every other field on a projection already resolves; failing
// that, the first plan the catalogue offers. The others keep their card and
// lose the mark.
//
// Here rather than in `@saasicat/nest` because two places answer the same
// question: the public catalogue the website reads, and the mock-up of that
// page in the SuperAdmin. A preview that previews something else is worse than
// no preview, and one rule in one file is what stops the two drifting.

/** The part of a plan card this rule reads and writes. */
export interface RecommendablePlan {
    planKey: string;
    highlight: boolean;
}

/**
 * Leaves the mark on at most one plan, in place, and returns the winner.
 *
 * `inRequestedLocale` holds the keys of the plans whose card was described in
 * the language that was asked for. Where a caller has no fallback to model —
 * the SuperAdmin edits one language at a time — passing every key, or none,
 * gives the same answer: the first plan in the list order wins.
 *
 * The list order is the caller's, and it is what the reader sees, so the
 * answer is the first recommended card on the page. Said exactly, because it
 * is easy to overstate: the tie-break inherits whatever order the caller
 * arranged, and where two plans are equal by every criterion it sorted on,
 * that order is the repository's. `PlanRepository.list` promises none, so an
 * adapter that returns rows in a different order each time would move the mark
 * between two otherwise indistinguishable plans. The shipped adapters order
 * totally.
 */
export function keepOneRecommended<T extends RecommendablePlan>(
    plans: T[],
    inRequestedLocale: ReadonlySet<string>,
): T | null {
    const recommended = plans.filter((plan) => plan.highlight);
    if (recommended.length === 0) return null;
    const winner =
        recommended.find((plan) => inRequestedLocale.has(plan.planKey)) ?? recommended[0];
    for (const plan of recommended) {
        if (plan !== winner) plan.highlight = false;
    }
    return winner;
}
