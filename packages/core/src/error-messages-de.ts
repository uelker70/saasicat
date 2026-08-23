// German counterpart of `ERROR_MESSAGES_EN`, shipped so a German-speaking
// consumer needs no translation pass of its own. Same keys, same order, same
// placeholders — the keys because the shared `Record<PlatformErrorCode, string>`
// makes a missing or unknown one a compile error, the placeholders because
// `error-messages.test` compares them across locales.
//
// Tone follows the audience: end-user errors (registration, OTP, promo codes,
// plan selection, limits, bookings) are plain and polite and address the reader
// as "du", matching the German UI locale in `@saasicat/ui-vue`. Admin and
// developer errors (catalog lifecycle, discovery, strict mode, module
// misconfiguration) stay precise and technical. Identifiers — class, field and
// module names, HTTP paths, SCREAMING_SNAKE_CASE values — are never translated.
//
// Pass it to `resolveErrorMessage` as the `defaults` argument.

import { FEATURE_NOT_LICENSED } from './upsell.types.js';

import type { PlatformErrorCode } from './error-codes.js';

export const ERROR_MESSAGES_DE: Record<PlatformErrorCode, string> = {
    // ── setup ──
    SETUP_DISABLED: '{envVar} ist nicht gesetzt — das Setup ist deaktiviert.',
    INVALID_SETUP_TOKEN: 'Das Setup-Token ist ungültig.',
    SETUP_ALREADY_DONE: 'Das Setup wurde bereits abgeschlossen.',
    INVALID_EMAIL: 'Das ist keine gültige E-Mail-Adresse.',
    EMAIL_EXISTS: 'Mit dieser E-Mail-Adresse gibt es bereits ein Konto.',
    // ── auth ──
    NOT_AUTHENTICATED: 'Nicht authentifiziert',
    NO_TENANT_ASSIGNED: 'Kein Mandant zugeordnet',
    TENANT_CONTEXT_MISSING: 'Am Request wurde keine Mandanten-ID gefunden',
    TENANT_ADMIN_REQUIRED: 'Diese Aktion erfordert die Rolle TENANT_ADMIN.',
    SUPER_ADMIN_REQUIRED: 'Nur die Rolle SUPER_ADMIN ist zugelassen',
    MFA_NOT_SET_UP: 'Richte MFA zuerst über die CLI ein.',
    MFA_REQUIRED: 'TOTP-Code im Header X-Mfa-Code erforderlich.',
    MFA_FAILED: 'Ungültiger TOTP-Code.',
    AUTH_GUARDS_NOT_CONFIGURED: 'TenantBillingModule.forRoot.authGuards ist nicht konfiguriert.',
    // ── catalog ──
    PLAN_HAS_DRAFTS:
        "Plan '{planKey}' hat noch {draftCount} offene Entwurfsversion(en). Verwirf sie zuerst (DELETE /admin/catalog/plan-versions/:id) oder veröffentliche sie.",
    PLAN_HAS_PUBLISHED_VERSIONS:
        "Plan '{planKey}' kann nicht {operation} werden — er hat {publishedCount} veröffentlichte Version(en) ({liveCount} live, {supersededCount} abgelöst). Bestehende Abonnements verweisen auf diese Versionen (Vertragsschutz P1), deshalb muss der Plan-Datensatz erhalten bleiben.",
    PLAN_HARD_DELETE_NOT_IMPLEMENTED:
        'Hard Delete ist im aktuellen Repository nicht implementiert. Implementiere PlanRepository.hardDelete.',
    PLAN_VERSION_ALREADY_PUBLISHED:
        "PlanVersion '{versionId}' ist bereits veröffentlicht und kann nicht verworfen werden.",
    PLAN_VERSION_NOT_EDITABLE:
        "PlanVersion '{versionId}' ist nicht bearbeitbar. Bearbeitbar sind nur Entwürfe sowie veröffentlichte Versionen, die letzte in der Kette sind, noch kein Abonnement binden und deren validFrom in der Zukunft liegt.",
    PLAN_VERSION_REGRESSION:
        'Diese Planversion ist regressiv (Feature entfernt / Quota gesenkt / Preis erhöht). Das Veröffentlichen erfordert ein ausdrückliches `forceRegressive: true` (Bestätigungsdialog in der UI mit MFA).',
    PLAN_VERSION_ZERO_PRICE:
        'Eine Planversion lässt sich nicht mit einem Preis von 0,00 veröffentlichen (Schutz vor Seed-Platzhaltern). Für bewusst kostenlose Sonderverträge setze allowZeroPrice.',
    PLAN_VERSION_DISCARD_NOT_IMPLEMENTED:
        'Das Verwerfen ist im aktuellen Repository nicht implementiert. Implementiere PlanRepository.deletePlanVersionDraft.',
    PLAN_VERSION_NOT_PUBLISHED:
        "Die PlanVersion '{versionId}' ist nicht veröffentlicht und kann nicht beendet werden.",
    PLAN_VERSION_SUPERSEDED:
        "Die PlanVersion '{versionId}' wurde bereits von einer Nachfolgeversion abgelöst und kann nicht beendet werden.",
    PLAN_VERSION_VALID_FROM_REQUIRED:
        'validFrom muss beim Veröffentlichen gesetzt sein (am Entwurf oder im Publish-Aufruf)..',
    PLAN_VERSION_VALID_FROM_INVALID: "validFrom '{validFrom}' ist kein gültiges Datum",
    PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS:
        'validFrom ({validFrom}) muss strikt nach dem validFrom der Vorgängerversion ({previousValidFrom}) liegen.',
    PLAN_VERSION_VALID_FROM_NOT_GAPLESS:
        'Der Vorgänger hat validUntil={previousValidUntil} — der Nachfolger muss lückenlos am Folgetag ({requiredValidFrom}) beginnen. Erhalten: {received}.',
    PLAN_VERSION_VALID_UNTIL_INVALID: "validUntil '{validUntil}' ist kein gültiges Datum",
    PLAN_VERSION_VALID_UNTIL_BEFORE_FROM:
        'validUntil ({validUntil}) muss strikt nach validFrom ({validFrom}) liegen.',
    PLAN_TERMINATE_INVALID_DATE: 'endsAt ist kein gültiges Datum.',
    PLAN_TERMINATE_DATE_NOT_FUTURE: 'endsAt ({endsAt}) muss strikt in der Zukunft liegen.',
    PLAN_TERMINATE_NOT_IMPLEMENTED:
        'Das Beenden ist im aktuellen Repository nicht implementiert. Implementiere PlanRepository.terminate.',
    BUNDLE_VERSION_ALREADY_PUBLISHED:
        "BundleVersion '{versionId}' ist bereits veröffentlicht und kann nicht verworfen werden.",
    BUNDLE_VERSION_NOT_EDITABLE:
        "BundleVersion '{versionId}' ist nicht bearbeitbar. Bearbeitbar sind nur Entwürfe sowie veröffentlichte Versionen, die letzte in der Kette sind, noch kein Abonnement binden und deren validFrom in der Zukunft liegt.",
    BUNDLE_VERSION_NOT_PUBLISHED:
        "BundleVersion '{bundleVersionId}' ist nicht veröffentlicht und lässt sich nicht buchen.",
    BUNDLE_VERSION_SUPERSEDED:
        "BundleVersion '{bundleVersionId}' wurde durch eine neuere Version abgelöst.",
    BUNDLE_VERSION_REGRESSION:
        'Diese Bundle-Version ist regressiv (Feature entfernt / Quota gesenkt / Preis erhöht). Das Veröffentlichen erfordert ein ausdrückliches `forceRegressive: true` (Bestätigungsdialog in der UI mit MFA).',
    BUNDLE_VERSION_ZERO_PRICE:
        'Eine Bundle-Version lässt sich nicht mit einem ausdrücklichen Preis von 0,00 veröffentlichen (Schutz vor Seed-Platzhaltern). Kostenlose Bundles lässt du auf null, oder du setzt allowZeroPrice.',
    BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED:
        'Das Verwerfen ist im aktuellen Repository nicht implementiert. Implementiere BundleRepository.deleteDraft.',
    BUNDLE_VERSION_VALID_FROM_REQUIRED:
        'Veröffentlichte Bundle-Versionen müssen ein validFrom behalten. Setze ein neues Datum in der Zukunft, oder bearbeite den Entwurf vor dem Veröffentlichen.',
    BUNDLE_VERSION_VALID_FROM_INVALID: "validFrom '{validFrom}' ist kein gültiges Datum",
    BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS:
        'validFrom ({validFrom}) muss strikt nach dem validFrom der Vorgängerversion ({previousValidFrom}) liegen.',
    BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS:
        'Der Vorgänger hat validUntil={previousValidUntil} — der Nachfolger muss lückenlos am Folgetag ({requiredValidFrom}) beginnen. Erhalten: {received}.',
    BUNDLE_VERSION_VALID_FROM_NOT_FUTURE:
        'validFrom ({validFrom}) muss bei einer veröffentlichten, aber zukünftigen Bundle-Version weiterhin in der Zukunft liegen.',
    BUNDLE_VERSION_VALID_UNTIL_INVALID: "validUntil '{validUntil}' ist kein gültiges Datum",
    BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM:
        'validUntil ({validUntil}) muss strikt nach validFrom ({validFrom}) liegen.',
    STRICT_MODE_VIOLATIONS:
        'Die Strict-Mode-Prüfung hat eine Abweichung gegenüber dem Discovery-Snapshot gefunden.',
    PLAN_NOT_FOUND: "Plan '{planId}' nicht gefunden",
    PLAN_VERSION_NOT_FOUND: "PlanVersion '{versionId}' nicht gefunden",
    BUNDLE_NOT_FOUND: "Bundle '{bundleId}' nicht gefunden",
    BUNDLE_VERSION_NOT_FOUND: "BundleVersion '{bundleVersionId}' nicht gefunden",
    FEATURE_NOT_FOUND: "Feature '{featureKey}' im Projekt '{projectKey}' nicht gefunden",
    QUOTA_NOT_FOUND: "Quota '{quotaKey}' im Projekt '{projectKey}' nicht gefunden",
    PROMOTION_NOT_FOUND: "Promotion '{promotionId}' nicht gefunden",
    MARKETING_PROJECTION_NOT_FOUND: "MarketingProjection '{projectionId}' nicht gefunden",
    PLAN_ALREADY_EXISTS: "Plan '{planKey}' gibt es im Projekt '{projectKey}' bereits",
    BUNDLE_ALREADY_EXISTS: "Bundle '{bundleKey}' gibt es im Projekt '{projectKey}' bereits",
    MARKETING_PROJECTION_ALREADY_EXISTS:
        'Für {targetType}/{targetVersionId}/{locale} gibt es bereits eine Marketing-Projektion — bearbeite sie per PATCH',
    PLAN_DRAFT_ALREADY_EXISTS:
        "Plan '{planKey}' hat bereits die Entwurfsversion v{draftVersion}; veröffentliche oder verwirf sie zuerst",
    BUNDLE_DRAFT_ALREADY_EXISTS:
        "Bundle '{bundleKey}' hat bereits die Entwurfsversion v{draftVersion}; veröffentliche oder verwirf sie zuerst",
    QUOTA_NOT_IN_DISCOVERY_SNAPSHOT:
        "Quota '{quotaKey}' steht nicht im Discovery-Snapshot — eine Quota, die im Code nicht deklariert ist, lässt sich nicht freigeben",
    DISCOVERY_STATUS_TRANSITION_INVALID: "Der Übergang '{from}' → '{to}' ist nicht erlaubt",
    DISCOVERY_NOT_INITIALIZED:
        'Die Freigabe braucht einen Discovery-Snapshot — Discovery ist nicht initialisiert (#25)',
    // ── billing ──
    BUNDLE_ALREADY_SUBSCRIBED:
        "Abonnement '{subscriptionId}' hat dieses Bundle bereits aktiv gebucht.",
    BUNDLE_INCOMPATIBLE_WITH_PLAN:
        "BundleVersion '{bundleVersionId}' passt nicht zum Plan '{planKey}'. Erlaubt: [{allowedPlanKeys}].",
    BUNDLE_NOT_SELF_SERVICE:
        "Bundle '{bundleKey}' wird nur über einen Sondervertrag freigeschaltet. Bitte wende dich an die Vertragsverwaltung.",
    SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED:
        "SubscriptionBundle '{subscriptionBundleId}' ist bereits gekündigt.",
    SUBSCRIPTION_BUNDLE_NOT_CANCELLED:
        "SubscriptionBundle '{subscriptionBundleId}' ist nicht gekündigt.",
    SUBSCRIPTION_BUNDLE_CANCELLATION_EFFECTIVE:
        'Die Kündigung ist bereits wirksam — buche das Bundle einfach neu.',
    SUBSCRIPTION_NOT_FOUND: 'Kein Abonnement für Mandant {tenantId}',
    SUBSCRIPTION_TENANT_MISMATCH: 'Das Abonnement gehört nicht zu diesem Mandanten',
    SUBSCRIPTION_BUNDLE_NOT_FOUND: "SubscriptionBundle '{subscriptionBundleId}' nicht gefunden",
    TENANT_NOT_FOUND: 'Mandant {slug} nicht gefunden',
    NO_ACTIVE_PLAN_VERSION:
        'Zum {asOf} ist keine Planversion für {planId} aktiv — weder ist das validFrom-Fenster erfüllt, noch steht eine jüngste Live-Version bereit.',
    PLAN_NOT_IN_CATALOG: 'Plan "{planKey}" steht nicht im Katalog ({projectKey})',
    PLAN_NOT_SELF_SERVICE: '{planKey} wird nicht per Self-Service freigeschaltet.',
    PLAN_CHANGE_BLOCKED: 'Während des Onboardings ist ein Planwechsel gesperrt.',
    NO_PENDING_PLAN_VERSION: 'Es wartet keine Planversion auf eine Bestätigung.',
    ONBOARDING_CREATE_FAILED:
        'Das Konto konnte nicht angelegt werden. Bitte versuche es noch einmal.',
    BUNDLE_PREVIEW_ARGUMENT_AMBIGUOUS:
        'Genau eines von bundleVersionId (Vorschau fürs Buchen) oder subscriptionBundleId (Vorschau fürs Kündigen) muss angegeben sein.',
    SUBSCRIPTION_PK_MISSING:
        'Der Adapter hat einen SubscriptionUsageRecord ohne id geliefert. Bitte den Primärschlüssel der Subscription durchreichen (siehe SubscriptionUsageRecord.id).',
    LIMIT_EXCEEDED: 'Das Limit für {dimension} ist erreicht: {used} von {max}.',
    QUOTA_DIMENSION_UNKNOWN: 'Unbekannte Quota-Dimension "{dimension}".',
    // ── promo ──
    PROMO_CODE_NOT_FOUND: 'Code nicht gefunden',
    PROMO_CODE_ALREADY_EXISTS: 'Diesen Code gibt es bereits.',
    PROMO_CODE_HAS_REDEMPTIONS:
        'Der Code wurde bereits eingelöst — er lässt sich nicht per Soft-Delete entfernen. Pausiere ihn stattdessen.',
    PROMO_CODE_NOT_REDEEMABLE: 'Der Code lässt sich nicht einlösen: {reason}',
    PROMO_CODE_FORMAT_INVALID:
        'Der Code darf nur Großbuchstaben, Ziffern, "-" und "_" enthalten (4–32 Zeichen).',
    PROMO_PERCENT_OUT_OF_RANGE: 'Der Prozentwert muss zwischen 0 und 100 liegen.',
    PROMO_AMOUNT_NOT_POSITIVE: 'Der Betrag muss positiv sein.',
    PROMO_ONE_OFF_WITH_DURATION: 'Ein einmaliger Rabatt darf keine Laufzeit haben.',
    PROMO_DURATION_INVALID: 'Ungültige Laufzeit (höchstens 24 Monate oder Abrechnungsperioden).',
    PROMO_VALIDITY_WINDOW_INVALID: 'Ungültiger Gültigkeitszeitraum.',
    PROMO_PLAN_NOT_DISCOUNTABLE: 'Der {plan}-Plan lässt sich nicht rabattieren.',
    PROMO_MIN_AMOUNT_NOT_POSITIVE: 'Der Mindest-Bruttobetrag des Plans muss positiv sein.',
    PROMO_WOULD_PRODUCE_ZERO_INVOICE:
        'Bei absoluten Beträgen muss der Rabatt unter dem niedrigsten anwendbaren Planpreis bleiben, oder allowZeroInvoice muss aktiviert sein.',
    PROMO_MAX_REDEMPTIONS_LOWERED: 'maxRedemptions lässt sich nicht senken.',
    // ── contract ──
    CHECKOUT_OFFER_LINE_ITEMS_REQUIRED:
        'Aus einem Checkout-Angebot entsteht nur ein einziger Vertrag, und das erst, wenn seine Positionen eingefroren sind.',
    CHECKOUT_OFFER_PLAN_LINE_ITEM_REQUIRED:
        'Ein Checkout-Angebot braucht eine eingefrorene Plan-Position.',
    CHECKOUT_OFFER_BUNDLE_LINE_ITEMS_REQUIRED:
        'Jede gewählte Bundle-Version braucht eine eingefrorene Bundle-Position.',
    CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE:
        'Mindestens eine Bundle-Version aus dem Checkout-Angebot ist nicht mehr buchbar.',
    CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED:
        'Der gewählte Plan deckt nicht alle Feature-Abhängigkeiten ab: [{missingRequires}] fehlen in Plan und gewählten Bundles.',
    SUBSCRIPTION_CONTRACT_LINE_ITEMS_REQUIRED: 'Ein Abo-Vertrag braucht mindestens eine Position.',
    SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED:
        'Ein Abo-Vertrag braucht genau eine Plan-Grundposition.',
    SUBSCRIPTION_CONTRACT_INVALID_DATE: '{field} muss ein gültiges Datum sein.',
    SUBSCRIPTION_CONTRACT_INVALID_WINDOW: 'effectiveUntil muss nach effectiveFrom liegen.',
    SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START:
        'effectiveUntil muss nach dem effectiveFrom des Vertrags liegen.',
    CHECKOUT_OFFER_NOT_FOUND: "CheckoutOffer '{offerId}' nicht gefunden",
    CHECKOUT_OFFER_EXPIRED:
        "Checkout-Angebot '{offerId}' ist abgelaufen — '{action}' ist nicht mehr möglich",
    CHECKOUT_OFFER_ALREADY_CONSUMED:
        "Checkout-Angebot '{offerId}' wurde bereits eingelöst — '{action}' ist nicht mehr möglich",
    CHECKOUT_OFFER_NOT_CONSUMED:
        "CheckoutOffer '{offerId}' muss eingelöst sein, bevor der Vertrag entsteht",
    SUBSCRIPTION_CONTRACT_NOT_FOUND: "SubscriptionContract '{contractId}' nicht gefunden",
    NO_ACTIVE_SUBSCRIPTION_CONTRACT: 'Kein aktiver Abo-Vertrag für Mandant {tenantId}',
    SUBSCRIPTION_CONTRACT_ALREADY_CLOSED:
        "SubscriptionContract '{contractId}' ist bereits geschlossen",
    // ── registration ──
    PENDING_REGISTRATION_NOT_FOUND:
        'Diese Registrierung konnten wir nicht finden. Vielleicht ist sie bereits abgeschlossen oder verworfen.',
    PENDING_REGISTRATION_EXPIRED:
        'Diese Registrierung ist abgelaufen. Bitte fange noch einmal von vorn an.',
    INVALID_REGISTRATION_STATE:
        'Dieser Schritt ist an dieser Stelle der Registrierung nicht verfügbar.',
    OTP_INVALID: 'Der Code ist nicht korrekt. Bitte prüfe ihn und versuche es erneut.',
    OTP_EXPIRED: 'Der Code ist abgelaufen. Bitte fordere einen neuen an.',
    OTP_LOCKED: 'Zu viele falsche Versuche. Bitte fordere einen neuen Code an.',
    RATE_LIMITED:
        'Zu viele Versuche. Bitte probiere es in {retryAfterSeconds} Sekunden noch einmal.',
    RESUME_TOKEN_INVALID:
        'Dieser Link zum Fortsetzen gilt nicht mehr. Bitte fordere einen neuen an.',
    RESUME_NOT_CONFIGURED: 'Eine begonnene Registrierung lässt sich hier nicht fortsetzen.',
    CONFIGURATOR_NOT_CONFIGURED: 'Der Konfigurator steht nicht zur Verfügung.',
    CONFIG_NOT_SAVED: 'Die Konfiguration konnte nicht gespeichert werden.',
    PLAN_NOT_AVAILABLE: 'Dieser Plan steht nicht zur Verfügung.',
    PLAN_NOT_SELECTED: 'Bitte wähle zuerst einen Plan aus.',
    MODEL_NOT_AVAILABLE: 'Diese Option steht nicht zur Verfügung.',
    // ── entitlement (code lives in upsell.types.ts) ──
    [FEATURE_NOT_LICENSED]: 'Das Feature {featureKeys} ist im aktuellen Plan nicht enthalten.',
};
