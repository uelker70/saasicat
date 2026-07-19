// Self-Service-Block-Policy für Plan-Wechsel und Bundle-Buchungen.
//
// `asTarget`: Pläne, die nicht per Self-Service gewählt werden dürfen
// (typisch: ENTERPRISE — nur per Sondervertrag aktivierbar).
// `asSource`: Pläne, die nicht per Self-Service verlassen werden dürfen
// (typisch: aktiver ENTERPRISE-Sondervertrag → Plan-Wechsel über Vertrieb).

export interface SelfServiceBlockedPlans {
    asTarget?: string[];
    asSource?: string[];
}

export const SELF_SERVICE_BLOCKED_PLANS_TOKEN = Symbol.for('saas-platform/SelfServiceBlockedPlans');

/**
 * Bundle-Pendant (#37): `bundleKeys` listet Bundles, die nicht per
 * Self-Service buchbar sind (nur über Vertrieb/Sondervertrag).
 * Greift in `SubscriptionBundlesService.addBundleToSubscription`
 * (Enforcement, 422) und im Bundle-Preview (Blocker-Ausweis).
 */
export interface SelfServiceBlockedBundles {
    bundleKeys?: string[];
}

// Symbol.for — der CJS-Bundle dupliziert geteilte Module über Entry-Points
// hinweg; nur global registrierte Symbole bleiben cross-entry identisch.
export const SELF_SERVICE_BLOCKED_BUNDLES_TOKEN = Symbol.for(
    'saas-platform/SelfServiceBlockedBundles',
);
