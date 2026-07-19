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

// DTOs für `BundlesController` — class-validator-Validierung an der HTTP-
// Grenze. Erbliche Pflicht-Felder werden hier validiert; Spec-konforme
// Optionen (compatibility, pricingOverrides) gehen als generisches Object/
// Array durch und werden im Service strukturell genutzt.

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

    /** Locale-Übersetzungen { "en": { label, description }, … }. */
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

    /** Locale-Übersetzungen { "en": { label, description }, … }. */
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
    compatibility?: { businessTypeKeys?: string[]; planIds?: string[] };

    @IsOptional()
    @IsArray()
    pricingOverrides?: Array<{
        businessTypeKey?: string;
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
    compatibility?: { businessTypeKeys?: string[]; planIds?: string[] };

    @IsOptional()
    @IsArray()
    pricingOverrides?: Array<{
        businessTypeKey?: string;
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
     * Erlaubt ein bewusst kostenloses Bundle (expliziter Preis 0,00) und hebt
     * den Zero-Price-Gate auf (sonst 422 BUNDLE_VERSION_ZERO_PRICE). Default:
     * Gate aktiv (Schutz gegen Seed-Platzhalter).
     */
    @IsOptional()
    @IsBoolean()
    allowZeroPrice?: boolean;

    /**
     * Pflicht beim Publish, falls der Draft kein `validFrom` trägt
     * (SPEC_V2 §4.2 + §11.1 M6 Pack 2c, analog PublishPlanVersionDto).
     * Service prüft strikt > `validFrom` der Vorgänger-Version.
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

// Hinweis: QuotaKey-Validierung der quotas-Map-Keys läuft nicht über
// class-validator (kein Decorator für Map-Keys), sondern als Service-Side-
// Check im Strict-Mode. Wer trotzdem an der HTTP-Grenze prüfen will,
// erweitert die DTOs mit einem custom @Validator über `Object.keys()`.
void QUOTA_KEY_PATTERN;
