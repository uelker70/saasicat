import {
    IsArray,
    IsBoolean,
    IsISO8601,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    MaxLength,
    ValidateIf,
} from 'class-validator';

// DTOs für PlanVersionsController — class-validator-Validation an der
// HTTP-Grenze. SPEC_V2 §11.1 M6 Pack 2a + §4.2 (validFrom/validUntil).
//
// Strukturell analog zu CreateBundleVersionDraftDto, aber ohne
// `compatibility` / `pricingOverrides` (Plan ist nicht
// kontext-abhängig wie Bundle).

const FEATURE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;

export class CreatePlanVersionDraftDto {
    @IsArray()
    @IsString({ each: true })
    @Matches(FEATURE_KEY_PATTERN, {
        each: true,
        message: 'features-Einträge müssen SCREAMING_SNAKE_CASE sein',
    })
    features!: string[];

    /**
     * Persistierte Bundle-Auswahl (bundleKeys, SCREAMING_SNAKE_CASE).
     * Optional + Default leer — siehe `PlanVersionRow.bundles`.
     */
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @Matches(FEATURE_KEY_PATTERN, {
        each: true,
        message: 'bundles-Einträge müssen SCREAMING_SNAKE_CASE sein',
    })
    bundles?: string[];

    @IsObject()
    quotas!: Record<string, number>;

    @Matches(DECIMAL_PATTERN, {
        message: 'monthlyNet muss Decimal mit max. 2 Nachkommastellen sein (z. B. "9.90")',
    })
    monthlyNet!: string;

    @Matches(DECIMAL_PATTERN, {
        message: 'yearlyNet muss Decimal mit max. 2 Nachkommastellen sein',
    })
    yearlyNet!: string;

    @IsOptional()
    @IsBoolean()
    marketed?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    changeNote?: string;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsUUID()
    baseVersionId?: string | null;

    /** Optional im Draft (Pflicht beim Publish). ISO-Date-String. SPEC_V2 §4.2. */
    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsISO8601()
    validFrom?: string | null;

    /** Optional; null = unbegrenzt. ISO-Date-String. */
    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsISO8601()
    validUntil?: string | null;
}

export class UpdatePlanVersionDraftDto {
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @Matches(FEATURE_KEY_PATTERN, { each: true })
    features?: string[];

    /** Persistierte Bundle-Auswahl (bundleKeys). Siehe `PlanVersionRow.bundles`. */
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @Matches(FEATURE_KEY_PATTERN, { each: true })
    bundles?: string[];

    @IsOptional()
    @IsObject()
    quotas?: Record<string, number>;

    @IsOptional()
    @Matches(DECIMAL_PATTERN)
    monthlyNet?: string;

    @IsOptional()
    @Matches(DECIMAL_PATTERN)
    yearlyNet?: string;

    @IsOptional()
    @IsBoolean()
    marketed?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    changeNote?: string;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsISO8601()
    validFrom?: string | null;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsISO8601()
    validUntil?: string | null;
}

export class TerminatePlanVersionDto {
    /**
     * Pflicht. ISO-8601-Datum/Zeitstempel; muss strikt in der Zukunft liegen.
     * Setzt `endsAt` der live PlanVersion. Idempotent.
     */
    @IsISO8601()
    endsAt!: string;
}

export class PublishPlanVersionDto {
    @IsOptional()
    @IsBoolean()
    forceRegressive?: boolean;

    /**
     * Erlaubt bewusst kostenlose Sonderverträge (Preis 0,00) und hebt damit
     * den Zero-Price-Gate auf (sonst 422 PLAN_VERSION_ZERO_PRICE). Default:
     * Gate aktiv (Schutz gegen Seed-Platzhalter).
     */
    @IsOptional()
    @IsBoolean()
    allowZeroPrice?: boolean;

    /**
     * Pflicht beim Publish (auf DTO oder Draft). Service prüft strikt
     * `validFrom > vorgänger.validFrom`. SPEC_V2 §4.2.
     */
    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsISO8601()
    validFrom?: string | null;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsISO8601()
    validUntil?: string | null;
}
