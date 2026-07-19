import { Inject, Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';
import qrcodeTerminal from 'qrcode-terminal';

import { type CliContextConfig } from './cli-context.service.js';
import { MfaSetupFlow } from './mfa-setup-flow.js';
import { CLI_CONTEXT_CONFIG_TOKEN } from './tokens.js';
import { WhoAmIFlow } from './whoami-flow.js';

// Geteilte `<app> admin …`-Commands für alle Plattform-Consumer. Bindet die
// Plattform-Flows `WhoAmIFlow` + `MfaSetupFlow` an die nest-commander-CLI.
// Consumer registrieren diese Klassen in den Providern ihres CLI-Moduls;
// die Flows kommen aus `CliContextModule.forRoot({...})`.

interface AsFlag {
    as?: string;
}

interface MfaSetupFlags extends AsFlag {
    force?: boolean;
}

@Injectable()
@SubCommand({ name: 'whoami', description: 'Aktive CLI-Identität + MFA-/Production-Status' })
export class AdminWhoamiCommand extends CommandRunner {
    constructor(private readonly flow: WhoAmIFlow) {
        super();
    }
    async run(_args: string[], flags: AsFlag): Promise<void> {
        const result = await this.flow.run(flags.as);
        process.stdout.write(this.flow.formatResult(result) + '\n');
    }
    @Option({ flags: '--as <email>' })
    parseAs(v: string): string {
        return v;
    }
}

@Injectable()
@SubCommand({ name: 'mfa-setup', description: 'TOTP-MFA für den eigenen SuperAdmin einrichten' })
export class AdminMfaSetupCommand extends CommandRunner {
    constructor(
        @Inject(CLI_CONTEXT_CONFIG_TOKEN) private readonly config: CliContextConfig,
        private readonly flow: MfaSetupFlow,
    ) {
        super();
    }
    async run(_args: string[], flags: MfaSetupFlags): Promise<void> {
        const result = await this.flow.run({
            asFlag: flags.as,
            issuer: this.config.mfaIssuer ?? 'SuperAdmin',
            force: flags.force,
        });
        // QR-Code direkt im Terminal rendern — Authenticator-Apps scannen ihn
        // aus dem Buffer, kein Copy-Paste der otpauth-URI nötig.
        await new Promise<void>((resolve) => {
            qrcodeTerminal.generate(result.otpauthUri, { small: true }, (qr) => {
                process.stdout.write('\n' + qr + '\n');
                resolve();
            });
        });
        process.stdout.write(this.flow.formatSetupResult(result) + '\n');
    }
    @Option({ flags: '--as <email>' })
    parseAs(v: string): string {
        return v;
    }
    @Option({ flags: '--force', description: 'bestehendes Secret ohne Rückfrage überschreiben' })
    parseForce(): boolean {
        return true;
    }
}

@Injectable()
@Command({
    name: 'admin',
    description: 'SuperAdmin-Operations (whoami, mfa-setup)',
    subCommands: [AdminWhoamiCommand, AdminMfaSetupCommand],
})
export class AdminCommands extends CommandRunner {
    async run(): Promise<void> {
        process.stderr.write('Bitte Sub-Command angeben: whoami, mfa-setup.\n');
        process.exit(2);
    }
}
