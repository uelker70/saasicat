import type { InstallationMarkVerdict } from '@saasicat/core';

/**
 * What the installation verdict means, and the command that changes it where
 * one does, in one sentence or two. `installation status` prints it and the
 * doctor reports it, so that both say the same thing about the same database.
 */
export function installationVerdictText(verdict: InstallationMarkVerdict): string {
    switch (verdict.kind) {
        case 'matches':
            return `This database is marked as installation ${verdict.identifier}, the one this environment names.`;
        case 'unmarked':
            return (
                'This database carries no installation mark, so nothing is deleted in it. ' +
                `Mark it as this environment’s with \`<app> installation mark ${verdict.expected}\`.`
            );
        case 'differs':
            return (
                `This database is marked as installation ${verdict.marked}, but this environment ` +
                `names ${verdict.expected}, so nothing is deleted in it. If a backup was restored ` +
                'into this environment, mark it again with ' +
                `\`<app> installation mark ${verdict.expected} --replace\`.`
            );
    }
}
