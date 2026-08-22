// @saasicat/nest/promo — sub-entry for promo-code logic.
//
// Contents:
//   - calculator: pure functions (computeDiscountGross, buildLabel, ...)
//   - math:       round2, computeIncludedVat
//   - service:    PromoCodesService (CRUD, preview, redeem, reverse, stats)
//   - expirer:    PromoCodeExpirer (cron @ 3am Europe/Berlin)
//   - rate-limit.guard: PromoCodeRateLimitGuard + ipFingerprint/hashIp
//   - tokens:     DI tokens for the adapter ports
//   - module:     PromoCodesModule.forRoot({ adapters... })

export * from './calculator.js';
export * from './math.js';
export * from './promo.service.js';
export * from './promo-code-expirer.service.js';
export * from './rate-limit.guard.js';
export * from './promo.tokens.js';
export * from './promo.controller.js';
export * from './dto/promo-public.dto.js';
export * from './promo.module.js';
export * from './promo-admin.controller.js';
export * from './dto/promo-admin.dto.js';
