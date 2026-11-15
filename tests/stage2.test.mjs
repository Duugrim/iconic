// node tests/stage2.test.mjs
// Field divisions, colors and contrast, and the new bake options (all pure, no DOM).
import assert from 'node:assert/strict';
import { DIVISION_IDS, divisionRegions, normalizeDivisionId, polygonPath } from '../scripts/lib/bg-division.mjs';
import { getShapeBounds, listBgShapes } from '../scripts/lib/bg-shapes.mjs';
import {
  CONTRAST_TARGET, CONTRAST_WARN_BELOW, checkContrast, colorWithContrast, contrastRatio, luminance, parseHex, toHex,
} from '../scripts/lib/color.mjs';
import { computeBakeHash, normalizeBakeOptions } from '../scripts/lib/svg-bake.mjs';

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
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

const polyArea = (pts) => Math.abs(pts.reduce((sum, [x, y], i) => {
  const [nx, ny] = pts[(i + 1) % pts.length];
  return sum + (x * ny - nx * y);
}, 0)) / 2;

// ---- divisions ----

const UNIT = { x: 0, y: 0, w: 1, h: 1 };
/** Share of the field painted with the second color, for each division. */
const SECOND_SHARE = {
  pale: 0.5, fess: 0.5, bend: 0.5, 'bend-sinister': 0.5, saltire: 0.5, quarterly: 0.5,
  gyronny: 0.5, paly: 0.5, barry: 0.5, chequy: 0.5, chief: 0.3,
};

test('divisions: ids are unique, none first, unknown ids mean none', () => {
  assert.equal(DIVISION_IDS[0], 'none');
  assert.equal(new Set(DIVISION_IDS).size, DIVISION_IDS.length);
  assert.equal(normalizeDivisionId('PALE'), 'pale');
  assert.equal(normalizeDivisionId('bogus'), 'none');
  assert.equal(normalizeDivisionId(undefined), 'none');
  assert.deepEqual(divisionRegions('none', UNIT), []);
  assert.deepEqual(divisionRegions('bogus', UNIT), []);
});

test('divisions: every region is a polygon inside the shape bounds', () => {
  for (const id of DIVISION_IDS.filter((d) => d !== 'none')) {
    const regions = divisionRegions(id, UNIT);
    assert.ok(regions.length > 0, id);
    for (const poly of regions) {
      assert.ok(poly.length >= 3, `${id}: polygon needs 3+ points`);
      for (const [x, y] of poly) assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${id}: ${x},${y}`);
    }
  }
});

test('divisions: the second color covers the expected share of the field', () => {
  for (const [id, share] of Object.entries(SECOND_SHARE)) {
    const total = divisionRegions(id, UNIT).reduce((sum, poly) => sum + polyArea(poly), 0);
    near(total, share, 1e-9);
  }
  // chevron: below the two arms, down to the bottom edge
  const chevron = divisionRegions('chevron', UNIT).reduce((sum, poly) => sum + polyArea(poly), 0);
  assert.ok(chevron > 0.2 && chevron < 0.6, `chevron share ${chevron}`);
});

test('divisions: laid out on the bounds, not on the unit square', () => {
  const [pale] = divisionRegions('pale', { x: 10, y: 20, w: 100, h: 50 });
  assert.deepEqual(pale, [[60, 20], [110, 20], [110, 70], [60, 70]]);
  const [triangle] = divisionRegions('bend', { x: 0, y: 0, w: 200, h: 100 });
  assert.deepEqual(triangle, [[0, 0], [200, 100], [0, 100]]);
});

test('divisions: paly and barry alternate stripes, chequy is a checkerboard', () => {
  assert.equal(divisionRegions('paly', UNIT).length, 3);
  assert.equal(divisionRegions('barry', UNIT).length, 3);
  assert.equal(divisionRegions('chequy', UNIT).length, 8);
  assert.equal(divisionRegions('gyronny', UNIT).length, 4);
  assert.equal(divisionRegions('saltire', UNIT).length, 2);
  assert.equal(divisionRegions('quarterly', UNIT).length, 2);
});

test('polygon path is closed and finite', () => {
  assert.equal(polygonPath([[0, 0], [10, 0], [10, 5.12345]]), 'M0 0L10 0L10 5.123Z');
});

test('shape bounds: inside the box and centered, for every shape', () => {
  const box = { x: 5, y: 10, w: 100, h: 80 };
  for (const { id } of listBgShapes()) {
    const b = getShapeBounds(id, box);
    assert.ok(b.w <= box.w + 1e-9 && b.h <= box.h + 1e-9, id);
    assert.ok(b.w >= box.w - 1e-9 || b.h >= box.h - 1e-9, `${id}: touches the box on one axis`);
    near(b.x + b.w / 2, box.x + box.w / 2);
    near(b.y + b.h / 2, box.y + box.h / 2);
  }
});

// ---- colors ----

test('color basics: parsing, luminance, contrast ratio', () => {
  assert.deepEqual(parseHex('#ff8000'), [255, 128, 0]);
  assert.equal(parseHex('nope'), null);
  assert.equal(toHex([255, 128.4, 0]), '#ff8000');
  near(luminance('#ffffff'), 1);
  near(luminance('#000000'), 0);
  near(contrastRatio('#000000', '#ffffff'), 21);
  near(contrastRatio('#336699', '#336699'), 1);
  near(contrastRatio('#777777', '#ffffff'), contrastRatio('#ffffff', '#777777'));
  assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.02);
});

test('colorWithContrast: reaches the target, keeps the hue, nearest direction first', () => {
  const fixed = colorWithContrast('#7a1f2b', '#7a1f2b'); // identical -> must move
  assert.ok(contrastRatio(fixed, '#7a1f2b') >= CONTRAST_TARGET);
  const onDark = colorWithContrast('#445577', '#223344'); // lighter than the bg -> lightens
  assert.ok(contrastRatio(onDark, '#223344') >= CONTRAST_TARGET);
  assert.ok(luminance(onDark) > luminance('#223344'));
  const onLight = colorWithContrast('#aabbcc', '#eeeeee'); // darker is the only way
  assert.ok(contrastRatio(onLight, '#eeeeee') >= CONTRAST_TARGET);
  assert.ok(luminance(onLight) < luminance('#eeeeee'));
  assert.equal(colorWithContrast('#808080', '#808080', 21.5), null); // impossible target
  assert.equal(colorWithContrast('#ffffff', '#000000'), '#ffffff'); // already fine: unchanged
  assert.equal(colorWithContrast('garbage', '#000000'), null);
});

const bg = (over = {}) => ({ enabled: true, color: '#7a1f2b', opacity: 1, divisionColor: null, ...over });

test('contrast check: only with an opaque enough background', () => {
  assert.equal(checkContrast({ iconColor: '#7a1f2b', background: bg({ enabled: false }) }).applicable, false);
  assert.equal(checkContrast({ iconColor: '#7a1f2b', background: bg({ opacity: 0.3 }) }).applicable, false);
  assert.equal(checkContrast({ iconColor: '#7a1f2b', background: bg({ opacity: 0.8 }) }).applicable, true);
});

test('contrast check: fine contrast is not flagged', () => {
  const r = checkContrast({ iconColor: '#ffffff', background: bg({ color: '#000000' }) });
  assert.equal(r.low, false);
  assert.equal(r.applicable, true);
  near(r.ratio, 21);
  assert.deepEqual(r.suggestions, { icon: [], background: [] });
});

test('contrast check: low contrast comes with readable suggestions', () => {
  const r = checkContrast({ iconColor: '#8a2432', background: bg(), hintColors: ['#ffd24a'] });
  assert.equal(r.low, true);
  assert.ok(r.ratio < CONTRAST_WARN_BELOW);
  assert.ok(r.suggestions.icon.length > 0 && r.suggestions.icon.length <= 3);
  for (const s of r.suggestions.icon) assert.ok(contrastRatio(s.color, '#7a1f2b') >= CONTRAST_WARN_BELOW);
  // best first
  const ratios = r.suggestions.icon.map((s) => s.ratio);
  assert.deepEqual(ratios, ratios.slice().sort((a, b) => b - a));
  assert.ok(r.suggestions.icon.some((s) => s.color === '#ffffff'));
  assert.ok(r.suggestions.icon.some((s) => s.color === '#ffd24a'), 'the faction color is offered when it reads well');
  assert.ok(r.suggestions.background.length > 0);
  for (const s of r.suggestions.background) {
    assert.ok(contrastRatio(s.color, '#8a2432') >= CONTRAST_WARN_BELOW);
    assert.notEqual(s.color, '#7a1f2b');
  }
});

test('contrast check: a hint color that reads badly is not offered', () => {
  const r = checkContrast({ iconColor: '#8a2432', background: bg(), hintColors: ['#7a2030'] });
  assert.ok(!r.suggestions.icon.some((s) => s.color === '#7a2030'));
});

test('contrast check: an outline that reads well saves a low-contrast icon', () => {
  const plain = checkContrast({ iconColor: '#8a2432', background: bg() });
  const outlined = checkContrast({ iconColor: '#8a2432', background: bg(), iconStroke: { enabled: true, color: '#ffffff' } });
  assert.equal(plain.low, true);
  assert.equal(outlined.low, false);
  const badOutline = checkContrast({ iconColor: '#8a2432', background: bg(), iconStroke: { enabled: true, color: '#7f2030' } });
  assert.equal(badOutline.low, true);
});

test('contrast check: each field is judged on its own, by the fill or by the outline', () => {
  // white icon with the default black outline, dark red field, gold second color: readable everywhere
  const field = { color: '#511515', divisionColor: '#d4af37' };
  const white = { iconColor: '#ffffff', background: bg(field) };
  assert.equal(checkContrast(white).low, true, 'white on gold alone is 2.1:1');
  near(checkContrast(white).ratio, contrastRatio('#ffffff', '#d4af37'), 1e-9);
  const outlined = checkContrast({ ...white, iconStroke: { enabled: true, color: '#000000', opacity: 1, widthPct: 4 } });
  assert.equal(outlined.low, false);
  assert.ok(outlined.ratio >= CONTRAST_WARN_BELOW, `weakest field ${outlined.ratio}`);
  // an outline that is too faint or too thin to matter does not count
  assert.equal(checkContrast({ ...white, iconStroke: { enabled: true, color: '#000000', opacity: 0.3, widthPct: 4 } }).low, true);
  assert.equal(checkContrast({ ...white, iconStroke: { enabled: true, color: '#000000', opacity: 1, widthPct: 0 } }).low, true);
  // an outline that fails on a field the fill also fails on is no help
  assert.equal(checkContrast({ iconColor: '#8a2432', background: bg({ color: '#7a1f2b' }), iconStroke: { enabled: true, color: '#7f2030' } }).low, true);
});

test('contrast check: a divided field must read on both colors; no background suggestions then', () => {
  const light = checkContrast({ iconColor: '#ffffff', background: bg({ color: '#000000' }) });
  assert.equal(light.low, false);
  const divided = checkContrast({ iconColor: '#ffffff', background: bg({ color: '#000000', divisionColor: '#f4f4f4' }) });
  assert.equal(divided.low, true);
  assert.ok(divided.ratio < 1.2);
  assert.equal(divided.suggestions.background.length, 0);
  for (const s of divided.suggestions.icon) {
    assert.ok(contrastRatio(s.color, '#000000') >= CONTRAST_WARN_BELOW && contrastRatio(s.color, '#f4f4f4') >= CONTRAST_WARN_BELOW);
  }
});

// ---- bake options ----

test('options: placement and field fields get defaults, clamps and survive a second pass', () => {
  const d = normalizeBakeOptions({ icon: { color: '#ffffff' } });
  assert.deepEqual(
    [d.icon.rotationDeg, d.icon.offsetXPct, d.icon.offsetYPct, d.icon.flipH, d.icon.flipV],
    [0, 0, 0, false, false],
  );
  assert.equal(d.background.division.type, 'none');
  assert.equal(d.background.contour2.enabled, false);

  const wild = normalizeBakeOptions({
    icon: { color: '#fff', rotationDeg: 900, offsetXPct: -80, offsetYPct: 'x', flipH: 1, flipV: 0 },
    background: {
      enabled: true,
      division: { type: 'Quarterly', color: '#ABC' },
      contour2: { enabled: 1, color: 'bad', widthPct: 99, gapPct: -4 },
    },
  });
  assert.equal(wild.icon.rotationDeg, 180);
  assert.equal(wild.icon.offsetXPct, -50);
  assert.equal(wild.icon.offsetYPct, 0);
  assert.equal(wild.icon.flipH, true);
  assert.equal(wild.icon.flipV, false);
  assert.equal(wild.background.division.type, 'quarterly');
  assert.equal(wild.background.division.color, '#aabbcc');
  assert.deepEqual(wild.background.contour2, { enabled: true, color: '#ffffff', widthPct: 25, gapPct: 0 });
  assert.deepEqual(normalizeBakeOptions(wild), wild);
});

test('options: every new setting changes the file hash, equal settings do not', () => {
  const base = { icon: { color: '#ffffff' }, background: { enabled: true } };
  const hash = (o) => computeBakeHash({ srcPath: 'a.svg', opts: o });
  const h0 = hash(base);
  assert.equal(hash(structuredClone(base)), h0);
  const variants = [
    { icon: { color: '#ffffff', rotationDeg: 15 } },
    { icon: { color: '#ffffff', offsetXPct: 5 } },
    { icon: { color: '#ffffff', offsetYPct: 5 } },
    { icon: { color: '#ffffff', flipH: true } },
    { icon: { color: '#ffffff', flipV: true } },
    { background: { enabled: true, division: { type: 'pale' } } },
    { background: { enabled: true, division: { type: 'pale', color: '#123456' } } },
    { background: { enabled: true, contour2: { enabled: true } } },
    { background: { enabled: true, contour2: { enabled: true, gapPct: 5 } } },
  ].map((v) => hash({ ...base, icon: { ...base.icon, ...v.icon }, background: { ...base.background, ...v.background } }));
  assert.equal(new Set([h0, ...variants]).size, variants.length + 1);
});

console.log(`${passed} stage 2 tests passed`);
