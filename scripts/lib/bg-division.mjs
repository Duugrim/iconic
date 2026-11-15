// Heraldic division of the background field. A division paints a second color over part of the
// shape; this file only knows the geometry: where the second color goes, as polygons on the
// rectangle the shape occupies. The baker clips them to the shape.

/** Field divisions in menu order; 'none' leaves the field in one color. */
export const DIVISION_IDS = [
  'none',
  'pale', 'fess', 'bend', 'bend-sinister', 'chevron', 'saltire', 'quarterly',
  'chief', 'gyronny', 'paly', 'barry', 'chequy',
];

const STRIPES = 6;
const CHEQUY_CELLS = 4;
const CHIEF_DEPTH = 0.3;
const CHEVRON_APEX = 0.38;
const CHEVRON_ARM_END = 0.88;

/** Points around a rectangle's edge, starting at the top-left corner, in unit coordinates. */
const EDGE_RING = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];

const rect = (u0, v0, u1, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

/** Regions of the second color on the unit square: arrays of polygons. */
const UNIT_REGIONS = {
  pale: () => [rect(0.5, 0, 1, 1)],
  fess: () => [rect(0, 0.5, 1, 1)],
  bend: () => [[[0, 0], [1, 1], [0, 1]]],
  'bend-sinister': () => [[[1, 0], [1, 1], [0, 1]]],
  chevron: () => [[[0, CHEVRON_ARM_END], [0.5, CHEVRON_APEX], [1, CHEVRON_ARM_END], [1, 1], [0, 1]]],
  saltire: () => [[[0, 0], [0.5, 0.5], [0, 1]], [[1, 0], [0.5, 0.5], [1, 1]]],
  quarterly: () => [rect(0.5, 0, 1, 0.5), rect(0, 0.5, 0.5, 1)],
  chief: () => [rect(0, 0, 1, CHIEF_DEPTH)],
  gyronny: () => [0, 2, 4, 6].map((i) => [[0.5, 0.5], EDGE_RING[i], EDGE_RING[(i + 1) % EDGE_RING.length]]),
  paly: () => Array.from({ length: STRIPES / 2 }, (_, k) => rect((2 * k + 1) / STRIPES, 0, (2 * k + 2) / STRIPES, 1)),
  barry: () => Array.from({ length: STRIPES / 2 }, (_, k) => rect(0, (2 * k + 1) / STRIPES, 1, (2 * k + 2) / STRIPES)),
  chequy: () => {
    const n = CHEQUY_CELLS;
    const cells = [];
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if ((row + col) % 2 === 1) cells.push(rect(col / n, row / n, (col + 1) / n, (row + 1) / n));
      }
    }
    return cells;
  },
};

/** Known division id, or 'none'. */
export function normalizeDivisionId(raw) {
  const id = String(raw ?? '').trim().toLowerCase();
  return DIVISION_IDS.includes(id) ? id : 'none';
}

/**
 * Polygons painted with the second color.
 * @param {string} id division id
 * @param {{x:number, y:number, w:number, h:number}} bounds rectangle the shape occupies
 * @returns {number[][][]} polygons as arrays of [x, y]; empty for 'none'
 */
export function divisionRegions(id, bounds) {
  const make = UNIT_REGIONS[normalizeDivisionId(id)];
  if (!make) return [];
  return make().map((poly) => poly.map(([u, v]) => [bounds.x + u * bounds.w, bounds.y + v * bounds.h]));
}

const fmt = (n) => String(Math.round(n * 1000) / 1000);

/** SVG path data of a closed polygon. */
export function polygonPath(points) {
  return `${points.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x)} ${fmt(y)}`).join('')}Z`;
}
