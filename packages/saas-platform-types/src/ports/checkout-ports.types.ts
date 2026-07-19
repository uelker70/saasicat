import type {
    CheckoutOfferFilter,
    CheckoutOfferRow,
    CreateCheckoutOfferData,
    UpdateCheckoutOfferData,
} from '../checkout-offer.types.js';

// =============================================================================
// CheckoutOffer — Persistenz-Adapter (METAMODELL §17a — Paket-Snapshot)
// =============================================================================

/**
 * Adapter für `checkout_offers`. Der Offer ist ein unveränderlicher
 * Paket-Snapshot: `create` legt ihn an, `update` erlaubt nur Individuali-
 * sierung solange `status = 'open'`, `consume` friert ihn ein.
 */
export interface CheckoutOfferRepository {
    list(filter: CheckoutOfferFilter): Promise<CheckoutOfferRow[]>;
    findById(id: string): Promise<CheckoutOfferRow | null>;
    create(data: CreateCheckoutOfferData): Promise<CheckoutOfferRow>;
    update(id: string, data: UpdateCheckoutOfferData): Promise<CheckoutOfferRow>;
    /** Setzt `status = 'consumed'` + `consumedAt = NOW()`. */
    consume(id: string): Promise<CheckoutOfferRow>;
}
