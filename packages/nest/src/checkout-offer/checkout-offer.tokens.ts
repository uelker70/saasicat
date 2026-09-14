// DI token for the CheckoutOffer module.

/** Repository for `checkout_offers`. */
export const CHECKOUT_OFFER_REPOSITORY_TOKEN = Symbol.for('saasicat/nest/CheckoutOfferRepository');

/**
 * The transaction an offer is concluded in: consuming it, writing its contract
 * and the application's own writes commit or roll back together.
 */
export const CHECKOUT_OFFER_TRANSACTION_RUNNER_TOKEN = Symbol.for(
    'saasicat/nest/CheckoutOfferTransactionRunner',
);
