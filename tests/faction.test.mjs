// node tests/faction.test.mjs
// Where the "faction color" button gets its color: the document's own, its faction's, and listeners of the hook.
import assert from 'node:assert/strict';

// The editor module extends Foundry's ApplicationV2 when it is imported (api.mjs imports it).
globalThis.foundry = {
  applications: { api: { HandlebarsApplicationMixin: (Base) => Base, ApplicationV2: class {} }, instances: new Map() },
};

const { collectColorHints, COLOR_HINTS_HOOK, factionColorHints, factionColorsSupported, normalizeHint } = await import('../scripts/lib/color-hints.mjs');

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}\n`, e);
    process.exitCode = 1;
  }
};

const faction = (name, fColor) => ({ documentName: 'Actor', name, type: 'azimuth.faction', system: { fColor } });
const redmark = faction('House Redmark', '#C1121F');
const library = { 'Actor.red': redmark, 'Actor.blue': faction('Blue Fleet', '#3a5a98'), 'Actor.plain': faction('No color', '') };
const resolve = async (uuid) => {
  if (uuid === 'Actor.broken') throw new Error('gone');
  return library[uuid] ?? null;
};
const globalObject = (gFaction) => ({ documentName: 'Actor', name: 'Fortress', type: 'azimuth.globalobject', system: { gFaction } });

await test('normalizeHint accepts hex colors only', () => {
  assert.equal(normalizeHint('#ABC'), '#aabbcc');
  assert.equal(normalizeHint(' #3A5A98 '), '#3a5a98');
  for (const bad of ['', 'red', '#12', '#12345', '#gggggg', null, undefined, 123]) assert.equal(normalizeHint(bad), '', String(bad));
});

await test('a Color value of a ColorField (not a plain string) reads like the string', async () => {
  const asColor = { documentName: 'Actor', name: 'Typed', system: { fColor: { toString: () => '#C1121F' } } };
  assert.deepEqual(await factionColorHints({ document: asColor }, resolve), [{ color: '#c1121f', label: 'Typed' }]);
});

await test('a faction offers its own color', async () => {
  assert.deepEqual(await factionColorHints({ document: redmark }, resolve), [{ color: '#c1121f', label: 'House Redmark' }]);
});

await test('a global object offers the color of its faction, by plain UUID or @UUID link', async () => {
  const expected = [{ color: '#c1121f', label: 'House Redmark' }];
  assert.deepEqual(await factionColorHints({ document: globalObject('Actor.red') }, resolve), expected);
  assert.deepEqual(await factionColorHints({ document: globalObject('@UUID[Actor.red]{Redmark}') }, resolve), expected);
});

await test('the chain Iconic -> Azimuth -> SpaceHolder: an Azimuth global object offers the color of a SpaceHolder faction', async () => {
  // the system keeps `fColor` as a plain string on its `faction` actors; Azimuth's global object only holds the UUID
  const shFaction = { documentName: 'Actor', name: 'SH Redmark', type: 'faction', system: { fColor: '#c1121f', fLink: '' } };
  const world = { 'Actor.sh': shFaction };
  const azObject = { documentName: 'Actor', name: 'Fortress', type: 'azimuth.globalobject', system: { gFaction: 'Actor.sh' } };
  const expected = [{ color: '#c1121f', label: 'SH Redmark' }];
  assert.deepEqual(await factionColorHints({ document: azObject }, async (uuid) => world[uuid] ?? null), expected);
  // an unlinked token on the scene has a synthetic actor with the same system data
  const token = { documentName: 'Token', actor: { ...azObject } };
  assert.deepEqual(await factionColorHints({ document: azObject, tokenDocument: token }, async (uuid) => world[uuid] ?? null), expected);
});

await test('a color field that holds an invalid Color (it prints as an empty string) offers nothing', async () => {
  const invalid = { documentName: 'Actor', name: 'Broken', system: { fColor: { toString: () => '' } } };
  assert.deepEqual(await factionColorHints({ document: invalid }, resolve), []);
});

await test('a placed token uses the actor behind it', async () => {
  const token = { documentName: 'Token', actor: globalObject('Actor.blue') };
  assert.deepEqual(await factionColorHints({ document: token }, resolve), [{ color: '#3a5a98', label: 'Blue Fleet' }]);
  // the editor is opened on an actor together with one of its placed tokens
  const actor = globalObject('Actor.blue');
  assert.deepEqual(await factionColorHints({ document: actor, tokenDocument: { documentName: 'Token', actor } }, resolve), [{ color: '#3a5a98', label: 'Blue Fleet' }]);
});

await test('nothing to offer: no faction, a missing, colorless or unreachable one, or an item', async () => {
  assert.deepEqual(await factionColorHints({ document: globalObject('') }, resolve), []);
  assert.deepEqual(await factionColorHints({ document: globalObject('Actor.nowhere') }, resolve), []);
  assert.deepEqual(await factionColorHints({ document: globalObject('Actor.plain') }, resolve), []);
  assert.deepEqual(await factionColorHints({ document: globalObject('Actor.broken') }, resolve), []);
  assert.deepEqual(await factionColorHints({ document: { documentName: 'Item', system: { fColor: '#ffffff' } } }, resolve), []);
  assert.deepEqual(await factionColorHints({}, resolve), []);
});

await test('a faction that belongs to a faction offers both, own color first, no duplicates', async () => {
  const sub = { ...faction('Redmark Vanguard', '#3a5a98'), system: { fColor: '#3a5a98', gFaction: 'Actor.red' } };
  const hints = await factionColorHints({ document: sub }, resolve);
  assert.deepEqual(hints.map((h) => h.color), ['#3a5a98', '#c1121f']);
  const same = { ...faction('Twin', '#c1121f'), system: { fColor: '#c1121f', gFaction: 'Actor.red' } };
  assert.equal((await factionColorHints({ document: same }, resolve)).length, 1);
});

await test('other modules add colors through the hook; bad entries and a failing listener do no harm', async () => {
  const listeners = [];
  globalThis.Hooks = { callAll: (name, ...args) => { assert.equal(name, COLOR_HINTS_HOOK); listeners.forEach((fn) => fn(...args)); } };

  listeners.push((context, hints) => {
    assert.equal(context.document.name, 'Fortress');
    hints.push({ color: '#2d6a4f', label: 'Guild' }, { color: 'not a color', label: 'broken' }, { color: '#C1121F', label: 'same as the faction' }, null);
  });
  const hints = await collectColorHints({ document: globalObject('Actor.red') }, resolve);
  assert.deepEqual(hints, [{ color: '#c1121f', label: 'House Redmark' }, { color: '#2d6a4f', label: 'Guild' }]);

  listeners.push(() => { throw new Error('listener bug'); });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const survived = await collectColorHints({ document: globalObject('Actor.red') }, resolve);
    assert.deepEqual(survived.map((h) => h.label), ['House Redmark', 'Guild'], 'colors collected before a failing listener survive');
  } finally {
    console.warn = warn;
  }
});

await test('a listener can put its color first', async () => {
  globalThis.Hooks = { callAll: (_name, _context, hints) => hints.unshift({ color: '#111111', label: 'Mine' }) };
  const [first] = await collectColorHints({ document: globalObject('Actor.red') }, resolve);
  assert.equal(first.color, '#111111');
});

// ---- api.edit passes the color on ----

globalThis.game = {
  user: { can: () => true },
  i18n: { localize: (k) => k },
  settings: { get: () => '' },
};
globalThis.ui = { notifications: { warn() {}, error() {} } };
globalThis.Hooks = { callAll() {} };
const { api, edit } = await import('../scripts/api.mjs');
const { IconicEditor } = await import('../scripts/editor/editor-app.mjs');

const seen = [];
IconicEditor.wait = async (options) => {
  seen.push(options);
  return null; // the user closed the editor
};
globalThis.fromUuid = async (uuid) => library[uuid] ?? null;
const owned = (doc) => ({ canUserModify: () => true, img: 'a/portrait.svg', ...doc });

await test('edit() finds the faction color of the document and names its owner', async () => {
  seen.length = 0;
  await edit({ document: owned(globalObject('Actor.red')) });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].factionColor, '#c1121f');
  assert.equal(seen[0].factionName, 'House Redmark');
  assert.equal(seen[0].target, 'both', 'an actor starts on both images');
});

await test('a color the caller names wins over the lookup', async () => {
  seen.length = 0;
  await edit({ document: owned(globalObject('Actor.red')), factionColor: '#00ff00', factionName: 'Mine' });
  assert.equal(seen[0].factionColor, '#00ff00');
  assert.equal(seen[0].factionName, 'Mine');
});

await test('a document with no faction opens the editor without a faction color', async () => {
  seen.length = 0;
  await edit({ document: owned({ documentName: 'Actor', name: 'Nobody', system: {} }) });
  assert.equal(seen[0].factionColor ?? null, null);
  seen.length = 0;
  await edit({ document: owned({ documentName: 'Item', system: {} }) });
  assert.equal(seen[0].factionColor ?? null, null);
});

await test('the api offers the lookup for other modules to inspect', async () => {
  assert.equal(typeof api.colorHints, 'function');
  assert.deepEqual(await api.colorHints(globalObject('Actor.blue')), [{ color: '#3a5a98', label: 'Blue Fleet' }]);
});

await test('faction colors need the SpaceHolder system or an active Azimuth', () => {
  const before = globalThis.game;
  const withGame = (systemId, modules) => {
    globalThis.game = { system: { id: systemId }, modules: new Map(Object.entries(modules)) };
    return factionColorsSupported();
  };
  try {
    assert.equal(withGame('spaceholder', {}), true);
    assert.equal(withGame('dnd5e', { azimuth: { active: true } }), true);
    assert.equal(withGame('dnd5e', { azimuth: { active: false } }), false, 'installed but switched off');
    assert.equal(withGame('dnd5e', {}), false);
    globalThis.game = undefined;
    assert.equal(factionColorsSupported(), false);
  } finally {
    globalThis.game = before;
  }
});

console.log(`${passed} faction tests passed`);
