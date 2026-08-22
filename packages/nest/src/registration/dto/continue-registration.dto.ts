import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Input for `POST /auth/register/continue`. The frontend reads the
 * `?resume=<jwt>` query from the magic link in the resume email and passes
 * it to this endpoint.
 */
export class ContinueRegistrationDto {
    @IsString()
    @MinLength(10)
    @MaxLength(2000)
    token!: string;
}
