import {
    Equals,
    IsEmail,
    IsIn,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    MinLength,
} from 'class-validator';

/**
 * Eingabe fuer Schritt 1 (Anmeldedaten) — `POST /auth/register/start`.
 * Sammelt Tenant- und Admin-Daten in einem Schritt; finale Tenant-/User-Anlage
 * passiert erst nach erfolgreicher Zahlung (Schritt 4).
 */
export class RegisterStartDto {
    /** Vereins-/Mandantenname (Pflicht). */
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    tenantName!: string;

    /** Optionaler Slug. Bei Leer-Eingabe wird er aus `tenantName` generiert. */
    @IsOptional()
    @IsString()
    @Matches(/^[a-z0-9-]+$/, {
        message: 'tenantSlug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.',
    })
    @MaxLength(60)
    tenantSlug?: string;

    /** Anrede des Administrators (optional). */
    @IsOptional()
    @IsString()
    @MaxLength(40)
    salutation?: string;

    @IsString()
    @MinLength(1)
    @MaxLength(60)
    firstName!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(60)
    lastName!: string;

    @IsEmail()
    @MaxLength(160)
    email!: string;

    @IsString()
    @MinLength(8)
    @MaxLength(160)
    password!: string;

    /** AGB / Datenschutz / Auftragsverarbeitung — Pflicht-Akzept (muss `true` sein). */
    @Equals(true, {
        message: 'AGB, Datenschutzerklaerung und Auftragsverarbeitung muessen zugestimmt werden.',
    })
    termsAccepted!: true;

    @IsOptional()
    @IsIn(['de', 'tr'])
    locale?: 'de' | 'tr';
}
