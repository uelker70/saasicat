// translation-catalogue: the German half of this file is German on purpose.
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
    BILLING_PERMISSION_REQUIRED:
        'Dieser Teil der Abrechnung erfordert die Abrechnungs-Berechtigung.',
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
        "PlanVersion '{versionId}' ist bereits veröffentlicht und wird weder erneut veröffentlicht noch verworfen.",
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
    PLAN_VERSION_VALID_FROM_INVALID: "validFrom '{validFrom}' ist kein Tag (JJJJ-MM-TT)",
    PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS:
        'validFrom ({validFrom}) muss strikt nach dem validFrom der Vorgängerversion ({previousValidFrom}) liegen.',
    PLAN_VERSION_VALID_FROM_NOT_GAPLESS:
        'Der Vorgänger hat validUntil={previousValidUntil} — der Nachfolger muss lückenlos am Folgetag ({requiredValidFrom}) beginnen. Erhalten: {received}.',
    PLAN_VERSION_VALID_UNTIL_INVALID: "validUntil '{validUntil}' ist kein Tag (JJJJ-MM-TT)",
    PLAN_VERSION_VALID_UNTIL_BEFORE_FROM:
        'validUntil ({validUntil}) muss strikt nach validFrom ({validFrom}) liegen.',
    PLAN_TERMINATE_INVALID_DATE: 'endsAt ist kein gültiges Datum.',
    PLAN_TERMINATE_DATE_NOT_FUTURE: 'endsAt ({endsAt}) muss strikt in der Zukunft liegen.',
    PLAN_TERMINATE_NOT_IMPLEMENTED:
        'Das Beenden ist im aktuellen Repository nicht implementiert. Implementiere PlanRepository.terminate.',
    PLAN_TERMINATE_BEFORE_RETIREMENT_MOVES:
        'Abonnements ziehen noch auf Version {version} von {planKey} um. Sie kann frühestens am {date} enden.',
    PLAN_TERMINATE_WHILE_MOVES_OVERDUE:
        '{count} Abonnements sind über ihr Datum und ziehen noch auf Version {version} von {planKey} um. Sie kann erst enden, wenn sie umgezogen sind.',
    PLAN_TERMINATE_WHILE_NOTICES_UNDELIVERED:
        '{count} Abonnements wissen noch nicht, dass sie auf Version {version} von {planKey} umziehen. Sie kann erst enden, wenn sie es erfahren haben.',
    BUNDLE_VERSION_ALREADY_PUBLISHED:
        "BundleVersion '{versionId}' ist bereits veröffentlicht und wird weder erneut veröffentlicht noch verworfen.",
    BUNDLE_VERSION_NOT_EDITABLE:
        "BundleVersion '{versionId}' ist nicht bearbeitbar. Bearbeitbar sind nur Entwürfe sowie veröffentlichte Versionen, die letzte in der Kette sind, noch kein Abonnement binden und deren validFrom in der Zukunft liegt.",
    BUNDLE_VERSION_NOT_PUBLISHED:
        "BundleVersion '{bundleVersionId}' ist nicht veröffentlicht und lässt sich nicht buchen.",
    BUNDLE_VERSION_SUPERSEDED:
        "BundleVersion '{bundleVersionId}' wurde durch eine neuere Version abgelöst.",
    BUNDLE_VERSION_NOT_YET_ON_SALE:
        "BundleVersion '{bundleVersionId}' ist ab {validFrom} im Verkauf und kann vorher nicht gebucht werden.",
    BUNDLE_DELETED:
        "Bundle '{bundleKey}' wurde aus dem Katalog gelöscht und lässt sich nicht buchen.",
    BUNDLE_VERSION_REGRESSION:
        'Diese Bundle-Version ist regressiv (Feature entfernt / Quota gesenkt / Preis erhöht). Das Veröffentlichen erfordert ein ausdrückliches `forceRegressive: true` (Bestätigungsdialog in der UI mit MFA).',
    BUNDLE_VERSION_ZERO_PRICE:
        'Eine Bundle-Version lässt sich nicht mit einem ausdrücklichen Preis von 0,00 veröffentlichen (Schutz vor Seed-Platzhaltern). Kostenlose Bundles lässt du auf null, oder du setzt allowZeroPrice.',
    BUNDLE_VERSION_NO_PRICE:
        'Diese Bundle-Version kann ohne Preis nicht veröffentlicht werden: weder ein Grundpreis noch eine Plan-Überschreibung ergibt einen.',
    BUNDLE_VERSION_NOT_PRICED_FOR_PLAN:
        "Dieses Bundle wird dem Plan '{planKey}' angeboten, der {billingCycle} verkauft wird, und dafür ergibt sich kein {billingCycle} Preis — weder als Grundpreis noch als Plan-Überschreibung.",
    BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED:
        'Das Verwerfen ist im aktuellen Repository nicht implementiert. Implementiere BundleRepository.deleteDraft.',
    BUNDLE_VERSION_VALID_FROM_REQUIRED:
        'Veröffentlichte Bundle-Versionen müssen ein validFrom behalten. Setze ein neues Datum in der Zukunft, oder bearbeite den Entwurf vor dem Veröffentlichen.',
    BUNDLE_VERSION_VALID_FROM_INVALID: "validFrom '{validFrom}' ist kein Tag (JJJJ-MM-TT)",
    BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS:
        'validFrom ({validFrom}) muss strikt nach dem validFrom der Vorgängerversion ({previousValidFrom}) liegen.',
    BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS:
        'Der Vorgänger hat validUntil={previousValidUntil} — der Nachfolger muss lückenlos am Folgetag ({requiredValidFrom}) beginnen. Erhalten: {received}.',
    BUNDLE_VERSION_VALID_FROM_NOT_FUTURE:
        'validFrom ({validFrom}) muss bei einer veröffentlichten, aber zukünftigen Bundle-Version weiterhin in der Zukunft liegen.',
    BUNDLE_VERSION_VALID_UNTIL_INVALID: "validUntil '{validUntil}' ist kein Tag (JJJJ-MM-TT)",
    BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM:
        'validUntil ({validUntil}) muss strikt nach validFrom ({validFrom}) liegen.',
    STRICT_MODE_VIOLATIONS:
        'Die Strict-Mode-Prüfung hat eine Abweichung gegenüber dem Discovery-Snapshot gefunden.',
    PLAN_NOT_FOUND: "Plan '{planId}' nicht gefunden",
    PLAN_VERSION_NOT_FOUND: "PlanVersion '{versionId}' nicht gefunden",
    BUNDLE_NOT_FOUND: "Bundle '{bundleId}' nicht gefunden",
    BUNDLE_VERSION_NOT_FOUND: "BundleVersion '{bundleVersionId}' nicht gefunden",
    FEATURE_NOT_FOUND: "Feature '{featureKey}' nicht gefunden",
    QUOTA_NOT_FOUND: "Quota '{quotaKey}' nicht gefunden",
    PROMOTION_NOT_FOUND: "Promotion '{promotionId}' nicht gefunden",
    PROMOTION_VALUE_INVALID:
        "Der Wert einer Aktion vom Typ '{type}' passt nicht zu ihrem Typ: ein Prozentsatz über 0 und höchstens 100, ein Betrag über 0, ein Einführungspreis ab 0 für eine ganze Zahl von Monaten oder eine ganze Zahl von Gratismonaten.",
    MARKETING_PROJECTION_NOT_FOUND: "MarketingProjection '{projectionId}' nicht gefunden",
    PLAN_ALREADY_EXISTS: "Plan '{planKey}' gibt es bereits",
    BUNDLE_ALREADY_EXISTS: "Bundle '{bundleKey}' gibt es bereits",
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
    // ── catalogue import ──
    PLAN_CATALOG_UNREADABLE:
        'Diese Datei ist kein Plankatalog — sie ließ sich nicht als einer lesen. Prüfe, ob es die YAML-Datei ist, in der deine App ihre Pläne deklariert.',
    PLAN_CATALOG_INVALID: 'Der Plankatalog wurde gelesen und dann abgelehnt: {message}',
    // ── billing ──
    BUNDLE_ALREADY_SUBSCRIBED:
        "Abonnement '{subscriptionId}' hat dieses Bundle bereits aktiv gebucht.",
    BUNDLE_INCOMPATIBLE_WITH_PLAN:
        "BundleVersion '{bundleVersionId}' passt nicht zum Plan '{planKey}'. Erlaubt: [{allowedPlanKeys}].",
    BUNDLE_NOT_SELF_SERVICE:
        "Bundle '{bundleKey}' wird nur über einen Sondervertrag freigeschaltet. Bitte wende dich an die Vertragsverwaltung.",
    BUNDLE_CYCLE_EXCEEDS_PLAN:
        'Ein jährlich abgerechnetes Bundle passt nicht zu einem monatlich abgerechneten Plan: es wäre an jedem Tag gebunden, an dem der Plan enden kann.',
    BUNDLE_NOT_PRICED_FOR_THIS_PLAN:
        'Für dieses Bundle ist im Plan {planKey} kein {billingCycle} Preis hinterlegt, es kann hier deshalb nicht gebucht werden.',
    BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN:
        'Dieses Bundle kann nicht im Plan {planKey} laufen, auf den das Abonnement am {from} wechselt.',
    BUNDLE_CANNOT_RUN_ON_UPCOMING_CYCLE:
        'Ein jährlich abgerechnetes Bundle kann nicht neben der monatlichen Abrechnung laufen, auf die das Abonnement am {from} wechselt.',
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
    NO_ACTIVE_PLAN_VERSION: 'Zum {asOf} ist keine Version des Plans {planId} im Verkauf.',
    BOUND_PLAN_VERSION_UNREADABLE:
        'Die Planversion, an die dieses Abonnement gebunden ist ({planVersionId}), ist für den Plan "{planKey}" nicht lesbar; deshalb kann kein Wechsel berechnet werden.',
    PLAN_NOT_IN_CATALOG: 'Plan "{planKey}" steht nicht im Katalog',
    PLAN_NOT_SELF_SERVICE:
        '{planName} wird nur über einen Sondervertrag freigeschaltet. Bitte wenden Sie sich an die Vertragsverwaltung.',
    PLAN_NOT_SOLD_IN_CYCLE:
        '{planName} hat für diesen Abrechnungsrhythmus keinen Preis und kann darin nicht gebucht werden.',
    PLAN_CHANGE_BLOCKED: 'Während des Onboardings ist ein Planwechsel gesperrt.',
    SUBSCRIPTION_CHANGED:
        'Dieses Abonnement hat sich geändert, während die Anfrage entschieden wurde. Bitte lade es neu.',
    NO_SUBSCRIPTION: 'Dieser Mandant hat kein Abonnement, das gekündigt werden kann.',
    CANCELLATION_TERMS_CHANGED:
        'Das Wirksamkeitsdatum hat sich seit der Anzeige geändert. Bitte bestätige das neue Datum.',
    VERSION_OFFER_CHANGED:
        'Das Angebot hat sich seit der Anzeige geändert. Bitte sieh dir das aktuelle an, bevor du wechselst.',
    PLAN_CHANGE_QUOTE_CHANGED:
        'Dieser Plan hat sich seit der Anzeige geändert. Bitte sieh ihn dir noch einmal an, bevor du wechselst.',
    PLAN_CHANGE_VERSION_NOT_NAMED:
        'Ein Planwechsel muss die Version nennen, die seine Vorschau gezeigt hat.',
    VERSION_SWITCH_AFTER_CANCELLATION:
        'Dieses Abonnement endet, bevor diese Version wirksam würde. Ein Wechsel dorthin ist nicht möglich.',
    VERSION_ENDS_BEFORE_SWITCH:
        'Diese Version wird nicht mehr verkauft, bevor sie wirksam würde. Ein Wechsel dorthin ist nicht möglich.',
    RETIREMENT_TERMS_NOT_CONFIRMED:
        'Eine Version für laufende Abonnements stillzulegen, braucht eine Klausel in deinen AGB. Setze tenantBilling.orderlyRetirement.termsConfirmed in config/saas.yaml, sobald sie sie enthalten.',
    RETIREMENT_VERSION_ON_SALE:
        'Version {version} von {planKey} wird noch verkauft. Beende zuerst ihren Verkauf, damit sie nach der Ankündigung niemand mehr bucht.',
    RETIREMENT_REPLACEMENT_NOT_ON_SALE:
        'Version {version} von {planKey} wird nicht verkauft. Abonnements können nicht auf ihr weiterlaufen.',
    RETIREMENT_REPLACEMENT_NOT_SOLD_IN_RHYTHM:
        '{count} dieser Abonnements werden in einem Rhythmus abgerechnet, für den Version {version} von {planKey} keinen Preis hat. Sie können nicht auf ihr weiterlaufen.',
    RETIREMENT_REPLACEMENT_CANNOT_CARRY_BUNDLES:
        '{count} dieser Abonnements halten ein Bundle, das in Version {version} von {planKey} nicht laufen kann. Sie können nicht auf ihr weiterlaufen.',
    RETIREMENT_REPLACEMENT_IS_RETIRED: 'Eine Version kann nicht ihr eigener Ersatz sein.',
    RETIREMENT_NOTHING_AFFECTED:
        'Kein laufendes Abonnement nutzt Version {version} von {planKey}. Es gibt niemanden zu benachrichtigen.',
    RETIREMENT_WITHIN_TWELVE_MONTHS:
        '{count} dieser Abonnements waren in den letzten zwölf Monaten schon von einer Stilllegung betroffen. Ein Abonnement ist höchstens einmal im Jahr betroffen.',
    RETIREMENT_PREVIEW_CHANGED:
        'Die Abonnements, die diese Stilllegung betrifft, haben sich seit der Anzeige geändert. Sieh sie dir noch einmal an, bevor du sie ankündigst.',
    RETIREMENT_SWITCH_NOT_PENDING:
        'Für Ihre Version steht keine Einstellung mehr bevor. Es gibt nichts, wohin Sie wechseln könnten.',
    RETIREMENT_SWITCH_IN_TRIAL: 'Der Wechsel ist möglich, sobald Ihre Testphase endet.',
    RETIREMENT_SWITCH_NOT_OPEN:
        'Dieses Abonnement kann gerade nicht wechseln: Eine Änderung ist geplant, es ist beendet, oder sein Paket gilt für einen Sondervertrag.',
    RETIREMENT_SWITCH_CHANGED:
        'Die Einstellung hat sich seit der Anzeige geändert. Sehen Sie sie sich noch einmal an, bevor Sie wechseln.',
    SUBSCRIPTION_ENDED:
        'Dieses Abonnement ist beendet. Sein Paket kann nicht mehr gewechselt werden.',
    PLAN_LOCKED:
        'Aktiver Sondervertrag {planName} — für einen Paketwechsel wenden Sie sich bitte an die Vertragsverwaltung.',
    QUOTA_OVER_TARGET:
        'Aktuelle Nutzung {used} überschreitet das Ziel-Limit {targetMax} ({quotaKey}) im Paket {planName}. Bitte zuerst die Nutzung reduzieren.',
    FEATURE_LOST:
        'Beim Wechsel verlieren Sie den Zugriff auf eine Funktion. Vorhandene Daten bleiben erhalten und werden nie gelöscht — ein späteres Upgrade schaltet sie wieder frei.',
    FEATURES_LOST:
        'Beim Wechsel verlieren Sie den Zugriff auf {count} Funktionen. Vorhandene Daten bleiben erhalten und werden nie gelöscht — ein späteres Upgrade schaltet sie wieder frei.',
    NO_CHANGE: 'Zielpaket und Abrechnungsrhythmus entsprechen bereits dem aktuellen Stand.',
    CANCELLATION_LOCKS_THE_CYCLE:
        'Dieses Abonnement ist gekündigt, sein Abrechnungsrhythmus kann daher nicht wechseln. Das Paket schon — behalten Sie den aktuellen Rhythmus, um es heute zu wechseln.',
    CYCLE_SHORTENS_AT_TERM_END:
        'Ein monatlich abgerechnetes {planName} kann nicht innerhalb der laufenden Jahreslaufzeit beginnen. Das Upgrade greift zum Ende dieser Laufzeit; wer es sofort möchte, behält den jährlichen Rhythmus.',
    BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE:
        '{bundleName} wird jährlich abgerechnet und läuft frühestens bis {until}; ein monatlich abgerechnetes Paket kann es nicht tragen. Ist es gekündigt, geht ein Wechsel durch, der an diesem Tag oder später wirksam wird — oder behalten Sie den jährlichen Rhythmus.',
    BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN:
        '{bundleName} kann im Paket {planName} nicht laufen und läuft frühestens bis {until}. Ist es gekündigt, geht ein Wechsel durch, der an diesem Tag oder später wirksam wird — oder wählen Sie ein anderes Paket.',
    REDUNDANT_FEATURES:
        'Der Plan oder ein anderes gebuchtes Bundle enthält bereits {count} der Funktionen aus diesem Bundle — mit der Buchung werden sie doppelt bezahlt.',
    MINIMUM_TERM_BINDS:
        'Die Mindestlaufzeit reicht über das Ende der Periode hinaus — die Kündigung wird erst zum Ende der Mindestlaufzeit wirksam.',
    BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED:
        'Das Bundle setzt [{features}] voraus — weder im Plan noch in den aktiven Bundles vorhanden.',
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
    PROMO_CODE_ALREADY_EXISTS:
        'Diesen Code gibt es bereits, oder ein gelöschter Code trägt ihn; ein gelöschter Code behält seinen Namen.',
    PROMO_CODE_HAS_REDEMPTIONS:
        'Der Code wurde bereits eingelöst oder ist für einen laufenden Checkout reserviert — er lässt sich nicht per Soft-Delete entfernen. Pausiere ihn stattdessen.',
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
    CHECKOUT_OFFER_PLAN_NOT_OFFERED:
        "Plan '{planKey}' wird derzeit nicht mit einem Preis für den Rhythmus {billingCycle} angeboten.",
    CHECKOUT_OFFER_BUNDLE_NOT_OFFERED:
        "Bundle-Version '{bundleVersionId}' kann diesem Angebot nicht hinzugefügt werden ({reason}).",
    CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED:
        'Der Rabattcode kann auf dieses Angebot nicht angewendet werden ({reason}).',
    CHECKOUT_OFFER_PRICE_NOT_CURRENT:
        "Die Preise des Angebots '{offerId}' stimmen nicht mehr mit dem Katalog überein; bitte ein neues Angebot erstellen.",
    SUBSCRIPTION_CONTRACT_LINE_ITEMS_REQUIRED: 'Ein Abo-Vertrag braucht mindestens eine Position.',
    SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED:
        'Ein Abo-Vertrag braucht genau eine Plan-Grundposition.',
    SUBSCRIPTION_CONTRACT_INVALID_DATE: '{field} muss ein gültiges Datum sein.',
    SUBSCRIPTION_CONTRACT_INVALID_WINDOW: 'effectiveUntil muss nach effectiveFrom liegen.',
    SUBSCRIPTION_CONTRACT_LINE_ITEM_TAX_MISMATCH:
        'taxAmount einer Position muss exakt priceGross minus priceNet sein.',
    SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_PERCENT:
        'Ein Abo-Vertrag nennt bei {field} einen Steuersatz von {taxRate}, der kein Prozentsatz ist: Ein Satz liegt zwischen 0 und 100, und ein Wert zwischen 0 und 1 wird als Bruch abgelehnt.',
    SUBSCRIPTION_CONTRACT_LINE_ITEM_CURRENCY_MISMATCH:
        'Eine Position muss in der Währung gebucht sein, in der ihr Vertrag bepreist ist.',
    SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP:
        'Die Positionen eines Abo-Vertrags ergeben {lines} für {field}, der Vertrag nennt aber {stated}.',
    SUBSCRIPTION_CONTRACT_DISCOUNT_NEGATIVE:
        'Ein Abo-Vertrag nennt bei {field} einen Rabatt von {amount}; ein Rabatt zieht Geld ab und ist nie negativ.',
    SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START:
        'effectiveUntil muss nach dem effectiveFrom des Vertrags liegen.',
    CHECKOUT_OFFER_NOT_FOUND: "CheckoutOffer '{offerId}' nicht gefunden",
    CHECKOUT_OFFER_EXPIRED:
        "Checkout-Angebot '{offerId}' ist abgelaufen — '{action}' ist nicht mehr möglich",
    CHECKOUT_OFFER_ALREADY_CONSUMED:
        "Checkout-Angebot '{offerId}' wurde bereits eingelöst — '{action}' ist nicht mehr möglich",
    CHECKOUT_OFFER_NOT_CONSUMED:
        "CheckoutOffer '{offerId}' muss eingelöst sein, bevor der Vertrag entsteht",
    CHECKOUT_OFFER_CHANGED:
        "Checkout-Angebot '{offerId}' hat sich während des Abschlusses geändert. Bitte neu laden.",
    SUBSCRIPTION_CONTRACT_NOT_FOUND: "SubscriptionContract '{contractId}' nicht gefunden",
    NO_ACTIVE_SUBSCRIPTION_CONTRACT: 'Kein aktiver Abo-Vertrag für Mandant {tenantId}',
    SUBSCRIPTION_CONTRACT_ALREADY_CLOSED:
        "SubscriptionContract '{contractId}' ist bereits geschlossen",
    SUBSCRIPTION_CONTRACT_CHANGED:
        "Die Verträge von Mandant '{tenantId}' haben sich geändert, während ein Nachfolger geschrieben wurde, oder einer beginnt nach dem Zeitpunkt, ab dem er gälte, sodass er neben einem anderen liefe. Es wurde nichts geschrieben.",
    // ── subscriber ──
    SUBSCRIBER_REQUIRED:
        "Mandant '{tenantId}' hat keinen Vertragspartner. Ohne ihn wird nichts vereinbart oder berechnet: Zuerst muss der Vertragspartner des Mandanten angelegt werden.",
    SUBSCRIBER_ALREADY_EXISTS: "Mandant '{tenantId}' hat bereits einen Vertragspartner.",
    SUBSCRIBER_NOT_FOUND: "Vertragspartner '{subscriberId}' nicht gefunden",
    SUBSCRIBER_LEGAL_NAME_REQUIRED: 'Ein Vertragspartner braucht seinen rechtlichen Namen.',
    SUBSCRIBER_DETAIL_INVALID: 'Das Feld {field} des Vertragspartners ist ungültig.',
    SUBSCRIBER_IDENTITY_NOT_A_CONTACT:
        '{field} gehört zur rechtlichen Identität des Vertragspartners und ändert sich nur als Korrektur mit Begründung.',
    SUBSCRIBER_CORRECTION_REASON_REQUIRED:
        'Eine Korrektur der rechtlichen Identität braucht eine Begründung.',
    SUBSCRIBER_CORRECTION_ACTOR_REQUIRED:
        'Eine Korrektur der rechtlichen Identität muss nennen, wer sie vornimmt.',
    SUBSCRIBER_CORRECTION_CHANGES_NOTHING:
        'Die Korrektur ändert nichts: Jeder genannte Wert ist bereits erfasst.',
    SUBSCRIBER_TAKEOVER_IS_A_TRANSFER:
        'Übernimmt eine andere Rechtsperson, ist das eine Übertragung und keine Korrektur; sie lässt sich nicht als Änderung erfassen.',
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
    // ── payments ──
    PAYMENTS_NOT_CONFIGURED: 'Zahlungsmethoden können hier noch nicht hinterlegt werden.',
    PAYMENT_GATEWAY_ACCOUNT_UNKNOWN:
        "Unter '{account}' ist kein Konto eines Zahlungsanbieters eingerichtet.",
    PAYMENT_CALLBACK_REJECTED: 'Die Rückmeldung des Zahlungsanbieters ließ sich nicht prüfen.',
    PAYMENT_RETURN_URL_NOT_ALLOWED:
        'Die {field} führt auf eine Seite, zu der diese Installation nicht zurückleitet.',
    PAYMENT_GATEWAY_FAILED:
        'Der Zahlungsanbieter hat nicht wie erwartet geantwortet. Bitte versuche es in ein paar Minuten noch einmal.',
    // ── entitlement (code lives in upsell.types.ts) ──
    [FEATURE_NOT_LICENSED]: 'Das Feature {featureKeys} ist im aktuellen Plan nicht enthalten.',
    // ── settings ──
    SETTINGS_CHANGE_NOT_FOUND: 'Keine aufgezeichnete Einstellungsänderung hat diese ID.',
    // ── maintenance ──
    MAINTENANCE: 'Die Anwendung wird gerade gewartet.',
    MAINTENANCE_WINDOW_ALREADY_OPEN:
        'Es ist bereits ein Wartungsfenster offen. Verschiebe oder streiche es, bevor du ein weiteres ankündigst.',
    MAINTENANCE_WINDOW_NOT_OPEN: 'Kein offenes Wartungsfenster hat diese ID.',
    MAINTENANCE_WINDOW_LOCKED:
        'Dieses Wartungsfenster ist gesperrt. Sein Beginn lässt sich nicht mehr verschieben, und beendet wird es durch Entsperren.',
    MAINTENANCE_WINDOW_END_NOT_AFTER_START:
        'Das Ende eines Wartungsfensters muss nach seinem Beginn liegen.',
    MAINTENANCE_WINDOW_END_IN_PAST:
        'Das Ende eines Wartungsfensters darf nicht in der Vergangenheit liegen.',
    MAINTENANCE_TIME_INVALID:
        '{field} muss Datum und Uhrzeit mit Zeitzone sein, etwa 2026-10-02T22:00+02:00.',
    MAINTENANCE_MESSAGE_TOO_LONG: 'Die Nachricht darf höchstens {max} Zeichen lang sein.',
};
