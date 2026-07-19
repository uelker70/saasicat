import { Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';

import { CliContextService } from './cli-context.service.js';
import { DoctorFlow } from './doctor-flow.js';

// Geteiltes `<app> doctor`-Command. Bindet den Plattform-`DoctorFlow` an die
// nest-commander-CLI. Die ausgeführten Checks bestimmt der Consumer über
// `CliContextModule.forRoot({ doctorChecks | defaultDoctorChecks })`; ohne
// Checks läuft der Flow durch und meldet Gesamtstatus `OK`.

interface AsFlag {
    as?: string;
}

@Injectable()
@Command({ name: 'doctor', description: 'Health-/Drift-Checks (Exit-Code 4 bei error)' })
export class DoctorCommands extends CommandRunner {
    constructor(
        private readonly ctx: CliContextService,
        private readonly flow: DoctorFlow,
    ) {
        super();
    }
    async run(_args: string[], flags: AsFlag): Promise<void> {
        const identity = this.ctx.resolveIdentity(flags.as);
        await this.ctx.ensureSuperAdmin(identity);
        const report = await this.flow.run();
        process.stdout.write(this.flow.formatReport(report) + '\n');
        const code = this.flow.exitCodeFor(report);
        if (code !== 0) process.exit(code);
    }
    @Option({ flags: '--as <email>' })
    parseAs(v: string): string {
        return v;
    }
}
