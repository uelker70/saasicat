// MarketingSettings — project-wide, runtime-editable marketing config
// (SPEC_V2 §6.5). Currently exactly one field: `activeLocales` — the subset
// of the `availableLocales` pool that is activated in the marketing catalog
// (the pool itself comes from the app-config `saas.yaml`).
//
// One row per project (`projectKey` unique). If the row is missing, the
// full pool is considered active.

/** Wire format of the `marketing_settings` row. */
export interface MarketingSettingsRow {
    projectKey: string;
    /** Runtime-activated subset of the `availableLocales` pool. */
    activeLocales: string[];
    updatedAt: string;
}

/** Body of `PUT /admin/catalog/marketing-settings`. */
export interface UpdateMarketingSettingsData {
    activeLocales: string[];
}
