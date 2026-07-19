import { Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';

import { AuditTailFlow } from './audit-tail-flow.js';
import { CliContextService } from './cli-context.service.js';

// Geteilte `<app> audit …`-Commands. Bindet den Plattform-`AuditTailFlow` an
// die nest-commander-CLI. Setzt voraus, dass der Consumer in
// `CliContextModule.forRoot({ auditQueryPort })` einen AuditQueryPort-Adapter
// liefert — sonst ist der Flow nicht registriert und der Command-Boot scheitert.

interface TailFlags {
    as?: string;
    actor?: string;
    action?: string;
    entity?: string;
    since?: string;
    limit?: number;
}

@Injectable()
@SubCommand({
    name: 'tail',
    description: 'Letzte Audit-Log-Einträge (--actor/--action/--entity/--since/--limit)',
})
export class AuditTailCommand extends CommandRunner {
    constructor(
        private readonly ctx: CliContextService,
        private readonly flow: AuditTailFlow,
    ) {
        super();
    }
    async run(_args: string[], flags: TailFlags): Promise<void> {
        const identity = this.ctx.resolveIdentity(flags.as);
        await this.ctx.ensureSuperAdmin(identity);
        const entries = await this.flow.run({
            actor: flags.actor,
            action: flags.action,
            entity: flags.entity,
            since: flags.since,
            limit: flags.limit,
        });
        this.ctx.table(this.flow.formatRows(entries));
    }
    @Option({ flags: '--as <email>' })
    parseAs(v: string): string {
        return v;
    }
    @Option({ flags: '--actor <email>' })
    parseActor(v: string): string {
        return v;
    }
    @Option({ flags: '--action <name>' })
    parseAction(v: string): string {
        return v;
    }
    @Option({ flags: '--entity <name>' })
    parseEntity(v: string): string {
        return v;
    }
    @Option({ flags: '--since <iso-date>' })
    parseSince(v: string): string {
        return v;
    }
    @Option({ flags: '--limit <n>' })
    parseLimit(v: string): number {
        return Number.parseInt(v, 10);
    }
}

@Injectable()
@Command({ name: 'audit', description: 'Audit-Log-Operations (tail)', subCommands: [AuditTailCommand] })
export class AuditCommands extends CommandRunner {
    async run(): Promise<void> {
        process.stderr.write('Bitte Sub-Command angeben: tail.\n');
        process.exit(2);
    }
}
