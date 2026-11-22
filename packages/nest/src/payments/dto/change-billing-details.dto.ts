import { IsOptional } from 'class-validator';

/**
 * A change of the subscriber's contact details — `PATCH /billing/details`. A
 * field left out keeps its value.
 *
 * Every field is declared, and none is judged here, so that each reaches the
 * service through the application's `ValidationPipe` rather than being
 * stripped or refused by it. The service refuses a detail the application
 * keeps elsewhere by its name before it judges any value, and then judges the
 * form and length of the rest (`SC-SUB-049`); a pipe judging them first would
 * answer a kept detail with its value's fault. The legal name and the tax
 * identifiers reach it the same way: a tenant that sends a new legal name is
 * told it cannot change it there, instead of being told it succeeded.
 */
export class ChangeBillingDetailsDto {
    @IsOptional()
    addressLine1?: string | null;

    @IsOptional()
    addressLine2?: string | null;

    @IsOptional()
    postalCode?: string | null;

    @IsOptional()
    city?: string | null;

    /** ISO 3166-1 alpha-2, e.g. `DE`. */
    @IsOptional()
    country?: string | null;

    @IsOptional()
    invoiceEmail?: string | null;

    @IsOptional()
    legalName?: unknown;

    @IsOptional()
    vatId?: unknown;

    @IsOptional()
    taxNumber?: unknown;
}
