import {
    type CanActivate,
    type ExecutionContext,
    ForbiddenException,
    Inject,
    Injectable,
    Optional,
} from '@nestjs/common';
import { TENANT_AUTH_GUARDS_TOKEN, type AuthGuardList } from './tenant-billing.tokens.js';

// ComposedTenantAuthGuard — bündelt eine Liste konsumenten-spezifischer
// Guards (z. B. JwtAuthGuard + TenantGuard + RolesGuard) in einen einzigen
// `@UseGuards()`-Eintrag. Wird vom `TenantBillingController` verwendet, weil
// die zu prüfenden Guards pro App unterschiedlich sind und `@UseGuards()`
// zur Compile-Zeit aufgelöst wird.
//
// Konsument registriert die Liste via `TenantBillingModule.forRoot.authGuards`
// (entweder direkter Array oder useFactory-Provider, der die Guards aus dem
// DI-Container holt). Reihenfolge ist signifikant — die erste Verweigerung
// blockt alle nachfolgenden Guards.

@Injectable()
export class ComposedTenantAuthGuard implements CanActivate {
    constructor(
        @Optional()
        @Inject(TENANT_AUTH_GUARDS_TOKEN)
        private readonly guards: AuthGuardList | null = null,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (!this.guards || this.guards.length === 0) {
            // Kein konfigurierter Guard ist ein Setup-Fehler — sonst wären
            // tenant-scoped Endpunkte ohne Auth-Schutz. Lieber laut scheitern
            // als still durchwinken.
            throw new ForbiddenException(
                'TenantBillingModule.forRoot.authGuards ist nicht konfiguriert.',
            );
        }
        for (const guard of this.guards) {
            const result = await Promise.resolve(guard.canActivate(context));
            if (!result) return false;
        }
        return true;
    }
}
