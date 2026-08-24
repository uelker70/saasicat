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
import { applyDecorators } from '@nestjs/common';

// DTOs for `BundlesController` — class-validator validation at the HTTP
// boundary. Inherited required fields are validated here; spec-conformant
// options (compatibility, pricingOverrides) pass through as a generic object/
// array and are used structurally in the service.

// Constraints that repeat, declared once.
//
// The four bundle DTOs are two pairs — create and update of a bundle, create
// and update of a version draft — and a pair differs in what is REQUIRED, not
// in what a value has to look like. Written out per class, the same stack was
// copied eight times, and the copies had already drifted: the update draft's
// price and feature rules carried no message, so the same bad payload came
// back explained on one route and unexplained on the other.
//
// `applyDecorators` composes property decorators without changing what
// class-validator sees — each still registers its own constraint on the
// property. Optionality stays at the call site, because that IS the difference
// between the two halves of a pair.
const IsBoundedText = (max: number) => applyDecorators(IsString(), MaxLength(max));

const IsFeatureKeyList = () =>
    applyDecorators(
        IsArray(),
        IsString({ each: true }),
        Matches(FEATURE_KEY_PATTERN, {
            each: true,
            message: 'features entries must be SCREAMING_SNAKE_CASE',
        }),
    );

/** A price, or `null` for "none of its own". Two fraction digits, no more. */
const IsDecimalAmountOrNull = (field: string) =>
    applyDecorators(
        ValidateIf((_o, value) => value !== null),
        IsNumberString({ no_symbols: false }),
        Matches(DECIMAL_PATTERN, {
            message: `${field} must be a decimal with at most 2 fraction digits (e.g. "9.90")`,
        }),
    );

/** A calendar day, or `null` for "unbounded". */
const IsIsoDateOrNull = (field: string) =>
    applyDecorators(
        ValidateIf((_o, value) => value !== null),
        Matches(ISO_DATE_PATTERN, { message: `${field} must be an ISO date (YYYY-MM-DD)` }),
    );

const IsSortOrder = () => applyDecorators(IsInt(), Min(0), Max(10_000));

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const FEATURE_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const QUOTA_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T.*)?$/;

export class CreateBundleDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, {
        message: 'projectKey must be kebab-case (e.g. "my-app")',
    })
    @MaxLength(64)
    projectKey!: string;

    @IsString()
    @Matches(KEY_PATTERN, {
        message: 'bundleKey must be SCREAMING_SNAKE_CASE (e.g. "BANKING")',
    })
    @MaxLength(64)
    bundleKey!: string;

    @IsString()
    @MinLength(1)
    @MaxLength(120)
    label!: string;

    @IsOptional()
    @IsBoundedText(2000)
    description?: string;

    @IsOptional()
    @IsBoundedText(64)
    icon?: string;

    @IsOptional()
    @IsSortOrder()
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
    @IsBoundedText(2000)
    description?: string | null;

    @IsOptional()
    @IsBoundedText(64)
    icon?: string | null;

    @IsOptional()
    @IsSortOrder()
    sortOrder?: number;

    /** Locale translations { "en": { label, description }, … }. */
    @IsOptional()
    @IsObject()
    i18n?: Record<string, { label?: string; description?: string }>;
}

/**
 * Everything a version draft may carry apart from its feature list.
 *
 * A base class rather than two copies, and the split is where the pair actually
 * differs: a create needs features, an update may leave them alone. Everything
 * else — quotas, compatibility, prices, the window — is optional on both, and
 * was written out twice.
 *
 * `features` is deliberately NOT here. Declared in the base as optional, the
 * inherited `@IsOptional()` would follow into the create DTO and make the one
 * required field of that request optional again; class-validator reads the
 * whole prototype chain.
 */
export class BundleVersionDraftFieldsDto {
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
    @IsDecimalAmountOrNull('monthlyNet')
    monthlyNet?: string | null;

    @IsOptional()
    @IsDecimalAmountOrNull('yearlyNet')
    yearlyNet?: string | null;

    @IsOptional()
    @IsBoolean()
    marketed?: boolean;

    @IsOptional()
    @IsBoundedText(2000)
    changeNote?: string;

    @IsOptional()
    @IsUUID()
    baseVersionId?: string | null;

    @IsOptional()
    @IsIsoDateOrNull('validFrom')
    validFrom?: string | null;

    @IsOptional()
    @IsIsoDateOrNull('validUntil')
    validUntil?: string | null;
}

export class CreateBundleVersionDraftDto extends BundleVersionDraftFieldsDto {
    @IsFeatureKeyList()
    features!: string[];
}

export class UpdateBundleVersionDraftDto extends BundleVersionDraftFieldsDto {
    @IsOptional()
    @IsFeatureKeyList()
    features?: string[];
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
     * (analogous to PublishPlanVersionDto).
     * Service strictly checks > `validFrom` of the predecessor version.
     */
    @IsOptional()
    @IsIsoDateOrNull('validFrom')
    validFrom?: string | null;

    @IsOptional()
    @IsIsoDateOrNull('validUntil')
    validUntil?: string | null;
}

// Note: QuotaKey validation of the quotas map keys does not run via
// class-validator (no decorator for map keys), but as a service-side
// check in strict mode. Whoever still wants to validate at the HTTP
// boundary extends the DTOs with a custom @Validator over `Object.keys()`.
void QUOTA_KEY_PATTERN;
