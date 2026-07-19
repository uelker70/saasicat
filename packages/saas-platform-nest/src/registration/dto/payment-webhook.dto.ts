import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Webhook-Vertrag fuer `POST /webhooks/payment`.
 *
 * Provider-agnostisch: Stripe-Adapter (Phase 2.4) mapped Stripe's
 * `checkout.session.completed` → `{ eventId, sessionId, status: 'SUCCEEDED' }`,
 * `payment_intent.payment_failed` → `{ status: 'FAILED' }`, etc.
 *
 * In Production sollte die Signatur-Verifikation (Stripe `Stripe-Signature`-
 * Header) VOR der DTO-Validierung greifen — siehe StripeWebhookGuard im
 * App-Modul.
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
