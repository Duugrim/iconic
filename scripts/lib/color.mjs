// Color math for contrast checks: WCAG relative luminance and contrast ratio, and finding a nearby
// color that is readable on another one.

/** Below this ratio an icon is hard to read on its background (WCAG's minimum for graphics). */
export const CONTRAST_WARN_BELOW = 3;
/** Ratio the suggested colors aim for (WCAG AA for text). */
export const CONTRAST_TARGET = 4.5;

const SEARCH_STEPS = 20;
const MAX_SUGGESTIONS = 3;
const MIN_BACKGROUND_OPACITY = 0.5;
/** An icon outline fainter than this does not make the icon readable. */
const MIN_OUTLINE_OPACITY = 0.5;

/** '#rrggbb' -> [r, g, b] (0-255), or null. */
export function parseHex(hex) {
  const m = String(hex ?? '').trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex([r, g, b]) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

const linear = (v) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance (0 black .. 1 white). */
export function luminance(hex) {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/** WCAG contrast ratio, 1 (identical) .. 21 (black on white). */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function rgbToHsl([r, g, b]) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

/** Walks the lightness of (h, s) from l0 toward `end` (0 or 1) to the nearest value reaching `target`. */
function searchLightness([h, s], l0, end, against, target) {
  const at = (l) => toHex(hslToRgb([h, s, l]));
  if (contrastRatio(at(end), against) < target) return null;
  let fail = l0;
  let pass = end;
  for (let i = 0; i < SEARCH_STEPS; i++) {
    const mid = (fail + pass) / 2;
    if (contrastRatio(at(mid), against) >= target) pass = mid;
    else fail = mid;
  }
  return at(pass);
}

/**
 * The color closest to `color` (same hue and saturation, lightness moved) that reaches `target`
 * contrast on `against`; null if no lightness does.
 * @returns {string|null} '#rrggbb'
 */
export function colorWithContrast(color, against, target = CONTRAST_TARGET) {
  const rgb = parseHex(color);
  if (!rgb) return null;
  if (contrastRatio(color, against) >= target) return toHex(rgb);
  const hsl = rgbToHsl(rgb);
  const lighter = luminance(color) >= luminance(against);
  return searchLightness(hsl, hsl[2], lighter ? 1 : 0, against, target)
    ?? searchLightness(hsl, hsl[2], lighter ? 0 : 1, against, target);
}

const worst = (color, againstList) => Math.min(...againstList.map((c) => contrastRatio(color, c)));

/**
 * How readable the icon is on its background, with colors that would fix it.
 * On each field color the icon is readable by its fill or, when it has an outline, by that outline
 * (a white icon with a black outline reads on dark red and on gold alike); the weakest field decides.
 * @param {object} input
 * @param {string} input.iconColor
 * @param {{enabled: boolean, color: string, opacity?: number, divisionColor?: string|null}} input.background
 *   divisionColor is the second field color when the field is divided
 * @param {{enabled: boolean, color: string, opacity?: number, widthPct?: number}} [input.iconStroke]
 * @param {string[]} [input.hintColors] extra candidates for the icon color (e.g. the faction color)
 * @returns {{applicable: boolean, ratio: number, low: boolean, suggestions: {icon: {color: string, ratio: number}[], background: {color: string, ratio: number}[]}}}
 */
export function checkContrast({ iconColor, background, iconStroke = null, hintColors = [] }) {
  const empty = { applicable: false, ratio: 21, low: false, suggestions: { icon: [], background: [] } };
  // Without a background, or with a see-through one, what is behind the icon is the map: unknown.
  if (!background?.enabled || (background.opacity ?? 1) < MIN_BACKGROUND_OPACITY) return empty;

  const fields = [background.color, ...(background.divisionColor ? [background.divisionColor] : [])];
  const outlined = Boolean(iconStroke?.enabled)
    && (iconStroke.opacity ?? 1) >= MIN_OUTLINE_OPACITY
    && (iconStroke.widthPct ?? 1) > 0;
  const readability = (field) => Math.max(
    contrastRatio(iconColor, field),
    outlined ? contrastRatio(iconStroke.color, field) : 0,
  );
  const ratio = Math.min(...fields.map(readability));
  const low = ratio < CONTRAST_WARN_BELOW;
  if (!low) return { ...empty, applicable: true, ratio, low };

  const pick = (candidates, againstList) => {
    const seen = new Set();
    return candidates
      .filter(Boolean)
      .map((c) => toHex(parseHex(c) ?? [0, 0, 0]))
      .filter((c) => (seen.has(c) ? false : seen.add(c)))
      .map((color) => ({ color, ratio: worst(color, againstList) }))
      .filter((c) => c.ratio >= CONTRAST_WARN_BELOW)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, MAX_SUGGESTIONS);
  };

  const iconCandidates = [
    ...(fields.length === 1 ? [colorWithContrast(iconColor, fields[0])] : []),
    '#ffffff', '#000000', ...hintColors,
  ];
  // Changing the background color only makes sense when the field is one color.
  const backgroundCandidates = fields.length === 1
    ? [colorWithContrast(background.color, iconColor), '#ffffff', '#000000']
    : [];
  return {
    applicable: true,
    ratio,
    low,
    suggestions: {
      icon: pick(iconCandidates, fields),
      background: pick(backgroundCandidates, [iconColor]).filter((c) => c.color !== toHex(parseHex(background.color) ?? [0, 0, 0])),
    },
  };
}
