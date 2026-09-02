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
        "PlanVersion '{versionId}' is already published and cannot be discarded.",
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
    PLAN_VERSION_VALID_FROM_INVALID: "validFrom '{validFrom}' is not a valid date",
    PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS:
        'validFrom ({validFrom}) must be strictly after the validFrom of the previous version ({previousValidFrom}).',
    PLAN_VERSION_VALID_FROM_NOT_GAPLESS:
        'The predecessor has validUntil={previousValidUntil} — the successor must start seamlessly on the next day ({requiredValidFrom}). Received: {received}.',
    PLAN_VERSION_VALID_UNTIL_INVALID: "validUntil '{validUntil}' is not a valid date",
    PLAN_VERSION_VALID_UNTIL_BEFORE_FROM:
        'validUntil ({validUntil}) must be strictly after validFrom ({validFrom}).',
    PLAN_TERMINATE_INVALID_DATE: 'endsAt is not a valid date.',
    PLAN_TERMINATE_DATE_NOT_FUTURE: 'endsAt ({endsAt}) must lie strictly in the future.',
    PLAN_TERMINATE_NOT_IMPLEMENTED:
        'Terminate is not implemented in the current repository. Implement PlanRepository.terminate.',
    BUNDLE_VERSION_ALREADY_PUBLISHED:
        "BundleVersion '{versionId}' is already published and cannot be discarded.",
    BUNDLE_VERSION_NOT_EDITABLE:
        "BundleVersion '{versionId}' is not editable. Only drafts and published versions are editable that are latest-in-chain, bind no subscription yet, and whose validFrom lies in the future.",
    BUNDLE_VERSION_NOT_PUBLISHED:
        "BundleVersion '{bundleVersionId}' is not published and cannot be booked.",
    BUNDLE_VERSION_SUPERSEDED:
        "BundleVersion '{bundleVersionId}' has been superseded by a newer version.",
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
    BUNDLE_VERSION_VALID_FROM_INVALID: "validFrom '{validFrom}' is not a valid date",
    BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS:
        'validFrom ({validFrom}) must be strictly after the validFrom of the previous version ({previousValidFrom}).',
    BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS:
        'The predecessor has validUntil={previousValidUntil} — the successor must start seamlessly on the next day ({requiredValidFrom}). Received: {received}.',
    BUNDLE_VERSION_VALID_FROM_NOT_FUTURE:
        'validFrom ({validFrom}) must, for a published-but-future bundle version, still lie in the future.',
    BUNDLE_VERSION_VALID_UNTIL_INVALID: "validUntil '{validUntil}' is not a valid date",
    BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM:
        'validUntil ({validUntil}) must be strictly after validFrom ({validFrom}).',
    STRICT_MODE_VIOLATIONS: 'The strict-mode check found drift against the discovery snapshot.',
    PLAN_NOT_FOUND: "Plan '{planId}' not found",
    PLAN_VERSION_NOT_FOUND: "PlanVersion '{versionId}' not found",
    BUNDLE_NOT_FOUND: "Bundle '{bundleId}' not found",
    BUNDLE_VERSION_NOT_FOUND: "BundleVersion '{bundleVersionId}' not found",
    FEATURE_NOT_FOUND: "Feature '{featureKey}' not found",
    QUOTA_NOT_FOUND: "Quota '{quotaKey}' not found",
    PROMOTION_NOT_FOUND: "Promotion '{promotionId}' not found",
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
        "BundleVersion '{bundleVersionId}' is not compatible with plan '{planKey}'. Allowed: [{allowedPlanKeys}].",
    BUNDLE_NOT_SELF_SERVICE:
        "Bundle '{bundleKey}' is only activated via a special contract. Please contact the contract manager.",
    BUNDLE_CYCLE_EXCEEDS_PLAN:
        'A yearly bundle cannot run beside a monthly plan: it would still be committed on every day the plan could end.',
    BUNDLE_NOT_PRICED_FOR_THIS_PLAN:
        'This bundle has no {billingCycle} price for the {planKey} plan, so it cannot be booked from here.',
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
    NO_ACTIVE_PLAN_VERSION:
        'No plan version for {planId} active as of {asOf} — neither the validFrom window is satisfied nor is a latest-live version available.',
    PLAN_NOT_IN_CATALOG: 'Plan "{planKey}" is not in the catalog',
    PLAN_NOT_SELF_SERVICE:
        '{planName} is only activated via a special contract. Please contact the contract manager.',
    PLAN_CHANGE_BLOCKED: 'Plan change during onboarding is blocked.',
    SUBSCRIPTION_CHANGED:
        'This subscription changed while the request was being decided. Reload it.',
    NO_SUBSCRIPTION: 'This tenant has no subscription to cancel.',
    CANCELLATION_TERMS_CHANGED:
        'The effective date changed since it was shown. Confirm the new one.',
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
        'A yearly bundle is booked until {until}. A monthly plan cannot carry it — cancel the bundle first, or keep the yearly cycle.',
    REDUNDANT_FEATURES:
        'The plan or another booked bundle already includes {count} of the features in this bundle — booking it pays for them twice.',
    MINIMUM_TERM_BINDS:
        'The minimum term extends beyond the end of the period — the cancellation only takes effect when the minimum term ends.',
    BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED:
        'The bundle requires [{features}] — present neither in the plan nor in the active bundles.',
    NO_PENDING_PLAN_VERSION: 'There is no pending plan version awaiting confirmation.',
    ONBOARDING_CREATE_FAILED: 'The account could not be created. Please try again.',
    BUNDLE_PREVIEW_ARGUMENT_AMBIGUOUS:
        'Exactly one of bundleVersionId (add preview) or subscriptionBundleId (cancel preview) must be given.',
    SUBSCRIPTION_PK_MISSING:
        'The adapter returned a subscription usage record without an id. Pass the subscription primary key through (see SubscriptionUsageRecord.id).',
    LIMIT_EXCEEDED: 'The limit for {dimension} has been reached: {used} of {max}.',
    QUOTA_DIMENSION_UNKNOWN: 'Unknown quota dimension "{dimension}".',
    // ── promo ──
    PROMO_CODE_NOT_FOUND: 'Code not found',
    PROMO_CODE_ALREADY_EXISTS: 'The code already exists.',
    PROMO_CODE_HAS_REDEMPTIONS:
        'The code already has redemptions — it cannot be soft-deleted. Pause it instead.',
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
    CHECKOUT_OFFER_LINE_ITEMS_REQUIRED:
        'A checkout offer can yield only one contract, and only once its line items are frozen.',
    CHECKOUT_OFFER_PLAN_LINE_ITEM_REQUIRED: 'A checkout offer requires a frozen plan line item.',
    CHECKOUT_OFFER_BUNDLE_LINE_ITEMS_REQUIRED:
        'Every selected bundle version requires a frozen bundle line item.',
    CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE:
        'At least one bundle version from the checkout offer is no longer bookable.',
    CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED:
        'The selected plan does not cover all feature dependencies: [{missingRequires}] are missing from the plan + selected bundles.',
    SUBSCRIPTION_CONTRACT_LINE_ITEMS_REQUIRED:
        'A subscription contract requires at least one line item.',
    SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED:
        'A subscription contract requires exactly one plan base item.',
    SUBSCRIPTION_CONTRACT_INVALID_DATE: '{field} must be a valid date.',
    SUBSCRIPTION_CONTRACT_INVALID_WINDOW: 'effectiveUntil must be after effectiveFrom.',
    SUBSCRIPTION_CONTRACT_LINE_ITEM_TAX_MISMATCH:
        "A line item's taxAmount must be exactly priceGross minus priceNet.",
    SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START:
        'effectiveUntil must be after the effectiveFrom of the contract.',
    SUBSCRIPTION_CONTRACT_LINE_ITEM_CURRENCY_MISMATCH:
        'A line item must be booked in the currency its contract was priced in.',
    CHECKOUT_OFFER_NOT_FOUND: "CheckoutOffer '{offerId}' not found",
    CHECKOUT_OFFER_EXPIRED: "Checkout offer '{offerId}' has expired and cannot be {action}",
    CHECKOUT_OFFER_ALREADY_CONSUMED:
        "Checkout offer '{offerId}' has already been consumed and cannot be {action}",
    CHECKOUT_OFFER_NOT_CONSUMED:
        "CheckoutOffer '{offerId}' must be consumed before the contract is created",
    SUBSCRIPTION_CONTRACT_NOT_FOUND: "SubscriptionContract '{contractId}' not found",
    NO_ACTIVE_SUBSCRIPTION_CONTRACT: 'No active subscription contract for tenant {tenantId}',
    SUBSCRIPTION_CONTRACT_ALREADY_CLOSED: "SubscriptionContract '{contractId}' is already closed",
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
    // ── entitlement (code lives in upsell.types.ts) ──
    [FEATURE_NOT_LICENSED]: 'Feature {featureKeys} is not included in the current plan.',
    // ── settings ──
    SETTINGS_CHANGE_NOT_FOUND: 'No recorded settings change has this id.',
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
