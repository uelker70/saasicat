// PLATFORM_CORE_MANIFEST_CONTRIBUTION — der generische Manifest-Spine, den jede
// SuperAdmin-Konsumenten-App mitbekommt: StandardPage-Definitionen für die
// Plattform-Pages (dashboard, tenants, plans, planVersions, audit, users, pilots),
// die generischen Tenant-Actions (suspend/reactivate/export/impersonate plus
// subscriptions.cancel und pilots.grant/revoke/extend) und die Audit-Action-
// Labels für genau diese Vorgänge.
//
// Was hier NICHT drin steht:
//   - capabilities — die App entscheidet, welche Plattform-Capability sie wirklich
//     unterstützt. Setzt sie eine Capability nicht auf `true`, filtert das
//     Frontend die zugehörige Page/Action automatisch aus.
//   - dashboard.kpiCards — Endpoints sind app-spezifisch (Pfad-Prefix unterscheidet
//     sich; KPI-Datenquellen sind App-Domänen).
//   - subscriptions/promoCodes StandardPages — beide Apps haben heute eine
//     individuelle Sicht auf diese Bereiche. Sie sind app-lokal in der eigenen
//     Contribution zu deklarieren.
//
// Apps registrieren diese Contribution nicht selbst — `AdminManifestModule.forRoot`
// hängt sie automatisch in den Service-Constructor. Wer das nicht möchte, kann
// `registerPlatformCore: false` setzen.
//
// Spec: yada-services/handoff/superadmin/SPEC.md §4

import type { ManifestContribution } from '@saasicat/types';

export const PLATFORM_CORE_MANIFEST_CONTRIBUTION: ManifestContribution = {
    navigation: {
        // Key-Reihenfolge ist Render-Reihenfolge in der Sidebar (innerhalb der
        // Section, s. `DEFAULT_NAV_SECTIONS` im nav-builder). Reihenfolge je
        // Section bewusst gepflegt:
        //   Übersicht: dashboard
        //   Produktkatalog: discovery → bundles → businessTypes → plans →
        //                   planVersions → marketingCatalog → promoCodes
        //                   (promoCodes wird von den App-Contributions
        //                   gehängt, kommt damit ans Ende der Section)
        //   Kunden: tenants → users → pilots
        //   System: audit
        standardPages: {
            dashboard: { enabled: true, requiredCapability: 'dashboard.read' },
            // SPEC_V2 §3.3 — Discovery-Snapshot des laufenden Backends.
            // Apps müssen `discovery.read` in ihren Manifest-Capabilities
            // auf `true` setzen, damit der NavBuilder die Page in die
            // Sidebar hängt; sonst wird sie automatisch ausgefiltert.
            discovery: { enabled: true, requiredCapability: 'discovery.read' },
            // SPEC_V2 §11.1 M3 — Bundle-Editor im SuperAdmin.
            // Apps mit DB-getriebenem Catalog setzen `bundles.read = true`.
            bundles: { enabled: true, requiredCapability: 'bundles.read' },
            // SPEC_V2 §11.1 M3 — BusinessType-Editor im SuperAdmin.
            // Apps mit fachlichen Vertikalen setzen `businessTypes.read = true`.
            businessTypes: {
                enabled: true,
                requiredCapability: 'businessTypes.read',
            },
            plans: { enabled: true, requiredCapability: 'plans.read' },
            planVersions: { enabled: true, requiredCapability: 'plans.read' },
            // SPEC_V2 §11.1 M3 — Marketing-Catalog (Locale-Pivot).
            // Apps mit Public-Catalog-Vermarktung setzen
            // `marketingProjections.read = true`.
            marketingCatalog: {
                enabled: true,
                requiredCapability: 'marketingProjections.read',
            },
            tenants: { enabled: true, requiredCapability: 'tenants.read' },
            users: { enabled: true, requiredCapability: 'users.read' },
            pilots: { enabled: true, requiredCapability: 'pilots.read' },
            // Audit-Log bewusst ans Ende — wird selten gebraucht, soll
            // produktive Pages nicht verdecken.
            audit: { enabled: true, requiredCapability: 'audit.read' },
            // Plattform-E-Mail-Absender (System-/Registrierungs-Mails). Apps
            // setzen `platformEmail.read = true`, damit der NavBuilder die Page
            // einhängt; sonst wird sie automatisch ausgefiltert.
            platformEmail: { enabled: true, requiredCapability: 'platformEmail.read' },
            // Plattform-E-Mail-Verlauf (Audit der versendeten System-Mails). Apps
            // setzen `platformEmailHistory.read = true`, damit der NavBuilder die
            // Page einhängt; sonst wird sie automatisch ausgefiltert.
            platformEmailHistory: {
                enabled: true,
                requiredCapability: 'platformEmailHistory.read',
            },
        },
    },
    tenants: {
        actions: [
            {
                id: 'platform.tenants.suspend',
                label: 'Mandant suspendieren',
                actionKey: 'tenants.suspend',
                requiredCapability: 'tenants.suspend',
                requiresMfa: true,
                confirmType: 'typed-slug',
            },
            {
                id: 'platform.tenants.reactivate',
                label: 'Mandant reaktivieren',
                actionKey: 'tenants.reactivate',
                requiredCapability: 'tenants.reactivate',
                requiresMfa: true,
                confirmType: 'simple',
            },
            {
                id: 'platform.tenants.impersonate',
                label: 'Impersonate',
                actionKey: 'tenants.impersonate',
                requiredCapability: 'tenants.impersonate',
                requiresMfa: true,
                confirmType: 'simple',
            },
            {
                id: 'platform.tenants.export',
                label: 'DSGVO-Export',
                actionKey: 'tenants.export',
                requiredCapability: 'tenants.export',
                requiresMfa: true,
                confirmType: 'simple',
            },
            {
                id: 'platform.subscriptions.cancel',
                label: 'Subscription kündigen',
                actionKey: 'subscriptions.cancel',
                requiredCapability: 'subscriptions.cancel',
                requiresMfa: true,
                confirmType: 'typed-slug',
            },
            {
                id: 'platform.pilots.grant',
                label: 'Pilot-Status setzen',
                actionKey: 'pilots.grant',
                requiredCapability: 'pilots.grant',
                requiresMfa: true,
                confirmType: 'simple',
            },
            {
                id: 'platform.pilots.revoke',
                label: 'Pilot-Status entziehen',
                actionKey: 'pilots.revoke',
                requiredCapability: 'pilots.revoke',
                requiresMfa: true,
                confirmType: 'typed-slug',
            },
            {
                id: 'platform.pilots.extend',
                label: 'Pilot verlängern',
                actionKey: 'pilots.extend',
                requiredCapability: 'pilots.extend',
                requiresMfa: true,
                confirmType: 'date',
            },
        ],
    },
    audit: {
        actions: [
            { key: 'TENANT_SUSPEND', label: 'Mandant suspendiert', severity: 'high' },
            { key: 'TENANT_REACTIVATE', label: 'Mandant reaktiviert', severity: 'medium' },
            { key: 'TENANT_IMPERSONATE', label: 'Impersonation gestartet', severity: 'high' },
            { key: 'TENANT_EXPORT', label: 'DSGVO-Export ausgelöst', severity: 'medium' },
            { key: 'PILOT_CREATE', label: 'Pilot-Tenant angelegt', severity: 'medium' },
            { key: 'PILOT_GRANT', label: 'Pilot-Status gesetzt', severity: 'medium' },
            { key: 'PILOT_REVOKE', label: 'Pilot-Status entzogen', severity: 'medium' },
            { key: 'PILOT_EXTEND', label: 'Pilot verlängert', severity: 'low' },
            { key: 'PLAN_VERSION_PUBLISH', label: 'Plan-Version freigegeben', severity: 'high' },
            {
                key: 'PLAN_VERSION_TERMINATE',
                label: 'Plan-Version terminiert',
                severity: 'high',
            },
            { key: 'SUBSCRIPTION_CANCEL', label: 'Subscription gekündigt', severity: 'high' },
            { key: 'USER_RESET_PASSWORD', label: 'Passwort-Reset ausgelöst', severity: 'medium' },
            { key: 'USER_DEACTIVATE', label: 'User deaktiviert', severity: 'high' },
            { key: 'USER_REASSIGN_ADMIN', label: 'Admin-Rolle übertragen', severity: 'high' },
            {
                key: 'PLATFORM_EMAIL_PROVIDER_CREATE',
                label: 'Plattform-Absender angelegt',
                severity: 'medium',
            },
            {
                key: 'PLATFORM_EMAIL_PROVIDER_UPDATE',
                label: 'Plattform-Absender geändert',
                severity: 'medium',
            },
            {
                key: 'PLATFORM_EMAIL_PROVIDER_DELETE',
                label: 'Plattform-Absender gelöscht',
                severity: 'medium',
            },
            {
                key: 'PLATFORM_EMAIL_PROVIDER_TEST',
                label: 'Plattform-Absender Test-Versand',
                severity: 'low',
            },
            {
                key: 'EMAIL_HISTORY_DELETE',
                label: 'Plattform-E-Mail aus Verlauf entfernt',
                severity: 'medium',
            },
            {
                key: 'EMAIL_HISTORY_RESEND',
                label: 'Plattform-E-Mail erneut versendet',
                severity: 'low',
            },
        ],
    },
};
