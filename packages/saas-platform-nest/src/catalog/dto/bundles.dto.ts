import {
    IsArray,
    IsBoolean,
    IsInt,
    IsNumberString,
    IsObject,
    IsOptional,
    IsString,
    IsUUID,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
} from 'class-validator';

// DTOs for `BundlesController` — class-validator validation at the HTTP
// boundary. Inherited required fields are validated here; spec-conformant
// options (compatibility, pricingOverrides) pass through as a generic object/
// array and are used structurally in the service.

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const FEATURE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const QUOTA_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

export class CreateBundleDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, {
        message: 'projectKey muss kebab-case sein (z. B. "my-app")',
    })
    @MaxLength(64)
    projectKey!: string;

    @IsString()
    @Matches(KEY_PATTERN, {
        message: 'bundleKey muss SCREAMING_SNAKE_CASE sein (z. B. "BANKING")',
    })
    @MaxLength(64)
    bundleKey!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    label!: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    icon?: string;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(10_000)
    sortOrder?: number;

    /** Locale translations { "en": { label, description }, … }. */
    @IsOptional()
    @IsObject()
    i18n?: Record<string, { label?: string; description?: string }>;
}

export class UpdateBundleDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    label?: string;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    description?: string | null;

    @IsOptional()
    @IsString()
    @MaxLength(64)
    icon?: string | null;

    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(10_000)
    sortOrder?: number;

    /** Locale translations { "en": { label, description }, … }. */
    @IsOptional()
    @IsObject()
    i18n?: Record<string, { label?: string; description?: string }>;
}

export class CreateBundleVersionDraftDto {
    @IsArray()
    @IsString({ each: true })
    @Matches(FEATURE_KEY_PATTERN, {
        each: true,
        message: 'features-Einträge müssen SCREAMING_SNAKE_CASE sein',
    })
    features!: string[];

    @IsOptional()
    @IsObject()
    quotas?: Record<string, number>;

    @IsOptional()
    @IsObject()
    compatibility?: { planIds?: string[] };

    @IsOptional()
    @IsArray()
    pricingOverrides?: Array<{
        planId?: string;
        monthlyNet?: string | null;
        yearlyNet?: string | null;
    }>;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsNumberString({ no_symbols: false })
    @Matches(DECIMAL_PATTERN, {
        message: 'monthlyNet muss Decimal mit max. 2 Nachkommastellen sein (z. B. "9.90")',
    })
    monthlyNet?: string | null;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @IsNumberString({ no_symbols: false })
    @Matches(DECIMAL_PATTERN, {
        message: 'yearlyNet muss Decimal mit max. 2 Nachkommastellen sein',
    })
    yearlyNet?: string | null;

    @IsOptional()
    @IsBoolean()
    marketed?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    changeNote?: string;

    @IsOptional()
    @IsUUID()
    baseVersionId?: string | null;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(ISO_DATE_PATTERN, {
        message: 'validFrom muss ISO-Datum sein (YYYY-MM-DD)',
    })
    validFrom?: string | null;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(ISO_DATE_PATTERN, {
        message: 'validUntil muss ISO-Datum sein (YYYY-MM-DD)',
    })
    validUntil?: string | null;
}

export class UpdateBundleVersionDraftDto {
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    @Matches(FEATURE_KEY_PATTERN, { each: true })
    features?: string[];

    @IsOptional()
    @IsObject()
    quotas?: Record<string, number>;

    @IsOptional()
    @IsObject()
    compatibility?: { planIds?: string[] };

    @IsOptional()
    @IsArray()
    pricingOverrides?: Array<{
        planId?: string;
        monthlyNet?: string | null;
        yearlyNet?: string | null;
    }>;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(DECIMAL_PATTERN)
    monthlyNet?: string | null;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(DECIMAL_PATTERN)
    yearlyNet?: string | null;

    @IsOptional()
    @IsBoolean()
    marketed?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    changeNote?: string;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(ISO_DATE_PATTERN, {
        message: 'validFrom muss ISO-Datum sein (YYYY-MM-DD)',
    })
    validFrom?: string | null;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(ISO_DATE_PATTERN, {
        message: 'validUntil muss ISO-Datum sein (YYYY-MM-DD)',
    })
    validUntil?: string | null;
}

export class PublishBundleVersionDto {
    @IsOptional()
    @IsBoolean()
    forceRegressive?: boolean;

    /**
     * Allows a deliberately free bundle (explicit price 0.00) and lifts the
     * zero-price gate (otherwise 422 BUNDLE_VERSION_ZERO_PRICE). Default: gate
     * active (protection against seed placeholders).
     */
    @IsOptional()
    @IsBoolean()
    allowZeroPrice?: boolean;

    /**
     * Required on publish if the draft carries no `validFrom`
     * (SPEC_V2 §4.2 + §11.1 M6 Pack 2c, analogous to PublishPlanVersionDto).
     * Service strictly checks > `validFrom` of the predecessor version.
     */
    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(ISO_DATE_PATTERN, {
        message: 'validFrom muss ISO-Datum sein (YYYY-MM-DD)',
    })
    validFrom?: string | null;

    @IsOptional()
    @ValidateIf((_o, value) => value !== null)
    @Matches(ISO_DATE_PATTERN, {
        message: 'validUntil muss ISO-Datum sein (YYYY-MM-DD)',
    })
    validUntil?: string | null;
}

// Note: QuotaKey validation of the quotas map keys does not run via
// class-validator (no decorator for map keys), but as a service-side
// check in strict mode. Whoever still wants to validate at the HTTP
// boundary extends the DTOs with a custom @Validator over `Object.keys()`.
void QUOTA_KEY_PATTERN;
