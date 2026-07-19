// CapabilityCatalogEntryRow / FeatureCatalogEntryRow / MarketingProjectionRow
// — Wire-Format der Catalog-Entries-Tabellen.
//
// Diese Typen sind die HTTP-Projektion der Prisma-Models aus
// `saas-platform-spec/prisma-fragments/06-catalog-entries.prisma`. Sie werden
// vom AdminController für die SuperAdmin-Pages „Discovery" + „Marketing-
// Catalog" geliefert sowie vom Public-Catalog-Controller für `/public/catalog`.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §3 + §5

// =============================================================================
// Discovery-Lifecycle (Freigabe je Feature + Quota, #20)
// =============================================================================

/**
 * Freigabe-Lebenszyklus eines Features oder einer Quota. Freigegeben wird
 * je FEATURE/QUOTA — nicht je Capability (#20); nur `approved`-Einträge
 * sind verkaufbar (Gate in strict-mode-check/seed-gate/preflight).
 *
 * - `pending`  — im Code gefunden, noch nicht freigegeben; steht der
 *                 Planung nicht zur Verfügung
 * - `approved` — vom SuperAdmin für Pläne, Bundles & Marketing freigegeben;
 *                 die Approval-Signatur friert den Code-Stand ein
 * - `outdated` — Drift: die Implementierung hat sich seit der Freigabe
 *                 geändert (Approval-Signatur ≠ aktueller Snapshot) oder
 *                 manuell als veraltet markiert — erneut freigeben
 * - `obsolete` — abgekündigt bzw. aus dem Code entfernt; in neuen Plänen
 *                 nicht mehr verwenden
 *
 * Ein „ersetzt durch X" (#39) ist bewusst KEIN eigener Status-Wert: die Union
 * wird exhaustiv konsumiert (Review-Automat als `Record<DiscoveryStatus, …>`,
 * Status-Badges im AdminUI, Status-Spalten in den Konsumenten-DBs) — ein
 * neuer Wert würde Lockstep-Migrationen über alle Konsumenten erzwingen.
 * Stattdessen: `obsolete` + `successorKey` als Nachfolger-Pointer; alte
 * Leser degradieren graceful (sehen weiterhin `obsolete`).
 */
export type DiscoveryStatus = 'pending' | 'approved' | 'outdated' | 'obsolete';

/**
 * Code-Status einer Capability — read-only Code-Fakt aus dem Scan (#20):
 * `active`/`experimental`/`deprecated` kommen aus dem Decorator, `retired`
 * setzt der Sync, wenn die Capability aus dem Code verschwunden ist.
 * Capabilities tragen keinen Review-Status mehr; die fachliche Freigabe
 * liegt am Feature/an der Quota.
 */
export type CapabilityCodeStatus = 'active' | 'experimental' | 'deprecated' | 'retired';

/**
 * Implementierungs-Art einer Capability — entspricht `kind` im
 * `@ImplementsCapability(...)`-Decorator.
 */
export type CapabilityKind = 'endpoint' | 'service' | 'job' | 'event';

/**
 * Enforcement-Modus einer Quota:
 * - `hard` — Überschreitung blockt fachlich (entspricht Policy `hardCap`)
 * - `soft` — Überschreitung wird nur gezählt/gewarnt
 */
export type QuotaEnforcementMode = 'hard' | 'soft';

/**
 * Locale-spezifische Übersetzungs-Felder eines Catalog-Entry. Leere/fehlende
 * Felder fallen im UI auf die Default-Locale (`de`) zurück. `unit` ist nur
 * für Quotas relevant.
 */
export interface CatalogEntryI18nFields {
    label?: string;
    description?: string;
    unit?: string;
}

/** `{ 'en': { label, description }, 'tr': { … } }` — Default-Locale fehlt bewusst. */
export type CatalogEntryI18n = Record<string, CatalogEntryI18nFields>;

// =============================================================================
// CapabilityCatalogEntry
// =============================================================================

/**
 * SuperAdmin-Projektion einer code-deklarierten Capability. Die fachliche
 * Wahrheit (existiert / existiert nicht) bleibt im Code; diese Tabelle hält
 * den Code-Status (read-only Fakt, #20) und denormalisierte Aggregations-
 * Hüllen für UI-Lookups. Die Freigabe liegt am Feature/an der Quota.
 */
export interface CapabilityCatalogEntryRow {
    id: string;
    projectKey: string;
    capabilityKey: string;
    label: string;
    description: string | null;

    /** Aggregations-Hülle aus dem Decorator (denormalisiert für UI-Lookup). */
    featureKey: string | null;
    /** Aggregations-Hülle aus dem Decorator (denormalisiert). */
    bundleKey: string | null;

    codeStatus: CapabilityCodeStatus;
    /** Code-Owner-Tag aus dem Decorator (z. B. 'accounting'). */
    owner: string | null;
    kind: CapabilityKind;

    /** Bei codeStatus = 'deprecated' empfohlen. */
    replacementKey: string | null;
    deprecatedAt: string | null;
    removalPlannedAt: string | null;
    reason: string | null;

    /** Locale-Übersetzungen (Discovery-Übersetzungs-Tab, SPEC_V2 §6.3). */
    i18n: CatalogEntryI18n;

    sortOrder: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

// =============================================================================
// FeatureCatalogEntry
// =============================================================================

/**
 * Tier-Hint für Comparison-Matrix-Sortierung. Konvention:
 * `CORE` < `ADVANCED` < `PRO` < `ENTERPRISE`. Apps dürfen weitere
 * Tiers ergänzen; die Sortierung erfolgt dann über `FeatureCatalogEntry.sortOrder`.
 */
export type FeatureTier = 'CORE' | 'ADVANCED' | 'PRO' | 'ENTERPRISE' | string;

/**
 * SuperAdmin-Projektion eines Features (Aggregation aus Capabilities, die im
 * Decorator `feature: 'XYZ'` deklarieren). Marketing-Kurzform liegt hier;
 * Locale-spezifische lange Texte in MarketingProjectionRow.
 */
export interface FeatureCatalogEntryRow {
    id: string;
    projectKey: string;
    featureKey: string;
    label: string;
    description: string | null;

    /** Marketing-Kurzlabel für Sidebar / Comparison-Matrix. */
    marketingLabel: string | null;
    /** Marketing-Kurzbeschreibung. Für lange Locale-Texte: MarketingProjectionRow. */
    marketingDescription: string | null;
    icon: string | null;

    tier: FeatureTier | null;
    discoveryStatus: DiscoveryStatus;

    /** Code-discoverte Feature-Abhängigkeiten (#35) — leere Liste = keine. */
    requires: string[];
    /** Alte Feature-Keys, die dieses Feature ablöst (#39) — leere Liste = keine. */
    replaces: string[];
    /**
     * Nachfolger-Pointer (#39): gesetzt, wenn dieser Key aus dem Code
     * verschwunden ist UND ein anderer Snapshot-Key ihn via `replaces`
     * beansprucht — „ersetzt durch X = geführte Migration" statt nacktem
     * `obsolete` (= gelöscht ohne Ersatz).
     */
    successorKey: string | null;

    /** Zeitpunkt der letzten Freigabe; `null` solange nie freigegeben. */
    approvedAt: string | null;
    /** User-ID des freigebenden SuperAdmins. */
    approvedBy: string | null;
    /**
     * Signatur des Capability-Sets zum Freigabe-Zeitpunkt
     * (`capabilityKey@codeStatus`, sortiert, `|`-separiert). Der Auto-Sync
     * vergleicht sie gegen den aktuellen Snapshot — bei Abweichung wird
     * `approved` → `outdated` (Drift, #20).
     */
    approvedSignature: string | null;

    /**
     * `true` = Feature ist im SuperAdmin-Plan geplant, aber noch nicht im
     * Code implementiert. Der blocking Strict-Mode-Check (SPEC_V2 §8.1)
     * lehnt Plan-Publish mit `plannedOnly`-Features ab.
     */
    plannedOnly: boolean;

    /** true = Basis/immer enthalten (nicht pro Plan buchbar). */
    core: boolean;

    /** Locale-Übersetzungen (Discovery-Übersetzungs-Tab, SPEC_V2 §6.3). */
    i18n: CatalogEntryI18n;

    sortOrder: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

// =============================================================================
// QuotaCatalogEntry
// =============================================================================

/**
 * SuperAdmin-Projektion einer code-deklarierten Quota (`@DefinesQuota`).
 * Trägt den Review-Status sowie die Deploy-Relevanz: eine harte Quota
 * ohne `usageProvider` ist nicht deploy-fähig (SPEC_V2 §6.3, Preflight).
 */
export interface QuotaCatalogEntryRow {
    id: string;
    projectKey: string;
    quotaKey: string;
    label: string;
    description: string | null;

    /** Anzeige-Einheit, z. B. `members`, `GB`, `/month`. */
    unit: string;
    /** Aggregations-Hülle aus dem Decorator (denormalisiert). */
    featureKey: string | null;

    /**
     * Klasse, die die Quota via `@DefinesQuota` deklariert (= UsageProvider).
     * `null` = die Quota wird referenziert (`@EnforceQuota`), aber von keiner
     * Klasse bereitgestellt — bei `enforcementMode: 'hard'` deploy-blockend.
     */
    usageProvider: string | null;
    enforcementMode: QuotaEnforcementMode;

    discoveryStatus: DiscoveryStatus;

    /** Alte QuotaKeys, die diese Quota ablöst (#39) — leere Liste = keine. */
    replaces: string[];
    /** Nachfolger-Pointer (#39), analog `FeatureCatalogEntryRow.successorKey`. */
    successorKey: string | null;

    /** Zeitpunkt der letzten Freigabe; `null` solange nie freigegeben. */
    approvedAt: string | null;
    /** User-ID des freigebenden SuperAdmins. */
    approvedBy: string | null;
    /**
     * Signatur der code-abgeleiteten Quota-Fakten zum Freigabe-Zeitpunkt
     * (`unit|enforcementMode|usageProvider|featureKey`). Der Auto-Sync
     * vergleicht sie gegen den aktuellen Snapshot — bei Abweichung wird
     * `approved` → `outdated` (Drift, #20).
     */
    approvedSignature: string | null;

    /** Locale-Übersetzungen (`label`, `unit`, `description`). */
    i18n: CatalogEntryI18n;

    sortOrder: number;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

// =============================================================================
// Catalog-Entry-Service-DTOs (Review / Sync / i18n)
// =============================================================================

/**
 * Filter für `CatalogEntryRepository.list*()`. `discoveryStatus` gilt für
 * Features/Quotas, `codeStatus` für Capabilities — je Liste ist nur das
 * passende Feld relevant.
 */
export interface CatalogEntryFilter {
    projectKey: string;
    discoveryStatus?: DiscoveryStatus;
    codeStatus?: CapabilityCodeStatus;
}

/**
 * Body von `PATCH …/{features,quotas}/:key/review` — der Ziel-Status des
 * Freigabe-Automaten. Erlaubte Übergänge validiert der Service
 * (`pending → approved/obsolete`, `approved → pending/outdated/obsolete`,
 * `outdated → approved/pending/obsolete`, `obsolete → pending`).
 */
export interface ReviewCatalogEntryData {
    discoveryStatus: DiscoveryStatus;
}

/**
 * Approved-Gate (#20 Slice 5): die Mengen der freigegebenen Feature-/
 * Quota-Keys (`discoveryStatus = 'approved'`) aus den Catalog-Entries.
 * Strict-Mode-Check, Seed-Gate und Preflight prüfen damit „nur Approved
 * ist verkaufbar" — `null`/weggelassen überspringt den Approval-Teil
 * (z. B. wenn kein CatalogEntryRepository registriert ist).
 */
export interface ApprovedCatalogKeys {
    features: ReadonlySet<string>;
    quotas: ReadonlySet<string>;
}

/** Body von `PATCH …/{features,quotas}/:key/i18n`. */
export interface UpdateCatalogEntryI18nData {
    /** Vollständiger i18n-Baum — ersetzt den bestehenden. */
    i18n: CatalogEntryI18n;
}

/**
 * Body von `PATCH …/{features,quotas}/:key` — editierbare Basis-/Default-
 * Locale-Felder (`de`). Quotas: `unit` bleibt code-abgeleitet und ist nicht
 * editierbar — pro Locale aber via `i18n` übersetzbar.
 */
export interface UpdateCatalogEntryBaseData {
    label?: string;
    description?: string | null;
    /** Feature-only (#13): statisches Default-Icon (Quasar-Icon-Name). Quotas ignorieren es. */
    icon?: string | null;
    /** Feature-only (#13): Tier-Hint (offene Union). Quotas ignorieren es. */
    tier?: FeatureTier | null;
}

/**
 * Ergebnis von `POST …/discovery/sync` — Zähler für die UI.
 * `discovered`/`retired` sind Scan-Ereignisse (neu im Code / aus dem Code
 * verschwunden); `outdated` zählt `approved`-Einträge, die der Sync wegen
 * Signatur-Drift auf `outdated` gekippt hat (#20). `replaced` zählt
 * Einträge, denen der Sync in diesem Lauf einen Nachfolger-Pointer
 * (`successorKey`) gesetzt hat (#39).
 */
export interface SyncDiscoveryResult {
    capabilities: { discovered: number; retired: number; total: number };
    features: {
        discovered: number;
        retired: number;
        outdated: number;
        replaced: number;
        total: number;
    };
    quotas: {
        discovered: number;
        retired: number;
        outdated: number;
        replaced: number;
        total: number;
    };
}

// =============================================================================
// MarketingProjection
// =============================================================================

/**
 * Polymorpher Ziel-Typ einer MarketingProjection. Verweist auf die
 * versionierte Entität (Plan-, Bundle- oder BusinessType-Version), die
 * öffentlich vermarktet wird.
 */
export type MarketingTargetType = 'PLAN' | 'BUNDLE' | 'BUSINESS_TYPE';

/**
 * Ein Top-Feature-Eintrag in der Public-Catalog-Karte.
 *
 * - `key` — optionale Referenz auf einen Feature-/Quota-Key. Ist `key`
 *   gesetzt und `label` leer, wird das angezeigte Label aus dem
 *   `FeatureCatalogEntry`/`QuotaCatalogEntry` in der jeweiligen Locale
 *   aufgelöst (übersetzt). So bleibt die Karte sprach-reaktiv.
 * - `label` — Fließtext bzw. Override; leer + `key` gesetzt = Auto-Label.
 * - `strong` — optionaler fett gesetzter Zusatz (z. B. "bis 100", "5 GB").
 */
export interface MarketingTopFeature {
    key?: string;
    label: string;
    strong: string;
}

/**
 * Locale-spezifische Marketing-Texte pro Plan-/Bundle-/BusinessType-Version.
 * Wird vom Public-Catalog-Controller (`GET /public/catalog?locale=de`)
 * gelesen und projiziert.
 *
 * Polymorphe Referenz über (`targetType`, `targetVersionId`) — kein FK,
 * App-Logik prüft die Existenz beim Lesen.
 */
export interface MarketingProjectionRow {
    id: string;
    projectKey: string;

    targetType: MarketingTargetType;
    targetVersionId: string;

    /** ISO-639-1, ggf. mit Region-Suffix (`de`, `en`, `de-AT`). */
    locale: string;

    displayLabel: string;
    description: string;

    /**
     * Sichtbarkeit im Public-Catalog. `false` = die Projektion existiert,
     * der Plan wird aber nicht auf der Pricing-Page gezeigt (z. B. während
     * der Vorbereitung).
     */
    visible: boolean;

    /**
     * Optionales Badge oben auf der Karte (z. B. "Beliebt", "Neu"). Leerer
     * String = kein Badge.
     */
    badge: string;

    /**
     * Top-Features, die prominent auf der Public-Catalog-Karte erscheinen.
     * Reihenfolge ist die Anzeige-Reihenfolge.
     */
    topFeatures: MarketingTopFeature[];

    /** Kostenlose Testphase aktiv — steuert den automatischen CTA-Text. */
    trialEnabled: boolean;
    /** Länge der Testphase in Tagen (nur relevant bei `trialEnabled`). */
    trialDays: number;

    /**
     * Optional formatted Pricing-Tag (z. B. "€ 9,90 / Monat" oder "auf
     * Anfrage"). null = Pricing wird automatisch aus PlanVersion.monthlyNet
     * etc. zur Render-Zeit formatiert.
     */
    priceTag: string | null;

    /**
     * Überschreibt den automatisch generierten Call-to-Action-Text
     * (z. B. "Kontakt aufnehmen"). null = Auto-Text aus Trial/Pricing.
     */
    ctaLabel: string | null;

    /** Sortierung in der Public-Liste (DESC). Höhere Werte zuerst. */
    priority: number;
    /** "Empfohlen"-Stern bzw. Featured-Hervorhebung in der UI. */
    highlight: boolean;

    createdAt: string;
    updatedAt: string;
}

// =============================================================================
// MarketingProjection-Service-DTOs (Create/Update/Filter)
// =============================================================================

/** Filter für `MarketingProjectionRepository.list()`. Mindestens projectKey. */
export interface MarketingProjectionFilter {
    projectKey: string;
    targetType?: MarketingTargetType;
    targetVersionId?: string;
    locale?: string;
}

export interface CreateMarketingProjectionData {
    projectKey: string;
    targetType: MarketingTargetType;
    targetVersionId: string;
    locale?: string;
    displayLabel: string;
    description: string;
    visible?: boolean;
    badge?: string;
    topFeatures?: MarketingTopFeature[];
    trialEnabled?: boolean;
    trialDays?: number;
    priceTag?: string | null;
    ctaLabel?: string | null;
    priority?: number;
    highlight?: boolean;
}

export interface UpdateMarketingProjectionData {
    displayLabel?: string;
    description?: string;
    visible?: boolean;
    badge?: string;
    topFeatures?: MarketingTopFeature[];
    trialEnabled?: boolean;
    trialDays?: number;
    priceTag?: string | null;
    ctaLabel?: string | null;
    priority?: number;
    highlight?: boolean;
}
