import {
    IsInt,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
    MinLength,
} from 'class-validator';

// DTOs für PlansController — class-validator-Validation an der HTTP-Grenze.
// SPEC_V2 §11.1 M6 (Pack 1): nur Plan-Stamm-CRUD, kein PlanVersion-Lifecycle.

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const PROJECT_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;

export class CreatePlanDto {
    @IsString()
    @Matches(PROJECT_KEY_PATTERN, {
        message: 'projectKey muss kebab-case sein (z. B. "my-app")',
    })
    @MaxLength(64)
    projectKey!: string;

    @IsString()
    @Matches(KEY_PATTERN, {
        message: 'planKey muss SCREAMING_SNAKE_CASE sein (z. B. "STARTER")',
    })
    @MaxLength(64)
    planKey!: string;

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
}

export class UpdatePlanDto {
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
}
