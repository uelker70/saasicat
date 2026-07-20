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

// DTOs for PlanVersionsController — class-validator validation at the
// HTTP boundary. SPEC_V2 §11.1 M6 Pack 2a + §4.2 (validFrom/validUntil).
//
// Structurally analogous to CreateBundleVersionDraftDto, but without
// `compatibility` / `pricingOverrides` (a plan is not
// context-dependent like a bundle).

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
     * Persisted bundle selection (bundleKeys, SCREAMING_SNAKE_CASE).
     * Optional + defaults to empty — see `PlanVersionRow.bundles`.
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

    /** Optional in the draft (required at publish). ISO date string. SPEC_V2 §4.2. */
    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsISO8601()
    validFrom?: string | null;

    /** Optional; null = unlimited. ISO date string. */
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

    /** Persisted bundle selection (bundleKeys). See `PlanVersionRow.bundles`. */
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
     * Required. ISO-8601 date/timestamp; must be strictly in the future.
     * Sets `endsAt` of the live PlanVersion. Idempotent.
     */
    @IsISO8601()
    endsAt!: string;
}

export class PublishPlanVersionDto {
    @IsOptional()
    @IsBoolean()
    forceRegressive?: boolean;

    /**
     * Deliberately allows free special contracts (price 0.00) and thereby lifts
     * the zero-price gate (otherwise 422 PLAN_VERSION_ZERO_PRICE). Default:
     * gate active (protection against seed placeholders).
     */
    @IsOptional()
    @IsBoolean()
    allowZeroPrice?: boolean;

    /**
     * Required at publish (on the DTO or draft). The service strictly checks
     * `validFrom > predecessor.validFrom`. SPEC_V2 §4.2.
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
