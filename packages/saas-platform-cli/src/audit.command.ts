import { Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option, SubCommand } from 'nest-commander';

import { AuditTailFlow } from './audit-tail-flow.js';
import { CliContextService } from './cli-context.service.js';

// Shared `<app> audit …` commands. Binds the platform `AuditTailFlow` to
// the nest-commander CLI. Requires the consumer to supply an AuditQueryPort
// adapter in `CliContextModule.forRoot({ auditQueryPort })` — otherwise the
// flow is not registered and command boot fails.

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
