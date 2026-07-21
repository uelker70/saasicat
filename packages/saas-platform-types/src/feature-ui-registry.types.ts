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
}

/** Map FeatureKey → UI metadata. Consumer apps supply a complete table. */
export type FeatureUiRegistry = Record<string, FeatureUiMeta>;
