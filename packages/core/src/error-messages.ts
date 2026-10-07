// Default English texts for every error code, shipped so a consumer has
// something readable without translating 128 strings first. 21 codes are
// thrown with no message at all (`{ code: 'OTP_INVALID' }`), so for those this
// is the only human-readable text that exists.
//
// The templates are derived from the messages the backend actually sends, with
// `${expr}` rewritten to the `{name}` placeholders `formatErrorMessage`
// understands.
//
// `Record<PlatformErrorCode, string>` over a closed union is what keeps this
// file and its German counterpart in step: a code with no text here is a
// compile error, and so is a text for a code that no longer exists. What the
// type cannot check is that both locales interpolate the SAME placeholders —
// `error-messages.test` does that, and it is the failure worth having, because
// a drifted placeholder renders as `{waitSeconds}` at the reader.
//
// A consumer overlays its own catalogue on top; see `resolveErrorMessage`.

import { FEATURE_NOT_LICENSED } from './upsell.types.js';

import type { PlatformErrorBody, PlatformErrorCode } from './error-codes.js';

export const ERROR_MESSAGES_EN: Record<PlatformErrorCode, string> = {
    // ── setup ──
    SETUP_DISABLED: '{envVar} is not set — setup is disabled.',
    INVALID_SETUP_TOKEN: 'The setup token is not valid.',
    SETUP_ALREADY_DONE: 'Setup has already been completed.',
    INVALID_EMAIL: 'That is not a valid email address.',
    EMAIL_EXISTS: 'An account with this email address already exists.',
    // ── auth ──
    NOT_AUTHENTICATED: 'Not authenticated',
    NO_TENANT_ASSIGNED: 'No tenant assigned',
    TENANT_CONTEXT_MISSING: 'No tenant ID found on the request',
    TENANT_ADMIN_REQUIRED: 'This action requires the TENANT_ADMIN role.',
    BILLING_PERMISSION_REQUIRED: 'This part of the billing area requires the billing permission.',
    SUPER_ADMIN_REQUIRED: 'Only the SUPER_ADMIN role is allowed',
    MFA_NOT_SET_UP: 'Run the MFA setup via the CLI first.',
    MFA_REQUIRED: 'TOTP code required in the X-Mfa-Code header.',
    MFA_FAILED: 'Invalid TOTP code.',
    AUTH_GUARDS_NOT_CONFIGURED: 'TenantBillingModule.forRoot.authGuards is not configured.',
    // ── catalog ──
    PLAN_HAS_DRAFTS:
        "Plan '{planKey}' still has {draftCount} open draft version(s). Discard them first (DELETE /admin/catalog/plan-versions/:id) or publish them.",
    PLAN_HAS_PUBLISHED_VERSIONS:
        "Plan '{planKey}' cannot be {operation} — it has {publishedCount} published version(s) ({liveCount} live, {supersededCount} superseded). Existing subscriptions reference those versions (contract protection P1), so the plan record must be preserved.",
    PLAN_HARD_DELETE_NOT_IMPLEMENTED:
        'Hard delete is not implemented in the current repository. Implement PlanRepository.hardDelete.',
    PLAN_VERSION_ALREADY_PUBLISHED:
        "PlanVersion '{versionId}' is already published; it is not published again or discarded.",
    PLAN_VERSION_NOT_EDITABLE:
        "PlanVersion '{versionId}' is not editable. Only drafts and published versions are editable that are latest-in-chain, bind no subscription yet, and whose validFrom lies in the future.",
    PLAN_VERSION_REGRESSION:
        'This plan version is regressive (feature removed / quota lowered / price raised). Publishing requires an explicit `forceRegressive: true` (UI confirmation dialog with MFA).',
    PLAN_VERSION_ZERO_PRICE:
        'A plan version cannot be published with a price of 0.00 (guard against seed placeholder). For deliberately free special contracts, set allowZeroPrice.',
    PLAN_VERSION_DISCARD_NOT_IMPLEMENTED:
        'Discard is not implemented in the current repository. Implement PlanRepository.deletePlanVersionDraft.',
    PLAN_VERSION_NOT_PUBLISHED:
        "PlanVersion '{versionId}' is not published and cannot be terminated.",
    PLAN_VERSION_SUPERSEDED:
        "PlanVersion '{versionId}' has already been superseded by a newer version and cannot be terminated.",
    PLAN_VERSION_VALID_FROM_REQUIRED:
        'validFrom must be set when publishing (on the draft or the publish call)..',
    PLAN_VERSION_VALID_FROM_INVALID: "validFrom '{validFrom}' is not a day (YYYY-MM-DD)",
    PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS:
        'validFrom ({validFrom}) must be strictly after the validFrom of the previous version ({previousValidFrom}).',
    PLAN_VERSION_VALID_FROM_NOT_GAPLESS:
        'The predecessor has validUntil={previousValidUntil} — the successor must start seamlessly on the next day ({requiredValidFrom}). Received: {received}.',
    PLAN_VERSION_VALID_UNTIL_INVALID: "validUntil '{validUntil}' is not a day (YYYY-MM-DD)",
    PLAN_VERSION_VALID_UNTIL_BEFORE_FROM:
        'validUntil ({validUntil}) must be strictly after validFrom ({validFrom}).',
    PLAN_TERMINATE_INVALID_DATE: 'endsAt is not a valid date.',
    PLAN_TERMINATE_DATE_NOT_FUTURE: 'endsAt ({endsAt}) must lie strictly in the future.',
    PLAN_TERMINATE_NOT_IMPLEMENTED:
        'Terminate is not implemented in the current repository. Implement PlanRepository.terminate.',
    PLAN_TERMINATE_BEFORE_RETIREMENT_MOVES:
        'Subscriptions still move to version {version} of {planKey}, so it can end on {date} at the earliest.',
    PLAN_TERMINATE_WHILE_MOVES_OVERDUE:
        '{count} subscriptions are past their date and still to be moved to version {version} of {planKey}, so it cannot end until they have moved.',
    PLAN_TERMINATE_WHILE_NOTICES_UNDELIVERED:
        '{count} subscriptions have not yet been told that they move to version {version} of {planKey}, so it cannot end until they have been.',
    BUNDLE_VERSION_ALREADY_PUBLISHED:
        "BundleVersion '{versionId}' is already published; it is not published again or discarded.",
    BUNDLE_VERSION_NOT_EDITABLE:
        "BundleVersion '{versionId}' is not editable. Only drafts and published versions are editable that are latest-in-chain, bind no subscription yet, and whose validFrom lies in the future.",
    BUNDLE_VERSION_NOT_PUBLISHED:
        "BundleVersion '{bundleVersionId}' is not published and cannot be booked.",
    BUNDLE_VERSION_SUPERSEDED:
        "BundleVersion '{bundleVersionId}' has been superseded by a newer version.",
    BUNDLE_VERSION_NOT_YET_ON_SALE:
        "BundleVersion '{bundleVersionId}' goes on sale on {validFrom} and cannot be booked before.",
    BUNDLE_DELETED:
        "Bundle '{bundleKey}' has been deleted from the catalogue and cannot be booked.",
    BUNDLE_VERSION_REGRESSION:
        'This bundle version is regressive (feature removed / quota lowered / price raised). Publishing requires an explicit `forceRegressive: true` (UI confirmation dialog with MFA).',
    BUNDLE_VERSION_ZERO_PRICE:
        'A bundle version cannot be published with an explicit price of 0.00 (guard against seed placeholders). For free bundles leave it null, or set allowZeroPrice.',
    BUNDLE_VERSION_NO_PRICE:
        'This bundle version cannot be published without a price: neither a base price nor any plan override resolves one.',
    BUNDLE_VERSION_NOT_PRICED_FOR_PLAN:
        "This bundle is offered to plan '{planKey}', which is sold {billingCycle}, and no {billingCycle} price resolves for it — neither a base price nor a plan override.",
    BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED:
        'Discard is not implemented in the current repository. Implement BundleRepository.deleteDraft.',
    BUNDLE_VERSION_VALID_FROM_REQUIRED:
        'Published bundle versions must keep a validFrom. Set a new future date, or edit the draft before publishing.',
    BUNDLE_VERSION_VALID_FROM_INVALID: "validFrom '{validFrom}' is not a day (YYYY-MM-DD)",
    BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS:
        'validFrom ({validFrom}) must be strictly after the validFrom of the previous version ({previousValidFrom}).',
    BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS:
        'The predecessor has validUntil={previousValidUntil} — the successor must start seamlessly on the next day ({requiredValidFrom}). Received: {received}.',
    BUNDLE_VERSION_VALID_FROM_NOT_FUTURE:
        'validFrom ({validFrom}) must, for a published-but-future bundle version, still lie in the future.',
    BUNDLE_VERSION_VALID_UNTIL_INVALID: "validUntil '{validUntil}' is not a day (YYYY-MM-DD)",
    BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM:
        'validUntil ({validUntil}) must be strictly after validFrom ({validFrom}).',
    STRICT_MODE_VIOLATIONS: 'The strict-mode check found drift against the discovery snapshot.',
    PLAN_NOT_FOUND: "Plan '{planId}' not found",
    PLAN_VERSION_NOT_FOUND: "PlanVersion '{versionId}' not found",
    BUNDLE_NOT_FOUND: "Bundle '{bundleId}' not found",
    BUNDLE_DELETE_WHILE_RETIREMENT_MOVES_PENDING:
        '{count} bookings still move onto a version of {bundleKey}, as a retirement told them. The add-on can be deleted once they have.',
    BUNDLE_VERSION_NOT_FOUND: "BundleVersion '{bundleVersionId}' not found",
    FEATURE_NOT_FOUND: "Feature '{featureKey}' not found",
    QUOTA_NOT_FOUND: "Quota '{quotaKey}' not found",
    PROMOTION_NOT_FOUND: "Promotion '{promotionId}' not found",
    PROMOTION_VALUE_INVALID:
        "The value of a '{type}' promotion is not one its type takes: a percentage above 0 and at most 100, an amount above 0, an intro price of at least 0 for a whole number of months, or a whole number of free months.",
    MARKETING_PROJECTION_NOT_FOUND: "MarketingProjection '{projectionId}' not found",
    PLAN_ALREADY_EXISTS: "Plan '{planKey}' already exists",
    BUNDLE_ALREADY_EXISTS: "Bundle '{bundleKey}' already exists",
    MARKETING_PROJECTION_ALREADY_EXISTS:
        'Marketing projection for {targetType}/{targetVersionId}/{locale} already exists — use PATCH to edit it',
    PLAN_DRAFT_ALREADY_EXISTS:
        "Plan '{planKey}' already has a draft version v{draftVersion}; publish or discard it first",
    BUNDLE_DRAFT_ALREADY_EXISTS:
        "Bundle '{bundleKey}' already has a draft version v{draftVersion}; publish or discard it first",
    QUOTA_NOT_IN_DISCOVERY_SNAPSHOT:
        "Quota '{quotaKey}' is not in the discovery snapshot — a quota that is not declared in code cannot be approved",
    DISCOVERY_STATUS_TRANSITION_INVALID: "Transition '{from}' → '{to}' is not allowed",
    DISCOVERY_NOT_INITIALIZED:
        'Approval requires a discovery snapshot — discovery is not initialised (#25)',
    // ── catalogue import ──
    PLAN_CATALOG_UNREADABLE:
        'That file is not a plan catalog — it could not be read as one. Check that it is the YAML your app declares its plans in.',
    PLAN_CATALOG_INVALID: 'The plan catalog was read, and then rejected: {message}',
    // ── billing ──
    BUNDLE_ALREADY_SUBSCRIBED:
        "Subscription '{subscriptionId}' has already actively booked this bundle.",
    BUNDLE_INCOMPATIBLE_WITH_PLAN:
        'This bundle cannot be booked on the {planKey} plan. The plans that can book it: {allowedPlanKeys}.',
    BUNDLE_NOT_SELF_SERVICE:
        "Bundle '{bundleKey}' is only activated via a special contract. Please contact the contract manager.",
    BUNDLE_CYCLE_EXCEEDS_PLAN:
        'A yearly bundle cannot run beside a monthly plan: it would still be committed on every day the plan could end.',
    BUNDLE_NOT_PRICED_FOR_THIS_PLAN:
        'This bundle has no price for the {planKey} plan in this billing cycle, so it cannot be booked from here.',
    BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN:
        'This bundle cannot run on the {planKey} plan, which the subscription moves to with effect from {from}.',
    BUNDLE_CANNOT_RUN_ON_UPCOMING_CYCLE:
        'A yearly bundle cannot run beside the monthly billing the subscription moves to with effect from {from}.',
    SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED:
        "SubscriptionBundle '{subscriptionBundleId}' is already cancelled.",
    SUBSCRIPTION_BUNDLE_NOT_CANCELLED:
        "SubscriptionBundle '{subscriptionBundleId}' is not cancelled.",
    SUBSCRIPTION_BUNDLE_CANCELLATION_EFFECTIVE:
        'Cancellation already in effect — book the bundle again.',
    SUBSCRIPTION_NOT_FOUND: 'No subscription for tenant {tenantId}',
    SUBSCRIPTION_TENANT_MISMATCH: 'Subscription does not belong to the tenant',
    SUBSCRIPTION_BUNDLE_NOT_FOUND: "SubscriptionBundle '{subscriptionBundleId}' not found",
    TENANT_NOT_FOUND: 'Tenant {slug} not found',
    NO_ACTIVE_PLAN_VERSION: 'No version of plan {planId} is on sale as of {asOf}.',
    BOUND_PLAN_VERSION_UNREADABLE:
        'The plan version this subscription is bound to ({planVersionId}) cannot be read for plan "{planKey}", so no change can be quoted.',
    PLAN_NOT_IN_CATALOG: 'Plan "{planKey}" is not in the catalog',
    PLAN_NOT_SELF_SERVICE:
        '{planName} is only activated via a special contract. Please contact the contract manager.',
    PLAN_NOT_SOLD_IN_CYCLE:
        '{planName} has no price for this billing rhythm and cannot be booked in it.',
    PLAN_CHANGE_BLOCKED: 'Plan change during onboarding is blocked.',
    SUBSCRIPTION_CHANGED:
        'This subscription changed while the request was being decided. Reload it.',
    NO_SUBSCRIPTION: 'This tenant has no subscription to cancel.',
    CANCELLATION_TERMS_CHANGED:
        'The effective date changed since it was shown. Confirm the new one.',
    VERSION_OFFER_CHANGED:
        'The offer changed since it was shown. Look at the current one before switching.',
    PLAN_CHANGE_QUOTE_CHANGED:
        'This plan changed since it was shown. Look at it again before changing to it.',
    PLAN_CHANGE_VERSION_NOT_NAMED: 'A plan change has to name the version its preview showed.',
    VERSION_SWITCH_AFTER_CANCELLATION:
        'This subscription ends before this version would take effect, so it cannot be switched to.',
    VERSION_ENDS_BEFORE_SWITCH:
        'This version stops being sold before it would take effect, so it cannot be switched to.',
    RETIREMENT_TERMS_NOT_CONFIRMED:
        'Retiring a version for running subscriptions needs a clause in your terms. Set tenantBilling.orderlyRetirement.termsConfirmed in config/saas.yaml once they carry it.',
    RETIREMENT_VERSION_ON_SALE:
        'Version {version} of {planKey} is still on sale. End its sale first, so nobody books it after the announcement.',
    RETIREMENT_REPLACEMENT_NOT_ON_SALE:
        'Version {version} of {planKey} is not on sale, so subscriptions cannot continue on it.',
    RETIREMENT_REPLACEMENT_NOT_SOLD_IN_RHYTHM:
        '{count} of these subscriptions are billed in a rhythm version {version} of {planKey} has no price for, so they cannot continue on it.',
    RETIREMENT_REPLACEMENT_CANNOT_CARRY_BUNDLES:
        '{count} of these subscriptions hold a bundle that cannot run on version {version} of {planKey}, so they cannot continue on it.',
    RETIREMENT_REPLACEMENT_IS_RETIRED: 'A version cannot be its own replacement.',
    RETIREMENT_NOTHING_AFFECTED:
        'No running subscription is on version {version} of {planKey}, so there is nobody to tell.',
    RETIREMENT_WITHIN_TWELVE_MONTHS:
        '{count} of these subscriptions were reached by a retirement within the last twelve months. A subscription is reached at most once a year.',
    RETIREMENT_PREVIEW_CHANGED:
        'The subscriptions this retirement reaches changed since they were shown. Look at them again before announcing it.',
    BUNDLE_RETIREMENT_VERSION_ON_SALE:
        'Version {version} of {bundleKey} is still on sale. Publish the version that replaces it, and retire this one once its sale has ended, so nobody books it after the announcement.',
    BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE:
        'Version {version} of {bundleKey} is not on sale, so bookings cannot continue on it.',
    BUNDLE_RETIREMENT_REPLACEMENT_OF_ANOTHER_BUNDLE:
        'The replacement is a version of {replacementBundleKey}, not of {bundleKey}. A booking continues on a version of its own add-on.',
    BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN:
        '{count} of these bookings run beside a plan that version {version} of {bundleKey} cannot run beside, so they cannot continue on it.',
    BUNDLE_RETIREMENT_NOTHING_AFFECTED:
        'No running booking is on version {version} of {bundleKey}, so there is nobody to tell.',
    BUNDLE_RETIREMENT_REINSTATE_REFUSED:
        'Version {version} of {bundleKey} is being retired, and this booking ends before it would move. Book version {replacementVersion} from {bookableFrom}, when this booking has ended.',
    BUNDLE_RETIREMENT_REINSTATE_REPLACEMENT_CANNOT_RUN:
        'Version {version} of {bundleKey} is being retired, and this booking ends before it would move. Version {replacementVersion}, which replaces it, cannot run beside your plan, or beside one your subscription is set to move to.',
    BUNDLE_RETIREMENT_REINSTATE_SUBSCRIPTION_ENDS:
        'Version {version} of {bundleKey} is being retired, and this booking ends before it would move. Your subscription ends by then as well.',
    BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES:
        '{bundleName} moves to its new version on {date}, and your plan changes before then, so the price a switch would keep is not known yet. Switch once your plan has changed, or let it move on that date.',
    BUNDLE_VERSION_OFFER_CHANGED:
        'The offer changed since it was shown. Look at the current one before switching.',
    FEATURE_WITHDRAWAL_UNAVAILABLE:
        'Withdrawing a feature is not offered here: the stores cannot list everybody a withdrawal reaches.',
    FEATURE_WITHDRAWAL_FEATURE_UNKNOWN: 'The catalogue knows no feature {featureKey}.',
    FEATURE_WITHDRAWAL_DATE_IN_PAST:
        'A feature is withdrawn from now on or from a later date, never from a date already past.',
    FEATURE_WITHDRAWAL_OPEN:
        '{featureKey} is withdrawn already, and that withdrawal is not lifted. Lift it before announcing another.',
    FEATURE_WITHDRAWAL_OVERLAPS:
        '{featureKey} is withdrawn until {date}. Another withdrawal can begin on that date at the earliest.',
    FEATURE_WITHDRAWAL_REDUCTION_NOT_REACHED:
        'The reduction for {key} billed {billingCycle} names nothing this withdrawal reaches.',
    FEATURE_WITHDRAWAL_REDUCTION_NAMED_TWICE:
        'The reduction for {key} billed {billingCycle} is named twice.',
    FEATURE_WITHDRAWAL_REDUCTION_EXCEEDS_PRICE:
        'The reduction for {key} billed {billingCycle} is more than the lowest price it reduces, {price}.',
    FEATURE_WITHDRAWAL_PREVIEW_CHANGED:
        'The subscriptions this withdrawal reaches changed since they were shown. Look at them again before announcing it.',
    FEATURE_WITHDRAWAL_NOT_FOUND: 'Feature withdrawal {withdrawalId} not found.',
    FEATURE_WITHDRAWAL_ALREADY_LIFTED: 'This withdrawal is lifted already, from {date}.',
    FEATURE_WITHDRAWAL_LIFT_IN_PAST:
        'A withdrawal is lifted from now on or from a later date, never from a date already past.',
    FEATURE_WITHDRAWAL_NOT_IN_EFFECT:
        '{featureKey} is not withdrawn now, so nothing can be ended at once because of it.',
    FEATURE_WITHDRAWAL_DOES_NOT_REACH:
        'This withdrawal does not reach your subscription, or no longer this booking.',
    FEATURE_WITHDRAWAL_ALREADY_ENDED: 'This has ended already.',
    FEATURE_WITHDRAWAL_END_NOW_UNSUPPORTED:
        'Your cancellation for {date} is recorded, and it cannot be brought forward here. It ends on that date, and until then the reduction applies.',
    RETIREMENT_SWITCH_NOT_PENDING:
        'No retirement of your version is waiting for its date, so there is nothing to switch to.',
    RETIREMENT_SWITCH_IN_TRIAL: 'The switch opens when your trial ends.',
    RETIREMENT_SWITCH_BUNDLE_CANNOT_FOLLOW:
        '{bundleName} cannot run on {planName} and runs until {until} at the earliest. Once it is cancelled, the switch can be made from that day.',
    RETIREMENT_SWITCH_BUNDLE_REPLACEMENT_CANNOT_FOLLOW:
        '{bundleName} continues on version {version} from {from}, which cannot run on {planName}. Once it is cancelled, the switch can be made.',
    RETIREMENT_SWITCH_NOT_OPEN:
        'This subscription cannot switch now: a change is scheduled, it has ended, or its plan is held for a special contract.',
    RETIREMENT_SWITCH_CHANGED:
        'The retirement changed since it was shown. Look at it again before switching.',
    SUBSCRIPTION_ENDED: 'This subscription has ended. Its plan can no longer be changed.',
    PLAN_LOCKED:
        'Active {planName} special contract — please contact the contract manager to change plans.',
    QUOTA_OVER_TARGET:
        'Current usage {used} exceeds the target limit {targetMax} ({quotaKey}) in the {planName} plan. Please reduce usage first.',
    FEATURE_LOST:
        'Switching means losing access to one feature. Existing data is retained and never deleted — upgrading again unlocks it.',
    FEATURES_LOST:
        'Switching means losing access to {count} features. Existing data is retained and never deleted — upgrading again unlocks it.',
    NO_CHANGE: 'Target plan and billing cycle already match the current state.',
    CANCELLATION_LOCKS_THE_CYCLE:
        'This subscription is cancelled, so its billing cycle cannot change. The plan can — keep the current cycle to change it today.',
    CYCLE_SHORTENS_AT_TERM_END:
        'A monthly {planName} cannot start inside the yearly term you are in. The upgrade takes effect when that term ends; to have it today, keep the yearly cycle.',
    BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE:
        '{bundleName} is billed yearly and runs until {until} at the earliest, which a monthly plan cannot carry. Once it is cancelled, a change that takes effect on or after that day goes through — or keep the yearly cycle.',
    BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN:
        '{bundleName} cannot run on {planName} and runs until {until} at the earliest. Once it is cancelled, a change that takes effect on or after that day goes through — or choose another plan.',
    BUNDLE_REPLACEMENT_DOES_NOT_FIT_TARGET_PLAN:
        '{bundleName} continues on version {version} from {from}, which cannot run on {planName}. Cancel it, and the change goes through — or choose another plan.',
    REDUNDANT_FEATURES:
        'The plan or another booked bundle already includes {count} of the features in this bundle — booking it pays for them twice.',
    MINIMUM_TERM_BINDS:
        'The minimum term extends beyond the end of the period — the cancellation only takes effect when the minimum term ends.',
    BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED:
        'The bundle requires [{features}] — present neither in the plan nor in the active bundles.',
    ONBOARDING_CREATE_FAILED: 'The account could not be created. Please try again.',
    BUNDLE_PREVIEW_ARGUMENT_AMBIGUOUS:
        'Exactly one of bundleVersionId (add preview) or subscriptionBundleId (cancel preview) must be given.',
    SUBSCRIPTION_PK_MISSING:
        'The adapter returned a subscription usage record without an id. Pass the subscription primary key through (see SubscriptionUsageRecord.id).',
    LIMIT_EXCEEDED: 'The limit for {dimension} has been reached: {used} of {max}.',
    QUOTA_DIMENSION_UNKNOWN: 'Unknown quota dimension "{dimension}".',
    // ── promo ──
    PROMO_CODE_NOT_FOUND: 'Code not found',
    PROMO_CODE_ALREADY_EXISTS:
        'The code exists, or a deleted code carries it; a deleted code keeps its name.',
    PROMO_CODE_HAS_REDEMPTIONS:
        'The code already has redemptions, or checkouts holding one — it cannot be soft-deleted. Pause it instead.',
    PROMO_CODE_NOT_REDEEMABLE: 'Code cannot be redeemed: {reason}',
    PROMO_CODE_FORMAT_INVALID:
        'The code may only contain upper-case letters, digits, "-" and "_" (4–32 characters).',
    PROMO_PERCENT_OUT_OF_RANGE: 'The percentage must be between 0 and 100.',
    PROMO_AMOUNT_NOT_POSITIVE: 'The amount must be positive.',
    PROMO_ONE_OFF_WITH_DURATION: 'A one-off discount must not set a duration.',
    PROMO_DURATION_INVALID: 'Invalid duration (at most 24 months or billing periods).',
    PROMO_VALIDITY_WINDOW_INVALID: 'Invalid validity window.',
    PROMO_PLAN_NOT_DISCOUNTABLE: '{plan}-Plan cannot be discounted.',
    PROMO_MIN_AMOUNT_NOT_POSITIVE: 'The minimum plan gross amount must be positive.',
    PROMO_WOULD_PRODUCE_ZERO_INVOICE:
        'For absolute amounts the discount must stay below the lowest applicable plan price, or allowZeroInvoice must be enabled.',
    PROMO_MAX_REDEMPTIONS_LOWERED: 'maxRedemptions cannot be lowered.',
    // ── contract ──
    SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_DECIDED:
        'The contract states {stated} % in {field}, and the tax adapter decides {decided} %.',
    CHECKOUT_OFFER_LINE_ITEMS_REQUIRED:
        'A checkout offer can yield only one contract, and only once its line items are frozen.',
    CHECKOUT_OFFER_PLAN_LINE_ITEM_REQUIRED: 'A checkout offer requires a frozen plan line item.',
    CHECKOUT_OFFER_BUNDLE_LINE_ITEMS_REQUIRED:
        'Every selected bundle version requires a frozen bundle line item.',
    CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE:
        'At least one bundle version from the checkout offer is no longer bookable.',
    CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED:
        'The selected plan does not cover all feature dependencies: [{missingRequires}] are missing from the plan + selected bundles.',
    CHECKOUT_OFFER_PLAN_NOT_OFFERED:
        "Plan '{planKey}' is not offered with a {billingCycle} price at the moment.",
    CHECKOUT_OFFER_BUNDLE_NOT_OFFERED:
        "Bundle version '{bundleVersionId}' cannot be added to this offer ({reason}).",
    CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED:
        'The promo code cannot be applied to this offer ({reason}).',
    CHECKOUT_OFFER_PRICE_NOT_CURRENT:
        "The prices of checkout offer '{offerId}' no longer match the catalogue; create a new offer.",
    SUBSCRIPTION_CONTRACT_LINE_ITEMS_REQUIRED:
        'A subscription contract requires at least one line item.',
    SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED:
        'A subscription contract requires exactly one plan base item.',
    SUBSCRIPTION_CONTRACT_INVALID_DATE: '{field} must be a valid date.',
    SUBSCRIPTION_CONTRACT_INVALID_WINDOW: 'effectiveUntil must be after effectiveFrom.',
    SUBSCRIPTION_CONTRACT_LINE_ITEM_TAX_MISMATCH:
        "A line item's taxAmount must be exactly priceGross minus priceNet.",
    SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_PERCENT:
        'A subscription contract states a tax rate of {taxRate} at {field}, which is not a percentage: a rate lies from 0 to 100, and a value between 0 and 1 is refused as a fraction.',
    SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START:
        'effectiveUntil must be after the effectiveFrom of the contract.',
    SUBSCRIPTION_CONTRACT_LINE_ITEM_CURRENCY_MISMATCH:
        'A line item must be booked in the currency its contract was priced in.',
    SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP:
        'The line items of a subscription contract add up to {lines} for {field}, but the contract states {stated}.',
    SUBSCRIPTION_CONTRACT_DISCOUNT_NEGATIVE:
        'A subscription contract states a discount of {amount} at {field}; a discount takes money off and is never negative.',
    CHECKOUT_OFFER_NOT_FOUND: "CheckoutOffer '{offerId}' not found",
    CHECKOUT_OFFER_EXPIRED: "Checkout offer '{offerId}' has expired and cannot be {action}",
    CHECKOUT_OFFER_ALREADY_CONSUMED:
        "Checkout offer '{offerId}' has already been consumed and cannot be {action}",
    CHECKOUT_OFFER_NOT_CONSUMED:
        "CheckoutOffer '{offerId}' must be consumed before the contract is created",
    CHECKOUT_OFFER_CHANGED:
        "Checkout offer '{offerId}' changed while it was being concluded. Load it again.",
    CHECKOUT_OFFER_CONTRACT_IN_FORCE:
        "Checkout offer '{offerId}' concludes a first contract, and this tenant already has one. A running subscription changes through its plan and its add-ons.",
    CHECKOUT_OFFER_ADD_ON_BOOKED_IN_ANOTHER_VERSION:
        "Checkout offer '{offerId}' names version {offeredVersion} of add-on '{bundleKey}', which this tenant has booked in version {bookedVersion} (booking {subscriptionBundleId}). Its version changes through the offer beside the add-on.",
    SUBSCRIPTION_CONTRACT_NOT_FOUND: "SubscriptionContract '{contractId}' not found",
    NO_ACTIVE_SUBSCRIPTION_CONTRACT: 'No active subscription contract for tenant {tenantId}',
    SUBSCRIPTION_CONTRACT_ALREADY_CLOSED: "SubscriptionContract '{contractId}' is already closed",
    SUBSCRIPTION_CONTRACT_CHANGED:
        "The contracts of tenant '{tenantId}' changed while a successor was being written, or one begins after the moment it would take effect, so it would run beside another. Nothing was written.",
    // ── subscriber ──
    SUBSCRIBER_REQUIRED:
        "Tenant '{tenantId}' has no subscriber. Nothing is agreed or charged without the party to it: create the tenant's subscriber first.",
    SUBSCRIBER_ALREADY_EXISTS: "Tenant '{tenantId}' already has a subscriber.",
    SUBSCRIBER_NOT_FOUND: "Subscriber '{subscriberId}' not found",
    SUBSCRIBER_LEGAL_NAME_REQUIRED: 'A subscriber needs its legal name.',
    SUBSCRIBER_DETAIL_INVALID: "The subscriber's {field} is not valid.",
    SUBSCRIBER_IDENTITY_INCOMPLETE:
        "The subscriber's billing address is not complete yet: a contract names it only with street and number, postal code, city and country.",
    SUBSCRIBER_IDENTITY_NOT_A_CONTACT:
        "{field} is part of the subscriber's legal identity and changes only as a correction, with a reason.",
    SUBSCRIBER_BUSINESS_STATUS_REASON_REQUIRED:
        'A change of whether the subscriber is a business needs a reason.',
    SUBSCRIBER_VAT_ID_MISSING: 'The subscriber has no VAT identification number to check.',
    SUBSCRIBER_CORRECTION_REASON_REQUIRED: 'A correction of the legal identity needs a reason.',
    SUBSCRIBER_CORRECTION_ACTOR_REQUIRED:
        'A correction of the legal identity has to say who makes it.',
    SUBSCRIBER_CORRECTION_CHANGES_NOTHING:
        'The correction changes nothing: every value it names is already recorded.',
    SUBSCRIBER_TAKEOVER_IS_A_TRANSFER:
        'Another legal entity taking over a subscriber is a transfer, not a correction, and cannot be recorded as an edit.',
    SUBSCRIBER_BUSINESS_STATUS_NOT_A_CONTACT:
        'Whether the subscriber is a business is part of its tax origin and changes only as a recorded change that names who made it.',
    SUBSCRIBER_CHANGE_ACTOR_REQUIRED:
        "A change of the subscriber's details has to say who makes it.",
    // ── registration ──
    PENDING_REGISTRATION_NOT_FOUND:
        'This registration could not be found. It may have already been completed or discarded.',
    PENDING_REGISTRATION_EXPIRED: 'This registration has expired. Please start again.',
    INVALID_REGISTRATION_STATE:
        'This step is not available at the current stage of the registration.',
    OTP_INVALID: 'That code is not correct. Please check it and try again.',
    OTP_EXPIRED: 'That code has expired. Please request a new one.',
    OTP_LOCKED: 'Too many incorrect attempts. Please request a new code.',
    RATE_LIMITED: 'Too many attempts. Please try again in {retryAfterSeconds} seconds.',
    RESUME_TOKEN_INVALID: 'This resume link is no longer valid. Please request a new one.',
    RESUME_NOT_CONFIGURED: 'Resuming a registration is not available.',
    CONFIGURATOR_NOT_CONFIGURED: 'The configurator is not available.',
    CONFIG_NOT_SAVED: 'The configuration could not be saved.',
    PLAN_NOT_AVAILABLE: 'This plan is not available.',
    PLAN_NOT_SELECTED: 'Please select a plan first.',
    MODEL_NOT_AVAILABLE: 'This option is not available.',
    // ── payments ──
    PAYMENTS_NOT_CONFIGURED: 'Payment methods cannot be set up here yet.',
    PAYMENT_GATEWAY_ACCOUNT_UNKNOWN: "No payment gateway account is configured under '{account}'.",
    PAYMENT_CALLBACK_REJECTED: 'The payment callback could not be verified.',
    PAYMENT_RETURN_URL_NOT_ALLOWED:
        'The {field} leads to a site this installation does not return to.',
    PAYMENT_GATEWAY_FAILED:
        'The payment provider did not answer as expected. Please try again in a few minutes.',
    // ── entitlement (code lives in upsell.types.ts) ──
    [FEATURE_NOT_LICENSED]: 'Feature {featureKeys} is not included in the current plan.',
    // ── settings ──
    SETTINGS_CHANGE_NOT_FOUND: 'No recorded settings change has this id.',
    // ── maintenance ──
    MAINTENANCE: 'The application is under maintenance.',
    MAINTENANCE_WINDOW_ALREADY_OPEN:
        'A maintenance window is already open. Move or cancel it before announcing another.',
    MAINTENANCE_WINDOW_NOT_OPEN: 'No open maintenance window has this id.',
    MAINTENANCE_WINDOW_LOCKED:
        'This maintenance window is locked. Its start cannot move, and unlocking is what ends it.',
    MAINTENANCE_WINDOW_END_NOT_AFTER_START:
        'The end of a maintenance window has to be after its start.',
    MAINTENANCE_WINDOW_END_IN_PAST: 'The end of a maintenance window cannot be in the past.',
    MAINTENANCE_TIME_INVALID:
        'The {field} has to be a date and time with its zone, such as 2026-10-02T22:00+02:00.',
    MAINTENANCE_MESSAGE_TOO_LONG: 'The message may be at most {max} characters long.',
    // ── tax ──
    TAX_TREATMENT_NOT_SUPPORTED: 'The tax adapter {adapter} does not support this case: {reason}',
    TAX_VAT_ID_CHECK_NOT_COMPLETED:
        'The VAT identification number could not be checked just now ({reason}). Please try again later.',
    TAX_VAT_ID_CHECK_NOT_AVAILABLE:
        'This installation names no tax adapter, so no VAT identification number is checked.',
};

/** Values available for interpolation into a message template. */
export type ErrorMessageParams = Record<string, unknown>;

/**
 * Replaces `{name}` with `params.name`. An unknown placeholder is left
 * verbatim, so a missing value is visible in the UI rather than silently
 * vanishing.
 */
export function formatErrorMessage(template: string, params: ErrorMessageParams = {}): string {
    return template.replace(/\{(\w+)\}/g, (match, name: string) => {
        const value = params[name];
        return value === undefined || value === null ? match : String(value);
    });
}

/**
 * An error body this function can read.
 *
 * `code` is widened past `PlatformErrorCode` on purpose. The function checks
 * `typeof body.code === 'string'` and resolves whatever it finds, and the
 * `overrides` parameter exists so a consumer can bring its own codes — one
 * consumer carries 98 of them against the platform's 135, overlapping in five.
 * A closed union here would reject exactly the case the parameter is for, and
 * the cast that works around it is one a reader has to be told is deliberate.
 *
 * `PlatformErrorBody` stays closed: a body the *platform* produces really does
 * carry a platform code. It is the reader that has to accept more. The same
 * shape appears in `SaLocale` next door, for the same reason.
 */
export type ResolvableErrorBody = Omit<Partial<PlatformErrorBody>, 'code'> &
    Record<string, unknown> & { code?: PlatformErrorCode | (string & {}) };

/**
 * Turns an error body into display text.
 *
 * Falls back in this order: the consumer's own catalogue, the shipped default,
 * the English `message` the backend sent, and only then the bare code. Because
 * every coded exception carries a message, the last step is unreachable in
 * practice — a consumer that has not translated a new code yet shows English
 * prose, never `PLAN_VERSION_SUPERSEDED`.
 *
 * Interpolation reads `params` first and the remaining top-level body fields
 * second, so a template may name either without the value being duplicated on
 * the wire.
 */
export function resolveErrorMessage(
    body: ResolvableErrorBody,
    overrides: Partial<Record<string, string>> = {},
    defaults: Partial<Record<string, string>> = ERROR_MESSAGES_EN,
): string {
    const code = typeof body.code === 'string' ? body.code : undefined;
    const template = (code && (overrides[code] ?? defaults[code])) ?? undefined;
    if (!template) {
        return typeof body.message === 'string' ? body.message : (code ?? '');
    }
    const { params, ...rest } = body;
    return formatErrorMessage(template, { ...rest, ...(params as ErrorMessageParams) });
}
