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

import type { ManifestContribution } from '@saasicat/core';

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
            // — discovery snapshot of the running backend.
            // Apps must set `discovery.read` in their manifest capabilities
            // to `true` so that the NavBuilder wires the page into the
            // sidebar; otherwise it is filtered out automatically.
            discovery: { enabled: true, requiredCapability: 'discovery.read' },
            // — Bundle editor in SuperAdmin.
            // Apps with a DB-driven catalog set `bundles.read = true`.
            bundles: { enabled: true, requiredCapability: 'bundles.read' },
            plans: { enabled: true, requiredCapability: 'plans.read' },
            // — marketing catalog (locale pivot).
            // Apps that market a public catalog set
            // `marketingProjections.read = true`.
            marketingCatalog: {
                enabled: true,
                requiredCapability: 'marketingProjections.read',
            },
            tenants: { enabled: true, requiredCapability: 'tenants.read' },
            // Every subscriber and its record, whether its tenant lives or not.
            // The capability is set where the subscribers' routes are served.
            subscribers: { enabled: true, requiredCapability: 'subscribers.read' },
            // Every invoice the installation issued, with its totals. The
            // capability is set where the invoices' documents are served.
            invoices: { enabled: true, requiredCapability: 'invoices.read' },
            // The invoices that still owe and the credits still owed, across
            // the installation. Set where the payments are recorded.
            openItems: { enabled: true, requiredCapability: 'payments.read' },
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
            // The applied configuration, read-only. The platform grants
            // `settings.read` unconditionally — see `compose/manifest.ts` —
            // because the page is mounted and the route answers either way;
            // `includeSettingsController` only says who serves it.
            settings: { enabled: true, requiredCapability: 'settings.read' },
            // Maintenance windows. The capability comes from the maintenance
            // module itself, so the page appears exactly where windows are
            // kept.
            maintenance: { enabled: true, requiredCapability: 'maintenance.manage' },
            // Features withdrawn for a reason outside the platform. The
            // capability is set where the stores can list everybody a
            // withdrawal reaches, which is where the routes are served.
            featureWithdrawals: { enabled: true, requiredCapability: 'features.withdraw' },
            // What the gateway reported and nothing matched, to reconcile. The
            // capability is set where what collections bring is recorded,
            // which is where the routes are served.
            reconciliation: { enabled: true, requiredCapability: 'reconciliation.read' },
        },
    },
    tenants: {
        actions: [
            {
                id: 'platform.tenants.suspend',
                label: 'Suspend tenant',
                actionKey: 'tenants.suspend',
                requiredCapability: 'tenants.suspend',
                requiresMfa: true,
                confirmType: 'typed-slug',
            },
            {
                id: 'platform.tenants.reactivate',
                label: 'Reactivate tenant',
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
                label: 'GDPR export',
                actionKey: 'tenants.export',
                requiredCapability: 'tenants.export',
                requiresMfa: true,
                confirmType: 'simple',
            },
            {
                id: 'platform.subscriptions.cancel',
                label: 'Cancel subscription',
                actionKey: 'subscriptions.cancel',
                requiredCapability: 'subscriptions.cancel',
                requiresMfa: true,
                confirmType: 'typed-slug',
            },
            {
                id: 'platform.pilots.grant',
                label: 'Set pilot status',
                actionKey: 'pilots.grant',
                requiredCapability: 'pilots.grant',
                requiresMfa: true,
                confirmType: 'simple',
            },
            {
                id: 'platform.pilots.revoke',
                label: 'Revoke pilot status',
                actionKey: 'pilots.revoke',
                requiredCapability: 'pilots.revoke',
                requiresMfa: true,
                confirmType: 'typed-slug',
            },
            {
                id: 'platform.pilots.extend',
                label: 'Extend pilot',
                actionKey: 'pilots.extend',
                requiredCapability: 'pilots.extend',
                requiresMfa: true,
                confirmType: 'date',
            },
        ],
    },
    audit: {
        actions: [
            { key: 'TENANT_SUSPEND', label: 'Tenant suspended', severity: 'high' },
            { key: 'TENANT_REACTIVATE', label: 'Tenant reactivated', severity: 'medium' },
            { key: 'TENANT_IMPERSONATE', label: 'Impersonation started', severity: 'high' },
            { key: 'TENANT_EXPORT', label: 'GDPR export triggered', severity: 'medium' },
            { key: 'PILOT_CREATE', label: 'Pilot tenant created', severity: 'medium' },
            { key: 'PILOT_GRANT', label: 'Pilot status set', severity: 'medium' },
            { key: 'PILOT_REVOKE', label: 'Pilot status revoked', severity: 'medium' },
            { key: 'PILOT_EXTEND', label: 'Pilot extended', severity: 'low' },
            { key: 'PLAN_VERSION_PUBLISH', label: 'Plan version approved', severity: 'high' },
            {
                key: 'PLAN_VERSION_TERMINATE',
                label: 'Plan version terminated',
                severity: 'high',
            },
            { key: 'PLAN_VERSION_RETIRE', label: 'Plan version retired', severity: 'high' },
            { key: 'BUNDLE_VERSION_RETIRE', label: 'Add-on version retired', severity: 'high' },
            {
                key: 'PLAN_VERSION_RETIREMENT_MOVE',
                label: 'Subscription moved to the replacement of a retired version',
                severity: 'medium',
            },
            {
                key: 'PLAN_VERSION_RETIREMENT_MOVE_FAILED',
                label: 'Subscription could not be moved to the replacement of a retired version',
                severity: 'high',
            },
            {
                key: 'BUNDLE_VERSION_RETIREMENT_MOVE',
                label: 'Add-on booking moved to the replacement of a retired version',
                severity: 'medium',
            },
            {
                key: 'BUNDLE_VERSION_RETIREMENT_MOVE_FAILED',
                label: 'Add-on booking could not be moved to the replacement of a retired version',
                severity: 'high',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_HELD',
                label: 'Invoice held back until what it lacks is supplied',
                severity: 'high',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_DOCUMENT_HELD',
                label: 'Invoice waits for its document: the rendered or archived file was refused',
                severity: 'high',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_DOCUMENT_RERENDERED',
                label: 'Invoice document rendered again before it was archived, in place of the one recorded',
                severity: 'medium',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_DELIVERY_HELD',
                label: 'Invoice not sent: the subscriber has no invoice email',
                severity: 'medium',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_DELIVERY_FAILED',
                label: 'Invoice could not be handed to the mail; tried again',
                severity: 'medium',
            },
            {
                key: 'CONTRACT_CONFIRMATION_HELD',
                label: 'Contract waits for its confirmation: its parties or its terms are missing, or the file was refused',
                severity: 'high',
            },
            {
                key: 'CONTRACT_CONFIRMATION_RERENDERED',
                label: 'Contract confirmation rendered again before it was archived, in place of the one recorded',
                severity: 'medium',
            },
            {
                key: 'CONTRACT_CONFIRMATION_MISMATCH',
                label: 'Archived contract confirmation does not match its checksum, and is not handed out',
                severity: 'high',
            },
            {
                key: 'CONTRACT_CONFIRMATION_DELIVERY_HELD',
                label: 'Contract confirmation not sent: the subscriber has no invoice email',
                severity: 'medium',
            },
            {
                key: 'CONTRACT_CONFIRMATION_DELIVERY_FAILED',
                label: 'Contract confirmation could not be handed to the mail; tried again',
                severity: 'medium',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_COLLECTION_FAILED',
                label: 'Invoice could not be collected through its payment gateway',
                severity: 'high',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_COLLECTION_PLANNED',
                label: 'Invoice collection planned: once more after a failure, or with a replaced payment method',
                severity: 'low',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_COLLECTION_ANNOUNCED',
                label: 'Direct debit announced again to the subscriber for its own day',
                severity: 'low',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_COLLECTION_WITHDRAWN',
                label: 'Planned invoice collection withdrawn: the invoice is paid, or its payment method is no longer in use',
                severity: 'low',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_COLLECTION_ABANDONED',
                label: 'Invoice collection not sent again: its request never arrived, and the invoice was paid meanwhile',
                severity: 'low',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_COLLECTION_WAITING',
                label: 'Invoice not collected yet: no payment method, or no mandate, to collect it with',
                severity: 'medium',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_PAYMENT_RECORDED',
                label: 'Payment the gateway confirmed recorded against its invoice',
                severity: 'low',
            },
            {
                key: 'SUBSCRIBER_CREDIT_RECORDED',
                label: 'Credit recorded: a payment beyond its invoice, an invoice below zero, or a reversal given back beyond what was owed',
                severity: 'medium',
            },
            {
                key: 'SUBSCRIBER_REFUND_RECORDED',
                label: 'Refund made in the gateway recorded against the credits it pays out',
                severity: 'medium',
            },
            {
                key: 'SUBSCRIBER_REFUND_GIVEN_BACK',
                label: 'Refund failed or was canceled, and gave back what it paid out',
                severity: 'medium',
            },
            {
                key: 'SUBSCRIBER_REFUND_UNMATCHED',
                label: 'Refund pays out more than the subscriber is owed, to reconcile',
                severity: 'high',
            },
            {
                key: 'SUBSCRIBER_CREDIT_PAID_OUT',
                label: 'Credit paid out outside the gateway, recorded with its reference',
                severity: 'medium',
            },
            {
                key: 'SUBSCRIBER_REVERSAL_RECORDED',
                label: 'Payment taken back by a returned direct debit or a chargeback: the credit first, then the invoice open again',
                severity: 'high',
            },
            {
                key: 'SUBSCRIBER_REVERSAL_UNMATCHED',
                label: 'Reversal meets a credit already paid out, or goes beyond the payment, to reconcile',
                severity: 'high',
            },
            {
                key: 'SUBSCRIBER_REVERSAL_GIVEN_BACK',
                label: 'Reversal given back by the gateway, a dispute won: what it took is owed and settled again',
                severity: 'medium',
            },
            {
                key: 'SUBSCRIBER_RECONCILIATION_CASE_CLOSED',
                label: 'Case to reconcile closed with a note, by the operator or because the money came back',
                severity: 'medium',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_DOCUMENT_MISMATCH',
                label: 'Archived invoice document does not match its checksum and is not handed out',
                severity: 'high',
            },
            {
                key: 'SUBSCRIPTION_INVOICE_CANCELLED',
                label: 'Invoice cancelled by a cancellation invoice and its replacement, for the reason given',
                severity: 'high',
            },
            { key: 'SUBSCRIPTION_CANCEL', label: 'Subscription cancelled', severity: 'high' },
            { key: 'FEATURE_WITHDRAW', label: 'Feature withdrawn', severity: 'high' },
            {
                key: 'FEATURE_WITHDRAWAL_LIFT',
                label: 'Feature withdrawal lifted',
                severity: 'high',
            },
            {
                key: 'END_SUBSCRIPTION_AT_ONCE',
                label: 'Subscription ended at once under a feature withdrawal',
                severity: 'high',
            },
            {
                key: 'END_ADD_ON_AT_ONCE',
                label: 'Add-on ended at once under a feature withdrawal',
                severity: 'medium',
            },
            { key: 'USER_RESET_PASSWORD', label: 'Password reset triggered', severity: 'medium' },
            { key: 'USER_DEACTIVATE', label: 'User deactivated', severity: 'high' },
            { key: 'USER_REASSIGN_ADMIN', label: 'Admin role transferred', severity: 'high' },
            {
                key: 'PLATFORM_EMAIL_PROVIDER_CREATE',
                label: 'Platform sender created',
                severity: 'medium',
            },
            {
                key: 'PLATFORM_EMAIL_PROVIDER_UPDATE',
                label: 'Platform sender changed',
                severity: 'medium',
            },
            {
                key: 'PLATFORM_EMAIL_PROVIDER_DELETE',
                label: 'Platform sender deleted',
                severity: 'medium',
            },
            {
                key: 'PLATFORM_EMAIL_PROVIDER_TEST',
                label: 'Platform sender test send',
                severity: 'low',
            },
            {
                key: 'EMAIL_HISTORY_DELETE',
                label: 'Platform email removed from history',
                severity: 'medium',
            },
            {
                key: 'EMAIL_HISTORY_RESEND',
                label: 'Platform email resent',
                severity: 'low',
            },
        ],
    },
};
