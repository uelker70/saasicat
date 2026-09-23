import { IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/** Only a value that is present is checked; `null` clears, and is judged by the service. */
const present = (_: unknown, value: unknown) => value !== null && value !== undefined;

/**
 * A change of the subscriber's contact details — `PATCH /billing/details`. A
 * field left out keeps its value.
 *
 * The legal name and the tax identifiers are declared so that they reach the
 * service rather than being stripped by the application's `ValidationPipe`:
 * a tenant that sends a new legal name is told it cannot change it there,
 * instead of being told it succeeded.
 */
export class ChangeBillingDetailsDto {
    @ValidateIf(present)
    @IsString()
    @MaxLength(200)
    addressLine1?: string | null;

    @ValidateIf(present)
    @IsString()
    @MaxLength(200)
    addressLine2?: string | null;

    @ValidateIf(present)
    @IsString()
    @MaxLength(20)
    postalCode?: string | null;

    @ValidateIf(present)
    @IsString()
    @MaxLength(100)
    city?: string | null;

    /** ISO 3166-1 alpha-2, e.g. `DE`; its form is checked where every detail is settled. */
    @ValidateIf(present)
    @IsString()
    @MaxLength(2)
    country?: string | null;

    @ValidateIf(present)
    @IsString()
    @MaxLength(254)
    invoiceEmail?: string | null;

    @IsOptional()
    legalName?: unknown;

    @IsOptional()
    vatId?: unknown;

    @IsOptional()
    taxNumber?: unknown;
}
