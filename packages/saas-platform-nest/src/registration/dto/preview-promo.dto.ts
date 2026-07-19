import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Eingabe fuer `POST /auth/register/preview-promo`. Wenn `code` leer ist,
 * wird der Effekt eines bisher angewendeten Codes entfernt (Preview ohne
 * Promo). Verandert die gespeicherte Pending NICHT — nur Preview-Berechnung.
 */
export class PreviewRegistrationPromoDto {
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    pendingRegistrationId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(60)
    code?: string;
}
