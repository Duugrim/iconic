// node tests/browser.test.mjs
import assert from 'node:assert/strict';
import { cssColorToHex } from '../scripts/browser/browser-view.mjs';
import { orderCreated, pushRecent } from '../scripts/browser/files.mjs';
import { Library, loadLibrary } from '../scripts/browser/library.mjs';
import { creditLine } from '../scripts/lib/credit.mjs';
import { parseLibraryIconPath } from '../scripts/lib/library-source.mjs';
import { routeUrl, toFetchUrl } from '../scripts/lib/storage.mjs';

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

const INDEX = {
  format: 1,
  source: 'https://game-icons.net',
  thumbs: { cell: 64, cols: 2, rows: 2, sheets: 2 },
  authors: [['lorc', 'Lorc', 'http://lorc.example', 'CC BY 3.0', 4], ['viscious-speed', 'Viscious Speed', '', 'CC0 1.0', 1]],
  tags: [['weapon', 'Weapon'], ['axe', 'Axe'], ['blade', 'Blade, Sword & Knife'], ['fire', 'Fire'], ['empty', 'Empty']],
  groups: [['weapon', 'Weapon', [0, 1, 2]], ['fire', 'Fire', [3]], ['empty', 'Empty', [4]]],
  icons: [
    ['war-axe', 'War axe', 0, [0, 1]],
    ['broad-sword', 'Broad sword', 0, [0, 2]],
    ['fire-sword', 'Fire sword', 0, [2, 3]],
    ['flame', 'Flame', 1, [3]],
    ['campfire', 'Campfire', 0, [3]],
  ],
};
const lib = () => new Library(INDEX, '/modules/iconic/library', 'modules/iconic/library');
const titles = (l, ids) => ids.map((i) => l.icons[i].title);

await test('library: unfiltered search keeps library order', () => {
  const l = lib();
  assert.deepEqual(l.search({}), [0, 1, 2, 3, 4]);
});

await test('library: group and tag filters; titles alphabetical; empty groups dropped', () => {
  const l = lib();
  assert.deepEqual(l.groups.map((g) => g.slug), ['weapon', 'fire']);
  assert.deepEqual(titles(l, l.search({ group: 'weapon' })), ['Broad sword', 'Fire sword', 'War axe']);
  assert.deepEqual(titles(l, l.search({ group: 'weapon', tag: 2 })), ['Broad sword', 'Fire sword']);
  assert.deepEqual(titles(l, l.search({ tag: 3 })), ['Campfire', 'Fire sword', 'Flame']);
  assert.equal(l.groups.find((g) => g.slug === 'weapon').count, 3);
});

await test('library: text search needs every word, ranks title-word hits first', () => {
  const l = lib();
  assert.deepEqual(titles(l, l.search({ text: 'sword' })), ['Broad sword', 'Fire sword']);
  assert.deepEqual(titles(l, l.search({ text: 'fire sword' })), ['Fire sword']);
  assert.deepEqual(titles(l, l.search({ text: 'fire' })), ['Fire sword', 'Campfire', 'Flame']); // word hit, then "camp-fire" / tag
  assert.deepEqual(l.search({ text: 'zzz' }), []);
  assert.deepEqual(titles(l, l.search({ text: 'viscious' })), ['Flame']); // author
  assert.deepEqual(titles(l, l.search({ text: 'sword', group: 'fire' })), ['Fire sword']);
});

await test('library: tag aliases make translated names searchable and can be replaced', () => {
  const l = lib();
  l.setTagAliases((slug) => (slug === 'weapon' ? 'Оружие' : ''));
  assert.equal(l.search({ text: 'оружие' }).length, 2); // war axe, broad sword carry the weapon tag
  l.setTagAliases(() => '');
  assert.equal(l.search({ text: 'оружие' }).length, 0);
});

await test('library: sub-tags with counts, sheet cells, urls and paths', () => {
  const l = lib();
  assert.deepEqual(l.subTags('weapon').map((t) => [t.slug, t.count]), [['weapon', 2], ['axe', 1], ['blade', 2]]);
  assert.deepEqual(l.cellOf(0), { sheet: 0, col: 0, row: 0 });
  assert.deepEqual(l.cellOf(3), { sheet: 0, col: 1, row: 1 });
  assert.deepEqual(l.cellOf(4), { sheet: 1, col: 0, row: 0 });
  assert.equal(l.sheetUrl(1), '/modules/iconic/library/thumbs/sheet-01.png');
  const icon = l.icons[0];
  assert.equal(l.svgUrl(icon), '/modules/iconic/library/icons/lorc/war-axe.svg');
  assert.equal(l.svgPath(icon), 'modules/iconic/library/icons/lorc/war-axe.svg');
  assert.equal(l.pageUrl(icon), 'https://game-icons.net/1x1/lorc/war-axe.html');
  assert.equal(l.byFolderAndName('viscious-speed', 'flame'), l.icons[3]);
  assert.equal(l.byFolderAndName('lorc', 'flame'), undefined);
});

await test('loadLibrary reads index.json from the base url', async () => {
  const seen = [];
  const l = await loadLibrary('/lib', {
    dataPath: 'modules/x/lib',
    fetchImpl: async (url) => {
      seen.push(url);
      return { ok: true, json: async () => INDEX };
    },
  });
  assert.deepEqual(seen, ['/lib/index.json']);
  assert.equal(l.svgPath(l.icons[0]), 'modules/x/lib/icons/lorc/war-axe.svg');
  await assert.rejects(loadLibrary('/lib', { fetchImpl: async () => ({ ok: false, status: 404 }) }), /404/);
});

await test('created icons: remembered ones first (newest first), the rest by name', () => {
  const f = (name) => ({ path: `w/${name}.svg`, name, folder: '' });
  const files = [f('c'), f('a'), f('b'), f('d')];
  assert.deepEqual(orderCreated(files, ['w/d.svg', 'w/b.svg', 'w/gone.svg']).map((x) => x.name), ['d', 'b', 'a', 'c']);
  assert.deepEqual(orderCreated(files, []).map((x) => x.name), ['a', 'b', 'c', 'd']);
});

await test('recent list: moves to the front, no duplicates, capped', () => {
  assert.deepEqual(pushRecent(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  assert.deepEqual(pushRecent([], 'a'), ['a']);
  const long = Array.from({ length: 400 }, (_, i) => `p${i}`);
  const out = pushRecent(long, 'new');
  assert.equal(out.length, 300);
  assert.equal(out[0], 'new');
});

await test('credit: line names title, author, license and page; library paths are recognised', () => {
  const line = creditLine({ title: 'War axe', author: 'Lorc', license: 'CC BY 3.0', url: 'https://game-icons.net/1x1/lorc/war-axe.html' });
  assert.match(line, /War axe/);
  assert.match(line, /Lorc \(CC BY 3\.0\)/);
  assert.match(line, /game-icons\.net\/1x1\/lorc\/war-axe\.html/);
  assert.deepEqual(parseLibraryIconPath('modules/iconic/library/icons/lorc/war-axe.svg'), { folder: 'lorc', name: 'war-axe' });
  assert.deepEqual(parseLibraryIconPath('/modules/iconic/library/icons/delapouite/a%20b.svg'), { folder: 'delapouite', name: 'a b' });
  assert.equal(parseLibraryIconPath('worlds/w/iconic/generated/x.svg'), null);
  assert.equal(parseLibraryIconPath('modules/iconic/storage/custom/x.svg'), null);
});

await test('urls: plain without a route prefix, prefixed with one; absolute urls untouched', () => {
  const had = globalThis.foundry;
  try {
    globalThis.foundry = undefined;
    assert.equal(routeUrl('modules/iconic/a.svg'), '/modules/iconic/a.svg');
    assert.equal(toFetchUrl('worlds/w/a.svg'), '/worlds/w/a.svg');
    globalThis.foundry = { utils: { getRoute: (p) => `/vtt/${p}` } };
    assert.equal(routeUrl('/modules/iconic/a.svg'), '/vtt/modules/iconic/a.svg');
    assert.equal(toFetchUrl('worlds/w/a.svg'), '/vtt/worlds/w/a.svg');
    assert.equal(toFetchUrl('https://example.com/a.svg'), 'https://example.com/a.svg');
    assert.equal(toFetchUrl('/already/rooted.svg'), '/already/rooted.svg');
    assert.equal(toFetchUrl(''), '');
  } finally {
    globalThis.foundry = had;
  }
});

await test('css color to hex', () => {
  assert.equal(cssColorToHex('rgb(12, 34, 56)'), '#0c2238');
  assert.equal(cssColorToHex('rgba(255, 255, 255, 0.5)'), '#ffffff');
  assert.equal(cssColorToHex('nonsense'), '#ffffff');
});

console.log(`${passed} browser tests passed`);
