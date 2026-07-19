// FeatureUiMeta — Konsumenten-spezifische UI-Metadaten je FeatureKey.
//
// Wird vom Konsumenten beim `forRoot({ featureUiRegistry })` injiziert und
// vom `GET /billing/feature-registry`-Endpoint 1:1 ausgeliefert. Plattform
// bleibt domain-agnostisch — AutohausPro liefert KFZ-Begriffe (icon:
// 'directions_car'), vereinsfux liefert Vereins-Begriffe (icon: 'groups').

export interface FeatureUiMeta {
    /** Sichtbarer Label für Plan-Vergleichs-Tabellen, Add-on-Listen. */
    label: string;
    /** Lange Beschreibung für Tooltips, Add-on-Karten. */
    description: string;
    /** Quasar-Icon-Name (z. B. 'directions_car', 'groups'). */
    icon: string;
    /** Spiegel von `PlanCatalog.features[].plannedOnly` — Cache für UI ohne Catalog-Roundtrip. */
    plannedOnly?: boolean;
    /** true = Basis-Infrastruktur, in jedem Plan enthalten (nicht buchbar). */
    core?: boolean;
}

/** Map FeatureKey → UI-Metadaten. Konsument-Apps liefern eine vollständige Tabelle. */
export type FeatureUiRegistry = Record<string, FeatureUiMeta>;
