import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Webhook contract for `POST /webhooks/payment`.
 *
 * Provider-agnostic: the Stripe adapter (phase 2.4) maps Stripe's
 * `checkout.session.completed` → `{ eventId, sessionId, status: 'SUCCEEDED' }`,
 * `payment_intent.payment_failed` → `{ status: 'FAILED' }`, etc.
 *
 * In production the signature verification (Stripe `Stripe-Signature`
 * header) should run BEFORE the DTO validation — see StripeWebhookGuard in
 * the app module.
 */
export class PaymentWebhookDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    eventId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    sessionId?: string;

    @IsString()
    @MaxLength(40)
    provider!: string;

    @IsIn(['SUCCEEDED', 'FAILED'])
    status!: 'SUCCEEDED' | 'FAILED';

    @IsOptional()
    @IsObject()
    payload?: Record<string, unknown>;
}
