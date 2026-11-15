// node tests/library.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSheetSvg, cellOf, iconParts } from '../tools/lib/atlas.mjs';
import { encodeMaskPng } from '../tools/lib/png-mask.mjs';
import {
  buildIndex, creditsMarkdown, humanizeName, parseAuthors, parseTagIndex, parseTagPage,
} from '../tools/lib/library-data.mjs';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}\n`, e);
    process.exitCode = 1;
  }
};

const TAGS_HTML = '<ul class="tags cover">'
  + '<li class="parent"><a href="/tags/weapon.html"><img src="x" alt="a" class="icon"/>Weapon — 3</a>'
  + '<a href="/tags/axe.html"><img src="x" alt="a" class="icon"/>Axe — 1</a>'
  + '<a href="/tags/star.html"><img src="x" alt="a" class="icon"/>Star &amp; Sun — 1<span title="2 new icon(s)">2</span></a></li>'
  + '<li class="icon"><a href="/tags/lock.html"><img src="x" alt="a" class="icon"/>Lock — 1</a></li>'
  + '</ul>';
const page = (items) => `<main><ul class="icons">${items.map(([a, n, t]) => `<li data-hint="${t}" class="hint--top"><a href="/1x1/${a}/${n}.html"><img/></a></li>`).join('')}</ul></main>`;

test('tag overview: groups, sub-tags, counts, entities', () => {
  const tree = parseTagIndex(TAGS_HTML);
  assert.equal(tree.length, 2);
  assert.deepEqual(tree[0], {
    slug: 'weapon', label: 'Weapon', count: 3,
    children: [{ slug: 'axe', label: 'Axe', count: 1 }, { slug: 'star', label: 'Star & Sun', count: 1 }],
  });
  assert.deepEqual(tree[1], { slug: 'lock', label: 'Lock', count: 1, children: [] });
});

test('tag page: author, name, decoded title', () => {
  const list = parseTagPage(page([['lorc', 'war-axe', 'War axe'], ['delapouite', 'a-b', 'A &amp; B&#x27;s']]));
  assert.deepEqual(list, [
    { author: 'lorc', name: 'war-axe', title: 'War axe' },
    { author: 'delapouite', name: 'a-b', title: "A & B's" },
  ]);
});

test('authors: names, links, CC0, folder aliases', () => {
  const m = parseAuthors('x\n- Lorc, http://lorc.example\n- Viscious Speed, http://v.example - CC0\n- PriorBlue\n- Lucas\n');
  assert.deepEqual(m.get('lorc'), { name: 'Lorc', url: 'http://lorc.example', license: 'CC BY 3.0' });
  assert.deepEqual(m.get('visciousspeed'), { name: 'Viscious Speed', url: 'http://v.example', license: 'CC0 1.0' });
  assert.equal(m.get('priorblue').url, '');
  assert.equal(m.get('lucas').name, 'Lucas');
});

test('humanizeName', () => assert.equal(humanizeName('acid-blob'), 'Acid blob'));

const ICONS = [
  { author: 'lorc', name: 'war-axe' },
  { author: 'lorc', name: 'big-star' },
  { author: 'lorc', name: 'padlock' },
  { author: 'lorc', name: 'tarot-01' },
  { author: 'lorc', name: 'tarot-02' },
  { author: 'lorc', name: 'tarot-03' },
  { author: 'lorc', name: 'tarot-11' },
  { author: 'viscious-speed', name: 'mystery' },
];

function sampleIndex() {
  const tagTree = parseTagIndex(TAGS_HTML);
  const tagPages = {
    weapon: parseTagPage(page([['lorc', 'war-axe', 'War axe'], ['lorc', 'tarot-01', 'T1'], ['lorc', 'tarot-02', 'T2'], ['lorc', 'tarot-03', 'T3']])),
    axe: parseTagPage(page([['lorc', 'war-axe', 'War axe']])),
    star: parseTagPage(page([['lorc', 'big-star', 'Big star'], ['lorc', 'not-shipped', 'Ghost']])),
    lock: parseTagPage(page([['lorc', 'padlock', 'Padlock']])),
  };
  return buildIndex({
    icons: ICONS,
    tagTree,
    tagPages,
    authorInfo: parseAuthors('- Lorc, http://l.example\n- Viscious Speed - CC0\n'),
    thumbs: { cell: 64, cols: 2, rows: 2 },
  });
}

test('index: sorted by the most specific group, then title; titles and tags kept', () => {
  const { index, report } = sampleIndex();
  const names = index.icons.map((r) => r[0]);
  // weapon group first (its sub-tags axe and star included), titles alphabetical inside it, then lock, then other
  assert.ok(names.indexOf('big-star') < names.indexOf('war-axe'));
  assert.ok(names.indexOf('padlock') > names.indexOf('war-axe'));
  assert.equal(names.at(-1), 'mystery');
  const row = index.icons.find((r) => r[0] === 'war-axe');
  assert.equal(row[1], 'War axe');
  assert.deepEqual(row[3].map((t) => index.tags[t][0]).sort(), ['axe', 'weapon']);
  assert.deepEqual(report.unknownInTags, ['lorc/not-shipped']);
});

test('index: untagged icon takes the tags of its same-word siblings; lone untagged goes to Other', () => {
  const { index, report } = sampleIndex();
  const tarot11 = index.icons.find((r) => r[0] === 'tarot-11');
  assert.deepEqual(tarot11[3].map((t) => index.tags[t][0]), ['weapon']);
  const mystery = index.icons.find((r) => r[0] === 'mystery');
  assert.deepEqual(mystery[3].map((t) => index.tags[t][0]), ['other']);
  assert.equal(report.untagged, 1);
  assert.equal(index.groups.at(-1)[0], 'other');
});

test('index: author table counts, licenses and sheet count', () => {
  const { index } = sampleIndex();
  const lorc = index.authors.find((a) => a[0] === 'lorc');
  assert.equal(lorc[4], 7);
  assert.equal(index.authors.find((a) => a[0] === 'viscious-speed')[3], 'CC0 1.0');
  assert.equal(index.thumbs.sheets, 2); // 8 icons, 4 per sheet
});

test('credits list every icon under its author', () => {
  const { index } = sampleIndex();
  const md = creditsMarkdown(index);
  assert.match(md, /Icons made by the authors below\. Available on https:\/\/game-icons\.net/);
  assert.match(md, /### Lorc \(7, CC BY 3\.0\)/);
  assert.match(md, /### Viscious Speed \(1, CC0 1\.0\)/);
  for (const row of index.icons) assert.ok(md.includes(row[1]), row[1]);
});

test('atlas: backdrop removed, cell placement', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/><path fill="#fff" d="M10 10h20v20z"/></svg>';
  const parts = iconParts(svg);
  assert.equal(parts.viewBox, '0 0 512 512');
  assert.ok(!parts.inner.includes('M0 0h512'));
  assert.ok(parts.inner.includes('M10 10h20v20z'));
  const sheet = buildSheetSvg([svg, svg, svg], { cell: 64, cols: 2, pad: 2 });
  assert.match(sheet, /width="128" height="128"/);
  assert.match(sheet, /x="66" y="2"/); // second cell
  assert.match(sheet, /x="2" y="66"/); // third cell
  assert.deepEqual(cellOf(5, { cols: 2, rowsPerSheet: 2 }), { sheet: 1, col: 1, row: 0 });
  // a short last sheet is padded to the full height the browser's mask size assumes
  assert.match(buildSheetSvg([svg], { cell: 64, cols: 2, rows: 4 }), /width="128" height="256"/);
});

/** Decodes the PNG the encoder writes (indexed, no interlace) back to coverage levels. */
function decodeMaskPng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let pos = 8;
  const chunks = {};
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    assert.equal(png.readUInt32BE(pos + 8 + len) >>> 0, zlib.crc32(png.subarray(pos + 4, pos + 8 + len)) >>> 0, `crc ${type}`);
    (chunks[type] ??= []).push(data);
    pos += 12 + len;
  }
  const w = chunks.IHDR[0].readUInt32BE(0);
  const h = chunks.IHDR[0].readUInt32BE(4);
  const depth = chunks.IHDR[0][8];
  const raw = zlib.inflateSync(Buffer.concat(chunks.IDAT));
  const rowBytes = Math.ceil((w * depth) / 8);
  const out = [];
  let prev = Buffer.alloc(rowBytes);
  for (let y = 0; y < h; y++) {
    const type = raw[y * (rowBytes + 1)];
    const line = Buffer.from(raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1)));
    for (let i = 0; i < rowBytes; i++) {
      const a = i ? line[i - 1] : 0;
      const b = prev[i];
      const c = i ? prev[i - 1] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
      line[i] = (line[i] + [0, a, b, (a + b) >> 1, paeth][type]) & 0xff;
    }
    prev = line;
    for (let x = 0; x < w; x++) {
      const per = 8 / depth;
      out.push((line[Math.floor(x / per)] >> (8 - depth * ((x % per) + 1))) & ((1 << depth) - 1));
    }
  }
  return { w, h, depth, levels: out, alpha: [...chunks.tRNS[0]], palette: chunks.PLTE[0] };
}

test('mask png: lossless for quantized alpha, white palette, any width', () => {
  for (const [w, levels] of [[7, 16], [16, 16], [5, 4], [9, 256], [13, 2]]) {
    const h = 6;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 17; // color is ignored
      rgba[i * 4 + 3] = (i * 37) % 256;
    }
    const png = encodeMaskPng(rgba, w, h, { levels });
    const dec = decodeMaskPng(png);
    assert.equal(dec.w, w);
    assert.equal(dec.h, h);
    assert.ok(dec.palette.every((v) => v === 255));
    for (let i = 0; i < w * h; i++) {
      const expectLevel = Math.round((rgba[i * 4 + 3] * (levels - 1)) / 255);
      assert.equal(dec.levels[i], expectLevel, `pixel ${i} (w=${w}, levels=${levels})`);
    }
    assert.equal(dec.alpha[0], 0);
    assert.equal(dec.alpha.at(-1), 255);
  }
});

const builtIndex = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'library', 'index.json');
if (fs.existsSync(builtIndex)) {
  test('built library: every index row has its svg and a valid thumbnail cell', () => {
    const index = JSON.parse(fs.readFileSync(builtIndex, 'utf8'));
    const dir = path.dirname(builtIndex);
    const perSheet = index.thumbs.cols * index.thumbs.rows;
    assert.equal(index.thumbs.sheets, Math.ceil(index.icons.length / perSheet));
    for (let i = 0; i < index.icons.length; i++) {
      const [name, title, author, tags] = index.icons[i];
      assert.ok(title, name);
      assert.ok(tags.length > 0, name);
      assert.ok(fs.existsSync(path.join(dir, 'icons', index.authors[author][0], `${name}.svg`)), name);
    }
    for (let s = 0; s < index.thumbs.sheets; s++) {
      const file = path.join(dir, 'thumbs', `sheet-${String(s).padStart(2, '0')}.png`);
      assert.ok(fs.existsSync(file), `sheet ${s}`);
      // every sheet, the short last one too, has the full size the browser's mask-size assumes
      const head = fs.readFileSync(file).subarray(16, 24);
      assert.equal(head.readUInt32BE(0), index.thumbs.cols * index.thumbs.cell, `sheet ${s} width`);
      assert.equal(head.readUInt32BE(4), index.thumbs.rows * index.thumbs.cell, `sheet ${s} height`);
    }
    assert.ok(fs.existsSync(path.join(dir, 'license.txt')));
  });
}

console.log(`${passed} library tests passed`);
