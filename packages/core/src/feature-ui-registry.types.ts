// FeatureUiMeta — consumer-specific UI metadata per FeatureKey.
//
// Injected by the consumer via `forRoot({ featureUiRegistry })` and
// served 1:1 by the `GET /billing/feature-registry` endpoint. The platform
// stays domain-agnostic — a car-dealership app supplies automotive terms
// (icon: 'directions_car'), a club app supplies club terms (icon: 'groups').

export interface FeatureUiMeta {
    /** Visible label for plan comparison tables, add-on lists. */
    label: string;
    /** Long description for tooltips, add-on cards. */
    description: string;
    /** Quasar icon name (e.g. 'directions_car', 'groups'). */
    icon: string;
    /** Mirror of `PlanCatalog.features[].plannedOnly` — cache for the UI without a catalog roundtrip. */
    plannedOnly?: boolean;
    /** true = base infrastructure, included in every plan (not bookable). */
    core?: boolean;
    /**
     * Set where the feature is withdrawn now or from a date ahead: each
     * withdrawal of it not over yet, the earliest first — why, from when, and
     * until when where it is lifted from a date ahead. A feature withdrawn
     * again from the day it returns carries both. A page that shows the
     * feature as part of a plan or an add-on shows this beside it, so whoever
     * concludes knows before they do.
     */
    withdrawn?: readonly FeatureWithdrawalMark[];
}

/** One withdrawal of a feature, as a catalogue marks it beside the feature. */
export interface FeatureWithdrawalMark {
    readonly reason: string;
    /** ISO 8601. */
    readonly effectiveFrom: string;
    /** ISO 8601, where it is lifted from a date ahead. */
    readonly liftedFrom: string | null;
}

/** Map FeatureKey → UI metadata. Consumer apps supply a complete table. */
export type FeatureUiRegistry = Record<string, FeatureUiMeta>;
