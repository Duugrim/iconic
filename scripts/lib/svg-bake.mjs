// Iconic SVG baking: takes a source SVG, applies the style (recolor, scale, stroke, background
// shape) and writes the result as a standalone SVG. The style options and the source path are
// stored in the file itself (a comment), so any baked icon can be opened again for editing.

import { ensureDirTree, getFilePickerImpl, getOutputDir, toFetchUrl, trimSlash } from './storage.mjs';
import { buildShapePath, getShapeBounds, getShapeSafeSquare, normalizeBgShapeId } from './bg-shapes.mjs';
import { divisionRegions, normalizeDivisionId, polygonPath } from './bg-division.mjs';
import { creditForPath } from './credit.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';

function _clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 1;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function _clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

export function normalizeHexColor(raw, fallback = '#ffffff') {
  const s = String(raw ?? '').trim();
  if (!s) return fallback;

  // #rgb or #rrggbb
  const m3 = s.match(/^#([0-9a-fA-F]{3})$/);
  if (m3) {
    const h = m3[1];
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }

  const m6 = s.match(/^#([0-9a-fA-F]{6})$/);
  if (m6) return `#${m6[1]}`.toLowerCase();

  return fallback;
}

function _normalizePct(raw, { fallback = 0, min = 0, max = 100 } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return _clamp(n, min, max);
}

/**
 * Corner radius (%) of the background. Before `fitIcon` existed only the old "rounded" shape used
 * the radius (and every icon stored a default 18), so legacy data keeps it for "rounded" and
 * drops it elsewhere; current data uses the radius for every shape with corners.
 */
function _bgRadiusPct(bg) {
  const legacy = bg.fitIcon === undefined;
  if (legacy) {
    const wasRounded = String(bg.shape ?? '').trim().toLowerCase() === 'rounded';
    return wasRounded ? _normalizePct(bg.radiusPct, { fallback: 18, min: 0, max: 50 }) : 0;
  }
  return _normalizePct(bg.radiusPct, { fallback: 0, min: 0, max: 50 });
}

function _stableBakeOpts(opts) {
  const o = opts ?? {};
  const icon = o.icon ?? {};
  const bg = o.background ?? {};
  const iconStroke = icon.stroke ?? {};
  const bgStroke = bg.stroke ?? {};
  const division = bg.division ?? {};
  const contour2 = bg.contour2 ?? {};

  return {
    icon: {
      color: normalizeHexColor(icon.color, '#ffffff'),
      opacity: _clamp01(icon.opacity ?? 1),
      scalePct: _normalizePct(icon.scalePct, { fallback: 100, min: 25, max: 200 }),
      // Placement of the icon: turned, shifted (% of the viewBox) and mirrored around its own center.
      rotationDeg: _normalizePct(icon.rotationDeg, { fallback: 0, min: -180, max: 180 }),
      offsetXPct: _normalizePct(icon.offsetXPct, { fallback: 0, min: -50, max: 50 }),
      offsetYPct: _normalizePct(icon.offsetYPct, { fallback: 0, min: -50, max: 50 }),
      flipH: Boolean(icon.flipH),
      flipV: Boolean(icon.flipV),
      stroke: {
        enabled: Boolean(iconStroke.enabled),
        color: normalizeHexColor(iconStroke.color, '#000000'),
        widthPct: _normalizePct(iconStroke.widthPct, { fallback: 4, min: 0, max: 50 }),
        opacity: _clamp01(iconStroke.opacity ?? 1),
      },
    },
    background: {
      enabled: Boolean(bg.enabled),
      shape: normalizeBgShapeId(bg.shape),
      color: normalizeHexColor(bg.color, '#000000'),
      opacity: _clamp01(bg.opacity ?? 1),
      insetPct: _normalizePct(bg.insetPct, { fallback: 0, min: 0, max: 49 }),
      radiusPct: _bgRadiusPct(bg),
      // Fit the icon inside the shape's safe area (off for data baked before this existed).
      fitIcon: Boolean(bg.fitIcon),
      stroke: {
        enabled: Boolean(bgStroke.enabled),
        color: normalizeHexColor(bgStroke.color, '#ffffff'),
        widthPct: _normalizePct(bgStroke.widthPct, { fallback: 2, min: 0, max: 50 }),
        opacity: _clamp01(bgStroke.opacity ?? 1),
      },
      // Heraldic division: a second field color over part of the shape.
      division: {
        type: normalizeDivisionId(division.type),
        color: normalizeHexColor(division.color, '#d4af37'),
      },
      // A second, inner outline running parallel to the edge.
      contour2: {
        enabled: Boolean(contour2.enabled),
        color: normalizeHexColor(contour2.color, '#ffffff'),
        widthPct: _normalizePct(contour2.widthPct, { fallback: 2, min: 0, max: 25 }),
        gapPct: _normalizePct(contour2.gapPct, { fallback: 2, min: 0, max: 25 }),
      },
    },
  };
}

export function normalizeBakeOptions(raw, { fallbackColor = '#ffffff' } = {}) {
  if (!raw || typeof raw !== 'object') {
    return _stableBakeOpts({ icon: { color: normalizeHexColor(fallbackColor) } });
  }

  // Legacy: allow {color:"#rrggbb"}
  if (typeof raw?.color === 'string' && !raw?.icon) {
    return _stableBakeOpts({ icon: { color: normalizeHexColor(raw.color, fallbackColor) } });
  }

  const opts = _stableBakeOpts(raw);
  // Ensure icon.color always present.
  opts.icon.color = normalizeHexColor(opts.icon.color, normalizeHexColor(fallbackColor));
  return opts;
}

function _bakeOptsDigest(opts) {
  // Small schema => fixed key order. This becomes part of the hash string.
  return JSON.stringify(_stableBakeOpts(opts));
}

export function computeBakeHash({ srcPath, color = '#ffffff', opts = null, version = 'v2' } = {}) {
  const src = String(srcPath ?? '').trim();
  const v = String(version ?? 'v2').trim() || 'v2';
  const n = normalizeBakeOptions(opts ?? { icon: { color } }, { fallbackColor: color });
  return _fnv1a32Hex(`${v}|${src}|${_bakeOptsDigest(n)}`);
}

export function extractBakeMeta(svgText) {
  const s = String(svgText ?? '');
  const m = s.match(/<!--\s*(?:iconic|spaceholder)-bake:(v\d+)\s+data=([\s\S]*?)\s*-->/);
  if (!m) return null;

  const version = m[1];
  const dataRaw = String(m[2] ?? '').trim();

  try {
    const parsed = JSON.parse(decodeURIComponent(dataRaw));
    const srcPath = String(parsed?.src ?? '').trim();
    const color = String(parsed?.color ?? '').trim();
    const opts = (parsed?.opts && typeof parsed.opts === 'object') ? parsed.opts : null;

    return {
      version,
      srcPath,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : color,
      opts: opts ? normalizeBakeOptions(opts, { fallbackColor: color }) : null,
    };
  } catch (_) {
    return { version };
  }
}

const CREDIT_PREFIX = 'iconic-credit:';

function _removeBakeComments(svg) {
  try {
    const nodes = Array.from(svg.childNodes || []);
    for (const n of nodes) {
      if (n?.nodeType !== 8) continue; // Comment
      const txt = String(n.nodeValue ?? '').trim();
      if (txt.startsWith('iconic-bake:') || txt.startsWith('spaceholder-bake:') || txt.startsWith(CREDIT_PREFIX)) {
        try { svg.removeChild(n); } catch (_) { /* ignore */ }
      }
    }
  } catch (_) {
    // ignore
  }
}

function _buildBakeMetaComment({ srcPath, opts, version = 'v2' } = {}) {
  const normalized = normalizeBakeOptions(opts);
  const payload = {
    src: String(srcPath ?? '').trim(),
    color: normalized.icon.color,
    opts: normalized,
  };

  // encodeURIComponent avoids forbidden "--" sequences in XML comments.
  const data = encodeURIComponent(JSON.stringify(payload));
  const v = String(version ?? 'v2').trim() || 'v2';
  return `iconic-bake:${v} data=${data}`;
}

function _injectBakeMetaToDoc(doc, svg, { srcPath, opts, version = 'v2', credit = '' } = {}) {
  if (!doc || !svg) return;
  _removeBakeComments(svg);

  try {
    // "--" is not allowed inside an XML comment.
    const creditText = String(credit ?? '').replace(/-{2,}/g, '-').trim();
    if (creditText) svg.insertBefore(doc.createComment(`${CREDIT_PREFIX} ${creditText}`), svg.firstChild);
    svg.insertBefore(doc.createComment(_buildBakeMetaComment({ srcPath, opts, version })), svg.firstChild);
  } catch (_) {
    // ignore
  }
}

function _fnv1a32Hex(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // FNV-1a 32-bit
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function _slugify(raw, { maxLen = 42 } = {}) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const out = s || 'icon';
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function _parseStyle(styleText) {
  const out = {};
  const s = String(styleText ?? '').trim();
  if (!s) return out;

  for (const part of s.split(';')) {
    const [kRaw, vRaw] = part.split(':');
    const k = String(kRaw ?? '').trim().toLowerCase();
    const v = String(vRaw ?? '').trim();
    if (!k) continue;
    out[k] = v;
  }

  return out;
}

function _serializeStyle(map) {
  const parts = [];
  for (const [k, v] of Object.entries(map ?? {})) {
    const kk = String(k ?? '').trim();
    const vv = String(v ?? '').trim();
    if (!kk || !vv) continue;
    parts.push(`${kk}: ${vv}`);
  }
  return parts.join('; ');
}

function _parseViewBox(svg) {
  const vb = String(svg?.getAttribute?.('viewBox') ?? '').trim();
  const parts = vb.split(/[\s,]+/).map((x) => Number(x)).filter((n) => Number.isFinite(n));
  if (parts.length === 4) {
    return { minX: parts[0], minY: parts[1], width: parts[2], height: parts[3] };
  }

  // Fallback: width/height attrs (common on some SVGs)
  const w = Number(svg?.getAttribute?.('width'));
  const h = Number(svg?.getAttribute?.('height'));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { minX: 0, minY: 0, width: w, height: h };
  }

  return null;
}

function _approxEq(a, b, tol = 0.5) {
  const da = Number(a);
  const db = Number(b);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
  return Math.abs(da - db) <= tol;
}

function _parseLen(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (s.endsWith('%')) return s; // keep percentage
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function _coversViewBoxRect(el, vb) {
  if (!vb) return false;

  const xRaw = _parseLen(el.getAttribute('x'));
  const yRaw = _parseLen(el.getAttribute('y'));
  const wRaw = _parseLen(el.getAttribute('width'));
  const hRaw = _parseLen(el.getAttribute('height'));

  const xOk = (xRaw === null) ? true : (typeof xRaw === 'number' ? _approxEq(xRaw, vb.minX) : xRaw === '0%');
  const yOk = (yRaw === null) ? true : (typeof yRaw === 'number' ? _approxEq(yRaw, vb.minY) : yRaw === '0%');

  const wOk = (wRaw === null) ? false : (typeof wRaw === 'number' ? _approxEq(wRaw, vb.width) : wRaw === '100%');
  const hOk = (hRaw === null) ? false : (typeof hRaw === 'number' ? _approxEq(hRaw, vb.height) : hRaw === '100%');

  return xOk && yOk && wOk && hOk;
}

function _tokenizePath(d) {
  const re = /[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g;
  return String(d ?? '').match(re) ?? [];
}

function _coversViewBoxPath(el, vb) {
  if (!vb) return false;

  const d = el.getAttribute('d');
  if (!d) return false;

  const tokens = _tokenizePath(d);
  if (!tokens.length) return false;

  // Only handle simple rect paths made from M/m + H/h + V/v + Z/z.
  const allowedCmd = new Set(['M','m','H','h','V','v','Z','z']);
  for (const t of tokens) {
    if (/^[a-zA-Z]$/.test(t) && !allowedCmd.has(t)) return false;
  }

  let i = 0;
  let cmd = null;

  let x = 0;
  let y = 0;
  let sx = null;
  let sy = null;

  const pts = [];
  let hasClose = false;

  const nextNum = () => {
    if (i >= tokens.length) return null;
    const t = tokens[i];
    if (/^[a-zA-Z]$/.test(t)) return null;
    i++;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  while (i < tokens.length) {
    const t = tokens[i++];
    if (/^[a-zA-Z]$/.test(t)) {
      cmd = t;
    } else {
      // Implicit command repetition: step back one token and continue.
      i--;
    }

    if (!cmd) return false;

    if (cmd === 'M' || cmd === 'm') {
      const nx = nextNum();
      const ny = nextNum();
      if (nx === null || ny === null) return false;
      if (cmd === 'm') { x += nx; y += ny; } else { x = nx; y = ny; }
      sx = x; sy = y;
      pts.push({ x, y });
      continue;
    }

    if (cmd === 'H' || cmd === 'h') {
      let n;
      while ((n = nextNum()) !== null) {
        x = (cmd === 'h') ? (x + n) : n;
        pts.push({ x, y });
      }
      continue;
    }

    if (cmd === 'V' || cmd === 'v') {
      let n;
      while ((n = nextNum()) !== null) {
        y = (cmd === 'v') ? (y + n) : n;
        pts.push({ x, y });
      }
      continue;
    }

    if (cmd === 'Z' || cmd === 'z') {
      hasClose = true;
      if (sx !== null && sy !== null) {
        x = sx; y = sy;
        pts.push({ x, y });
      }
      continue;
    }
  }

  if (!hasClose || sx === null || sy === null) return false;
  if (pts.length < 4) return false;

  let minX = pts[0].x;
  let maxX = pts[0].x;
  let minY = pts[0].y;
  let maxY = pts[0].y;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  return _approxEq(minX, vb.minX) && _approxEq(minY, vb.minY)
    && _approxEq(maxX - minX, vb.width) && _approxEq(maxY - minY, vb.height);
}

function _isNoneFill(el) {
  const attr = String(el.getAttribute('fill') ?? '').trim().toLowerCase();
  if (attr === 'none') return true;

  const styleRaw = el.getAttribute('style');
  if (!styleRaw) return false;
  const map = _parseStyle(styleRaw);
  const fillV = String(map.fill ?? '').trim().toLowerCase();
  return fillV === 'none';
}

export function stripSvgBackground(svgText) {
  let doc = null;
  try {
    doc = new DOMParser().parseFromString(String(svgText ?? ''), 'image/svg+xml');
  } catch (_) {
    return String(svgText ?? '');
  }

  const svg = doc?.querySelector?.('svg');
  if (!svg) return String(svgText ?? '');

  // Ensure xmlns for safety
  if (!svg.getAttribute('xmlns')) {
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }

  const vb = _parseViewBox(svg);

  const selector = [
    'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line',
  ].join(',');

  const els = Array.from(svg.querySelectorAll(selector));
  if (els.length <= 1) {
    // Avoid stripping the whole icon if the icon is literally a square.
    return new XMLSerializer().serializeToString(svg);
  }

  for (const el of els) {
    const tag = String(el.tagName ?? '').toLowerCase();

    // Do not strip outline-only rects
    if (_isNoneFill(el)) continue;

    const isBg = (tag === 'rect')
      ? _coversViewBoxRect(el, vb)
      : (tag === 'path')
        ? _coversViewBoxPath(el, vb)
        : false;

    if (isBg) {
      try { el.remove(); } catch (_) { /* ignore */ }
    }
  }

  try {
    return new XMLSerializer().serializeToString(svg);
  } catch (_) {
    return String(svgText ?? '');
  }
}

function _ensureXmlns(svg) {
  if (!svg) return;
  if (!svg.getAttribute('xmlns')) {
    svg.setAttribute('xmlns', SVG_NS);
  }
}

function _createSvgEl(doc, tag) {
  try {
    return doc.createElementNS(SVG_NS, tag);
  } catch (_) {
    return doc.createElement(tag);
  }
}

function _wrapIconInGroup(doc, svg) {
  if (!doc || !svg) return null;

  const existing = svg.querySelector?.('g[data-sh-role="icon"]');
  if (existing) return existing;

  const group = _createSvgEl(doc, 'g');
  group.setAttribute('data-sh-role', 'icon');
  group.setAttribute('id', 'sh-icon');

  const nodes = Array.from(svg.childNodes || []);
  let moved = 0;

  for (const n of nodes) {
    if (n?.nodeType !== 1) continue; // element only
    const tag = String(n.tagName ?? '').toLowerCase();
    if (tag === 'defs' || tag === 'metadata' || tag === 'title' || tag === 'desc') continue;
    try { group.appendChild(n); moved++; } catch (_) { /* ignore */ }
  }

  if (!moved) return null;

  try {
    svg.appendChild(group);
    return group;
  } catch (_) {
    return null;
  }
}

function _recolorSvgSubtree(rootEl, { color } = {}) {
  const fillColor = normalizeHexColor(color);
  if (!rootEl?.querySelectorAll) return;

  // Default fill at group helps cover elements without explicit fill.
  try { rootEl.setAttribute('fill', fillColor); } catch (_) { /* ignore */ }

  const selector = [
    'path', 'circle', 'rect', 'ellipse', 'polygon', 'polyline', 'line',
  ].join(',');

  const els = rootEl.querySelectorAll(selector);
  for (const el of els) {
    if (!el?.getAttribute) continue;

    // Skip generated background.
    if (String(el.getAttribute('data-sh-role') ?? '') === 'bg') continue;

    const styleRaw = el.getAttribute('style');
    if (styleRaw) {
      const map = _parseStyle(styleRaw);
      const fillV = String(map.fill ?? '').trim().toLowerCase();
      if (!fillV || fillV !== 'none') {
        map.fill = fillColor;
      }
      const strokeV = String(map.stroke ?? '').trim().toLowerCase();
      if (strokeV && strokeV !== 'none') {
        map.stroke = fillColor;
      }
      el.setAttribute('style', _serializeStyle(map));
    }

    const fillAttr = el.getAttribute('fill');
    if (fillAttr === null) {
      el.setAttribute('fill', fillColor);
    } else {
      const fv = String(fillAttr).trim().toLowerCase();
      if (fv !== 'none') el.setAttribute('fill', fillColor);
    }

    if (el.hasAttribute('stroke')) {
      const sv = String(el.getAttribute('stroke') ?? '').trim().toLowerCase();
      if (sv !== 'none') el.setAttribute('stroke', fillColor);
    }
  }
}

function _applyStrokeToSubtree(rootEl, { color, width, opacity } = {}) {
  if (!rootEl?.querySelectorAll) return;

  const strokeColor = normalizeHexColor(color, '#000000');
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) return;
  const a = _clamp01(opacity ?? 1);

  const selector = [
    'path', 'circle', 'rect', 'ellipse', 'polygon', 'polyline', 'line',
  ].join(',');

  const els = rootEl.querySelectorAll(selector);
  for (const el of els) {
    if (!el?.setAttribute) continue;
    if (String(el.getAttribute('data-sh-role') ?? '') === 'bg') continue;

    el.setAttribute('stroke', strokeColor);
    el.setAttribute('stroke-width', String(w));
    el.setAttribute('stroke-linejoin', 'round');
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-opacity', String(a));

    // Ensure stroke is rendered above fill.
    const styleRaw = el.getAttribute('style');
    const map = _parseStyle(styleRaw);
    map['paint-order'] = 'stroke fill';
    el.setAttribute('style', _serializeStyle(map));
  }
}

function _computeViewBoxOrFallback(svg) {
  const vb = _parseViewBox(svg);
  if (vb) return vb;
  return { minX: 0, minY: 0, width: 100, height: 100 };
}

/** Sets the outline's paint on an element. */
function _setOutline(el, { color, width, opacity }) {
  el.setAttribute('stroke', normalizeHexColor(color, '#ffffff'));
  el.setAttribute('stroke-width', String(width));
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-opacity', String(_clamp01(opacity ?? 1)));
}

function _el(doc, tag, attrs = {}, children = []) {
  const el = _createSvgEl(doc, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const child of children) el.append(child);
  return el;
}

function _insertBackground(doc, svg, iconGroup, vb, bg) {
  if (!doc || !svg || !bg?.enabled) return null;

  const minDim = Math.min(vb.width, vb.height);

  const baseInset = minDim * (Number(bg.insetPct) / 100);

  // SVG stroke is centered on the shape outline (half inside, half outside).
  // To keep the entire stroke inside the viewBox (avoid clipping), inset the shape by strokeWidth/2.
  let strokeInset = 0;
  let outlineWidth = 0;
  if (bg.stroke?.enabled) {
    const sw = minDim * (Number(bg.stroke.widthPct) / 100);
    if (Number.isFinite(sw) && sw > 0) {
      outlineWidth = sw;
      strokeInset = sw / 2;
    }
  }

  const inset = baseInset + strokeInset;
  const box = {
    x: vb.minX + inset,
    y: vb.minY + inset,
    w: Math.max(0, vb.width - 2 * inset),
    h: Math.max(0, vb.height - 2 * inset),
  };

  const shape = normalizeBgShapeId(bg.shape);
  const shapeD = buildShapePath(shape, box, { radius: minDim * (Number(bg.radiusPct) / 100) });
  const fill = normalizeHexColor(bg.color, '#000000');
  const fillOpacity = _clamp01(bg.opacity ?? 1);
  const outline = { color: bg.stroke?.color, width: outlineWidth, opacity: bg.stroke?.opacity };

  const regions = bg.division?.type && bg.division.type !== 'none'
    ? divisionRegions(bg.division.type, getShapeBounds(shape, box))
    : [];
  const contourWidth = bg.contour2?.enabled ? minDim * (Number(bg.contour2.widthPct) / 100) : 0;
  const layers = [];

  const baseAttrs = {
    d: shapeD, id: 'sh-bg', 'data-sh-role': 'bg', 'data-sh-bg-shape': shape, fill,
  };

  if (!regions.length && !(contourWidth > 0)) {
    // One path: the field and its outline.
    const el = _el(doc, 'path', { ...baseAttrs, 'fill-opacity': fillOpacity });
    if (outlineWidth > 0) {
      _setOutline(el, outline);
      // Marker for migrations/diagnostics: background geometry was inset to keep stroke inside.
      el.setAttribute('data-sh-bg-stroke-inset', '1');
    }
    layers.push(el);
  } else {
    // Layered: field (with the second color clipped to the shape), inner contour, outline on top.
    const clipId = 'sh-bg-clip';
    const defs = _el(doc, 'defs', {}, [
      _el(doc, 'clipPath', { id: clipId }, [_el(doc, 'path', { d: shapeD })]),
    ]);
    layers.push(defs);

    const field = _el(doc, 'g', { id: 'sh-bg', 'data-sh-role': 'bg', 'data-sh-bg-shape': shape, opacity: fillOpacity }, [
      _el(doc, 'path', { d: shapeD, fill }),
    ]);
    if (regions.length) {
      const division = _el(doc, 'g', {
        'data-sh-role': 'bg-division',
        'clip-path': `url(#${clipId})`,
        fill: normalizeHexColor(bg.division.color, '#d4af37'),
      });
      for (const poly of regions) {
        const part = _el(doc, 'path', { d: polygonPath(poly) });
        // Division lines are drawn in the outline color, like the lines of a painted shield.
        if (outlineWidth > 0) _setOutline(part, outline);
        division.append(part);
      }
      field.append(division);
    }
    layers.push(field);

    if (contourWidth > 0) {
      // The band between `near` and `near + contourWidth` inside the edge: a thick stroke of the shape,
      // clipped to the shape, minus a thinner black stroke in the mask. This keeps it exactly parallel
      // to the edge for any shape, which an inset copy of the path would not.
      const near = strokeInset + minDim * (Number(bg.contour2.gapPct) / 100);
      const maskChildren = [_el(doc, 'rect', {
        x: vb.minX, y: vb.minY, width: vb.width, height: vb.height, fill: '#fff',
      })];
      if (near > 0) {
        maskChildren.push(_el(doc, 'path', { d: shapeD, fill: 'none', stroke: '#000', 'stroke-width': 2 * near }));
      }
      defs.append(_el(doc, 'mask', {
        id: 'sh-bg-inner-mask', maskUnits: 'userSpaceOnUse',
        x: vb.minX, y: vb.minY, width: vb.width, height: vb.height,
      }, maskChildren));
      layers.push(_el(doc, 'path', {
        d: shapeD,
        'data-sh-role': 'bg-contour2',
        fill: 'none',
        stroke: normalizeHexColor(bg.contour2.color, '#ffffff'),
        'stroke-width': 2 * (near + contourWidth),
        'clip-path': `url(#${clipId})`,
        mask: 'url(#sh-bg-inner-mask)',
      }));
    }

    if (outlineWidth > 0) {
      const edge = _el(doc, 'path', { d: shapeD, 'data-sh-role': 'bg-outline', fill: 'none' });
      _setOutline(edge, outline);
      edge.setAttribute('data-sh-bg-stroke-inset', '1');
      layers.push(edge);
    }
  }

  try {
    const before = (iconGroup && iconGroup.parentNode === svg) ? iconGroup : svg.firstChild;
    for (const layer of layers) svg.insertBefore(layer, before);
  } catch (_) {
    for (const layer of layers) {
      try { svg.appendChild(layer); } catch (_) { /* ignore */ }
    }
  }

  // Square the icon should be fitted into to sit inside the shape (used when bg.fitIcon is on).
  return { safe: getShapeSafeSquare(shape, box) };
}

export function buildBakedSvgText(srcSvgText, {
  srcPath = '',
  opts = null,
  version = 'v2',
  includeMeta = false,
  credit = '',
} = {}) {
  const normalized = normalizeBakeOptions(opts);

  // Start by stripping "native" bg.
  const cleanedText = stripSvgBackground(srcSvgText);

  let doc = null;
  try {
    doc = new DOMParser().parseFromString(String(cleanedText ?? ''), 'image/svg+xml');
  } catch (_) {
    return String(cleanedText ?? srcSvgText ?? '');
  }

  const svg = doc?.querySelector?.('svg');
  if (!svg) return String(cleanedText ?? srcSvgText ?? '');

  _ensureXmlns(svg);

  const vb = _computeViewBoxOrFallback(svg);

  // Wrap existing icon into a group so we can apply icon opacity without touching bg.
  const iconGroup = _wrapIconInGroup(doc, svg) ?? svg;

  // Recolor icon.
  _recolorSvgSubtree(iconGroup, { color: normalized.icon.color });

  // Insert background (if enabled) before applying strokes, so strokes can target bg separately.
  const bgResult = _insertBackground(doc, svg, (iconGroup === svg) ? null : iconGroup, vb, normalized.background);
  const fitSafe = normalized.background.fitIcon ? bgResult?.safe : null;

  // Icon placement: scale (and fit), then turn, mirror and shift, all around the icon's own center
  // (the viewBox center, or the shape's safe square when "fit icon" is on).
  // Only safe when icon is wrapped in its own group.
  if (iconGroup !== svg) {
    const sp = Number(normalized.icon.scalePct ?? 100);
    const s = (Number.isFinite(sp) && sp > 0) ? sp / 100 : 1;
    const { rotationDeg, offsetXPct, offsetYPct, flipH, flipV } = normalized.icon;
    const placed = rotationDeg !== 0 || offsetXPct !== 0 || offsetYPct !== 0 || flipH || flipV;
    if (fitSafe || s !== 1 || placed) {
      const minDim = Math.min(vb.width, vb.height);
      const cx = vb.minX + vb.width / 2;
      const cy = vb.minY + vb.height / 2;
      const k = fitSafe ? fitSafe.size / minDim : 1;
      const tx = (fitSafe ? fitSafe.cx : cx) + minDim * (offsetXPct / 100);
      const ty = (fitSafe ? fitSafe.cy : cy) + minDim * (offsetYPct / 100);
      const sx = k * s * (flipH ? -1 : 1);
      const sy = k * s * (flipV ? -1 : 1);
      const old = String(iconGroup.getAttribute('transform') ?? '').trim();
      const t = `translate(${tx} ${ty})${rotationDeg ? ` rotate(${rotationDeg})` : ''} scale(${sx} ${sy}) translate(${-cx} ${-cy})`;
      try {
        iconGroup.setAttribute('transform', old ? `${old} ${t}` : t);
      } catch (_) {
        // ignore
      }
    }
  }

  // Icon stroke.
  if (normalized.icon.stroke?.enabled) {
    const minDim = Math.min(vb.width, vb.height);
    const sw = minDim * (Number(normalized.icon.stroke.widthPct) / 100);
    _applyStrokeToSubtree(iconGroup, {
      color: normalized.icon.stroke.color,
      width: sw,
      opacity: normalized.icon.stroke.opacity,
    });
  }

  // Icon opacity.
  if (iconGroup !== svg) {
    try { iconGroup.setAttribute('opacity', String(_clamp01(normalized.icon.opacity))); } catch (_) { /* ignore */ }
  }

  if (includeMeta) {
    _injectBakeMetaToDoc(doc, svg, { srcPath, opts: normalized, version, credit });
  }

  try {
    return new XMLSerializer().serializeToString(svg);
  } catch (_) {
    return String(cleanedText ?? srcSvgText ?? '');
  }
}

/**
 * Fetch a source SVG as text.
 * @param {string} srcPath Data-relative path or URL.
 */
export async function fetchSvgText(srcPath) {
  const res = await fetch(toFetchUrl(srcPath));
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return await res.text();
}

/**
 * What an SVG on disk can be edited from: a baked file points back to its source and carries
 * the style it was made with; any other SVG is its own source.
 * @returns {Promise<{srcPath:string, opts:object|null}|null>} null when the file cannot be read.
 */
export async function resolveEditableSource(path) {
  const p = String(path ?? '').trim();
  if (!p.toLowerCase().endsWith('.svg')) return null;

  let text = '';
  try {
    text = await fetchSvgText(p);
  } catch (_) {
    return null;
  }

  const meta = extractBakeMeta(text);
  if (meta?.srcPath) return { srcPath: meta.srcPath, opts: meta.opts ?? null };
  return { srcPath: p, opts: null };
}

/**
 * Bake a styled SVG into the output folder (the module's "generated" folder by default).
 * The file name carries a hash of source + style, so the same style always lands on the same file.
 * @returns {Promise<string>} Data-relative path of the written file.
 */
export async function bakeSvgToGenerated({ srcPath, color = '#ffffff', opts = null, outputDir = null } = {}) {
  const src = String(srcPath ?? '').trim();
  if (!src) throw new Error('Missing srcPath');

  const normalized = normalizeBakeOptions(opts ?? { icon: { color } }, { fallbackColor: color });

  const dir = trimSlash(outputDir ?? getOutputDir());
  await ensureDirTree(dir);

  let svgText = '';
  try {
    svgText = await fetchSvgText(src);
  } catch (e) {
    throw new Error(`Failed to fetch SVG: ${e?.message ?? e}`);
  }

  const credit = await creditForPath(src);
  const baked = buildBakedSvgText(svgText, {
    srcPath: src, opts: normalized, version: 'v2', includeMeta: true, credit,
  });

  const base = _slugify(src.split('/').pop() ?? 'icon.svg');
  const hash = computeBakeHash({ srcPath: src, opts: normalized, version: 'v2' });
  const colorToken = normalizeHexColor(normalized.icon.color).slice(1);
  const fileName = `${base}__${colorToken}__${hash}.svg`;

  const file = new File([baked], fileName, { type: 'image/svg+xml' });

  const FP = getFilePickerImpl();
  if (!FP?.upload) throw new Error('FilePicker.upload is not available');

  try {
    const result = await FP.upload('data', dir, file, { overwrite: true });
    const destPath = String(result?.path ?? '').trim();
    return destPath || `${dir}/${fileName}`;
  } catch (e) {
    throw new Error(`Failed to upload baked SVG: ${e?.message ?? e}`);
  }
}
