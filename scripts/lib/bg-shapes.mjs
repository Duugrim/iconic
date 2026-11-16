// Background shapes for baked icons (SpaceHolder, Foundry v13+).
// Pure geometry: shape id + target box -> SVG path data. No Foundry / DOM dependencies,
// so it can be unit-tested in plain Node (see bg-shapes.test.mjs).
//
// Every shape is a closed outline made of straight lines and cubic Béziers, drawn in its own
// design units (origin top-left, y down). The shape is fitted into the target box without
// distortion ("contain", centered). Corner rounding is applied afterwards by cutting every
// sharp joint back and inserting a circular-arc fillet, so one `radius` works for hexagons,
// squares and shield tips alike.

const EPS = 1e-9;
const KAPPA = 0.5522847498307936; // cubic Bézier circle constant
const HEX_RATIO = Math.sqrt(3) / 2; // height / width of a regular flat-top hexagon
const SMOOTH_ANGLE = (5 * Math.PI) / 180; // joints turning less than this are left alone
const MAX_TURN = (175 * Math.PI) / 180; // keep tan(phi / 2) finite

/** Shapes that skip the radius slider (they have no corners). */
const NO_RADIUS = new Set(['circle']);

const ALIASES = {
  rounded: 'square', // legacy: a square with corner radius
  hex: 'hex-flat', // legacy: the old (stretched) flat-top hexagon
};

// ---------------------------------------------------------------------------
// Shape definitions
// ---------------------------------------------------------------------------

function _poly(id, group, w, h, pts, safe) {
  return {
    id,
    group,
    w,
    h,
    start: pts[0],
    segs: pts.slice(1).map((p) => ['L', p[0], p[1]]),
    safe,
  };
}

function _ellipse(id, group, rx, ry, safe) {
  const w = rx * 2;
  const h = ry * 2;
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  return {
    id,
    group,
    w,
    h,
    start: [rx, 0],
    segs: [
      ['C', rx + kx, 0, w, ry - ky, w, ry],
      ['C', w, ry + ky, rx + kx, h, rx, h],
      ['C', rx - kx, h, 0, ry + ky, 0, ry],
      ['C', 0, ry - ky, rx - kx, 0, rx, 0],
    ],
    safe,
  };
}

/** One cubic for a circular arc. Angles are y-down, 0 at +x, and increase clockwise on screen. */
function _arcSeg(cx, cy, r, a0, a1) {
  const k = (4 / 3) * Math.tan((a1 - a0) / 4) * r;
  const at = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const tan = (a) => [-Math.sin(a), Math.cos(a)];
  const p0 = at(a0);
  const p1 = at(a1);
  const t0 = tan(a0);
  const t1 = tan(a1);
  return [
    'C',
    p0[0] + k * t0[0], p0[1] + k * t0[1],
    p1[0] - k * t1[0], p1[1] - k * t1[1],
    p1[0], p1[1],
  ];
}

/**
 * Map pin: a circle whose lower sides leave on the tangent and meet in a point.
 * The tip is one diameter below the center, so the tangents sit 30° under the
 * equator and the point is 60° — the usual geolocation marker.
 */
function _mapPin() {
  const R = 50;
  const cx = R;
  const cy = R;
  const tipDist = 2 * R;
  const relY = (R * R) / tipDist;
  const relX = Math.sqrt(R * R - relY * relY);
  const aRight = Math.atan2(relY, relX);
  const aLeft = Math.atan2(relY, -relX);
  const start = [cx + R * Math.cos(aLeft), cy + R * Math.sin(aLeft)];
  const tip = [cx, cy + tipDist];
  // Extrema (left, top, right) are endpoints, so the arc stays in the design box.
  const stops = [aLeft, Math.PI, Math.PI * 1.5, Math.PI * 2, aRight + Math.PI * 2];
  const segs = [];
  for (let i = 0; i < stops.length - 1; i++) segs.push(_arcSeg(cx, cy, R, stops[i], stops[i + 1]));
  segs.push(['L', tip[0], tip[1]], ['L', start[0], start[1]]);
  return {
    id: 'map-pin',
    group: 'basic',
    w: R * 2,
    h: tip[1],
    start,
    segs,
    // The icon sits in the round head, with the same room the circle gives it.
    safe: { cx, cy, size: 74 },
  };
}

const HEX_H = 100 * HEX_RATIO;

/**
 * `safe` is the square an icon should be fitted into when "fit icon" is on, in design units.
 * Hexagons are regular (equal sides); both orientations match Foundry's hex grid types.
 */
const SHAPES = [
  _poly('square', 'basic', 100, 100, [[0, 0], [100, 0], [100, 100], [0, 100]], { cx: 50, cy: 50, size: 100 }),
  _ellipse('circle', 'basic', 50, 50, { cx: 50, cy: 50, size: 74 }),
  _mapPin(),

  _poly('hex-flat', 'hex', 100, HEX_H, [
    [25, 0], [75, 0], [100, HEX_H / 2], [75, HEX_H], [25, HEX_H], [0, HEX_H / 2],
  ], { cx: 50, cy: HEX_H / 2, size: 66 }),
  _poly('hex-pointy', 'hex', HEX_H, 100, [
    [HEX_H / 2, 0], [HEX_H, 25], [HEX_H, 75], [HEX_H / 2, 100], [0, 75], [0, 25],
  ], { cx: HEX_H / 2, cy: 50, size: 66 }),

  {
    // Heater: flat top, straight upper sides, curving to a point.
    id: 'shield-heater',
    group: 'shield',
    w: 100,
    h: 118,
    start: [0, 0],
    segs: [
      ['L', 100, 0],
      ['L', 100, 46],
      ['C', 100, 82, 74, 102, 50, 118],
      ['C', 26, 102, 0, 82, 0, 46],
    ],
    safe: { cx: 50, cy: 44, size: 70 },
  },
  {
    // Kite (Norman): round shoulders, long taper.
    id: 'shield-kite',
    group: 'shield',
    w: 100,
    h: 150,
    start: [50, 0],
    segs: [
      ['C', 74, 0, 100, 12, 100, 42],
      ['C', 100, 64, 68, 108, 50, 150],
      ['C', 32, 108, 0, 64, 0, 42],
      ['C', 0, 12, 26, 0, 50, 0],
    ],
    safe: { cx: 50, cy: 50, size: 60 },
  },
  {
    // Oval (Italian): a pointed egg.
    id: 'shield-oval',
    group: 'shield',
    w: 100,
    h: 124,
    start: [50, 0],
    segs: [
      ['C', 78, 0, 100, 24, 100, 56],
      ['C', 100, 88, 74, 108, 50, 124],
      ['C', 26, 108, 0, 88, 0, 56],
      ['C', 0, 24, 22, 0, 50, 0],
    ],
    safe: { cx: 50, cy: 52, size: 68 },
  },
  {
    // French / Spanish: flat top, semicircular base.
    id: 'shield-french',
    group: 'shield',
    w: 100,
    h: 112,
    start: [0, 0],
    segs: [
      ['L', 100, 0],
      ['L', 100, 62],
      ['C', 100, 62 + 50 * KAPPA, 50 + 50 * KAPPA, 112, 50, 112],
      ['C', 50 - 50 * KAPPA, 112, 0, 62 + 50 * KAPPA, 0, 62],
    ],
    safe: { cx: 50, cy: 48, size: 72 },
  },
  {
    // Baroque: the top edge dips in the middle, leaving two horns.
    id: 'shield-baroque',
    group: 'shield',
    w: 100,
    h: 122,
    start: [0, 0],
    segs: [
      ['C', 18, 0, 34, 12, 50, 12],
      ['C', 66, 12, 82, 0, 100, 0],
      ['L', 100, 50],
      ['C', 100, 84, 76, 104, 50, 122],
      ['C', 24, 104, 0, 84, 0, 50],
    ],
    safe: { cx: 50, cy: 54, size: 62 },
  },
  {
    // Tilting shield: round base, a quarter notch cut out of the upper left (spear rest).
    id: 'shield-tilting',
    group: 'shield',
    w: 100,
    h: 112,
    start: [34, 0],
    segs: [
      ['L', 100, 0],
      ['L', 100, 62],
      ['C', 100, 62 + 50 * KAPPA, 50 + 50 * KAPPA, 112, 50, 112],
      ['C', 50 - 50 * KAPPA, 112, 0, 62 + 50 * KAPPA, 0, 62],
      ['L', 0, 26],
      ['C', 20, 26, 34, 16, 34, 0],
    ],
    safe: { cx: 55, cy: 52, size: 60 },
  },
  // Pentagon badge: modern "home plate" shield.
  _poly('shield-badge', 'shield', 100, 112, [[0, 0], [100, 0], [100, 66], [50, 112], [0, 66]], {
    cx: 50, cy: 46, size: 68,
  }),
  // Lozenge: the diamond used for ladies' arms.
  _poly('shield-lozenge', 'shield', 100, 130, [[50, 0], [100, 65], [50, 130], [0, 65]], {
    cx: 50, cy: 65, size: 52,
  }),
];

const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

export const BG_SHAPE_GROUPS = ['basic', 'hex', 'shield'];

/** @returns {Array<{id:string, group:string, hasRadius:boolean}>} in display order. */
export function listBgShapes() {
  return SHAPES.map((s) => ({ id: s.id, group: s.group, hasRadius: !NO_RADIUS.has(s.id) }));
}

/** Resolve a stored shape id (legacy ids included) to a known id; unknown -> 'square'. */
export function normalizeBgShapeId(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  const id = ALIASES[s] ?? s;
  return SHAPE_BY_ID.has(id) ? id : 'square';
}

export function bgShapeHasRadius(raw) {
  return !NO_RADIUS.has(normalizeBgShapeId(raw));
}

// ---------------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------------

const _sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const _len = (v) => Math.hypot(v[0], v[1]);
const _dist = (a, b) => _len(_sub(a, b));
const _lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function _unit(v) {
  const l = _len(v);
  return l < EPS ? [0, 0] : [v[0] / l, v[1] / l];
}

function _fmt(n) {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

const _pt = (p) => `${_fmt(p[0])} ${_fmt(p[1])}`;

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

/** Expand a shape definition into explicit closed segments. */
function _segments(shape) {
  const segs = [];
  let cur = shape.start;
  for (const s of shape.segs) {
    if (s[0] === 'L') {
      const p1 = [s[1], s[2]];
      segs.push({ t: 'L', p0: cur, p1 });
      cur = p1;
    } else {
      const p1 = [s[5], s[6]];
      segs.push({ t: 'C', p0: cur, c1: [s[1], s[2]], c2: [s[3], s[4]], p1 });
      cur = p1;
    }
  }
  if (_dist(cur, shape.start) > EPS) segs.push({ t: 'L', p0: cur, p1: shape.start });
  return segs;
}

function _mapSeg(seg, fn) {
  return seg.t === 'L'
    ? { t: 'L', p0: fn(seg.p0), p1: fn(seg.p1) }
    : { t: 'C', p0: fn(seg.p0), c1: fn(seg.c1), c2: fn(seg.c2), p1: fn(seg.p1) };
}

function _startTangent(seg) {
  if (seg.t === 'L') return _sub(seg.p1, seg.p0);
  for (const p of [seg.c1, seg.c2, seg.p1]) {
    const v = _sub(p, seg.p0);
    if (_len(v) > EPS) return v;
  }
  return [0, 0];
}

function _endTangent(seg) {
  if (seg.t === 'L') return _sub(seg.p1, seg.p0);
  for (const p of [seg.c2, seg.c1, seg.p0]) {
    const v = _sub(seg.p1, p);
    if (_len(v) > EPS) return v;
  }
  return [0, 0];
}

function _bezierPoint(seg, u) {
  const a = _lerp(seg.p0, seg.c1, u);
  const b = _lerp(seg.c1, seg.c2, u);
  const c = _lerp(seg.c2, seg.p1, u);
  return _lerp(_lerp(a, b, u), _lerp(b, c, u), u);
}

function _splitCubic(seg, t) {
  const a = _lerp(seg.p0, seg.c1, t);
  const b = _lerp(seg.c1, seg.c2, t);
  const c = _lerp(seg.c2, seg.p1, t);
  const d = _lerp(a, b, t);
  const e = _lerp(b, c, t);
  const f = _lerp(d, e, t);
  return [
    { t: 'C', p0: seg.p0, c1: a, c2: d, p1: f },
    { t: 'C', p0: f, c1: e, c2: c, p1: seg.p1 },
  ];
}

function _reverseCubic(seg) {
  return { t: 'C', p0: seg.p1, c1: seg.c2, c2: seg.c1, p1: seg.p0 };
}

/** Parameter u where the curve is `d` away (straight line) from its start. */
function _paramAtDistance(seg, d) {
  if (_dist(seg.p0, seg.p1) <= d) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (_dist(_bezierPoint(seg, mid), seg.p0) < d) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Cut `ds` off the start and `de` off the end of a segment. */
function _trimSeg(seg, ds, de) {
  if (ds <= 0 && de <= 0) return seg;

  if (seg.t === 'L') {
    const u = _unit(_sub(seg.p1, seg.p0));
    return {
      t: 'L',
      p0: [seg.p0[0] + u[0] * ds, seg.p0[1] + u[1] * ds],
      p1: [seg.p1[0] - u[0] * de, seg.p1[1] - u[1] * de],
    };
  }

  const u0 = ds > 0 ? _paramAtDistance(seg, ds) : 0;
  const u1 = de > 0 ? 1 - _paramAtDistance(_reverseCubic(seg), de) : 1;
  let cur = seg;
  if (u1 < 1) cur = _splitCubic(cur, u1)[0];
  if (u0 > 0) cur = _splitCubic(cur, u0 / Math.max(u1, EPS))[1];
  return cur;
}

// ---------------------------------------------------------------------------
// Corner rounding
// ---------------------------------------------------------------------------

/**
 * Fillet parameters for the joint between `prev` (ending there) and `next` (starting there).
 * A circular fillet of radius r turning by phi touches both segments d = r * tan(phi / 2)
 * away from the joint; its cubic handles are k * d long.
 * @returns {{d:number, k:number}|null} null when the joint is smooth or radius is 0.
 */
function _fillet(prev, next, radius) {
  if (!(radius > 0)) return null;

  const tin = _endTangent(prev);
  const tout = _startTangent(next);
  const lin = _len(tin);
  const lout = _len(tout);
  if (lin < EPS || lout < EPS) return null;

  const cos = Math.max(-1, Math.min(1, (tin[0] * tout[0] + tin[1] * tout[1]) / (lin * lout)));
  const phi = Math.acos(cos);
  if (phi < SMOOTH_ANGLE) return null;

  const turn = Math.min(phi, MAX_TURN);
  const reach = 0.5 * Math.min(_dist(prev.p0, prev.p1), _dist(next.p0, next.p1));
  const d = Math.min(radius * Math.tan(turn / 2), reach);
  if (d <= EPS) return null;

  return { d, k: ((4 / 3) * Math.tan(turn / 4)) / Math.tan(turn / 2) };
}

function _pathData(segs, radius) {
  const n = segs.length;
  const joints = segs.map((seg, i) => _fillet(segs[(i - 1 + n) % n], seg, radius));
  const trimmed = segs.map((seg, i) => _trimSeg(seg, joints[i]?.d ?? 0, joints[(i + 1) % n]?.d ?? 0));

  let d = `M${_pt(trimmed[0].p0)}`;
  for (let i = 0; i < n; i++) {
    const t = trimmed[i];
    const j = joints[(i + 1) % n];

    // Z already draws the closing line back to the start.
    const closesByZ = i === n - 1 && !j && t.t === 'L' && _dist(t.p1, trimmed[0].p0) < EPS;
    if (!closesByZ) {
      d += t.t === 'L'
        ? `L${_pt(t.p1)}`
        : `C${_pt(t.c1)} ${_pt(t.c2)} ${_pt(t.p1)}`;
    }
    if (!j) continue;

    const next = trimmed[(i + 1) % n];
    const ta = _unit(_endTangent(t));
    const tb = _unit(_startTangent(next));
    const h = j.k * j.d;
    d += `C${_pt([t.p1[0] + ta[0] * h, t.p1[1] + ta[1] * h])} `
      + `${_pt([next.p0[0] - tb[0] * h, next.p0[1] - tb[1] * h])} ${_pt(next.p0)}`;
  }
  return `${d}Z`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function _fit(shape, box) {
  const s = Math.min(box.w / shape.w, box.h / shape.h);
  return {
    s,
    ox: box.x + (box.w - shape.w * s) / 2,
    oy: box.y + (box.h - shape.h * s) / 2,
  };
}

/**
 * SVG path data for a shape fitted (contain, centered) into `box`.
 * @param {string} shapeId
 * @param {{x:number, y:number, w:number, h:number}} box
 * @param {{radius?: number}} [opts] corner radius in the box's own units; 0 = sharp.
 * @returns {string}
 */
export function buildShapePath(shapeId, box, { radius = 0 } = {}) {
  const shape = SHAPE_BY_ID.get(normalizeBgShapeId(shapeId));
  const { s, ox, oy } = _fit(shape, box);
  const segs = _segments(shape).map((seg) => _mapSeg(seg, (p) => [ox + p[0] * s, oy + p[1] * s]));
  return _pathData(segs, NO_RADIUS.has(shape.id) ? 0 : Math.max(0, Number(radius) || 0));
}

/**
 * The square an icon should be fitted into so it sits inside the shape, in the box's units.
 * @returns {{cx:number, cy:number, size:number}}
 */
export function getShapeSafeSquare(shapeId, box) {
  const shape = SHAPE_BY_ID.get(normalizeBgShapeId(shapeId));
  const { s, ox, oy } = _fit(shape, box);
  return {
    cx: ox + shape.safe.cx * s,
    cy: oy + shape.safe.cy * s,
    size: shape.safe.size * s,
  };
}

/**
 * The rectangle a shape actually occupies once fitted into `box` (the box's own units).
 * Field divisions are laid out on it.
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function getShapeBounds(shapeId, box) {
  const shape = SHAPE_BY_ID.get(normalizeBgShapeId(shapeId));
  const { s, ox, oy } = _fit(shape, box);
  return { x: ox, y: oy, w: shape.w * s, h: shape.h * s };
}
