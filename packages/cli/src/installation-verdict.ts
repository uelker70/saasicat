import type { InstallationMarkVerdict, InstallationStatus } from '@saasicat/core';
import { installationOperationProblem } from '@saasicat/nest';

/**
 * What the installation status means, and the command that changes it where
 * one does, in a few sentences. `installation status` prints it and the doctor
 * reports it, so that both say the same thing about the same database.
 */
export function installationStatusText(status: InstallationStatus): string {
    const operation =
        status.kind === 'unmarked'
            ? 'Without a mark it is a live operation.'
            : `It is marked as a ${status.operation} operation.`;
    const problem = operationProblemOf(status);
    const disagreement = problem === null ? '' : ` ${capitalised(problem)}`;
    return `${verdictText(status)} ${operation}${disagreement}`;
}

/**
 * Why the application refuses to start on this database's documents, in the
 * words its start refuses with; `null` where they agree with the mark or
 * cannot be read.
 */
export function operationProblemOf(status: InstallationStatus): string | null {
    return status.issued === null
        ? null
        : installationOperationProblem(status.operation, status.issued);
}

function capitalised(sentence: string): string {
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function verdictText(verdict: InstallationMarkVerdict): string {
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
