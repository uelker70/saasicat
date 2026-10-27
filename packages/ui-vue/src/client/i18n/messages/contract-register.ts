// translation-catalogue: the German half of this file is German on purpose.
// The contract register of the installation: every contract, a former
// subscriber's and a deleted tenant's included. A contract's tenant, period and
// price are worded where the subscriber's record words them
// (`subscribers.contracts`), so both screens say them alike.
import { defineMessages } from '../define.js';

export const contractRegisterMessages = defineMessages(
    {
        title: 'Verträge',
        subtitle:
            'Jeder Vertrag der Installation, auch früherer Vertragspartner und gelöschter Mandanten – der späteste Beginn zuerst.',
        loadFailed: 'Die Verträge konnten nicht geladen werden.',
        state: 'Stand',
        states: {
            'in-force': 'In Kraft',
            ended: 'Beendet',
            scheduled: 'Geplant',
            'never-in-force': 'Nie in Kraft',
            all: 'Alle',
        },
        day: 'Am Tag',
        dayHint: 'Leer: heute',
        listTitle: 'Stand am {day}',
        empty: 'Kein Vertrag in diesem Stand.',
        columnSubscriber: 'Vertragspartner',
        columnTenant: 'Mandant',
        columnPlan: 'Plan und Add-ons',
        columnPeriod: 'Laufzeit',
        columnStanding: 'Stand',
        columnPrice: 'Preis je Periode',
        tenantDeleted: '{name}, gelöscht',
        noPlan: 'ohne Plan',
        openContract: 'Den Vertrag von {customerNumber} in der Akte öffnen',
        more: 'Weitere laden',
    },
    {
        title: 'Contracts',
        subtitle:
            "Every contract of the installation, former subscribers' and deleted tenants' included — the latest start first.",
        loadFailed: 'The contracts could not be loaded.',
        state: 'Standing',
        states: {
            'in-force': 'In force',
            ended: 'Ended',
            scheduled: 'Scheduled',
            'never-in-force': 'Never in force',
            all: 'All',
        },
        day: 'On the day',
        dayHint: 'Empty: today',
        listTitle: 'As of {day}',
        empty: 'No contract in this standing.',
        columnSubscriber: 'Subscriber',
        columnTenant: 'Tenant',
        columnPlan: 'Plan and add-ons',
        columnPeriod: 'Term',
        columnStanding: 'Standing',
        columnPrice: 'Price per period',
        tenantDeleted: '{name}, deleted',
        noPlan: 'no plan',
        openContract: "Open {customerNumber}'s contract in the record",
        more: 'Load more',
    },
);
