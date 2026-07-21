import { Controller, Get, Inject } from '@nestjs/common';
import type { PublicBootResponse } from '@saasicat/types';
import { ADMIN_MANIFEST_CONFIG, type AdminManifestConfig } from './admin-manifest.config.js';

// Public boot endpoint — no auth, returns only minimal branding data
// for the SuperAdmin UI login page. Deliberately just the required subset
// (key/displayName/logoUrl/environment) — prevents app topology leak before login.

@Controller('admin')
export class AdminPublicBootController {
    constructor(@Inject(ADMIN_MANIFEST_CONFIG) private readonly config: AdminManifestConfig) {}

    @Get('boot')
    getBoot(): PublicBootResponse {
        return {
            project: {
                key: this.config.project.key,
                displayName: this.config.project.displayName,
                label: this.config.project.label,
                icon: this.config.project.icon,
                logoUrl: this.config.project.logoUrl,
                environment: this.config.project.environment,
            },
        };
    }
}
