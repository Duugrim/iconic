// Fetches the tag overview and every tag page of game-icons.net once, politely (one request at a time
// with a pause), for tools/build-library.mjs.
//
//   node tools/fetch-tags.mjs <out dir>
import fs from 'node:fs';
import path from 'node:path';
import { parseTagIndex } from './lib/library-data.mjs';

const BASE = 'https://game-icons.net';
const PAUSE_MS = 400;
const out = process.argv[2];
if (!out) {
  console.error('usage: node tools/fetch-tags.mjs <out dir>');
  process.exit(1);
}

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'Iconic-build/0.1 (one-off tag fetch)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

fs.mkdirSync(path.join(out, 'pages'), { recursive: true });
const indexHtml = await get(`${BASE}/tags.html`);
fs.writeFileSync(path.join(out, 'tags.html'), indexHtml);

for (const group of parseTagIndex(indexHtml)) {
  for (const tag of [group, ...group.children]) {
    const file = path.join(out, 'pages', `${tag.slug}.html`);
    if (fs.existsSync(file)) continue;
    fs.writeFileSync(file, await get(`${BASE}/tags/${tag.slug}.html`));
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
}
console.log('done');
