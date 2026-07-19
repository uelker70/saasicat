import { IsEmail, IsString, Matches } from 'class-validator';

export class VerifyRegistrationOtpDto {
    @IsEmail()
    email!: string;

    @IsString()
    @Matches(/^\d{6}$/, { message: 'OTP muss 6 Ziffern sein.' })
    otp!: string;
}
