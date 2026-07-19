// Geteilte Domänen-Fehler. Bewusst framework-frei (kein NestJS-Import), damit
// sowohl Adapter (Konsumenten) als auch Aufrufer (nest-Services, CLI) sie
// werfen bzw. fachlich mappen können, statt sie als 500 durchzureichen.

import type { PlatformRole } from './ports/core-ports.types.js';

const USER_ALREADY_EXISTS = 'USER_ALREADY_EXISTS';

/**
 * Ein anzulegender User existiert bereits unter dieser E-Mail. Adapter werfen
 * ihn (z. B. im SuperAdmin-Bootstrap); Aufrufer mappen ihn fachlich:
 * SetupService → HTTP 409, CLI → lesbare Meldung.
 */
export class PlatformUserExistsError extends Error {
    readonly code = USER_ALREADY_EXISTS;
    constructor(
        readonly email: string,
        readonly existingRole: PlatformRole,
    ) {
        super(`User ${email} existiert bereits (Rolle: ${existingRole}).`);
        this.name = 'PlatformUserExistsError';
    }
}

/**
 * Realm-sicherer Type-Guard (prüft `code` statt `instanceof`) — funktioniert auch,
 * wenn Werfer und Fänger die Klasse aus unterschiedlichen Modul-Instanzen sehen.
 */
export function isPlatformUserExistsError(err: unknown): err is PlatformUserExistsError {
    return err instanceof Error && (err as { code?: string }).code === USER_ALREADY_EXISTS;
}
