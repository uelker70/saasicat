// @saasicat/nest/registration — Sub-Entry fuer den
// mehrstufigen Registrierungs- und Onboarding-Flow.
//
// Inhalte:
//   - helpers:                   Pure Funktionen (generateOtpCode, hashOtpCode,
//                                verifyOtpCode, slugify) — fuer Unit-Tests
//                                ohne DI nutzbar.
//   - tokens:                    DI-Tokens fuer die Adapter-Ports + PasswordHasher-Interface.
//   - pending-registration:      PendingRegistrationService (start, verifyOtp, resendOtp).
//   - module:                    RegistrationModule.forRoot({ adapters... }).
//   - dto:                       class-validator DTOs fuer die Controller-Schicht.
//
// Spec: vereinsfux/handoff/registrierung/registrierung.md

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
