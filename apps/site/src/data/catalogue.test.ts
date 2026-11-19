import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { en } from '../i18n/en.ts';
import { nl } from '../i18n/nl.ts';
import {
  AUDIENCES,
  AUDIENCE_KEY,
  AGENCY_COST_FLOW,
  CATEGORIES,
  DEVELOPER_SURFACES,
  FEATURES,
  featuresFor,
  STATUSES,
} from './catalogue.ts';
import { PORTS, STANDARDS } from './integrations.ts';

describe('feature catalogue', () => {
  test('every feature has copy in both languages, and no copy lacks a feature', () => {
    const ids = FEATURES.map((feature) => feature.id).sort();
    assert.equal(new Set(ids).size, ids.length, 'feature ids are unique');
    assert.deepEqual(Object.keys(en.catalogue.items).sort(), ids);
    assert.deepEqual(Object.keys(nl.catalogue.items).sort(), ids);
  });

  test('only the Coming next category holds planned work, and it holds nothing else', () => {
    for (const feature of FEATURES) {
      assert.equal(
        feature.status === 'planned',
        feature.category === 'next',
        `${feature.id} is ${feature.status} in ${feature.category}`,
      );
    }
  });

  test('every category and every audience has features', () => {
    for (const category of CATEGORIES) assert.ok(featuresFor({ category }).length > 0, category);
    for (const audience of AUDIENCES) {
      assert.ok(featuresFor({ audience, exclude: ['next'] }).length >= 15, audience);
      assert.ok(featuresFor({ audience, category: 'next' }).length >= 2, `${audience} next`);
    }
  });

  test('each audience page leads with six to eight built features meant for it', () => {
    for (const audience of AUDIENCES) {
      const key = AUDIENCE_KEY[audience];
      assert.ok(key.length >= 6 && key.length <= 8, `${audience} has ${key.length}`);
      assert.equal(new Set(key).size, key.length);
      for (const id of key) {
        const feature = FEATURES.find((candidate) => candidate.id === id);
        assert.ok(feature, id);
        assert.notEqual(feature.status, 'planned', `${audience} key feature ${id} is planned`);
        assert.ok(feature.audiences.includes(audience), `${id} is not tagged ${audience}`);
      }
    }
  });

  test('the ten lines on the home page are ten', () => {
    assert.equal(en.tenLines.items.length, 10);
  });
});

describe('port board', () => {
  const statuses: readonly string[] = STATUSES;

  test('the catalogue and the copy name the same ports, each with an adapter', () => {
    const ids = PORTS.map((port) => port.id);
    assert.deepEqual([...ids].sort(), Object.keys(en.integrationsPage.ports).sort());
    assert.deepEqual([...ids].sort(), Object.keys(nl.integrationsPage.ports).sort());
    for (const port of PORTS) {
      assert.ok(port.adapters.length > 0, port.id);
      assert.ok(['registry', 'standard', 'contract'].includes(port.kind), port.id);
    }
  });

  test('every adapter has a status the site knows, and its note and label have copy in both languages', () => {
    for (const port of PORTS) {
      for (const adapter of port.adapters) {
        assert.ok(statuses.includes(adapter.status), `${port.id}: ${adapter.status}`);
        for (const key of [adapter.note, adapter.label]) {
          if (!key) continue;
          assert.ok(en.integrationsPage.notes[key], key);
          assert.ok(nl.integrationsPage.notes[key], key);
        }
        assert.ok(adapter.name || adapter.label, 'an adapter has a name or a label');
      }
    }
  });

  test('the catalogue and the copy name the same standards', () => {
    const ids = STANDARDS.map((standard) => standard.id).sort();
    assert.deepEqual(ids, Object.keys(en.integrationsPage.standards).sort());
    assert.deepEqual(ids, Object.keys(nl.integrationsPage.standards).sort());
  });

  test('the standards on the page are only the ones that are built', () => {
    for (const standard of STANDARDS) assert.notEqual(standard.status, 'planned', standard.id);
  });
});

describe('audience page sections', () => {
  test('the cost flow has one sentence per step in both languages', () => {
    assert.equal(en.agencies.flow.steps.length, AGENCY_COST_FLOW.length);
    assert.equal(nl.agencies.flow.steps.length, AGENCY_COST_FLOW.length);
  });

  test('the developer surfaces are built features, none of them in the key list', () => {
    for (const id of DEVELOPER_SURFACES) {
      assert.ok(FEATURES.some((feature) => feature.id === id && feature.status !== 'planned'));
      assert.ok(!AUDIENCE_KEY.developers.includes(id), id);
    }
  });
});

describe('branch timeline', () => {
  test('has the seven steps, with yours third to fifth, that its grid is drawn for', () => {
    for (const dict of [en, nl]) {
      const lanes = dict.developers.object.steps.map((step) => step.lane);
      assert.deepEqual(lanes, ['agent', 'agent', 'you', 'you', 'you', 'agent', 'agent']);
    }
  });
});
