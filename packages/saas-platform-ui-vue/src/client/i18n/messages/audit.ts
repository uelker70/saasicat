import { defineMessages } from '../define.js';

export const auditMessages = defineMessages(
    {
        title: 'Audit-Trail',
        subtitle: '{count} Einträge · plattformweit.',
        filterButton: 'Filtern',
        detailActorPrefix: 'Actor:',
        filters: {
            actor: 'Actor (E-Mail)',
            action: 'Action',
            entity: 'Entity',
            since: 'Seit',
        },
        columns: {
            time: 'Zeit',
            actor: 'Actor',
            action: 'Action',
            entity: 'Entity',
            id: 'ID',
        },
    },
    {
        title: 'Audit trail',
        subtitle: '{count} entries · platform-wide.',
        filterButton: 'Filter',
        detailActorPrefix: 'Actor:',
        filters: {
            actor: 'Actor (email)',
            action: 'Action',
            entity: 'Entity',
            since: 'Since',
        },
        columns: {
            time: 'Time',
            actor: 'Actor',
            action: 'Action',
            entity: 'Entity',
            id: 'ID',
        },
    },
);
