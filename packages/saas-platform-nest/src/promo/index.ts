// @saasicat/nest/promo — Sub-Entry für Promo-Code-Logik.
//
// Inhalte:
//   - calculator: Pure Functions (computeDiscountGross, buildLabel, ...)
//   - math:       round2, computeIncludedVat
//   - service:    PromoCodesService (CRUD, Preview, Redeem, Reverse, Stats)
//   - expirer:    PromoCodeExpirer (Cron @ 3am Europe/Berlin)
//   - rate-limit.guard: PromoCodeRateLimitGuard + ipFingerprint/hashIp
//   - tokens:     DI-Tokens für die Adapter-Ports
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
