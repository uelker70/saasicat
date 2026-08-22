import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Input for `POST /auth/register/preview-promo`. If `code` is empty, the
 * effect of a previously applied code is removed (preview without promo).
 * Does NOT change the stored pending — only the preview calculation.
 */
export class PreviewRegistrationPromoDto {
    @IsString()
    @MinLength(1)
    @MaxLength(80)
    pendingRegistrationId!: string;

    @IsOptional()
    @IsString()
    @MaxLength(60)
    code?: string;
}
