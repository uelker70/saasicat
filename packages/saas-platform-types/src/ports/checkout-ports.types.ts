import type {
    CheckoutOfferFilter,
    CheckoutOfferRow,
    CreateCheckoutOfferData,
    UpdateCheckoutOfferData,
} from '../checkout-offer.types.js';

// =============================================================================
// CheckoutOffer — persistence adapter (METAMODELL §17a — bundle snapshot)
// =============================================================================

/**
 * Adapter for `checkout_offers`. The offer is an immutable bundle snapshot:
 * `create` creates it, `update` only allows customization while
 * `status = 'open'`, `consume` freezes it.
 */
export interface CheckoutOfferRepository {
    list(filter: CheckoutOfferFilter): Promise<CheckoutOfferRow[]>;
    findById(id: string): Promise<CheckoutOfferRow | null>;
    create(data: CreateCheckoutOfferData): Promise<CheckoutOfferRow>;
    update(id: string, data: UpdateCheckoutOfferData): Promise<CheckoutOfferRow>;
    /** Sets `status = 'consumed'` + `consumedAt = NOW()`. */
    consume(id: string): Promise<CheckoutOfferRow>;
}
