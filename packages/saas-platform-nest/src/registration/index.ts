// @saasicat/nest/registration — sub-entry for the
// multi-step registration and onboarding flow.
//
// Contents:
//   - helpers:                   Pure functions (generateOtpCode, hashOtpCode,
//                                verifyOtpCode, slugify) — usable for unit tests
//                                without DI.
//   - tokens:                    DI tokens for the adapter ports + PasswordHasher interface.
//   - pending-registration:      PendingRegistrationService (start, verifyOtp, resendOtp).
//   - module:                    RegistrationModule.forRoot({ adapters... }).
//   - dto:                       class-validator DTOs for the controller layer.

export * from './helpers.js';
export * from './tokens.js';
export * from './pending-registration.service.js';
export * from './cleanup.cron.js';
export * from './ip-rate-limit.guard.js';
export * from './module.js';
export * from './dto/register-start.dto.js';
export * from './dto/verify-registration-otp.dto.js';
export * from './dto/resend-registration-otp.dto.js';
export * from './dto/select-plan.dto.js';
export * from './dto/start-checkout.dto.js';
export * from './dto/payment-webhook.dto.js';
export * from './dto/continue-registration.dto.js';
export * from './dto/save-configuration.dto.js';
export * from './dto/preview-promo.dto.js';
export * from './pricing.js';
