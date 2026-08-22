import { IsEmail, IsString, Matches } from 'class-validator';

export class VerifyRegistrationOtpDto {
    @IsEmail()
    email!: string;

    @IsString()
    @Matches(/^\d{6}$/, { message: 'The OTP must be 6 digits.' })
    otp!: string;
}
