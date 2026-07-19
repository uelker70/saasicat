import {
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    MinLength,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Konfigurator-Auswahl-Payload fuer `POST /auth/register/save-config`.
 *
 * Bewusst flach gehalten — Modell-Validierung passiert im Service gegen
 * den Catalog. DTO prueft nur Strukturtypen.
 */
export class SaveRegistrationConfigSelectionDto {
    @IsString()
    @MinLength(1)
    @MaxLength(40)
    modelId!: string;

    @IsIn(['MONTHLY', 'YEARLY'])
    billingCycle!: 'MONTHLY' | 'YEARLY';

    @IsOptional()
    @IsString()
    @MaxLength(60)
    appliedPromoCode?: string | null;

    /**
     * SPEC_V2 §11.1 M5.3 — optionale Vereinstyp-Wahl. UUID einer
     * **published** BusinessTypeVersion. Service validiert Existenz +
     * Live-Status gegen `RegistrationBusinessTypeLookup`. `null` = keine
     * Wahl (alter Plan-only-Pfad).
     */
    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsUUID()
    businessTypeVersionId?: string | null;

    /**
     * METAMODELL §17a — Paket-Konsistenz. ID des `CheckoutOffer`, der auf
     * der Pricing-Page angelegt wurde (`<app>/register?offer=<id>`). Wird
     * unverändert in `configJson` durchgereicht; der ActivationOrchestrator
     * friert ihn bei der Subscription-Anlage als `packageSnapshot` ein und
     * setzt den Offer auf `consumed`. `null` = Direkt-Registrierung ohne
     * Webseiten-Offer.
     */
    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsUUID()
    offerId?: string | null;
}

export class SaveRegistrationConfigDto {
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    pendingRegistrationId!: string;

    @ValidateNested()
    @Type(() => SaveRegistrationConfigSelectionDto)
    selection!: SaveRegistrationConfigSelectionDto;
}
