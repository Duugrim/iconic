// Builds the bundled game-icons.net library: copies the SVGs, writes the index, the thumbnail sheets
// and CREDITS.md.
//
//   node tools/build-library.mjs --repo <clone of github.com/game-icons/icons> --tags <dir> [--cell 64]
//
// <dir> holds tags.html and pages/<slug>.html fetched with tools/fetch-tags.mjs.
// Needs the devDependency @resvg/resvg-js (npm install).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSheetSvg, cellOf, renderPng } from './lib/atlas.mjs';
import { buildIndex, creditsMarkdown, parseAuthors, parseTagIndex, parseTagPage } from './lib/library-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BADGES = 'badges'; // the site's badge frames, not part of the browsable icon set

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const repoDir = arg('repo');
const tagsDir = arg('tags');
if (!repoDir || !tagsDir) {
  console.error('usage: node tools/build-library.mjs --repo <game-icons clone> --tags <tag pages dir> [--cell 64]');
  process.exit(1);
}
const cell = Number(arg('cell', 64));
const cols = Number(arg('cols', 16));
const rows = cols;
const libDir = path.join(ROOT, 'library');

// Source icons.
const icons = [];
for (const folder of fs.readdirSync(repoDir).sort()) {
  const dir = path.join(repoDir, folder);
  if (folder.startsWith('.') || folder === BADGES || !fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir).sort()) {
    if (file.endsWith('.svg')) icons.push({ author: folder, name: file.slice(0, -4), file: path.join(dir, file) });
  }
}

// Tags.
const tagTree = parseTagIndex(fs.readFileSync(path.join(tagsDir, 'tags.html'), 'utf8'));
const tagPages = {};
for (const g of tagTree) {
  for (const t of [g, ...g.children]) {
    tagPages[t.slug] = parseTagPage(fs.readFileSync(path.join(tagsDir, 'pages', `${t.slug}.html`), 'utf8'));
  }
}

const licenseText = fs.readFileSync(path.join(repoDir, 'license.txt'), 'utf8');
const { index, report } = buildIndex({
  icons, tagTree, tagPages, authorInfo: parseAuthors(licenseText), thumbs: { cell, cols, rows },
});

// Write everything.
fs.rmSync(libDir, { recursive: true, force: true });
fs.mkdirSync(path.join(libDir, 'icons'), { recursive: true });
fs.mkdirSync(path.join(libDir, 'thumbs'), { recursive: true });
fs.writeFileSync(path.join(libDir, 'license.txt'), licenseText);

const byKey = new Map(icons.map((i) => [`${i.author}/${i.name}`, i]));
const folders = index.authors.map((a) => a[0]);
const svgOf = (row) => {
  const src = byKey.get(`${folders[row[2]]}/${row[0]}`);
  return fs.readFileSync(src.file, 'utf8');
};
for (const icon of icons) {
  const dir = path.join(libDir, 'icons', icon.author);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(icon.file, path.join(dir, `${icon.name}.svg`));
}

const perSheet = cols * rows;
let thumbBytes = 0;
for (let s = 0; s * perSheet < index.icons.length; s++) {
  const chunk = index.icons.slice(s * perSheet, (s + 1) * perSheet);
  const png = await renderPng(buildSheetSvg(chunk.map(svgOf), { cell, cols, rows }));
  fs.writeFileSync(path.join(libDir, 'thumbs', `sheet-${String(s).padStart(2, '0')}.png`), png);
  thumbBytes += png.length;
}
// Sanity check of the cell arithmetic the browser relies on.
const last = cellOf(index.icons.length - 1, { cols, rowsPerSheet: rows });
if (last.sheet !== index.thumbs.sheets - 1) throw new Error('sheet count mismatch');

fs.writeFileSync(path.join(libDir, 'index.json'), JSON.stringify(index));
fs.writeFileSync(path.join(ROOT, 'CREDITS.md'), `${creditsMarkdown(index)}\n`);

console.log(`icons ${index.icons.length}, authors ${index.authors.length}, tags ${index.tags.length}, groups ${index.groups.length}`);
console.log(`sheets ${index.thumbs.sheets}, thumbs ${(thumbBytes / 1024).toFixed(0)} KB, index ${(fs.statSync(path.join(libDir, 'index.json')).size / 1024).toFixed(0)} KB`);
console.log(`untagged ${report.untagged}; named by tag pages but not shipped ${report.unknownInTags.length}; authors without info: ${report.authorsWithoutInfo.join(', ') || 'none'}`);
