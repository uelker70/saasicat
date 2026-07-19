// Upsell-Response des FeatureGuard (#36) — Wire-Format + Resolver-Port.
//
// Wirft der FeatureGuard wegen fehlendem Entitlement, soll das Frontend
// daraus ein Kaufangebot machen können statt nur „Zugriff verweigert"
// anzuzeigen. Der Guard liefert dafür einen strukturierten 403-Body
// (`FeatureNotLicensedBody`); die Angebote kommen aus einem optional
// registrierten `UpsellOfferResolver`.
//
// Statuscode-Entscheidung: **403 mit `code`-Feld**, NICHT 402.
// - 402 „Payment Required" ist im HTTP-Standard reserviert/experimentell;
//   Proxies, HTTP-Clients und Error-Interceptoren behandeln ihn
//   uneinheitlich.
// - 403 trifft die Semantik exakt: authentifiziert, aber nicht berechtigt
//   (Lizenz fehlt). SPA-Interceptoren, die nur auf 401 Auto-Logout machen,
//   bleiben unberührt (vgl. DMS-401-Falle) — Konsumenten-Interceptoren
//   dürfen einen 403 nie als Auth-Fehler interpretieren.
// - Die Maschinen-Unterscheidung läuft über `code === 'FEATURE_NOT_LICENSED'`,
//   nicht über den Statuscode.

/** Error-Code des strukturierten FeatureGuard-403 (#36). */
export const FEATURE_NOT_LICENSED = 'FEATURE_NOT_LICENSED' as const;

/**
 * Ein Kaufangebot, das das fehlende Feature decken würde — typischerweise
 * eine published Catalog-BundleVersion, die den Feature-Key enthält.
 */
export interface UpsellOffer {
    bundleKey: string;
    /** Live-BundleVersion-ID — für das `add`-Request des Tenant-Self-Service. */
    bundleVersionId?: string;
    /** Netto-Monatspreis; `null` = Preis nur kontextabhängig (Pricing-Override). */
    priceMonthlyNet: number | null;
    /** ISO-4217, z. B. `EUR`. */
    currency: string;
    label?: string;
}

/**
 * 403-Body des FeatureGuard bei fehlendem Entitlement und registriertem
 * `UpsellOfferResolver`. Ohne Resolver bleibt der bisherige plain-403
 * (nur `message`) — kein Breaking Change für Bestandskonsumenten.
 */
export interface FeatureNotLicensedBody {
    code: typeof FEATURE_NOT_LICENSED;
    /** Erster geforderter Key — Komfort für Single-Feature-Guards (Issue-Shape). */
    featureKey: string;
    /** Alle geforderten Keys (`@RequireFeature` ist ein Logical-OR). */
    featureKeys: string[];
    offers: UpsellOffer[];
    /** Menschlich lesbare Meldung (Fallback-Anzeige). */
    message: string;
}

/**
 * Port (#36): löst fehlende Feature-Keys in Kaufangebote auf. Konsumenten
 * registrieren eine Implementierung unter `UPSELL_OFFER_RESOLVER_TOKEN`
 * (saas-platform-nest) — z. B. den mitgelieferten
 * `CatalogBundleUpsellResolver` gegen die published Catalog-Bundles.
 *
 * `tenantId` erlaubt tenant-spezifische Angebote (z. B. Plan-Kompatibilität
 * oder bereits gebuchte Abhängigkeiten berücksichtigen); die
 * Default-Implementierung nutzt sie nicht.
 */
export interface UpsellOfferResolver {
    resolveOffers(featureKeys: string[], tenantId: string): Promise<UpsellOffer[]>;
}
