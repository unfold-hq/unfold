import type { Status } from './catalogue.ts';
import type { en } from '../i18n/en.ts';
import catalogue from './integrations.json' with { type: 'json' };

type Notes = keyof typeof en.integrationsPage.notes;
type PortId = keyof typeof en.integrationsPage.ports;
type StandardId = keyof typeof en.integrationsPage.standards;

/** One tab on the port board: a product name, or a translated label when there is none. */
export interface Adapter {
  name?: string;
  label?: Notes;
  note?: Notes;
  status: Status;
}

export interface Port {
  id: PortId;
  kind: 'registry' | 'standard' | 'contract';
  openSocket: boolean;
  adapters: readonly Adapter[];
}

export interface Standard {
  id: StandardId;
  name: string;
  status: Status;
}

export const PORTS = catalogue.ports as readonly Port[];

export const STANDARDS = catalogue.standards as readonly Standard[];

/** Coming next on the integrations page, grouped, in the owner's order. */
export const NEXT_GROUPS = [
  { id: 'trackers', features: ['nextJira', 'nextIssues', 'nextLinear', 'nextTrackers'] },
  { id: 'billing', features: ['nextPsa'] },
  { id: 'gateway', features: ['nextGateway'] },
  { id: 'delivery', features: ['nextPreview', 'nextPortal', 'nextHosted'] },
  { id: 'tests', features: ['nextTrackerSuite'] },
] as const;
