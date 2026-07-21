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
export * from './service.js';
export * from './expirer.js';
export * from './rate-limit.guard.js';
export * from './tokens.js';
export * from './controller.js';
export * from './dto/promo-public.dto.js';
export * from './module.js';
