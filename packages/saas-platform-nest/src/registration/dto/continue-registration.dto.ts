import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Eingabe fuer `POST /auth/register/continue`. Das Frontend liest den
 * `?resume=<jwt>`-Query aus dem Magic-Link der Resume-Mail und uebergibt
 * ihn an diesen Endpoint.
 */
export class ContinueRegistrationDto {
    @IsString()
    @MinLength(10)
    @MaxLength(2000)
    token!: string;
}
