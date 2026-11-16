/**
 * Smoke tests for icon background shapes. Runs in plain Node. Execute with:
 *   node tests/bg-shapes.test.mjs
 *
 * Each case prints a single PASS/FAIL line. Process exits with code 1 if any assertion fails.
 */

import fs from 'node:fs';
import {
  bgShapeHasRadius,
  buildShapePath,
  getShapeSafeSquare,
  listBgShapes,
  normalizeBgShapeId,
} from '../scripts/lib/bg-shapes.mjs';

let failed = 0;

function assert(label, cond, detail) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

/** Split generated path data into commands with their coordinate pairs. */
function parse(d) {
  const cmds = [];
  for (const m of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
    const nums = (m[2].match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    cmds.push({ c: m[1], pts, nums });
  }
  return cmds;
}

function bounds(d) {
  const all = parse(d).flatMap((c) => c.pts);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

const BOX = { x: 0, y: 0, w: 512, h: 512 };

// --- registry --------------------------------------------------------------

const shapes = listBgShapes();
assert('registry has basic, hex and shield shapes', ['basic', 'hex', 'shield'].every((g) => shapes.some((s) => s.group === g)));
assert('registry ids are unique', new Set(shapes.map((s) => s.id)).size === shapes.length);
assert('at least 6 shield shapes', shapes.filter((s) => s.group === 'shield').length >= 6, shapes.length);

assert('legacy "hex" maps to hex-flat', normalizeBgShapeId('hex') === 'hex-flat');
assert('legacy "rounded" maps to square', normalizeBgShapeId('rounded') === 'square');
assert('unknown shape falls back to square', normalizeBgShapeId('nope') === 'square' && normalizeBgShapeId(null) === 'square');
assert('circle has no radius, others do', !bgShapeHasRadius('circle') && bgShapeHasRadius('hex-flat') && bgShapeHasRadius('shield-heater'));
assert('map pin keeps its id and can be rounded', normalizeBgShapeId('Map-Pin') === 'map-pin' && bgShapeHasRadius('map-pin'));

function pascal(id) {
  return id.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}
for (const lang of ['en', 'ru']) {
  const labels = JSON.parse(fs.readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), 'utf8')).ICONIC.Editor.Background.Shapes;
  for (const { id } of shapes) {
    assert(`${lang} names ${id}`, typeof labels[pascal(id)] === 'string' && labels[pascal(id)].length > 0);
  }
}

// --- regular hexagons --------------------------------------------------------

function sideLengths(d) {
  const cmds = parse(d);
  const pts = [cmds[0].pts[0], ...cmds.filter((c) => c.c === 'L').map((c) => c.pts[0])];
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  return out;
}

for (const id of ['hex-flat', 'hex-pointy']) {
  const d = buildShapePath(id, BOX);
  const sides = sideLengths(d);
  assert(`${id}: six sides`, sides.length === 6, sides.length);
  assert(`${id}: all sides equal (regular)`, sides.every((s) => near(s, sides[0], 0.05)), sides);
  const b = bounds(d);
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (id === 'hex-flat') {
    assert('hex-flat: fills box width, height = width * sqrt(3)/2', near(w, 512, 0.05) && near(h, 512 * Math.sqrt(3) / 2, 0.05), { w, h });
  } else {
    assert('hex-pointy: fills box height, width = height * sqrt(3)/2', near(h, 512, 0.05) && near(w, 512 * Math.sqrt(3) / 2, 0.05), { w, h });
  }
  assert(`${id}: centered in the box`, near((b.minX + b.maxX) / 2, 256, 0.05) && near((b.minY + b.maxY) / 2, 256, 0.05));
}

// --- fitting ------------------------------------------------------------------

{
  const wide = { x: 100, y: 50, w: 400, h: 200 };
  const b = bounds(buildShapePath('shield-heater', wide));
  assert('wide box: shield fills the height and is centered horizontally',
    near(b.maxY - b.minY, 200, 0.05) && near((b.minX + b.maxX) / 2, 300, 0.05) && near(b.minY, 50, 0.05), b);
}

// --- rounding -------------------------------------------------------------------

{
  const sharp = parse(buildShapePath('hex-flat', BOX));
  const soft = parse(buildShapePath('hex-flat', BOX, { radius: 40 }));
  assert('hex sharp: 5 lines, no curves', sharp.filter((c) => c.c === 'L').length === 5 && !sharp.some((c) => c.c === 'C'));
  assert('hex rounded: 6 fillets', soft.filter((c) => c.c === 'C').length === 6, soft.length);

  const b = bounds(buildShapePath('hex-flat', BOX, { radius: 40 }));
  assert('rounded hex stays inside the box', b.minX >= -0.01 && b.maxX <= 512.01 && b.minY >= 0 && b.maxY <= 512);
  assert('rounded hex is narrower than the sharp one', b.maxX - b.minX < 512 - 1);

  // A fillet of radius r on a 120° corner starts d = r * tan(30°) before the vertex.
  const first = parse(buildShapePath('hex-flat', BOX, { radius: 40 }))[0].pts[0];
  const vertexTopLeft = [128, (512 - 512 * Math.sqrt(3) / 2) / 2];
  const dFirst = Math.hypot(first[0] - vertexTopLeft[0], first[1] - vertexTopLeft[1]);
  assert('fillet cut distance is r * tan(30°)', near(dFirst, 40 * Math.tan(Math.PI / 6), 0.1), dFirst);

  const huge = buildShapePath('hex-flat', BOX, { radius: 9999 });
  assert('huge radius is clamped, no NaN', !/NaN|Infinity/.test(huge), huge);
}

// --- every shape ------------------------------------------------------------------

for (const { id } of shapes) {
  for (const radius of [0, 24, 120]) {
    const d = buildShapePath(id, BOX, { radius });
    const b = bounds(d);
    const ok = /^M/.test(d) && /Z$/.test(d) && !/NaN|Infinity/.test(d)
      && b.minX >= -0.5 && b.maxX <= 512.5 && b.minY >= -0.5 && b.maxY <= 512.5;
    assert(`${id} r=${radius}: valid closed path inside the box`, ok, ok ? undefined : { d, b });
  }

  const safe = getShapeSafeSquare(id, BOX);
  const half = safe.size / 2;
  assert(`${id}: icon safe square lies inside the box`,
    safe.cx - half >= -0.01 && safe.cx + half <= 512.01 && safe.cy - half >= -0.01 && safe.cy + half <= 512.01, safe);
}

// --- icon safe square corners lie inside the sharp outline ---------------------------

/** Even-odd point test on a flattened outline (Béziers sampled). */
function polygonFromPath(d) {
  const cmds = parse(d);
  const pts = [];
  let cur = cmds[0].pts[0];
  pts.push(cur);
  for (const c of cmds.slice(1)) {
    if (c.c === 'L') {
      cur = c.pts[0];
      pts.push(cur);
    } else if (c.c === 'C') {
      const [c1, c2, p1] = c.pts;
      for (let i = 1; i <= 24; i++) {
        const t = i / 24;
        const u = 1 - t;
        pts.push([
          u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
          u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
        ]);
      }
      cur = p1;
    }
  }
  return pts;
}

function inside(poly, [x, y]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// --- map pin: a circle drawn to a point -------------------------------------------------

{
  const d = buildShapePath('map-pin', BOX);
  const cmds = parse(d);
  const curves = cmds.filter((c) => c.c === 'C');
  const lines = cmds.filter((c) => c.c === 'L');
  assert('map pin: four arcs and one side (the other closes with Z)', curves.length === 4 && lines.length === 1, cmds.map((c) => c.c));

  const b = bounds(d);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  assert('map pin: fills the box height and is centered',
    near(height, 512, 0.05) && near(b.minY, 0, 0.05) && near((b.minX + b.maxX) / 2, 256, 0.05), b);
  assert('map pin: width is two thirds of the height', near(width, 512 * 2 / 3, 0.1), width);

  const radius = width / 2;
  const head = [(b.minX + b.maxX) / 2, b.minY + radius];
  const tip = lines[0].pts[0];
  const left = cmds[0].pts[0];
  const right = curves[curves.length - 1].pts.at(-1);
  assert('map pin: tip is the bottom center', near(tip[0], head[0], 0.05) && near(tip[1], b.maxY, 0.05), tip);

  const between = (u, v) => {
    const d = u[0] * v[0] + u[1] * v[1];
    return Math.acos(d / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])));
  };
  const point = between([left[0] - tip[0], left[1] - tip[1]], [right[0] - tip[0], right[1] - tip[1]]);
  assert('map pin: the point is 60°', near(point, Math.PI / 3, 0.01), point);
  assert('map pin: shoulders sit on the circle, 30° under the equator',
    near(Math.hypot(left[0] - head[0], left[1] - head[1]), radius, 0.15)
    && near(Math.hypot(right[0] - head[0], right[1] - head[1]), radius, 0.15)
    && near(Math.atan2(left[1] - head[1], head[0] - left[0]), Math.PI / 6, 0.01),
    { left, right, head, radius });

  // The head is a circle: sample every arc. A quarter-circle cubic bows by a fraction of a pixel.
  const samples = [];
  let cur = left;
  for (const c of curves) {
    const [c1, c2, p1] = c.pts;
    for (const t of [0.25, 0.5, 0.75, 1]) {
      const u = 1 - t;
      samples.push([
        u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
        u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
      ]);
    }
    cur = p1;
  }
  const off = samples.map((p) => Math.abs(Math.hypot(p[0] - head[0], p[1] - head[1]) - radius));
  assert('map pin: the head is circular', Math.max(...off) < 0.2, Math.max(...off));

  const soft = parse(buildShapePath('map-pin', BOX, { radius: 36 }));
  assert('map pin: corner radius rounds only the tip', soft.filter((c) => c.c === 'C').length === curves.length + 1, soft.map((c) => c.c));

  const poly = polygonFromPath(d);
  const s = getShapeSafeSquare('map-pin', BOX);
  const ri = s.size / 2;
  const outside = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const p = [s.cx + Math.cos(a) * ri, s.cy + Math.sin(a) * ri];
    if (!inside(poly, p)) outside.push(deg);
  }
  assert('map pin: the icon disc sits inside the outline', outside.length === 0, { outside, s });
  assert('map pin: the icon is centered on the head, not on the whole pin', near(s.cx, head[0], 0.05) && near(s.cy, head[1], 0.05), s);
}

for (const { id } of shapes) {
  if (id === 'square') continue;
  const poly = polygonFromPath(buildShapePath(id, BOX));
  const s = getShapeSafeSquare(id, BOX);
  const h = s.size / 2;
  // Game icons are roughly round, so the circle inscribed in the safe square must fit; the
  // square's corners may poke out of tapered shapes.
  const probes = [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [s.cx + Math.cos(a) * h, s.cy + Math.sin(a) * h];
  });
  const bad = probes.filter((p) => !inside(poly, p));
  assert(`${id}: circle inscribed in the icon safe square fits the outline`, bad.length === 0, { bad, s });
}

// --- bake options: legacy data keeps its look, new data uses the radius everywhere -------

{
  const { normalizeBakeOptions } = await import('../scripts/lib/svg-bake.mjs');
  const bgOf = (bg) => normalizeBakeOptions({ icon: { color: '#ffffff' }, background: { enabled: true, ...bg } }).background;

  const rounded = bgOf({ shape: 'rounded', radiusPct: 18 });
  assert('legacy "rounded" becomes a square with its radius, no icon fit',
    rounded.shape === 'square' && rounded.radiusPct === 18 && rounded.fitIcon === false, rounded);

  const oldHex = bgOf({ shape: 'hex', radiusPct: 18 });
  assert('legacy "hex" keeps sharp corners (radius was only for "rounded")',
    oldHex.shape === 'hex-flat' && oldHex.radiusPct === 0, oldHex);

  const fresh = bgOf({ shape: 'hex-pointy', radiusPct: 12, fitIcon: true });
  assert('current data: radius applies to hexagons', fresh.shape === 'hex-pointy' && fresh.radiusPct === 12 && fresh.fitIcon === true, fresh);

  const again = normalizeBakeOptions(normalizeBakeOptions({ background: { enabled: true, shape: 'rounded', radiusPct: 18 } }));
  assert('normalization is idempotent for legacy rounded',
    again.background.shape === 'square' && again.background.radiusPct === 18, again.background);
}

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll bg-shapes tests passed');
