// node tests/presets.test.mjs
// Presets without Foundry: what they hold, how they go on a style, the strip of recent styles, what a
// style says on hover, and the library on files that can only be added to.
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { normalizeBakeOptions } from '../scripts/lib/svg-bake.mjs';
import {
  PRESET_FIELD_IDS,
  PRESET_FIELDS,
  PRESET_FORMAT,
  PRESET_GROUPS,
  PRESET_VERSION,
  applyValues,
  buildPreset,
  collectValues,
  factionRef,
  isFactionRef,
  parsePreset,
  presetFileName,
  sanitizeValues,
  styleSig,
  visiblePresets,
} from '../scripts/lib/preset-schema.mjs';
import {
  RECENT_LIMIT,
  entryKey,
  entryResult,
  isEntryActive,
  makeEntry,
  planApply,
  pushEntry,
  rememberIconStyle,
  sanitizeRecent,
  snapshotEntry,
} from '../scripts/lib/preset-recent.mjs';
import { entryTooltip, escapeHtml } from '../scripts/lib/preset-text.mjs';

// The windows extend Foundry's ApplicationV2 at import time.
class ApplicationV2 {
  static DEFAULT_OPTIONS = {};
}
globalThis.foundry = { applications: { api: { ApplicationV2 } } };
const { PresetStore } = await import('../scripts/presets/preset-store.mjs');
const { PresetController } = await import('../scripts/presets/preset-controller.mjs');

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

const STYLE = normalizeBakeOptions({
  icon: {
    color: '#112233', opacity: 0.5, scalePct: 80, rotationDeg: 45, offsetXPct: 3, offsetYPct: -4, flipH: true,
    stroke: { enabled: true, color: '#445566', widthPct: 7, opacity: 0.25 },
  },
  background: {
    enabled: true, shape: 'circle', color: '#778899', opacity: 0.75, insetPct: 5, radiusPct: 9, fitIcon: true,
    division: { type: 'pale', color: '#aabbcc' },
    contour2: { enabled: true, color: '#ddeeff', widthPct: 3, gapPct: 4 },
    stroke: { enabled: true, color: '#010203', widthPct: 6, opacity: 0.5 },
  },
});
const OTHER = normalizeBakeOptions({
  icon: { color: '#ffffff' },
  background: { enabled: false, shape: 'square', color: '#000000', fitIcon: false },
});

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---- fields ----

await test('schema: every value of a style is a field of exactly one block', () => {
  const leaves = (node, path = []) => Object.entries(node).flatMap(([key, value]) => (
    value && typeof value === 'object' ? leaves(value, [...path, key]) : [[...path, key].join('.')]
  ));
  assert.deepEqual([...PRESET_FIELD_IDS].sort(), leaves(STYLE).sort());
  assert.equal(new Set(PRESET_FIELD_IDS).size, PRESET_FIELD_IDS.length);
});

await test('schema: every block and field has its text in both languages', () => {
  for (const lang of ['en', 'ru']) {
    const { Groups, Fields } = JSON.parse(fs.readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), 'utf8')).ICONIC.Presets;
    for (const group of PRESET_GROUPS) assert.ok(Groups[group.label], `${lang} group ${group.label}`);
    for (const field of PRESET_FIELDS) assert.ok(Fields[field.label], `${lang} field ${field.label}`);
  }
});

await test('lang: both languages have the same preset keys', () => {
  const keys = (node, path = '') => Object.entries(node).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${path}${k}.`) : [`${path}${k}`]));
  const read = (lang) => keys(JSON.parse(fs.readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), 'utf8')).ICONIC.Presets);
  assert.deepEqual(read('en'), read('ru'));
});

await test('lang: every text the code names exists, and none is left over', () => {
  const dir = new URL('../scripts/presets/', import.meta.url);
  const sources = [
    ...fs.readdirSync(dir).map((f) => new URL(f, dir)),
    new URL('../scripts/lib/preset-text.mjs', import.meta.url),
  ].map((f) => fs.readFileSync(f, 'utf8')).join('\n');

  const { ICONIC } = JSON.parse(fs.readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
  const has = (key) => key.split('.').slice(1).reduce((node, part) => node?.[part], ICONIC) !== undefined;
  for (const [key] of sources.matchAll(/ICONIC\.Presets\.[A-Za-z0-9.]+(?<!\.)(?![.$\w])/g)) assert.ok(has(key), `missing ${key}`);

  // Named in pieces: the blocks and fields come from the schema, these from a few lines of code.
  const pieced = ['Strip.SaveHint', 'Strip.LibraryHint', 'Strip.Save', 'Strip.Library', 'Library.Loading', 'Library.Unavailable', 'Library.Empty', 'Library.NoResults'];
  const used = (path) => pieced.includes(path) || path.startsWith('Groups.') || path.startsWith('Fields.') || sources.includes(`ICONIC.Presets.${path}`);
  const leaves = (node, path = '') => Object.entries(node).flatMap(([k, v]) => (typeof v === 'object' ? leaves(v, `${path}${k}.`) : [`${path}${k}`]));
  for (const path of leaves(ICONIC.Presets)) assert.ok(used(path), `unused ${path}`);
  for (const path of pieced) assert.ok(has(`ICONIC.Presets.${path}`), `missing ${path}`);
});

await test('values: only the chosen fields are collected', () => {
  const values = collectValues(STYLE, ['background.shape', 'icon.stroke.widthPct']);
  assert.deepEqual(values, { 'icon.stroke.widthPct': 7, 'background.shape': 'circle' });
});

await test('values: everything comes back as it was', () => {
  const values = collectValues(STYLE, PRESET_FIELD_IDS);
  assert.equal(Object.keys(values).length, PRESET_FIELD_IDS.length);
  assert.equal(styleSig(applyValues(OTHER, values)), styleSig(STYLE));
});

await test('values: "only the shape of the background" changes the shape and nothing else', () => {
  const values = collectValues(STYLE, ['background.shape']);
  const expected = clone(OTHER);
  expected.background.shape = 'circle';
  assert.deepEqual(applyValues(OTHER, values), expected);
});

await test('values: what is skipped stays as it is', () => {
  const values = collectValues(STYLE, ['background.shape', 'background.color', 'icon.color']);
  const result = applyValues(OTHER, values, { skip: ['background.color'] });
  assert.equal(result.background.shape, 'circle');
  assert.equal(result.icon.color, '#112233');
  assert.equal(result.background.color, OTHER.background.color);
});

await test('values: a disabled background keeps the parts switched on under it', () => {
  const style = clone(STYLE);
  style.background.enabled = false;
  const result = applyValues(OTHER, collectValues(style, PRESET_FIELD_IDS));
  assert.equal(result.background.enabled, false);
  assert.equal(result.background.stroke.enabled, true);
  assert.equal(result.background.contour2.enabled, true);
});

await test('values: the corner radius survives the bake options', () => {
  assert.equal(sanitizeValues({ 'background.radiusPct': 33 })['background.radiusPct'], 33);
  assert.equal(applyValues(OTHER, { 'background.radiusPct': 33 }).background.radiusPct, 33);
});

// ---- faction ----

await test('faction: a color can be stored as a link', () => {
  const values = collectValues(STYLE, ['background.color', 'icon.color'], ['background.color']);
  assert.deepEqual(values['background.color'], { $faction: true, fallback: '#778899' });
  assert.equal(values['icon.color'], '#112233');
});

await test('faction: only colors can be links', () => {
  const values = collectValues(STYLE, ['background.shape'], ['background.shape']);
  assert.equal(values['background.shape'], 'circle');
});

await test('faction: a link takes the faction color here, and the saved color where there is none', () => {
  const values = { 'background.color': factionRef('#778899') };
  assert.equal(applyValues(OTHER, values, { factionColor: '#c1121f' }).background.color, '#c1121f');
  assert.equal(applyValues(OTHER, values, { factionColor: null }).background.color, '#778899');
  assert.equal(applyValues(OTHER, values, { factionColor: 'nonsense' }).background.color, '#778899');
});

// ---- what comes from a file ----

await test('sanitize: unknown keys and wrong types are dropped, ranges are enforced', () => {
  const values = sanitizeValues({
    'icon.color': '#ABC',
    'icon.opacity': 7,
    'icon.scalePct': 9000,
    'icon.rotationDeg': -9000,
    'icon.flipH': 'yes',
    'icon.stroke.widthPct': '12',
    'icon.stroke.opacity': Number.NaN,
    'background.color': 'red',
    'background.shape': 'pentagram',
    'background.division.type': 'bogus',
    'background.stroke.color': '<script>',
    'background.contour2.gapPct': 999,
    'evil.key': 1,
    __proto__: { polluted: true },
  });
  assert.deepEqual(values, {
    'icon.color': '#aabbcc',
    'icon.opacity': 1,
    'icon.scalePct': 200,
    'icon.rotationDeg': -180,
    'background.contour2.gapPct': 25,
  });
  assert.equal({}.polluted, undefined);
});

await test('sanitize: nothing that is not a map of values gets through', () => {
  for (const raw of [null, undefined, 1, 'x', [], [1]]) assert.deepEqual(sanitizeValues(raw), {});
});

await test('sanitize: a link is rebuilt, with a safe fallback', () => {
  assert.deepEqual(sanitizeValues({ 'icon.color': { $faction: true, fallback: 'x', extra: 1 } }), { 'icon.color': { $faction: true, fallback: '#ffffff' } });
  assert.deepEqual(sanitizeValues({ 'icon.color': { $faction: 'yes' } }), {});
  assert.deepEqual(sanitizeValues({ 'icon.opacity': { $faction: true } }), {});
  assert.ok(isFactionRef(sanitizeValues({ 'icon.color': factionRef('#123456') })['icon.color']));
});

await test('sanitize: known shapes and divisions pass', () => {
  assert.deepEqual(sanitizeValues({ 'background.shape': 'shield-heater', 'background.division.type': 'none' }), {
    'background.shape': 'shield-heater',
    'background.division.type': 'none',
  });
});

await test('file: a preset survives being written and read', () => {
  const values = collectValues(STYLE, ['background.shape', 'icon.color'], ['icon.color']);
  const content = buildPreset({ id: 'abc123', name: '  Red   shield ', created: 5, values });
  assert.equal(content.format, PRESET_FORMAT);
  assert.equal(content.version, PRESET_VERSION);
  assert.deepEqual(parsePreset(clone(content)), { id: 'abc123', name: 'Red shield', created: 5, values });
});

await test('file: anything else is no preset', () => {
  const good = { format: PRESET_FORMAT, version: 1, id: 'a1', name: 'x', created: 1, values: { 'icon.color': '#000000' } };
  assert.ok(parsePreset(good));
  assert.equal(parsePreset(null), null);
  assert.equal(parsePreset('text'), null);
  assert.equal(parsePreset({ ...good, format: 'other' }), null);
  assert.equal(parsePreset({ ...good, version: PRESET_VERSION + 1 }), null);
  assert.equal(parsePreset({ ...good, version: '1' }), null);
  assert.equal(parsePreset({ ...good, id: '../../evil' }), null);
  assert.equal(parsePreset({ ...good, id: 5 }), null);
  assert.equal(parsePreset({ ...good, values: { nope: 1 } }), null);
  assert.equal(parsePreset({ ...good, values: null }), null);
});

await test('file: a missing name or date does not lose the preset', () => {
  const preset = parsePreset({ format: PRESET_FORMAT, version: 1, id: 'a1', values: { 'icon.color': '#000000' } });
  assert.equal(preset.name, 'a1');
  assert.equal(preset.created, 0);
});

await test('file: names give safe, unique file names', () => {
  assert.equal(presetFileName('Red Shield!', 'id1'), 'red-shield-id1.json');
  assert.equal(presetFileName('Красный щит', 'id2'), 'preset-id2.json');
  assert.equal(presetFileName('../../etc/passwd', 'id3'), 'etc-passwd-id3.json');
  assert.equal(presetFileName('', 'id4'), 'preset-id4.json');
  assert.match(presetFileName('x'.repeat(200), 'id5'), /^x{40}-id5\.json$/);
});

await test('library: removed presets are hidden, each id shows once, newest first', () => {
  const p = (id, created, name = id) => ({ id, created, name, values: {} });
  const shown = visiblePresets([p('a', 1), p('b', 3), p('c', 2), p('b', 9), p('d', 2, 'A')], ['c']);
  assert.deepEqual(shown.map((x) => x.id), ['b', 'd', 'a']);
});

// ---- the strip ----

const preset = (fields, extra = {}) => makeEntry({ presetId: 'p1', name: 'Preset', values: collectValues(STYLE, fields), ...extra });

await test('strip: the key depends on the content, not on the name or the time', () => {
  const a = preset(['icon.color'], { name: 'One', at: 1 });
  const b = preset(['icon.color'], { name: 'Two', at: 2 });
  const c = preset(['icon.color', 'icon.opacity']);
  const d = preset(['icon.color', 'icon.opacity'], { skip: ['icon.opacity'] });
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, c.key);
  assert.notEqual(c.key, d.key);
  assert.equal(a.key, entryKey(a.values, a.skip));
});

await test('strip: an entry that would apply nothing is no entry', () => {
  assert.equal(preset(['icon.color'], { skip: ['icon.color'] }), null);
  assert.equal(makeEntry({ values: { nope: 1 } }), null);
});

await test('strip: skip only names fields the style has', () => {
  assert.deepEqual(preset(['icon.color', 'icon.opacity'], { skip: ['icon.opacity', 'background.color', 'bogus'] }).skip, ['icon.opacity']);
});

await test('strip: newest first, no duplicates, capped', () => {
  let list = [];
  const fields = PRESET_FIELD_IDS.slice(0, RECENT_LIMIT + 2);
  for (const id of fields) list = pushEntry(list, preset([id]));
  assert.equal(list.length, RECENT_LIMIT);
  assert.deepEqual(Object.keys(list[0].values), [fields.at(-1)]);

  const again = preset([fields.at(-3)]);
  list = pushEntry(list, again);
  assert.equal(list.length, RECENT_LIMIT);
  assert.equal(list[0].key, again.key);
  assert.equal(new Set(list.map((e) => e.key)).size, RECENT_LIMIT);
});

await test('strip: a snapshot does not push out the named preset with the same content', () => {
  const named = preset(PRESET_FIELD_IDS, { at: 1 });
  const list = pushEntry([named], snapshotEntry(STYLE, 2));
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, 'preset');
  assert.equal(list[0].name, 'Preset');
  assert.equal(list[0].at, 2);
});

await test('strip: what is stored is not trusted', () => {
  const good = preset(['icon.color']);
  const list = sanitizeRecent([
    good,
    good,
    null,
    'x',
    { values: { nope: 1 } },
    { kind: 'snapshot', name: 'ignored', values: { 'icon.color': '#123456' }, skip: 5, at: 'y' },
  ].concat(Array.from({ length: 10 }, (_, i) => ({ values: { 'icon.scalePct': 30 + i } }))));
  assert.equal(list.length, RECENT_LIMIT);
  assert.equal(list[0].key, good.key);
  assert.equal(list[1].kind, 'snapshot');
  assert.equal(list[1].name, '');
  assert.equal(list[1].at, 0);
  assert.deepEqual(sanitizeRecent('nonsense'), []);
});

// ---- saving an icon ----

const remember = (list, style = STYLE, extra = {}) => rememberIconStyle({ recent: list, style, name: 'bell-shield', at: 7, ...extra });
const PLACEMENT_IDS = PRESET_GROUPS.find((g) => g.id === 'placement').fields.map((f) => f.id);

await test('saved icon: its style goes to the strip under the name of the icon', () => {
  const list = remember([]);
  assert.equal(list.length, 1);
  const [entry] = list;
  assert.equal(entry.kind, 'icon');
  assert.equal(entry.name, 'bell-shield');
  assert.equal(entry.at, 7);
  assert.equal(entry.presetId, null);
  assert.deepEqual(entry.skip, []);
});

await test('saved icon: where it sat does not follow to the next icon', () => {
  const [entry] = remember([]);
  for (const id of PLACEMENT_IDS) assert.ok(!Object.hasOwn(entry.values, id), id);

  const next = clone(OTHER);
  next.icon.rotationDeg = -30;
  const result = entryResult(entry, next);
  assert.equal(result.icon.rotationDeg, -30);
  assert.equal(result.icon.color, '#112233');
  assert.equal(result.background.shape, 'circle');
});

await test('saved icon: the same style again is the same tile, moved up, wherever the icon sat', () => {
  const turned = clone(STYLE);
  turned.icon.rotationDeg = -90;
  const list = remember([preset(['icon.color']), ...remember([])], turned, { name: 'another', at: 9 });
  assert.equal(list.length, 2);
  assert.equal(list[0].kind, 'icon');
  assert.equal(list[0].name, 'bell-shield');
  assert.equal(list[0].at, 9);
});

await test('saved icon: a different style is a tile of its own', () => {
  const changed = clone(STYLE);
  changed.background.color = '#123456';
  const list = remember(remember([]), changed);
  assert.equal(list.length, 2);
  assert.equal(list[0].values['background.color'], '#123456');
});

await test('saved icon: a preset that gives this style moves up and keeps its name', () => {
  const named = preset(PRESET_FIELD_IDS, { at: 1 });
  const list = remember([preset(['icon.color']), named]);
  assert.equal(list.length, 2);
  assert.equal(list[0].key, named.key);
  assert.equal(list[0].kind, 'preset');
  assert.equal(list[0].at, 7);
});

await test('saved icon: a faction link counts as the color it gives here', () => {
  const linked = makeEntry({ name: 'Linked', values: collectValues(STYLE, PRESET_FIELD_IDS, ['background.color']) });
  const red = clone(STYLE);
  red.background.color = '#c1121f';
  assert.equal(remember([linked], red, { factionColor: '#c1121f' })[0].name, 'Linked');
  assert.equal(remember([linked], red)[0].kind, 'icon', 'without a faction the link gives another color');
});

await test('saved icon: an entry that holds only part of the style does not stand in for it', () => {
  const list = remember([preset(PRESET_FIELD_IDS, { skip: ['background.color'] }), preset(['background.shape'])]);
  assert.equal(list.length, 3);
  assert.equal(list[0].kind, 'icon');
});

await test('saved icon: the entry survives being stored', () => {
  const [entry] = remember([]);
  assert.deepEqual(sanitizeRecent(clone([entry])), [entry]);
});

// ---- applying ----

const plan = (over = {}) => planApply({
  style: OTHER,
  entry: preset(['background.shape']),
  recent: [],
  lastSig: null,
  at: 100,
  ...over,
});

await test('apply: the replaced settings go to the strip after the style itself', () => {
  const { merged, changed, recent } = plan();
  assert.ok(changed);
  assert.equal(merged.background.shape, 'circle');
  assert.deepEqual(recent.map((e) => e.kind), ['preset', 'snapshot']);
  assert.equal(recent[1].skip.length, 0);
  assert.equal(styleSig(applyValues(STYLE, recent[1].values)), styleSig(OTHER));
  assert.equal(recent[0].at, 100);
});

await test('apply: settings the last style left untouched make no snapshot', () => {
  const { recent } = plan({ lastSig: styleSig(OTHER) });
  assert.deepEqual(recent.map((e) => e.kind), ['preset']);
});

await test('apply: settings changed by hand after the last style make a snapshot', () => {
  const { recent } = plan({ lastSig: styleSig(STYLE) });
  assert.deepEqual(recent.map((e) => e.kind), ['preset', 'snapshot']);
});

await test('apply: a style that changes nothing makes no snapshot', () => {
  const entry = makeEntry({ name: 'Same', values: collectValues(OTHER, ['background.shape']) });
  const { changed, recent } = plan({ entry });
  assert.equal(changed, false);
  assert.deepEqual(recent.map((e) => e.kind), ['preset']);
});

await test('apply: the same snapshot is not kept twice', () => {
  const first = plan();
  const second = plan({ entry: preset(['background.color']), recent: first.recent });
  assert.deepEqual(second.recent.map((e) => e.kind), ['preset', 'snapshot', 'preset']);
});

await test('apply: going back and forth does not fill the strip', () => {
  const first = plan();
  let style = first.merged;
  let recent = first.recent;
  let lastSig = styleSig(style);
  for (let i = 0; i < 4; i++) {
    const entry = recent[1];
    const step = planApply({ style, entry, recent, lastSig, at: 200 + i });
    style = step.merged;
    recent = step.recent;
    lastSig = styleSig(style);
  }
  assert.equal(recent.length, 2);
});

await test('apply: a partly loaded style leaves out what it skips, also from the strip', () => {
  const entry = preset(['background.shape', 'background.color'], { skip: ['background.color'] });
  const { merged, recent } = plan({ entry });
  assert.equal(merged.background.shape, 'circle');
  assert.equal(merged.background.color, OTHER.background.color);
  assert.deepEqual(recent[0].skip, ['background.color']);

  const again = planApply({ style: OTHER, entry: recent[0], recent, lastSig: null, at: 1 });
  assert.equal(again.merged.background.color, OTHER.background.color);
});

await test('apply: an entry is active when the style already shows all it applies', () => {
  const entry = preset(['background.shape', 'background.color'], { skip: ['background.color'] });
  assert.equal(isEntryActive(entry, OTHER), false);
  assert.equal(isEntryActive(entry, applyValues(OTHER, entry.values, { skip: entry.skip })), true);

  const linked = makeEntry({ values: { 'icon.color': factionRef('#000000') } });
  const red = applyValues(OTHER, { 'icon.color': '#c1121f' });
  assert.equal(isEntryActive(linked, red, '#c1121f'), true);
  assert.equal(isEntryActive(linked, red, null), false);
});

// ---- hover ----

const t = (key, data) => (data ? `${key}:${JSON.stringify(data)}` : key);

await test('tooltip: tells what the style holds, by block', () => {
  const html = entryTooltip(preset(['background.shape', 'icon.stroke.enabled', 'icon.stroke.color', 'icon.stroke.widthPct', 'icon.stroke.opacity']), { t });
  assert.match(html, /<li>ICONIC\.Presets\.Groups\.IconStroke<\/li>/);
  assert.match(html, /<li>ICONIC\.Presets\.Groups\.Background: ICONIC\.Presets\.Fields\.Shape<\/li>/);
  assert.doesNotMatch(html, /NotApplied/);
  assert.doesNotMatch(html, /Tooltip\.Partial/);
});

await test('tooltip: a complete style is not listed block by block', () => {
  const html = entryTooltip(snapshotEntry(STYLE, 5), { t, formatTime: () => '12:30' });
  assert.match(html, /Tooltip\.Everything/);
  assert.match(html, /12:30/);
  assert.doesNotMatch(html, /Groups\./);
});

await test('tooltip: the style of a saved icon names the icon and holds no placement', () => {
  const [entry] = remember([], STYLE, { name: '<b>bell</b>' });
  const html = entryTooltip(entry, { t, formatTime: () => '12:30' });
  assert.match(html, /Tooltip\.Icon/);
  assert.match(html, /Groups\.Background/);
  assert.doesNotMatch(html, /Groups\.Placement/);
  assert.doesNotMatch(html, /<b>/);
});

await test('tooltip: a partly loaded style says what will not be applied', () => {
  const html = entryTooltip(preset(['background.shape', 'background.color'], { skip: ['background.color'] }), { t });
  assert.match(html, /Tooltip\.Partial/);
  assert.match(html, /Tooltip\.NotApplied/);
  const [, notApplied] = html.split('Tooltip.NotApplied');
  assert.match(notApplied, /Fields\.Color/);
  assert.doesNotMatch(notApplied, /Fields\.Shape/);
});

await test('tooltip: warns about a faction color only where there is none and it is used', () => {
  const linked = { 'icon.color': factionRef('#123456'), 'icon.opacity': 1 };
  const entry = makeEntry({ name: 'x', values: linked });
  assert.match(entryTooltip(entry, { t }), /Tooltip\.NoFaction/);
  assert.doesNotMatch(entryTooltip(entry, { t, factionColor: '#c1121f' }), /Tooltip\.NoFaction/);
  assert.match(entryTooltip(entry, { t, factionColor: '#c1121f' }), /Tooltip\.Faction/);
  const skipped = makeEntry({ name: 'x', values: linked, skip: ['icon.color'] });
  assert.doesNotMatch(entryTooltip(skipped, { t }), /Tooltip\.NoFaction/);
});

await test('tooltip: a name from a file cannot put HTML into the page', () => {
  const entry = makeEntry({ name: '<img src=x onerror=alert(1)>"\'&', values: { 'icon.color': '#000000' } });
  const html = entryTooltip(entry, { t });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#x27;&amp;/);
  assert.equal(escapeHtml('<a>'), '&lt;a&gt;');
});

// ---- files that can only be added to ----

/** Behaves like Foundry's server: no overwriting, no missing folders, nothing is ever deleted. */
function memoryFiles({ canCreateDirs = true, canBrowse = true } = {}) {
  const dirs = new Set();
  const files = new Map();
  let next = 0;
  return {
    dirs,
    files,
    newId: () => `id${++next}`,
    async browse(dir) {
      if (!canBrowse) throw new Error('no permission');
      if (!dirs.has(dir)) throw new Error('missing folder');
      return { files: [...files.keys()].filter((p) => p.slice(0, p.lastIndexOf('/')) === dir), dirs: [] };
    },
    async ensureDir(dir) {
      if (!canCreateDirs) return;
      const parts = dir.split('/');
      parts.forEach((_, i) => dirs.add(parts.slice(0, i + 1).join('/')));
    },
    async upload(dir, name, text) {
      if (!dirs.has(dir)) return false;
      const path = `${dir}/${name}`;
      if (files.has(path)) return false;
      files.set(path, text);
      return true;
    },
    async read(path) {
      return JSON.parse(files.get(path));
    },
  };
}

const values = collectValues(STYLE, ['background.shape']);

await test('store: an empty library is created on first look', async () => {
  const files = memoryFiles();
  assert.deepEqual(await new PresetStore(files).list(), { presets: [], failed: false });
  assert.ok(files.dirs.has('modules/iconic/storage/presets'));
});

await test('store: what is saved is listed, newest first', async () => {
  const store = new PresetStore(memoryFiles());
  await store.save({ name: 'Old', values, created: 1 });
  const saved = await store.save({ name: 'New', values, created: 2 });
  assert.equal(saved.name, 'New');
  const { presets } = await store.list();
  assert.deepEqual(presets.map((p) => p.name), ['New', 'Old']);
  assert.deepEqual(presets[0].values, values);
});

await test('store: nothing is overwritten: saving under the same name makes a second file', async () => {
  const files = memoryFiles();
  const store = new PresetStore(files);
  await store.save({ name: 'Same', values });
  await store.save({ name: 'Same', values });
  assert.equal((await store.list()).presets.length, 2);
  assert.equal(files.files.size, 2);
});

await test('store: a removed preset is hidden, its file stays', async () => {
  const files = memoryFiles();
  const store = new PresetStore(files);
  const a = await store.save({ name: 'A', values, created: 1 });
  await store.save({ name: 'B', values, created: 2 });
  await store.remove(a.id);
  assert.deepEqual((await store.list()).presets.map((p) => p.name), ['B']);
  assert.ok([...files.files.keys()].some((p) => p.endsWith(`-${a.id}.json`)));
  assert.ok(files.files.has(`modules/iconic/storage/presets/removed/${a.id}.json`));
});

await test('store: a removal that could not be written is an error, and a rename then keeps both', async () => {
  const files = memoryFiles();
  const store = new PresetStore(files);
  const a = await store.save({ name: 'A', values });

  const upload = files.upload;
  files.upload = async (dir, name, text) => (dir.endsWith('/removed') ? false : upload(dir, name, text));
  await assert.rejects(store.remove(a.id));
  assert.deepEqual((await store.list()).presets.map((p) => p.name), ['A']);

  await assert.rejects(store.rename(a, 'B'));
  assert.deepEqual((await store.list()).presets.map((p) => p.name).sort(), ['A', 'B']);
});

await test('store: an id that is not safe never becomes a path', async () => {
  await assert.rejects(new PresetStore(memoryFiles()).remove('../../evil'));
});

await test('store: a rename is a new file and the old one removed', async () => {
  const files = memoryFiles();
  const store = new PresetStore(files);
  const a = await store.save({ name: 'Old name', values, created: 7 });
  const renamed = await store.rename(a, 'New name');
  assert.notEqual(renamed.id, a.id);
  const { presets } = await store.list();
  assert.deepEqual(presets.map((p) => [p.name, p.created]), [['New name', 7]]);
});

await test('store: a broken file is skipped, the rest is listed', async () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    const files = memoryFiles();
    const store = new PresetStore(files);
    await store.save({ name: 'Good', values });
    files.files.set('modules/iconic/storage/presets/broken.json', '{ not json');
    files.files.set('modules/iconic/storage/presets/other.json', '{"format":"something-else"}');
    files.files.set('modules/iconic/storage/presets/future.json', `{"format":"${PRESET_FORMAT}","version":99,"id":"f","values":{"icon.color":"#000000"}}`);
    files.files.set('modules/iconic/storage/presets/notes.txt', 'not json at all');
    assert.deepEqual((await store.list()).presets.map((p) => p.name), ['Good']);
    assert.equal(warnings.length, 3);
  } finally {
    console.warn = warn;
  }
});

await test('store: a folder that cannot be read leaves the library empty, not broken', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await new PresetStore(memoryFiles({ canBrowse: false })).list(), { presets: [], failed: true });
  } finally {
    console.warn = warn;
  }
});

await test('store: a player who cannot create the folder gets an error, not a lost preset', async () => {
  await assert.rejects(new PresetStore(memoryFiles({ canCreateDirs: false })).save({ name: 'x', values }));
});

await test('controller: importing it touches neither game nor the editor', () => {
  assert.equal(typeof PresetController, 'function');
  const source = fs.readFileSync(new URL('../scripts/presets/preset-controller.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from '[^']*editor-app/);
});

console.log(`presets ok: ${passed} passed`);
