// SetupController — öffentlicher First-Run-Endpoint des Admin-UI.
//
// BEWUSST OHNE Auth-Guards: vor dem ersten SUPER_ADMIN gibt es keine Session.
// Der Schutz liegt im SetupService (SETUP_TOKEN + Self-Disable). Validierung der
// Eingaben via class-validator (globale ValidationPipe des Konsumenten).

import { Body, Controller, Get, Post } from '@nestjs/common';
import type {
    SetupConfirmMfaResponse,
    SetupResult,
    SetupStatusResponse,
} from '@saasicat/types';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

import { SetupService } from './setup.service.js';

class SetupDto {
    @IsString()
    @IsNotEmpty()
    token!: string;

    @IsEmail()
    email!: string;

    @IsOptional()
    @IsString()
    @MinLength(8)
    password?: string;
}

class SetupConfirmMfaDto {
    @IsString()
    @IsNotEmpty()
    token!: string;

    @IsString()
    @IsNotEmpty()
    userId!: string;

    @IsString()
    @IsNotEmpty()
    code!: string;
}

@Controller('admin/setup')
export class SetupController {
    constructor(private readonly setup: SetupService) {}

    @Get('status')
    status(): Promise<SetupStatusResponse> {
        return this.setup.status();
    }

    @Post()
    run(@Body() dto: SetupDto): Promise<SetupResult> {
        return this.setup.setup(dto);
    }

    @Post('confirm-mfa')
    confirm(@Body() dto: SetupConfirmMfaDto): Promise<SetupConfirmMfaResponse> {
        return this.setup.confirmMfa(dto);
    }
}
