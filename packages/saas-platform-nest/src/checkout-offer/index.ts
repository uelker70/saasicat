// @saasicat/nest/checkout-offer — Paket-Snapshot Webseite →
// Onboarding → Abrechnung (METAMODELL §17a).

export { CheckoutOfferService } from './checkout-offer.service.js';
export { buildCheckoutOfferController } from './checkout-offer.controller.js';
export {
    CheckoutOfferModule,
    type CheckoutOfferControllerConfig,
    type CheckoutOfferModuleOptions,
} from './checkout-offer.module.js';
export { CHECKOUT_OFFER_REPOSITORY_TOKEN } from './tokens.js';
export { CreateCheckoutOfferDto, UpdateCheckoutOfferDto } from './dto/checkout-offer.dto.js';
