import type { TransactionContext } from './core-ports.types.js';
import type {
    CheckoutOfferFilter,
    CheckoutOfferRow,
    CreateCheckoutOfferData,
    UpdateCheckoutOfferData,
} from '../checkout-offer.types.js';

// =============================================================================
// CheckoutOffer — persistence adapter (bundle snapshot)
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
    /**
     * Sets `status = 'consumed'` + `consumedAt = NOW()`, and only while the
     * offer is still `open`: the write carries that condition, so of two
     * callers consuming at once one succeeds and the other is refused with
     * `CHECKOUT_OFFER_ALREADY_CONSUMED` (or `CHECKOUT_OFFER_EXPIRED`). A check
     * before the write cannot decide it, because the status can change in
     * between.
     *
     * With `tx`, the write runs on that transaction, so it is undone with
     * everything else the transaction wrote. `CheckoutOfferService.conclude`
     * depends on that; the persistence contract holds both.
     */
    consume(id: string, tx?: TransactionContext): Promise<CheckoutOfferRow>;
}
