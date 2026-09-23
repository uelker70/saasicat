// A plan catalogue the operator publishes into while the services reading it
// are already running — what the database source is in production, without a
// database.
//
// Every `current()` answers what has been published up to that moment, and
// counts, so a test can also say how often one operation read.
//
// A test lets the service read once before the operator changes anything. A
// service that keeps its first reading is then caught; one whose first read
// happens after the change would pass whether it keeps it or not.

/** A `PlanCatalogSource` over `catalog`, with the operator's hand on it. */
export function publishingCatalogue(catalog) {
    let state = structuredClone(catalog);
    const source = {
        origin: 'database',
        reads: 0,
        async current() {
            source.reads++;
            return structuredClone(state);
        },
    };
    const plans = () => state.plans ?? [];
    return {
        source,
        /** A new plan, or a new version of one: it replaces the plan in its place in the order. */
        publish(plan) {
            const at = plans().findIndex((existing) => existing.id === plan.id);
            const next = [...plans()];
            if (at === -1) next.push(plan);
            else next[at] = plan;
            state = { ...state, plans: next };
        },
        retire(planId) {
            state = { ...state, plans: plans().filter((plan) => plan.id !== planId) };
        },
        markPlannedOnly(featureKey) {
            state = {
                ...state,
                features: (state.features ?? []).map((feature) =>
                    feature.key === featureKey ? { ...feature, plannedOnly: true } : feature,
                ),
            };
        },
    };
}
