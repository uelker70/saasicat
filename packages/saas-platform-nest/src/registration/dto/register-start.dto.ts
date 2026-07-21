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
 * Input for step 1 (registration data) — `POST /auth/register/start`.
 * Collects Tenant and admin data in one step; the final Tenant/User creation
 * only happens after successful payment (step 4).
 */
export class RegisterStartDto {
    /** Association/tenant name (required). */
    @IsString()
    @MinLength(2)
    @MaxLength(120)
    tenantName!: string;

    /** Optional slug. If left empty, it is generated from `tenantName`. */
    @IsOptional()
    @IsString()
    @Matches(/^[a-z0-9-]+$/, {
        message: 'tenantSlug darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.',
    })
    @MaxLength(60)
    tenantSlug?: string;

    /** Salutation of the administrator (optional). */
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

    /** Terms / privacy / data processing — mandatory acceptance (must be `true`). */
    @Equals(true, {
        message: 'AGB, Datenschutzerklaerung und Auftragsverarbeitung muessen zugestimmt werden.',
    })
    termsAccepted!: true;

    @IsOptional()
    @IsIn(['de', 'tr'])
    locale?: 'de' | 'tr';
}
