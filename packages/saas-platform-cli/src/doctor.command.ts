import { Injectable } from '@nestjs/common';
import { Command, CommandRunner, Option } from 'nest-commander';

import { CliContextService } from './cli-context.service.js';
import { DoctorFlow } from './doctor-flow.js';

// Shared `<app> doctor` command. Binds the platform `DoctorFlow` to the
// nest-commander CLI. The consumer determines which checks run via
// `CliContextModule.forRoot({ doctorChecks | defaultDoctorChecks })`; without
// any checks the flow completes and reports an overall status of `OK`.

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
