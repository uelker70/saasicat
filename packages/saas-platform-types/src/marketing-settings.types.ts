// MarketingSettings — projekt-weite, runtime-editierbare Marketing-Konfig
// (SPEC_V2 §6.5). Aktuell genau ein Feld: `activeLocales` — die im
// Marketing-Catalog aktivierte Teilmenge des `availableLocales`-Pools
// (der Pool selbst kommt aus der app-config `saas.yaml`).
//
// Eine Row pro Projekt (`projectKey` unique). Fehlt die Row, gilt der
// volle Pool als aktiv.
//
// Spec: yada-services/handoff/superadmin/SPEC_V2.md §6.5

/** Wire-Format der `marketing_settings`-Row. */
export interface MarketingSettingsRow {
    projectKey: string;
    /** Runtime-aktivierte Teilmenge des `availableLocales`-Pools. */
    activeLocales: string[];
    updatedAt: string;
}

/** Body von `PUT /admin/catalog/marketing-settings`. */
export interface UpdateMarketingSettingsData {
    activeLocales: string[];
}
