// PLATFORM_CORE_MANIFEST_CONTRIBUTION — the generic manifest spine that every
// SuperAdmin consumer app receives: StandardPage definitions for the
// platform pages (dashboard, tenants, plans, audit, users, pilots),
// the generic tenant actions (suspend/reactivate/export/impersonate plus
// subscriptions.cancel and pilots.grant/revoke/extend) and the audit action
// labels for exactly these operations.
//
// What is NOT included here:
//   - capabilities — the app decides which platform capability it actually
//     supports. If it does not set a capability to `true`, the
//     frontend automatically filters out the associated page/action.
//   - dashboard.kpiCards — endpoints are app-specific (the path prefix differs;
//     KPI data sources are app domains).
//   - subscriptions/promoCodes StandardPages — both apps currently have an
//     individual view of these areas. They must be declared app-locally in their own
//     contribution.
//
// Apps do not register this contribution themselves — `AdminManifestModule.forRoot`
// wires it automatically into the service constructor. If you don't want that, you can
// set `registerPlatformCore: false`.

import type { ManifestContribution } from '@saasicat/types';

export const PLATFORM_CORE_MANIFEST_CONTRIBUTION: ManifestContribution = {
    navigation: {
        // Key order is render order in the sidebar (within the
        // section, see `DEFAULT_NAV_SECTIONS` in the nav-builder). The order per
        // section is deliberately curated:
        //   Overview: dashboard
        //   Product catalog: discovery → bundles → plans →
        //                   marketingCatalog → promoCodes
        //                   (promoCodes is appended by the app contributions
        //                   and therefore lands at the end of the section)
        //   Customers: tenants → users → pilots
        //   System: audit
        standardPages: {
            dashboard: { enabled: true, requiredCapability: 'dashboard.read' },
            // SPEC_V2 §3.3 — discovery snapshot of the running backend.
            // Apps must set `discovery.read` in their manifest capabilities
            // to `true` so that the NavBuilder wires the page into the
            // sidebar; otherwise it is filtered out automatically.
            discovery: { enabled: true, requiredCapability: 'discovery.read' },
            // SPEC_V2 §11.1 M3 — Bundle editor in SuperAdmin.
            // Apps with a DB-driven catalog set `bundles.read = true`.
            bundles: { enabled: true, requiredCapability: 'bundles.read' },
            plans: { enabled: true, requiredCapability: 'plans.read' },
            // SPEC_V2 §11.1 M3 — marketing catalog (locale pivot).
            // Apps that market a public catalog set
            // `marketingProjections.read = true`.
            marketingCatalog: {
                enabled: true,
                requiredCapability: 'marketingProjections.read',
            },
            tenants: { enabled: true, requiredCapability: 'tenants.read' },
            users: { enabled: true, requiredCapability: 'users.read' },
            pilots: { enabled: true, requiredCapability: 'pilots.read' },
            // Audit log deliberately at the end — rarely needed, should
            // not obscure the productive pages.
            audit: { enabled: true, requiredCapability: 'audit.read' },
            // Platform email sender (system/registration mails). Apps
            // set `platformEmail.read = true` so that the NavBuilder wires the page
            // in; otherwise it is filtered out automatically.
            platformEmail: { enabled: true, requiredCapability: 'platformEmail.read' },
            // Platform email history (audit of the sent system mails). Apps
            // set `platformEmailHistory.read = true` so that the NavBuilder wires the
            // page in; otherwise it is filtered out automatically.
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
