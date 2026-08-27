// MarketingSettings — installation-wide, runtime-editable marketing config
//. Currently exactly one field: `activeLocales` — the subset
// of the `availableLocales` pool that is activated in the marketing catalog
// (the pool itself comes from the app-config `saas.yaml`).
//
// At most one row. If it is missing, the full pool is considered active.

/** Wire format of the `marketing_settings` row. */
export interface MarketingSettingsRow {
    /** Runtime-activated subset of the `availableLocales` pool. */
    activeLocales: string[];
    updatedAt: string;
}

/** Body of `PUT /admin/catalog/marketing-settings`. */
export interface UpdateMarketingSettingsData {
    activeLocales: string[];
}
