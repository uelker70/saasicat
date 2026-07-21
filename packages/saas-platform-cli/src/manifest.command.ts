import { Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';

import { CliContextService } from './cli-context.service.js';
import { ManifestCliFlow } from './manifest-cli-flow.js';

// Shared `<app> manifest …` commands for all platform consumers.
// Binds the platform `ManifestCliFlow` to the
// nest-commander CLI tree. Consumers register these classes in the
// providers of their CLI module; `CliContextService` + `ManifestCliFlow` come
// from `CliContextModule.forRoot({ manifestAccessPort })`.
//
// Sub-commands:
//   <app> manifest dump      — JSON output of the live manifest
//   <app> manifest hash      — manifestHash for CI pinning
//   <app> manifest validate  — schemaVersion + project.key + manifestHash sanity
//   <app> manifest check     — all registered checks (exit 7 on error)

interface AsFlag {
    as?: string;
}

@Injectable()
@SubCommand({ name: 'dump', description: 'Manifest als JSON ausgeben' })
export class ManifestDumpCommand extends CommandRunner {
    constructor(
        private readonly ctx: CliContextService,
        private readonly flow: ManifestCliFlow,
    ) {
        super();
    }
    async run(_args: string[], flags: AsFlag): Promise<void> {
        const identity = this.ctx.resolveIdentity(flags.as);
        await this.ctx.ensureSuperAdmin(identity);
        process.stdout.write(JSON.stringify(this.flow.dump(), null, 2) + '\n');
    }
    @Option({ flags: '--as <email>' })
    parseAs(v: string): string {
        return v;
    }
}

@Injectable()
@SubCommand({ name: 'hash', description: 'manifestHash ausgeben (CI-Pinning)' })
export class ManifestHashCommand extends CommandRunner {
    constructor(
        private readonly ctx: CliContextService,
        private readonly flow: ManifestCliFlow,
    ) {
        super();
    }
    async run(_args: string[], flags: AsFlag): Promise<void> {
        const identity = this.ctx.resolveIdentity(flags.as);
        await this.ctx.ensureSuperAdmin(identity);
        process.stdout.write(this.flow.hash() + '\n');
    }
    @Option({ flags: '--as <email>' })
    parseAs(v: string): string {
        return v;
    }
}

@Injectable()
@SubCommand({
    name: 'validate',
    description: 'Schnell-Sanity (schemaVersion + project.key + manifestHash)',
})
export class ManifestValidateCommand extends CommandRunner {
    constructor(
        private readonly ctx: CliContextService,
        private readonly flow: ManifestCliFlow,
    ) {
        super();
    }
    async run(_args: string[], flags: AsFlag): Promise<void> {
        const identity = this.ctx.resolveIdentity(flags.as);
        await this.ctx.ensureSuperAdmin(identity);
        const result = this.flow.validate();
        if (result.ok) {
            process.stdout.write('Manifest validiert ✓\n');
            return;
        }
        process.stderr.write(`Manifest invalid: ${result.reason}\n`);
        process.exit(1);
    }
    @Option({ flags: '--as <email>' })
    parseAs(v: string): string {
        return v;
    }
}

@Injectable()
@SubCommand({
    name: 'check',
    description: 'Alle Manifest-Checks (Exit-Code 7 bei error/Drift)',
})
export class ManifestCheckCommand extends CommandRunner {
    constructor(
        private readonly ctx: CliContextService,
        private readonly flow: ManifestCliFlow,
    ) {
        super();
    }
    async run(_args: string[], flags: AsFlag): Promise<void> {
        const identity = this.ctx.resolveIdentity(flags.as);
        await this.ctx.ensureSuperAdmin(identity);
        const report = await this.flow.runChecks();
        process.stdout.write(this.flow.formatReport(report) + '\n');
        const code = this.flow.exitCodeFor(report);
        if (code !== 0) process.exit(code);
    }
    @Option({ flags: '--as <email>' })
    parseAs(v: string): string {
        return v;
    }
}

@Injectable()
@Command({
    name: 'manifest',
    description: 'Manifest-Operations (dump, hash, validate, check)',
    subCommands: [
        ManifestDumpCommand,
        ManifestHashCommand,
        ManifestValidateCommand,
        ManifestCheckCommand,
    ],
})
export class ManifestCommands extends CommandRunner {
    async run(): Promise<void> {
        process.stderr.write('Bitte Sub-Command angeben: dump, hash, validate, check.\n');
        process.exit(2);
    }
}
