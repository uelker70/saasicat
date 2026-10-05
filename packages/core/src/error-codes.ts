import { FEATURE_NOT_LICENSED } from './upsell.types.js';

// Central error codes shared by backend AND frontend. Single source of
// truth, so that service response and UI mapping do not silently drift
// apart. String literals stay stable as the wire format.
//
// The code is the contract, not the message. Consumers resolve their own i18n
// by code; `message` is an English developer-facing fallback and may be
// reworded at any time. Renaming or removing a code is a breaking change.
//
// Scope: codes carried by thrown exceptions. Codes that travel inside
// successful responses live with their own payload type — strict-mode
// warnings in `bundle.types.ts`, plan-change and bundle-preview blockers in
// the respective preview types.

/** Codes of the first-run setup endpoints (`SetupController`). */
export const SETUP_ERROR_CODES = {
    /** `SETUP_TOKEN` env not set → setup disabled. */
    SETUP_DISABLED: 'SETUP_DISABLED',
    /** Provided token does not match. */
    INVALID_SETUP_TOKEN: 'INVALID_SETUP_TOKEN',
    /** A SUPER_ADMIN already exists — self-disable. */
    SETUP_ALREADY_DONE: 'SETUP_ALREADY_DONE',
    /** Invalid email in the request. */
    INVALID_EMAIL: 'INVALID_EMAIL',
    /** Email already taken (mapped from `PlatformUserExistsError`). */
    EMAIL_EXISTS: 'EMAIL_EXISTS',
} as const;

export type SetupErrorCode = (typeof SETUP_ERROR_CODES)[keyof typeof SETUP_ERROR_CODES];

/** Plan and bundle lifecycle in the admin catalogue. */
export const CATALOG_ERROR_CODES = {
    // ── plan master data ──
    PLAN_HAS_DRAFTS: 'PLAN_HAS_DRAFTS',
    PLAN_HAS_PUBLISHED_VERSIONS: 'PLAN_HAS_PUBLISHED_VERSIONS',
    PLAN_HARD_DELETE_NOT_IMPLEMENTED: 'PLAN_HARD_DELETE_NOT_IMPLEMENTED',

    // ── plan versions ──
    PLAN_VERSION_ALREADY_PUBLISHED: 'PLAN_VERSION_ALREADY_PUBLISHED',
    PLAN_VERSION_NOT_EDITABLE: 'PLAN_VERSION_NOT_EDITABLE',
    PLAN_VERSION_REGRESSION: 'PLAN_VERSION_REGRESSION',
    PLAN_VERSION_ZERO_PRICE: 'PLAN_VERSION_ZERO_PRICE',
    PLAN_VERSION_DISCARD_NOT_IMPLEMENTED: 'PLAN_VERSION_DISCARD_NOT_IMPLEMENTED',
    /** Version was never published, so it cannot be terminated. */
    PLAN_VERSION_NOT_PUBLISHED: 'PLAN_VERSION_NOT_PUBLISHED',
    /** Version was replaced by a successor (`supersededAt` set). */
    PLAN_VERSION_SUPERSEDED: 'PLAN_VERSION_SUPERSEDED',
    PLAN_VERSION_VALID_FROM_REQUIRED: 'PLAN_VERSION_VALID_FROM_REQUIRED',
    PLAN_VERSION_VALID_FROM_INVALID: 'PLAN_VERSION_VALID_FROM_INVALID',
    PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS: 'PLAN_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS',
    PLAN_VERSION_VALID_FROM_NOT_GAPLESS: 'PLAN_VERSION_VALID_FROM_NOT_GAPLESS',
    PLAN_VERSION_VALID_UNTIL_INVALID: 'PLAN_VERSION_VALID_UNTIL_INVALID',
    PLAN_VERSION_VALID_UNTIL_BEFORE_FROM: 'PLAN_VERSION_VALID_UNTIL_BEFORE_FROM',
    PLAN_TERMINATE_INVALID_DATE: 'PLAN_TERMINATE_INVALID_DATE',
    PLAN_TERMINATE_DATE_NOT_FUTURE: 'PLAN_TERMINATE_DATE_NOT_FUTURE',
    PLAN_TERMINATE_NOT_IMPLEMENTED: 'PLAN_TERMINATE_NOT_IMPLEMENTED',
    /**
     * Subscriptions told of a retirement still move onto this version, and
     * nothing moves onto a version that has ended. Carries the version, its
     * plan key and the first day it may end: the day after the last move.
     */
    PLAN_TERMINATE_BEFORE_RETIREMENT_MOVES: 'PLAN_TERMINATE_BEFORE_RETIREMENT_MOVES',
    /**
     * Subscriptions told of a retirement are past their date and still to be
     * moved onto this version — a move the platform could not make yet — so it
     * cannot end until they have moved. Carries how many, the version and its
     * plan key.
     */
    PLAN_TERMINATE_WHILE_MOVES_OVERDUE: 'PLAN_TERMINATE_WHILE_MOVES_OVERDUE',
    /**
     * Subscriptions on a retired version have not yet been told of their move
     * onto this version — their notice has reached nobody, so their date is not
     * set — and it cannot end until they have been. Carries how many, the
     * version and its plan key.
     */
    PLAN_TERMINATE_WHILE_NOTICES_UNDELIVERED: 'PLAN_TERMINATE_WHILE_NOTICES_UNDELIVERED',

    // ── bundle versions ──
    BUNDLE_VERSION_ALREADY_PUBLISHED: 'BUNDLE_VERSION_ALREADY_PUBLISHED',
    BUNDLE_VERSION_NOT_EDITABLE: 'BUNDLE_VERSION_NOT_EDITABLE',
    BUNDLE_VERSION_NOT_PUBLISHED: 'BUNDLE_VERSION_NOT_PUBLISHED',
    BUNDLE_VERSION_SUPERSEDED: 'BUNDLE_VERSION_SUPERSEDED',
    /**
     * The bundle version is published, and its window has not opened: it goes
     * on sale on `validFrom`, and until then its predecessor is the one sold.
     */
    BUNDLE_VERSION_NOT_YET_ON_SALE: 'BUNDLE_VERSION_NOT_YET_ON_SALE',
    /**
     * The add-on itself has been deleted from the catalogue. Deleting it leaves
     * its versions' dates as they were, so the version asked for can still be
     * inside its window; it is not on offer all the same.
     */
    BUNDLE_DELETED: 'BUNDLE_DELETED',
    BUNDLE_VERSION_REGRESSION: 'BUNDLE_VERSION_REGRESSION',
    BUNDLE_VERSION_ZERO_PRICE: 'BUNDLE_VERSION_ZERO_PRICE',
    BUNDLE_VERSION_NO_PRICE: 'BUNDLE_VERSION_NO_PRICE',
    BUNDLE_VERSION_NOT_PRICED_FOR_PLAN: 'BUNDLE_VERSION_NOT_PRICED_FOR_PLAN',
    BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED: 'BUNDLE_VERSION_DISCARD_NOT_IMPLEMENTED',
    BUNDLE_VERSION_VALID_FROM_REQUIRED: 'BUNDLE_VERSION_VALID_FROM_REQUIRED',
    BUNDLE_VERSION_VALID_FROM_INVALID: 'BUNDLE_VERSION_VALID_FROM_INVALID',
    BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS: 'BUNDLE_VERSION_VALID_FROM_NOT_AFTER_PREVIOUS',
    BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS: 'BUNDLE_VERSION_VALID_FROM_NOT_GAPLESS',
    BUNDLE_VERSION_VALID_FROM_NOT_FUTURE: 'BUNDLE_VERSION_VALID_FROM_NOT_FUTURE',
    BUNDLE_VERSION_VALID_UNTIL_INVALID: 'BUNDLE_VERSION_VALID_UNTIL_INVALID',
    BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM: 'BUNDLE_VERSION_VALID_UNTIL_BEFORE_FROM',

    /** Publish blocked by strict mode. Carries `warnings[]` with own codes. */
    STRICT_MODE_VIOLATIONS: 'STRICT_MODE_VIOLATIONS',

    // ── resources not found (stage 3) ──
    PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
    PLAN_VERSION_NOT_FOUND: 'PLAN_VERSION_NOT_FOUND',
    BUNDLE_NOT_FOUND: 'BUNDLE_NOT_FOUND',
    /**
     * Bookings told that their add-on version is being retired have still to
     * move onto a version of this add-on — waiting for their notice, for their
     * date, or past it — and a deleted add-on is booked by nothing, the move
     * included. Carries how many, and the add-on's key.
     */
    BUNDLE_DELETE_WHILE_RETIREMENT_MOVES_PENDING: 'BUNDLE_DELETE_WHILE_RETIREMENT_MOVES_PENDING',
    BUNDLE_VERSION_NOT_FOUND: 'BUNDLE_VERSION_NOT_FOUND',
    FEATURE_NOT_FOUND: 'FEATURE_NOT_FOUND',
    QUOTA_NOT_FOUND: 'QUOTA_NOT_FOUND',
    PROMOTION_NOT_FOUND: 'PROMOTION_NOT_FOUND',
    /**
     * A promotion's value is not one its type takes: a percentage above 0 and
     * at most 100, an amount above 0, an intro price of at least 0 for a whole
     * number of months, or a whole number of free months.
     */
    PROMOTION_VALUE_INVALID: 'PROMOTION_VALUE_INVALID',
    MARKETING_PROJECTION_NOT_FOUND: 'MARKETING_PROJECTION_NOT_FOUND',

    // ── already exists ──
    PLAN_ALREADY_EXISTS: 'PLAN_ALREADY_EXISTS',
    BUNDLE_ALREADY_EXISTS: 'BUNDLE_ALREADY_EXISTS',
    MARKETING_PROJECTION_ALREADY_EXISTS: 'MARKETING_PROJECTION_ALREADY_EXISTS',
    /** A draft already exists — publish or discard it before creating another. */
    PLAN_DRAFT_ALREADY_EXISTS: 'PLAN_DRAFT_ALREADY_EXISTS',
    BUNDLE_DRAFT_ALREADY_EXISTS: 'BUNDLE_DRAFT_ALREADY_EXISTS',

    // ── discovery ──
    QUOTA_NOT_IN_DISCOVERY_SNAPSHOT: 'QUOTA_NOT_IN_DISCOVERY_SNAPSHOT',
    DISCOVERY_STATUS_TRANSITION_INVALID: 'DISCOVERY_STATUS_TRANSITION_INVALID',
    DISCOVERY_NOT_INITIALIZED: 'DISCOVERY_NOT_INITIALIZED',

    // ── catalogue import ──
    /** The uploaded document is not a plan catalog — unparseable, or not an object. */
    PLAN_CATALOG_UNREADABLE: 'PLAN_CATALOG_UNREADABLE',
    /** It parsed, and then failed the schema or a cross-field rule. */
    PLAN_CATALOG_INVALID: 'PLAN_CATALOG_INVALID',
} as const;

export type CatalogErrorCode = (typeof CATALOG_ERROR_CODES)[keyof typeof CATALOG_ERROR_CODES];

/** Bundle bookings on a tenant subscription. */
export const BILLING_ERROR_CODES = {
    /**
     * Feature not covered by the plan. Defined in `upsell.types.ts` because the
     * upsell body type is built around it; re-exported here so an exhaustive
     * `PlatformErrorCode` switch covers it.
     */
    FEATURE_NOT_LICENSED,
    BUNDLE_ALREADY_SUBSCRIBED: 'BUNDLE_ALREADY_SUBSCRIBED',
    BUNDLE_INCOMPATIBLE_WITH_PLAN: 'BUNDLE_INCOMPATIBLE_WITH_PLAN',
    BUNDLE_NOT_SELF_SERVICE: 'BUNDLE_NOT_SELF_SERVICE',
    BUNDLE_CYCLE_EXCEEDS_PLAN: 'BUNDLE_CYCLE_EXCEEDS_PLAN',
    BUNDLE_NOT_PRICED_FOR_THIS_PLAN: 'BUNDLE_NOT_PRICED_FOR_THIS_PLAN',
    /**
     * The bundle cannot run on a plan the subscription is already set to move
     * to — by a scheduled change, or by a retirement it has been told of — and
     * the booking would still be running then: that plan does not book it, or
     * has no price for it. Carries that plan's key, the rhythm it is billed in
     * there, and the day the move takes effect from, which can lie in the past
     * while the move has not run yet.
     */
    BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN: 'BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN',
    /**
     * As `BUNDLE_CANNOT_RUN_ON_UPCOMING_PLAN`, where only the rhythm stands in
     * the way: a yearly bundle, and the subscription billed monthly from the
     * day of the move — a switch of rhythm on the plan it keeps, for one, where
     * naming the plan would point at the one it is already on. Same values.
     */
    BUNDLE_CANNOT_RUN_ON_UPCOMING_CYCLE: 'BUNDLE_CANNOT_RUN_ON_UPCOMING_CYCLE',
    SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED: 'SUBSCRIPTION_BUNDLE_ALREADY_CANCELLED',
    SUBSCRIPTION_BUNDLE_NOT_CANCELLED: 'SUBSCRIPTION_BUNDLE_NOT_CANCELLED',
    SUBSCRIPTION_BUNDLE_CANCELLATION_EFFECTIVE: 'SUBSCRIPTION_BUNDLE_CANCELLATION_EFFECTIVE',

    // ── subscriptions and plan changes (stage 3) ──
    SUBSCRIPTION_NOT_FOUND: 'SUBSCRIPTION_NOT_FOUND',
    SUBSCRIPTION_TENANT_MISMATCH: 'SUBSCRIPTION_TENANT_MISMATCH',
    SUBSCRIPTION_BUNDLE_NOT_FOUND: 'SUBSCRIPTION_BUNDLE_NOT_FOUND',
    TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
    /** No plan version is active as of the requested date. */
    NO_ACTIVE_PLAN_VERSION: 'NO_ACTIVE_PLAN_VERSION',
    /** Plan is unknown to the loaded plan catalogue. */
    PLAN_NOT_IN_CATALOG: 'PLAN_NOT_IN_CATALOG',
    /** Plan exists but cannot be booked via self-service. */
    PLAN_NOT_SELF_SERVICE: 'PLAN_NOT_SELF_SERVICE',
    /**
     * Plan carries no price for the requested billing cycle, so it is not sold
     * in it: a plan without a yearly price is a monthly plan.
     */
    PLAN_NOT_SOLD_IN_CYCLE: 'PLAN_NOT_SOLD_IN_CYCLE',
    /**
     * The subscription is bound to a plan version the plan repository does not
     * find, or finds as a version of another plan. What the subscription pays
     * cannot be read, so no change is quoted until the binding is repaired.
     */
    BOUND_PLAN_VERSION_UNREADABLE: 'BOUND_PLAN_VERSION_UNREADABLE',
    /** Plan change refused. Carries `blockers[]` with their own codes. */
    PLAN_CHANGE_BLOCKED: 'PLAN_CHANGE_BLOCKED',
    /**
     * The subscription moved between the read a request was decided on and the
     * write it attempted, so nothing was written. The caller reloads and asks
     * again.
     */
    SUBSCRIPTION_CHANGED: 'SUBSCRIPTION_CHANGED',
    /**
     * The tenant has no subscription to act on.
     *
     * `SUBSCRIPTION_NOT_FOUND` states the same fact on the read routes. Both
     * are already on the wire and a code is renamed only deliberately, so both
     * are named here rather than one being dropped behind a consumer's back.
     */
    NO_SUBSCRIPTION: 'NO_SUBSCRIPTION',
    /**
     * The cancellation date the reader was shown is no longer the one the rules
     * return, so the confirmation is refused rather than silently applied.
     * Carries the recomputed dates, so the page can re-ask instead of guessing.
     */
    CANCELLATION_TERMS_CHANGED: 'CANCELLATION_TERMS_CHANGED',
    /**
     * The version the caller asked to switch to is no longer the one offered —
     * another is on sale, the subscription moved, or there is no offer. Nothing
     * was switched. Carries the current `offer`, or `null`, so the page can show
     * it instead of guessing.
     */
    VERSION_OFFER_CHANGED: 'VERSION_OFFER_CHANGED',
    /**
     * The version a change to another plan named is not the one on sale when
     * the change was submitted: its preview was shown at another moment.
     * Nothing was changed. Carries the current `preview`, so the page shows
     * what the change binds now instead of what it would have.
     */
    PLAN_CHANGE_QUOTE_CHANGED: 'PLAN_CHANGE_QUOTE_CHANGED',
    /**
     * A change to another plan named no version, where its preview names one:
     * nothing says which price and terms the customer was shown, so nothing
     * is changed.
     */
    PLAN_CHANGE_VERSION_NOT_NAMED: 'PLAN_CHANGE_VERSION_NOT_NAMED',
    /**
     * A version that takes something away takes effect when the term ends, and
     * the subscription's cancellation lands no later: the switch would never
     * happen, so it is refused rather than recorded. Carries both dates.
     */
    VERSION_SWITCH_AFTER_CANCELLATION: 'VERSION_SWITCH_AFTER_CANCELLATION',
    /**
     * A version that takes something away takes effect when the term ends, and
     * it stops being sold before then — by its window or because an operator
     * ended it — so it could not be bound when the change comes due. Refused
     * rather than recorded; carries the dates.
     */
    VERSION_ENDS_BEFORE_SWITCH: 'VERSION_ENDS_BEFORE_SWITCH',

    // ── retiring a version for running subscriptions ──
    /**
     * The operator's terms are not confirmed to carry the clause a retirement
     * rests on (`tenantBilling.orderlyRetirement.termsConfirmed` in
     * `config/saas.yaml`), so none is accepted.
     */
    RETIREMENT_TERMS_NOT_CONFIRMED: 'RETIREMENT_TERMS_NOT_CONFIRMED',
    /**
     * The version is still on sale: a subscription booked after the
     * announcement would be on it without having been told. Carries the plan
     * key and the version.
     */
    RETIREMENT_VERSION_ON_SALE: 'RETIREMENT_VERSION_ON_SALE',
    /** The replacement is not on sale, so nobody can continue on it. Carries plan key and version. */
    RETIREMENT_REPLACEMENT_NOT_ON_SALE: 'RETIREMENT_REPLACEMENT_NOT_ON_SALE',
    /**
     * The replacement has no price in the rhythm some of the subscriptions it
     * reaches are billed in, so they cannot continue on it. Carries how many,
     * and the replacement's plan key and version.
     */
    RETIREMENT_REPLACEMENT_NOT_SOLD_IN_RHYTHM: 'RETIREMENT_REPLACEMENT_NOT_SOLD_IN_RHYTHM',
    /**
     * Some of the subscriptions the retirement reaches hold an add-on that
     * cannot run on the replacement's plan, so they cannot continue on it.
     * Carries how many, and the replacement's plan key and version.
     */
    RETIREMENT_REPLACEMENT_CANNOT_CARRY_BUNDLES: 'RETIREMENT_REPLACEMENT_CANNOT_CARRY_BUNDLES',
    /** The replacement named is the version being retired. */
    RETIREMENT_REPLACEMENT_IS_RETIRED: 'RETIREMENT_REPLACEMENT_IS_RETIRED',
    /** No running subscription is on the version: there is nobody to tell. Carries plan key and version. */
    RETIREMENT_NOTHING_AFFECTED: 'RETIREMENT_NOTHING_AFFECTED',
    /**
     * Some of the subscriptions it reaches were reached by a retirement within
     * the last twelve months, and a subscription is reached at most once in that
     * time. Carries how many and which.
     */
    RETIREMENT_WITHIN_TWELVE_MONTHS: 'RETIREMENT_WITHIN_TWELVE_MONTHS',
    /**
     * The subscriptions the retirement reaches, or their dates, changed since
     * the preview the operator confirmed. Carries the preview as it stands.
     */
    RETIREMENT_PREVIEW_CHANGED: 'RETIREMENT_PREVIEW_CHANGED',
    /** No retirement of the subscription's version waits for its date: there is nothing to switch to. */
    RETIREMENT_SWITCH_NOT_PENDING: 'RETIREMENT_SWITCH_NOT_PENDING',
    /** The switch opens once the trial has converted: a trial has no contract to hold the price on. */
    RETIREMENT_SWITCH_IN_TRIAL: 'RETIREMENT_SWITCH_IN_TRIAL',
    /**
     * An add-on running today cannot run beside the replacement's plan, which
     * the switch would move the subscription onto today. Carries the add-on,
     * the plan and the earliest day the booking can end. Its own code rather
     * than a plan change's: the switch has no other plan to choose and no day
     * to pick, so the way past it is the add-on ending.
     */
    RETIREMENT_SWITCH_BUNDLE_CANNOT_FOLLOW: 'RETIREMENT_SWITCH_BUNDLE_CANNOT_FOLLOW',
    /**
     * As `RETIREMENT_SWITCH_BUNDLE_CANNOT_FOLLOW`, where only the version the
     * add-on continues on from a retirement's date cannot run beside the
     * replacement's plan. The version it is on can, so cancelling it — it then
     * ends before that date — lets the switch through. Given while that date
     * is ahead and the add-on is not cancelled yet; otherwise the earlier code
     * names the day it can end. Carries the add-on, that version, its date and
     * the plan.
     */
    RETIREMENT_SWITCH_BUNDLE_REPLACEMENT_CANNOT_FOLLOW:
        'RETIREMENT_SWITCH_BUNDLE_REPLACEMENT_CANNOT_FOLLOW',
    /**
     * The subscription takes no switch now: a change is scheduled, it has
     * ended, or its plan is held for a special contract.
     */
    RETIREMENT_SWITCH_NOT_OPEN: 'RETIREMENT_SWITCH_NOT_OPEN',
    /**
     * The version named is not the replacement the retirement names. Carries
     * the retirement as it now stands.
     */
    RETIREMENT_SWITCH_CHANGED: 'RETIREMENT_SWITCH_CHANGED',

    // ── retiring an add-on version for running bookings ──
    //
    // An add-on retirement answers with the plan retirement's codes where the
    // sentence is the same — terms not confirmed, a version named as its own
    // replacement, twelve months, a preview that changed — and with these
    // where it names an add-on rather than a plan.
    /**
     * The add-on version is still on sale: a booking made after the
     * announcement would be on it without having been told. Carries the
     * add-on key and the version.
     */
    BUNDLE_RETIREMENT_VERSION_ON_SALE: 'BUNDLE_RETIREMENT_VERSION_ON_SALE',
    /** The replacement is not on sale, so no booking can continue on it. Carries add-on key and version. */
    BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE: 'BUNDLE_RETIREMENT_REPLACEMENT_NOT_ON_SALE',
    /**
     * The replacement is a version of another add-on. A booking continues on
     * a version of its own add-on, so it stays the same booking with its term.
     * Carries both add-on keys.
     */
    BUNDLE_RETIREMENT_REPLACEMENT_OF_ANOTHER_BUNDLE:
        'BUNDLE_RETIREMENT_REPLACEMENT_OF_ANOTHER_BUNDLE',
    /**
     * Some of the bookings it reaches run, at their date, beside a plan the
     * replacement cannot run beside: not allowed there, without a price there
     * in the booking's rhythm, or in a longer rhythm than the plan's. Carries
     * how many, and the replacement's add-on key and version.
     */
    BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN: 'BUNDLE_RETIREMENT_REPLACEMENT_CANNOT_RUN',
    /** No running booking is on the version: there is nobody to tell. Carries add-on key and version. */
    BUNDLE_RETIREMENT_NOTHING_AFFECTED: 'BUNDLE_RETIREMENT_NOTHING_AFFECTED',
    /**
     * The booking is on an add-on version being retired, and was cancelled to
     * end before it would move, so it was never told and nothing moves it.
     * Reinstated, it would run on past the date on a version nobody sells;
     * booking the replacement once it has ended is the way. Carries the add-on
     * key, the version, the replacement's version and the day it can be booked
     * from.
     */
    BUNDLE_RETIREMENT_REINSTATE_REFUSED: 'BUNDLE_RETIREMENT_REINSTATE_REFUSED',
    /**
     * As `BUNDLE_RETIREMENT_REINSTATE_REFUSED`, where the replacement cannot
     * run beside the plan the subscription is on when the booking ends, or
     * beside one it is already set to move to after that, in any rhythm it
     * could be booked in, so there is no version of the add-on to book.
     * Carries the add-on key, the version and the replacement's version.
     */
    BUNDLE_RETIREMENT_REINSTATE_REPLACEMENT_CANNOT_RUN:
        'BUNDLE_RETIREMENT_REINSTATE_REPLACEMENT_CANNOT_RUN',
    /**
     * As `BUNDLE_RETIREMENT_REINSTATE_REFUSED`, where the subscription ends by
     * the day the replacement could be booked from, so there is no day to
     * name. Carries the add-on key, the version and the replacement's version.
     */
    BUNDLE_RETIREMENT_REINSTATE_SUBSCRIPTION_ENDS: 'BUNDLE_RETIREMENT_REINSTATE_SUBSCRIPTION_ENDS',
    /**
     * The plan the add-on runs beside, or the rhythm it is billed in, changes
     * before the date the booking was told — by a change scheduled, or by a
     * retirement told that moves the subscription to another plan — so the
     * price a switch now would hold is not the one the booking pays until
     * then. Switching once the plan has changed, or waiting for the
     * date, is the way. Carries the add-on and the date.
     */
    BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES: 'BUNDLE_RETIREMENT_SWITCH_PLAN_CHANGES',

    // ── the preview routes' own blockers and warnings ──
    //
    // These travel inside a 200 response, in `blockers[]` and `warnings[]`, not
    // as thrown errors — but they are read by a person and so belong in the same
    // catalogue. Each carries `params` with the values its sentence names. Two
    // routes emit them: the plan-change preview and the bundle preview.
    //
    // Three of them used to construct their code from the subject:
    // `VEHICLES_OVER_TARGET`, `ENTERPRISE_LOCKED`, `PRO_NOT_SELF_SERVICE`. That
    // made the set grow with every quota and plan an installation defines, so no
    // catalogue could be complete against it and no guard could check one. The
    // subject is a parameter now.

    /** The subscription has ended; its plan can no longer be changed. */
    SUBSCRIPTION_ENDED: 'SUBSCRIPTION_ENDED',
    /** An active special contract blocks self-service plan changes. */
    PLAN_LOCKED: 'PLAN_LOCKED',
    /** Current usage of one quota exceeds what the target plan allows. */
    QUOTA_OVER_TARGET: 'QUOTA_OVER_TARGET',
    /** The change drops features the tenant has today. */
    FEATURE_LOST: 'FEATURE_LOST',
    FEATURES_LOST: 'FEATURES_LOST',
    /** Target plan and cycle already match what is in place. */
    NO_CHANGE: 'NO_CHANGE',
    /** A shorter cycle cannot start inside the term already running. */
    CYCLE_SHORTENS_AT_TERM_END: 'CYCLE_SHORTENS_AT_TERM_END',
    /** A cancelled subscription cannot change its billing cycle. */
    CANCELLATION_LOCKS_THE_CYCLE: 'CANCELLATION_LOCKS_THE_CYCLE',
    /**
     * A bundle the tenant already holds runs past the cycle they are moving to.
     * Carries the bundle, the earliest day the booking can end, and the two
     * rhythms.
     *
     * Its own code rather than `BUNDLE_CYCLE_EXCEEDS_PLAN`, which states the
     * same rule about a booking that has not been made yet. The two need
     * different sentences: this one can name the day the obstacle lifts and
     * tell the reader how to get past it, and that advice is wrong for someone
     * who is only about to book. One template cannot serve both.
     */
    BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE: 'BUNDLE_BOOKING_OUTLASTS_TARGET_CYCLE',
    /**
     * A bundle the tenant already holds cannot run on the plan they are moving
     * to: that plan may not book it, or it has no price there in the rhythm
     * the booking is billed in. Carries the bundle, the plan and the earliest
     * day the booking can end.
     */
    BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN: 'BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN',
    /**
     * A bundle the tenant already holds can run on the plan they are moving
     * to, but the version it continues on from a retirement's date cannot.
     * Cancelling it lets the change through at once: the booking then ends
     * before that date and never reaches the version. Given while that date is
     * ahead and the booking is not cancelled yet; otherwise
     * `BUNDLE_BOOKING_DOES_NOT_FIT_TARGET_PLAN` names the day it can end.
     * Carries the bundle, that version, its date and the plan.
     */
    BUNDLE_REPLACEMENT_DOES_NOT_FIT_TARGET_PLAN: 'BUNDLE_REPLACEMENT_DOES_NOT_FIT_TARGET_PLAN',
    /**
     * Features of the previewed bundle are already covered by the plan or by
     * another booked bundle. A warning rather than a blocker: paying twice is
     * the customer's decision, and the preview only has to say so first.
     */
    REDUNDANT_FEATURES: 'REDUNDANT_FEATURES',
    /**
     * A booking's minimum term outlasts the period being cancelled, so the
     * cancellation takes effect at the end of the term, not of the period.
     */
    MINIMUM_TERM_BINDS: 'MINIMUM_TERM_BINDS',
    /**
     * The previewed bundle requires features that neither the plan nor an
     * active booking provides.
     *
     * The same string is a `StrictModeWarningCode` in `bundle.types.ts`, where
     * it names the catalogue-authoring reading of the rule and travels with its
     * own message. This declaration is the booking preview's blocker, which a
     * tenant reads and therefore needs a shipped text for.
     */
    BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED: 'BUNDLE_FEATURE_DEPENDENCY_UNSATISFIED',
    ONBOARDING_CREATE_FAILED: 'ONBOARDING_CREATE_FAILED',
    BUNDLE_PREVIEW_ARGUMENT_AMBIGUOUS: 'BUNDLE_PREVIEW_ARGUMENT_AMBIGUOUS',
    /**
     * The adapter returned a `SubscriptionUsageRecord` without `id`. A wiring
     * error in the consumer, not a missing subscription — hence its own code.
     */
    SUBSCRIPTION_PK_MISSING: 'SUBSCRIPTION_PK_MISSING',

    // ── entitlements ──
    /** Quota exhausted. Carries `dimension`, `used`, `max`. */
    LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
    QUOTA_DIMENSION_UNKNOWN: 'QUOTA_DIMENSION_UNKNOWN',
} as const;

export type BillingErrorCode = (typeof BILLING_ERROR_CODES)[keyof typeof BILLING_ERROR_CODES];

/** Checkout offers and the subscription contracts derived from them. */
export const CONTRACT_ERROR_CODES = {
    CHECKOUT_OFFER_LINE_ITEMS_REQUIRED: 'CHECKOUT_OFFER_LINE_ITEMS_REQUIRED',
    CHECKOUT_OFFER_PLAN_LINE_ITEM_REQUIRED: 'CHECKOUT_OFFER_PLAN_LINE_ITEM_REQUIRED',
    CHECKOUT_OFFER_BUNDLE_LINE_ITEMS_REQUIRED: 'CHECKOUT_OFFER_BUNDLE_LINE_ITEMS_REQUIRED',
    CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE: 'CHECKOUT_OFFER_BUNDLE_VERSION_NOT_BOOKABLE',
    CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED: 'CHECKOUT_OFFER_FEATURE_DEPENDENCY_UNSATISFIED',
    CHECKOUT_OFFER_PLAN_NOT_OFFERED: 'CHECKOUT_OFFER_PLAN_NOT_OFFERED',
    CHECKOUT_OFFER_BUNDLE_NOT_OFFERED: 'CHECKOUT_OFFER_BUNDLE_NOT_OFFERED',
    CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED: 'CHECKOUT_OFFER_PROMO_CODE_NOT_ACCEPTED',
    CHECKOUT_OFFER_PRICE_NOT_CURRENT: 'CHECKOUT_OFFER_PRICE_NOT_CURRENT',

    SUBSCRIPTION_CONTRACT_LINE_ITEMS_REQUIRED: 'SUBSCRIPTION_CONTRACT_LINE_ITEMS_REQUIRED',
    SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED: 'SUBSCRIPTION_CONTRACT_PLAN_LINE_ITEM_REQUIRED',
    SUBSCRIPTION_CONTRACT_INVALID_DATE: 'SUBSCRIPTION_CONTRACT_INVALID_DATE',
    SUBSCRIPTION_CONTRACT_INVALID_WINDOW: 'SUBSCRIPTION_CONTRACT_INVALID_WINDOW',
    SUBSCRIPTION_CONTRACT_LINE_ITEM_TAX_MISMATCH: 'SUBSCRIPTION_CONTRACT_LINE_ITEM_TAX_MISMATCH',
    SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_PERCENT: 'SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_PERCENT',
    SUBSCRIPTION_CONTRACT_LINE_ITEM_CURRENCY_MISMATCH:
        'SUBSCRIPTION_CONTRACT_LINE_ITEM_CURRENCY_MISMATCH',
    /**
     * The lines do not add up to a total the contract states, counted as often
     * as each falls due in one period. `field` names the total.
     */
    SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP: 'SUBSCRIPTION_CONTRACT_LINES_DO_NOT_ADD_UP',
    /** Something that takes money off states a negative amount. */
    SUBSCRIPTION_CONTRACT_DISCOUNT_NEGATIVE: 'SUBSCRIPTION_CONTRACT_DISCOUNT_NEGATIVE',
    SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START:
        'SUBSCRIPTION_CONTRACT_TERMINATION_BEFORE_START',

    // ── stage 3 ──
    CHECKOUT_OFFER_NOT_FOUND: 'CHECKOUT_OFFER_NOT_FOUND',
    CHECKOUT_OFFER_EXPIRED: 'CHECKOUT_OFFER_EXPIRED',
    CHECKOUT_OFFER_ALREADY_CONSUMED: 'CHECKOUT_OFFER_ALREADY_CONSUMED',
    CHECKOUT_OFFER_NOT_CONSUMED: 'CHECKOUT_OFFER_NOT_CONSUMED',
    /**
     * The offer changed between the checks of `conclude` and the transaction
     * that consumed it, so the contract checked is not the one the offer now
     * describes. Nothing was written; load the offer and conclude it again.
     */
    CHECKOUT_OFFER_CHANGED: 'CHECKOUT_OFFER_CHANGED',
    SUBSCRIPTION_CONTRACT_NOT_FOUND: 'SUBSCRIPTION_CONTRACT_NOT_FOUND',
    NO_ACTIVE_SUBSCRIPTION_CONTRACT: 'NO_ACTIVE_SUBSCRIPTION_CONTRACT',
    SUBSCRIPTION_CONTRACT_ALREADY_CLOSED: 'SUBSCRIPTION_CONTRACT_ALREADY_CLOSED',
    /**
     * A successor would run beside another contract of the tenant: the
     * contract in force moved while it was being written — another successor
     * took its place, or a cancellation capped it — and kept moving on a
     * second attempt, or a contract begins after the moment the successor
     * would take effect. Nothing was written.
     */
    SUBSCRIPTION_CONTRACT_CHANGED: 'SUBSCRIPTION_CONTRACT_CHANGED',
    /**
     * A contract states a tax rate — `field` names where — other than the one
     * the installation's tax adapter decides for its subscriber.
     */
    SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_DECIDED: 'SUBSCRIPTION_CONTRACT_TAX_RATE_NOT_DECIDED',
} as const;

export type ContractErrorCode = (typeof CONTRACT_ERROR_CODES)[keyof typeof CONTRACT_ERROR_CODES];

/** The parties contracts are concluded with (`SubscriberService`), and their absence. */
export const SUBSCRIBER_ERROR_CODES = {
    /**
     * A contract, a plan change or a booking for a tenant that has no
     * subscriber. Nothing is agreed or charged without the party to it.
     * Carries `tenantId`.
     */
    SUBSCRIBER_REQUIRED: 'SUBSCRIBER_REQUIRED',
    /** The tenant already has a live subscriber. Carries `tenantId`. */
    SUBSCRIBER_ALREADY_EXISTS: 'SUBSCRIBER_ALREADY_EXISTS',
    SUBSCRIBER_NOT_FOUND: 'SUBSCRIBER_NOT_FOUND',
    SUBSCRIBER_LEGAL_NAME_REQUIRED: 'SUBSCRIBER_LEGAL_NAME_REQUIRED',
    /**
     * A detail that has a form — the country, the invoice email — is not in it,
     * or one sign-up requires — the billing address — is missing. Carries `field`.
     */
    SUBSCRIBER_DETAIL_INVALID: 'SUBSCRIBER_DETAIL_INVALID',
    /** A contact change named a field of the legal identity. Carries `field`. */
    SUBSCRIBER_IDENTITY_NOT_A_CONTACT: 'SUBSCRIBER_IDENTITY_NOT_A_CONTACT',
    SUBSCRIBER_CORRECTION_REASON_REQUIRED: 'SUBSCRIBER_CORRECTION_REASON_REQUIRED',
    SUBSCRIBER_CORRECTION_ACTOR_REQUIRED: 'SUBSCRIBER_CORRECTION_ACTOR_REQUIRED',
    SUBSCRIBER_CORRECTION_CHANGES_NOTHING: 'SUBSCRIBER_CORRECTION_CHANGES_NOTHING',
    /** The operator declared another legal entity: that is a transfer, not an edit. */
    SUBSCRIBER_TAKEOVER_IS_A_TRANSFER: 'SUBSCRIBER_TAKEOVER_IS_A_TRANSFER',
    /**
     * A contact change named whether the subscriber is a business. That is part
     * of its tax origin and changes as a recorded change naming who made it.
     */
    SUBSCRIBER_BUSINESS_STATUS_NOT_A_CONTACT: 'SUBSCRIBER_BUSINESS_STATUS_NOT_A_CONTACT',
    /** A change of the subscriber's contact details or business status did not say who makes it. */
    SUBSCRIBER_CHANGE_ACTOR_REQUIRED: 'SUBSCRIBER_CHANGE_ACTOR_REQUIRED',
    /**
     * Where a tax adapter decides, a contract names its subscriber only once
     * the address an invoice names is complete (`SC-PRIC-032`): a party copied
     * onto a contract incomplete cannot be completed afterwards. Carries
     * `missing`, the empty fields.
     */
    SUBSCRIBER_IDENTITY_INCOMPLETE: 'SUBSCRIBER_IDENTITY_INCOMPLETE',
} as const;

export type SubscriberErrorCode =
    (typeof SUBSCRIBER_ERROR_CODES)[keyof typeof SUBSCRIBER_ERROR_CODES];

/** Self-service registration funnel (`PendingRegistration`). */
export const REGISTRATION_ERROR_CODES = {
    PENDING_REGISTRATION_NOT_FOUND: 'PENDING_REGISTRATION_NOT_FOUND',
    PENDING_REGISTRATION_EXPIRED: 'PENDING_REGISTRATION_EXPIRED',
    INVALID_REGISTRATION_STATE: 'INVALID_REGISTRATION_STATE',
    OTP_INVALID: 'OTP_INVALID',
    OTP_EXPIRED: 'OTP_EXPIRED',
    OTP_LOCKED: 'OTP_LOCKED',
    /** Too many attempts from this origin. Carries `retryAfterSeconds`. */
    RATE_LIMITED: 'RATE_LIMITED',
    RESUME_TOKEN_INVALID: 'RESUME_TOKEN_INVALID',
    RESUME_NOT_CONFIGURED: 'RESUME_NOT_CONFIGURED',
    CONFIGURATOR_NOT_CONFIGURED: 'CONFIGURATOR_NOT_CONFIGURED',
    CONFIG_NOT_SAVED: 'CONFIG_NOT_SAVED',
    PLAN_NOT_AVAILABLE: 'PLAN_NOT_AVAILABLE',
    PLAN_NOT_SELECTED: 'PLAN_NOT_SELECTED',
    MODEL_NOT_AVAILABLE: 'MODEL_NOT_AVAILABLE',
} as const;

export type RegistrationErrorCode =
    (typeof REGISTRATION_ERROR_CODES)[keyof typeof REGISTRATION_ERROR_CODES];

/** Authentication, role and tenant-context failures raised by the guards. */
export const AUTH_ERROR_CODES = {
    /** No authenticated user on the request. */
    NOT_AUTHENTICATED: 'NOT_AUTHENTICATED',
    /** Authenticated, but the request carries no tenant. */
    NO_TENANT_ASSIGNED: 'NO_TENANT_ASSIGNED',
    /** Neither `tenantId` nor `userId` could be resolved from the request. */
    TENANT_CONTEXT_MISSING: 'TENANT_CONTEXT_MISSING',
    TENANT_ADMIN_REQUIRED: 'TENANT_ADMIN_REQUIRED',
    /**
     * The tenant's billing area — its payment method, and later its invoices
     * and account — needs the billing permission, which the application maps
     * to its roles and the tenant's administrator holds by default.
     */
    BILLING_PERMISSION_REQUIRED: 'BILLING_PERMISSION_REQUIRED',
    SUPER_ADMIN_REQUIRED: 'SUPER_ADMIN_REQUIRED',
    /** TOTP MFA has never been set up for this user. */
    MFA_NOT_SET_UP: 'MFA_NOT_SET_UP',
    /** Endpoint is MFA-gated and no `X-Mfa-Code` header was sent. */
    MFA_REQUIRED: 'MFA_REQUIRED',
    /** The supplied TOTP code did not verify. */
    MFA_FAILED: 'MFA_FAILED',
    /** Module misconfiguration, not an end-user condition. */
    AUTH_GUARDS_NOT_CONFIGURED: 'AUTH_GUARDS_NOT_CONFIGURED',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

/** Promo-code administration and redemption. */
export const PROMO_ERROR_CODES = {
    PROMO_CODE_NOT_FOUND: 'PROMO_CODE_NOT_FOUND',
    PROMO_CODE_ALREADY_EXISTS: 'PROMO_CODE_ALREADY_EXISTS',
    PROMO_CODE_HAS_REDEMPTIONS: 'PROMO_CODE_HAS_REDEMPTIONS',
    /** Not redeemable. Carries `reason` (`PromoPreviewInvalidReason`). */
    PROMO_CODE_NOT_REDEEMABLE: 'PROMO_CODE_NOT_REDEEMABLE',
    PROMO_CODE_FORMAT_INVALID: 'PROMO_CODE_FORMAT_INVALID',
    PROMO_PERCENT_OUT_OF_RANGE: 'PROMO_PERCENT_OUT_OF_RANGE',
    PROMO_AMOUNT_NOT_POSITIVE: 'PROMO_AMOUNT_NOT_POSITIVE',
    PROMO_ONE_OFF_WITH_DURATION: 'PROMO_ONE_OFF_WITH_DURATION',
    PROMO_DURATION_INVALID: 'PROMO_DURATION_INVALID',
    PROMO_VALIDITY_WINDOW_INVALID: 'PROMO_VALIDITY_WINDOW_INVALID',
    PROMO_PLAN_NOT_DISCOUNTABLE: 'PROMO_PLAN_NOT_DISCOUNTABLE',
    PROMO_MIN_AMOUNT_NOT_POSITIVE: 'PROMO_MIN_AMOUNT_NOT_POSITIVE',
    PROMO_WOULD_PRODUCE_ZERO_INVOICE: 'PROMO_WOULD_PRODUCE_ZERO_INVOICE',
    PROMO_MAX_REDEMPTIONS_LOWERED: 'PROMO_MAX_REDEMPTIONS_LOWERED',
} as const;

export type PromoErrorCode = (typeof PROMO_ERROR_CODES)[keyof typeof PROMO_ERROR_CODES];

/** Payment methods and the gateways that confirm them. */
export const PAYMENT_ERROR_CODES = {
    /**
     * No gateway account takes new payment methods:
     * `config/saas.yaml#payments.newPaymentMethods` names none.
     */
    PAYMENTS_NOT_CONFIGURED: 'PAYMENTS_NOT_CONFIGURED',
    /** A callback arrived for an account `config/saas.yaml#payments.accounts` does not name. Carries `account`. */
    PAYMENT_GATEWAY_ACCOUNT_UNKNOWN: 'PAYMENT_GATEWAY_ACCOUNT_UNKNOWN',
    /** A callback the gateway did not send: its signature does not verify. */
    PAYMENT_CALLBACK_REJECTED: 'PAYMENT_CALLBACK_REJECTED',
    /**
     * A success or cancel URL at an origin `config/saas.yaml#payments.returnUrlOrigins`
     * does not name. Carries `field`.
     */
    PAYMENT_RETURN_URL_NOT_ALLOWED: 'PAYMENT_RETURN_URL_NOT_ALLOWED',
    /**
     * The gateway failed — unreachable, refusing the account's keys, or
     * answering with an error — while opening its form or reading a callback
     * back. Answered with 502; what the gateway answered stays in the server
     * log.
     */
    PAYMENT_GATEWAY_FAILED: 'PAYMENT_GATEWAY_FAILED',
} as const;

export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[keyof typeof PAYMENT_ERROR_CODES];

/** Codes of the settings record (`GET /admin/settings`, the acknowledgement). */
export const SETTINGS_ERROR_CODES = {
    /** No recorded change has this id, or the installation keeps no record at all. */
    SETTINGS_CHANGE_NOT_FOUND: 'SETTINGS_CHANGE_NOT_FOUND',
} as const;
export type SettingsErrorCode = (typeof SETTINGS_ERROR_CODES)[keyof typeof SETTINGS_ERROR_CODES];

/** Codes of maintenance windows: the lock's refusal, and the operator's routes. */
export const MAINTENANCE_ERROR_CODES = {
    /** The application is locked for maintenance; the body carries the window. */
    MAINTENANCE: 'MAINTENANCE',
    /** A window is already open: move or cancel it before announcing another. */
    MAINTENANCE_WINDOW_ALREADY_OPEN: 'MAINTENANCE_WINDOW_ALREADY_OPEN',
    /** No open window has this id — it ended, or it never existed. */
    MAINTENANCE_WINDOW_NOT_OPEN: 'MAINTENANCE_WINDOW_NOT_OPEN',
    /** The window is locked: its start is history, and unlocking is what ends it. */
    MAINTENANCE_WINDOW_LOCKED: 'MAINTENANCE_WINDOW_LOCKED',
    /** The announced end is not after the announced start. */
    MAINTENANCE_WINDOW_END_NOT_AFTER_START: 'MAINTENANCE_WINDOW_END_NOT_AFTER_START',
    /** The announced end has already passed. */
    MAINTENANCE_WINDOW_END_IN_PAST: 'MAINTENANCE_WINDOW_END_IN_PAST',
    /** A time without its zone, or not a date and time at all; `field` names which. */
    MAINTENANCE_TIME_INVALID: 'MAINTENANCE_TIME_INVALID',
    /** The message is longer than `MAINTENANCE_MESSAGE_MAX_LENGTH`. */
    MAINTENANCE_MESSAGE_TOO_LONG: 'MAINTENANCE_MESSAGE_TOO_LONG',
} as const;
export type MaintenanceErrorCode =
    (typeof MAINTENANCE_ERROR_CODES)[keyof typeof MAINTENANCE_ERROR_CODES];

/** Codes of the installation's tax adapter (ADR 0013). */
export const TAX_ERROR_CODES = {
    /**
     * The tax adapter answers that it does not support the subscriber's case;
     * `adapter` names it and `reason` is its sentence. Nothing is concluded with
     * a guessed tax (`SC-PRIC-039`).
     */
    TAX_TREATMENT_NOT_SUPPORTED: 'TAX_TREATMENT_NOT_SUPPORTED',
    /**
     * The tax adapter needs the VAT identification number checked to treat the
     * case, and the check did not complete — the service is unavailable, timed
     * out, or answered in a way the adapter cannot read (`503`). Nothing is
     * decided in the subscriber's favour on a number not checked
     * (`SC-PRIC-040`): try again later. `adapter` names the adapter and
     * `reason` says why.
     */
    TAX_VAT_ID_CHECK_NOT_COMPLETED: 'TAX_VAT_ID_CHECK_NOT_COMPLETED',
} as const;
export type TaxErrorCode = (typeof TAX_ERROR_CODES)[keyof typeof TAX_ERROR_CODES];

/**
 * Every exception code the platform emits, in one object.
 *
 * Group membership is presentational — the wire format is the bare string, so
 * a code may be moved between groups without breaking consumers. Renaming or
 * removing one may not.
 */
export const PLATFORM_ERROR_CODES = {
    ...SETUP_ERROR_CODES,
    ...AUTH_ERROR_CODES,
    ...PROMO_ERROR_CODES,
    ...CATALOG_ERROR_CODES,
    ...BILLING_ERROR_CODES,
    ...CONTRACT_ERROR_CODES,
    ...SUBSCRIBER_ERROR_CODES,
    ...REGISTRATION_ERROR_CODES,
    ...PAYMENT_ERROR_CODES,
    ...SETTINGS_ERROR_CODES,
    ...MAINTENANCE_ERROR_CODES,
    ...TAX_ERROR_CODES,
} as const;

export type PlatformErrorCode =
    | SetupErrorCode
    | AuthErrorCode
    | PromoErrorCode
    | CatalogErrorCode
    | BillingErrorCode
    | ContractErrorCode
    | SubscriberErrorCode
    | RegistrationErrorCode
    | PaymentErrorCode
    | SettingsErrorCode
    | MaintenanceErrorCode
    | TaxErrorCode;

/**
 * Shape of a coded error response.
 *
 * Note what NestJS does with this: throwing an exception with a string
 * argument yields `{ message, error, statusCode }`, whereas throwing it with
 * an object passes that object through verbatim. Coded errors therefore carry
 * no `error`/`statusCode` field in the body — the HTTP status is on the
 * response itself, which is where a client should read it.
 */
export interface PlatformErrorBody {
    /** Stable machine-readable discriminator. Resolve i18n by this. */
    code: PlatformErrorCode;
    /** English developer-facing fallback. Do not parse it. */
    message: string;
    /**
     * Named values interpolated into `message`, so a consumer can render a
     * translated sentence without scraping the ids back out of the text.
     */
    params?: Record<string, unknown>;
}
