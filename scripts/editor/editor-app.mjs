// Iconic editor window (Foundry v13+, ApplicationV2): choose an SVG, style it, preview it.
// It only collects the choice; baking and applying are done by api.mjs.

import { buildBakedSvgText, normalizeBakeOptions, resolveEditableSource } from '../lib/svg-bake.mjs';
import { IconBrowser } from '../browser/browser-app.mjs';
import { toFetchUrl } from '../lib/storage.mjs';
import {
  BG_SHAPE_GROUPS,
  bgShapeHasRadius,
  listBgShapes,
  normalizeBgShapeId,
} from '../lib/bg-shapes.mjs';
import { DIVISION_IDS, normalizeDivisionId } from '../lib/bg-division.mjs';
import { checkContrast } from '../lib/color.mjs';
import { factionColorsSupported } from '../lib/color-hints.mjs';
import { PresetController } from '../presets/preset-controller.mjs';
import { renderContrastHint } from './contrast-hint.mjs';

const TEMPLATE = 'modules/iconic/templates/editor.hbs';

/** Everything fits this size without scrolling; styles/iconic.css keeps it as the window's minimum. */
const WINDOW_WIDTH = 1120;
const WINDOW_HEIGHT = 540;

/** Where the icon sits on its own: not turned, not shifted, not mirrored. */
const PLACEMENT_DEFAULTS = { rotationDeg: 0, offsetXPct: 0, offsetYPct: 0, flipH: false, flipV: false };

// Controls by data-action. A color is a picker plus a hex field ("<action>" and "<action>-hex").
const COLOR_FIELDS = {
  color: '_color',
  'bg-color': '_bgColor',
  'bg-division-color': '_bgDivisionColor',
  'bg-stroke-color': '_bgStrokeColor',
  'bg-contour2-color': '_bgContour2Color',
  'icon-stroke-color': '_iconStrokeColor',
};
const CHECK_FIELDS = {
  'bg-enabled': '_bgEnabled',
  'bg-fit-icon': '_bgFitIcon',
  'bg-stroke-enabled': '_bgStrokeEnabled',
  'bg-contour2-enabled': '_bgContour2Enabled',
  'icon-stroke-enabled': '_iconStrokeEnabled',
};
/** action -> [field, min, max]. A slider and its number box are "<action>" and "<action>-number". */
const NUMBER_FIELDS = {
  'icon-scale': ['_iconScalePct', 25, 200],
  'icon-rotation': ['_iconRotationDeg', -180, 180],
  'bg-inset': ['_bgInsetPct', 0, 49],
  'bg-radius': ['_bgRadiusPct', 0, 50],
  'bg-stroke-width': ['_bgStrokeWidthPct', 0, 50],
  'bg-contour2-width': ['_bgContour2WidthPct', 0, 25],
  'bg-contour2-gap': ['_bgContour2GapPct', 0, 25],
  'icon-stroke-width': ['_iconStrokeWidthPct', 0, 50],
  'icon-offset-x': ['_iconOffsetXPct', -50, 50],
  'icon-offset-y': ['_iconOffsetYPct', -50, 50],
};
/** Percent sliders stored as 0..1. */
const OPACITY_FIELDS = {
  'bg-opacity': '_bgOpacity',
  'bg-stroke-opacity': '_bgStrokeOpacity',
  'icon-stroke-opacity': '_iconStrokeOpacity',
  'icon-opacity': '_iconOpacity',
};
function _T(key, data) {
  try { return data ? game.i18n.format(key, data) : game.i18n.localize(key); } catch (_) { return key; }
}

function _L(key) {
  try { return game.i18n.localize(key); } catch (_) { return key; }
}

/** 'shield-heater' -> 'ShieldHeater', 'bend-sinister' -> 'BendSinister' (lang key under Background.Shapes / Divisions). */
function _pascalKey(id) {
  return String(id).split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

function _trim(s) {
  return String(s ?? '').trim();
}

function _normalizeColor(raw, fallback = '#ffffff') {
  const s = _trim(raw);
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  const m3 = s.match(/^#([0-9a-fA-F]{3})$/);
  if (m3) {
    const h = m3[1];
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase();
  }
  return fallback;
}

function _clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

function _pct01FromInt(pct) {
  const p = _clamp(pct, 0, 100);
  return p / 100;
}

function _intFromPct01(x) {
  const n = _clamp(Number(x) * 100, 0, 100);
  return Math.round(n);
}

function _invertHex(hex) {
  const h = _normalizeColor(hex, '#000000');
  const r = 255 - parseInt(h.slice(1, 3), 16);
  const g = 255 - parseInt(h.slice(3, 5), 16);
  const b = 255 - parseInt(h.slice(5, 7), 16);
  const to2 = (v) => v.toString(16).padStart(2, '0');
  return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function _isSvgPath(path) {
  const p = String(path ?? '').trim().toLowerCase();
  return p.endsWith('.svg');
}

export class IconicEditor extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    ...super.DEFAULT_OPTIONS,
    id: 'iconic-editor',
    classes: ['iconic', 'iconic-editor-window'],
    tag: 'div',
    window: { title: 'ICONIC.Editor.Title', icon: 'fa-solid fa-icons', resizable: true },
    position: { width: WINDOW_WIDTH, height: WINDOW_HEIGHT },
  };

  // Not `root: true`: Foundry would drop the template's outer element (and the .iconic-editor
  // class its layout hangs on) and pour only its children into the window.
  static PARTS = {
    main: { template: TEMPLATE },
  };

  /**
   * @param {object} [options]
   * @param {Array<{id:string, label:string}>} [options.targets] Where the result can be applied
   *   (shown as a select when there is more than one); the chosen id comes back in the selection.
   * @param {string} [options.target] Initially selected target id.
   */
  constructor({
    title = null,
    defaultColor = '#ffffff',
    factionColor = null,
    factionName = null,
    initialPath = null,
    initialOpts = null,
    startDir = '',
    autoOpenBrowser = false,
    targets = [],
    target = null,
  } = {}) {
    super();

    this._titleOverride = _trim(title) || null;

    this._targets = Array.isArray(targets) ? targets : [];
    this._target = this._targets.some((t) => t.id === target) ? target : (this._targets[0]?.id ?? null);

    this._startDir = String(startDir ?? '').trim();
    this._autoOpenBrowser = Boolean(autoOpenBrowser);
    this._didAutoOpen = false;

    this._srcPath = String(initialPath ?? '').trim();

    // Styling options (persisted)
    this._prefsKey = 'iconic.editor.prefs.v1';

    // Optional faction color (used by quick buttons)
    this._factionColor = _normalizeColor(factionColor, '');
    this._factionName = _trim(factionName);

    // Icon color is still the primary control.
    this._color = _normalizeColor(defaultColor);

    // Defaults (will be overridden by persisted prefs if present)
    this._iconOpacity = 1;
    this._iconScalePct = 100;
    this._iconStrokeEnabled = false;
    this._iconStrokeColor = '#000000';
    this._iconStrokeWidthPct = 4;
    this._iconStrokeOpacity = 1;
    this._iconRotationDeg = 0;
    this._iconOffsetXPct = 0;
    this._iconOffsetYPct = 0;
    this._iconFlipH = false;
    this._iconFlipV = false;

    this._bgEnabled = false;
    this._bgColor = '#000000';
    this._bgShape = 'square';
    this._bgOpacity = 1;
    this._bgInsetPct = 0;
    this._bgRadiusPct = 0;
    this._bgFitIcon = true;
    this._bgDivision = 'none';
    this._bgDivisionColor = '#d4af37';
    this._bgContour2Enabled = false;
    this._bgContour2Color = '#ffffff';
    this._bgContour2WidthPct = 2;
    this._bgContour2GapPct = 2;

    this._bgStrokeEnabled = false;
    this._bgStrokeColor = '#ffffff';
    this._bgStrokeWidthPct = 2;
    this._bgStrokeOpacity = 1;

    this._loadPrefs();

    // If the caller provided initial opts (or we resolved them from baked meta), prefer them.
    if (initialOpts && typeof initialOpts === 'object') {
      this._applyOpts(initialOpts);
    }

    this._resolve = null;

    // Preview caching
    this._previewToken = 0;
    this._cachedPreviewSrc = '';
    this._cachedSvgText = '';

    this._presets = new PresetController(this);

    this._onRootClick = this._onRootClick.bind(this);
    this._onRootInput = this._onRootInput.bind(this);
  }

  get title() {
    return this._titleOverride || _L('ICONIC.Editor.Title');
  }

  static async wait(options = {}) {
    return await new Promise((resolve) => {
      const app = new IconicEditor(options);
      app._resolve = resolve;
      app.render(true);
    });
  }

  async close(options = {}) {
    await super.close(options);
    this._presets.close();

    // If closed without explicit resolve, resolve null.
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      resolve(null);
    }
  }

  async _prepareContext(_options) {
    const srcPath = String(this._srcPath ?? '').trim();
    const fileName = srcPath ? (srcPath.split('/').pop() ?? srcPath) : '';

    return {
      srcPath,
      fileName,
      hasSrc: !!srcPath,
      previewUrl: toFetchUrl(srcPath),

      color: this._color,

      hasFactionColor: !!this._factionColor,
      factionTooltip: this._factionTooltip(),

      // Where the result goes (only offered when there is a choice)
      hasTargets: this._targets.length > 1,
      targets: this._targets.map((t) => ({ id: t.id, label: t.label, selected: t.id === this._target })),

      // Background
      bgEnabled: this._bgEnabled,
      bgColor: this._bgColor,
      bgShapeGroups: this._buildShapeGroups(),
      bgOpacityPct: _intFromPct01(this._bgOpacity),
      bgInsetPct: this._bgInsetPct,
      bgRadiusPct: this._bgRadiusPct,
      bgFitIcon: this._bgFitIcon,
      bgDivisions: this._buildDivisions(),
      bgDivisionColor: this._bgDivisionColor,
      bgContour2Enabled: this._bgContour2Enabled,
      bgContour2Color: this._bgContour2Color,
      bgContour2WidthPct: this._bgContour2WidthPct,
      bgContour2GapPct: this._bgContour2GapPct,

      bgStrokeEnabled: this._bgStrokeEnabled,
      bgStrokeColor: this._bgStrokeColor,
      bgStrokeWidthPct: this._bgStrokeWidthPct,
      bgStrokeOpacityPct: _intFromPct01(this._bgStrokeOpacity),

      // Icon
      iconOpacityPct: _intFromPct01(this._iconOpacity),
      iconScalePct: this._iconScalePct,
      iconStrokeEnabled: this._iconStrokeEnabled,
      iconStrokeColor: this._iconStrokeColor,
      iconStrokeWidthPct: this._iconStrokeWidthPct,
      iconStrokeOpacityPct: _intFromPct01(this._iconStrokeOpacity),
      iconRotationDeg: this._iconRotationDeg,
      iconOffsetXPct: this._iconOffsetXPct,
      iconOffsetYPct: this._iconOffsetYPct,
      iconFlipH: this._iconFlipH,
      iconFlipV: this._iconFlipV,

      canConfirm: !!srcPath,
    };
  }

  /** What the faction color buttons say: the faction, or why there is no color to take. */
  _factionTooltip() {
    const { color, name, supported } = this.factionInfo;
    if (!color) return _L(`ICONIC.Editor.Tooltips.${supported ? 'NoFaction' : 'FactionUnsupported'}`);
    const label = _L('ICONIC.Editor.Tooltips.UseFactionColor');
    return name ? `${label}: ${name}` : label;
  }

  /** Shape <select> data: [{ label, shapes: [{ id, label, selected }] }] in display order. */
  _buildShapeGroups() {
    const groupLabels = {
      basic: _L('ICONIC.Editor.Background.Groups.Basic'),
      hex: _L('ICONIC.Editor.Background.Groups.Hex'),
      shield: _L('ICONIC.Editor.Background.Groups.Shield'),
    };
    const current = normalizeBgShapeId(this._bgShape);
    const shapes = listBgShapes();

    return BG_SHAPE_GROUPS.map((group) => ({
      label: groupLabels[group] ?? group,
      shapes: shapes
        .filter((s) => s.group === group)
        .map((s) => ({
          id: s.id,
          label: _L(`ICONIC.Editor.Background.Shapes.${_pascalKey(s.id)}`),
          selected: s.id === current,
        })),
    }));
  }

  /** Division <select> data: [{ id, label, selected }]. */
  _buildDivisions() {
    const current = normalizeDivisionId(this._bgDivision);
    return DIVISION_IDS.map((id) => ({
      id,
      label: _L(`ICONIC.Editor.Background.Divisions.${_pascalKey(id)}`),
      selected: id === current,
    }));
  }

  async _onRender(context, options) {
    await super._onRender(context, options);

    const el = this.element;
    if (!el) return;

    const root = el.querySelector('.iconic-editor') || el;

    if (root.dataset?.iconicHandlers !== 'true') {
      root.dataset.iconicHandlers = 'true';
      root.addEventListener('click', this._onRootClick);
      root.addEventListener('input', this._onRootInput);
      root.addEventListener('change', this._onRootInput);
    }

    // Presets fill their own slot; a render replaces it, so it is filled again every time.
    this._presets.mount(root.querySelector('[data-role="preset-strip"]'));

    // Sync preview (mask hydration + current color)
    this._syncPreview(root);

    // Optionally open the icon browser on first render (nothing chosen yet).
    if (this._autoOpenBrowser && !this._didAutoOpen && !this._srcPath) {
      this._didAutoOpen = true;
      setTimeout(() => this._openBrowser(), 0);
    }
  }

  _encodeSvgDataUri(svgText) {
    const s = String(svgText ?? '');
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
  }

  /** The style as it is set, switched-off parts included (a bake leaves those out, see _getBakeOpts). */
  getStyleOpts() {
    return normalizeBakeOptions({
      icon: {
        color: this._color,
        opacity: this._iconOpacity,
        scalePct: this._iconScalePct,
        rotationDeg: this._iconRotationDeg,
        offsetXPct: this._iconOffsetXPct,
        offsetYPct: this._iconOffsetYPct,
        flipH: this._iconFlipH,
        flipV: this._iconFlipV,
        stroke: {
          enabled: this._iconStrokeEnabled,
          color: this._iconStrokeColor,
          widthPct: this._iconStrokeWidthPct,
          opacity: this._iconStrokeOpacity,
        },
      },
      background: {
        enabled: this._bgEnabled,
        shape: this._bgShape,
        color: this._bgColor,
        opacity: this._bgOpacity,
        insetPct: this._bgInsetPct,
        radiusPct: this._bgRadiusPct,
        fitIcon: this._bgFitIcon,
        division: { type: this._bgDivision, color: this._bgDivisionColor },
        contour2: {
          enabled: this._bgContour2Enabled,
          color: this._bgContour2Color,
          widthPct: this._bgContour2WidthPct,
          gapPct: this._bgContour2GapPct,
        },
        stroke: {
          enabled: this._bgStrokeEnabled,
          color: this._bgStrokeColor,
          widthPct: this._bgStrokeWidthPct,
          opacity: this._bgStrokeOpacity,
        },
      },
    }, { fallbackColor: this._color });
  }

  _getBakeOpts() {
    const opts = this.getStyleOpts();
    // Nothing outlines a background that is not there.
    opts.background.contour2.enabled &&= opts.background.enabled;
    opts.background.stroke.enabled &&= opts.background.enabled;
    return opts;
  }

  /** Takes a complete style, in the form getStyleOpts returns it; stores it and draws the window again. */
  applyStyleOpts(opts) {
    this._applyOpts(opts);
    this._savePrefs();
    this.render(false);
  }

  /** The faction color on offer here, and whether this game can have one at all. */
  get factionInfo() {
    return {
      color: this._factionColor || null,
      name: this._factionName || null,
      supported: factionColorsSupported(),
    };
  }

  /** The text of the chosen source SVG; '' when none is chosen or it cannot be read. */
  getSourceSvgText() {
    return this._ensureCachedSvgText(toFetchUrl(this._srcPath));
  }

  _applyOpts(raw) {
    try {
      const opts = normalizeBakeOptions(raw);

      this._color = _normalizeColor(opts.icon.color, this._color);
      this._iconOpacity = _clamp(opts.icon.opacity ?? 1, 0, 1);
      this._iconScalePct = _clamp(opts.icon.scalePct ?? 100, 25, 200);
      this._iconRotationDeg = opts.icon.rotationDeg;
      this._iconOffsetXPct = opts.icon.offsetXPct;
      this._iconOffsetYPct = opts.icon.offsetYPct;
      this._iconFlipH = opts.icon.flipH;
      this._iconFlipV = opts.icon.flipV;
      this._iconStrokeEnabled = Boolean(opts.icon.stroke?.enabled);
      this._iconStrokeColor = _normalizeColor(opts.icon.stroke?.color, this._iconStrokeColor);
      this._iconStrokeWidthPct = _clamp(opts.icon.stroke?.widthPct ?? 4, 0, 50);
      this._iconStrokeOpacity = _clamp(opts.icon.stroke?.opacity ?? 1, 0, 1);

      this._bgEnabled = Boolean(opts.background.enabled);
      this._bgColor = _normalizeColor(opts.background.color, this._bgColor);
      this._bgShape = String(opts.background.shape ?? this._bgShape);
      this._bgOpacity = _clamp(opts.background.opacity ?? 1, 0, 1);
      this._bgInsetPct = _clamp(opts.background.insetPct ?? 0, 0, 49);
      this._bgRadiusPct = _clamp(opts.background.radiusPct ?? 0, 0, 50);
      this._bgFitIcon = Boolean(opts.background.fitIcon);
      this._bgDivision = opts.background.division.type;
      this._bgDivisionColor = opts.background.division.color;
      this._bgContour2Enabled = opts.background.contour2.enabled;
      this._bgContour2Color = opts.background.contour2.color;
      this._bgContour2WidthPct = opts.background.contour2.widthPct;
      this._bgContour2GapPct = opts.background.contour2.gapPct;

      this._bgStrokeEnabled = Boolean(opts.background.stroke?.enabled);
      this._bgStrokeColor = _normalizeColor(opts.background.stroke?.color, this._bgStrokeColor);
      this._bgStrokeWidthPct = _clamp(opts.background.stroke?.widthPct ?? 2, 0, 50);
      this._bgStrokeOpacity = _clamp(opts.background.stroke?.opacity ?? 1, 0, 1);
    } catch (_) {
      // ignore
    }
  }

  /** Back to an upright, centered, unmirrored icon. */
  _resetPlacement() {
    this._iconRotationDeg = PLACEMENT_DEFAULTS.rotationDeg;
    this._iconOffsetXPct = PLACEMENT_DEFAULTS.offsetXPct;
    this._iconOffsetYPct = PLACEMENT_DEFAULTS.offsetYPct;
    this._iconFlipH = PLACEMENT_DEFAULTS.flipH;
    this._iconFlipV = PLACEMENT_DEFAULTS.flipV;
  }

  _loadPrefs() {
    try {
      const raw = globalThis?.localStorage?.getItem?.(this._prefsKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      this._applyOpts(parsed?.opts ?? parsed);
    } catch (_) {
      // ignore
    }
  }

  _savePrefs() {
    try {
      // The style carries over to the next icon; where this one sits does not.
      const opts = this.getStyleOpts();
      Object.assign(opts.icon, PLACEMENT_DEFAULTS);
      globalThis?.localStorage?.setItem?.(this._prefsKey, JSON.stringify({ opts }));
    } catch (_) {
      // ignore
    }
  }

  async _ensureCachedSvgText(src) {
    const s = String(src ?? '').trim();
    if (!s) return '';
    if (this._cachedPreviewSrc === s && this._cachedSvgText) return this._cachedSvgText;

    let svgText = '';
    try {
      const res = await fetch(s);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      svgText = await res.text();
    } catch (_) {
      this._cachedPreviewSrc = s;
      this._cachedSvgText = '';
      return '';
    }

    this._cachedPreviewSrc = s;
    this._cachedSvgText = String(svgText ?? '');
    return this._cachedSvgText;
  }

  async _hydratePreviewThumb(thumb, src) {
    const token = ++this._previewToken;
    if (!thumb) return;

    const img = thumb.querySelector('[data-role="preview-img"]');
    if (!img) return;

    thumb.dataset.shPreviewReady = 'pending';
    thumb.dataset.shPreviewFailed = 'false';

    const svgText = await this._ensureCachedSvgText(src);
    if (token !== this._previewToken) return;

    if (!svgText) {
      thumb.dataset.shPreviewFailed = 'true';
      thumb.dataset.shPreviewReady = 'false';
      // Fallback: show original file.
      try { img.src = String(src ?? ''); } catch (_) { /* ignore */ }
      return;
    }

    const bakedPreview = buildBakedSvgText(svgText, { opts: this._getBakeOpts(), includeMeta: false });
    const uri = this._encodeSvgDataUri(bakedPreview);

    try {
      img.src = uri;
    } catch (_) {
      // ignore
    }

    thumb.dataset.shPreviewReady = 'true';
    thumb.dataset.shPreviewFailed = 'false';
  }

  /** Shows or hides the low-contrast warning with its color suggestions. */
  _syncContrastHint(root) {
    const box = root.querySelector('[data-role="contrast-hint"]');
    if (!box) return;
    const divided = normalizeDivisionId(this._bgDivision) !== 'none';
    const check = checkContrast({
      iconColor: this._color,
      background: {
        enabled: this._bgEnabled,
        color: this._bgColor,
        opacity: this._bgOpacity,
        divisionColor: divided ? this._bgDivisionColor : null,
      },
      iconStroke: {
        enabled: this._iconStrokeEnabled,
        color: this._iconStrokeColor,
        opacity: this._iconStrokeOpacity,
        widthPct: this._iconStrokeWidthPct,
      },
      hintColors: this._factionColor ? [this._factionColor] : [],
    });
    const html = renderContrastHint(check, _T);
    box.hidden = !html;
    box.innerHTML = html;
  }

  /** Dims what has no effect right now. Nothing is ever hidden, so no switch moves or resizes a block. */
  _syncMuted(root) {
    const setBlock = (id, { off = false, inactive = false }) => {
      const block = root.querySelector(`[data-block="${id}"]`);
      block?.classList.toggle('is-off', off);
      block?.classList.toggle('is-inactive', inactive);
    };
    const noBackground = !this._bgEnabled;
    setBlock('icon-stroke', { off: !this._iconStrokeEnabled });
    setBlock('background', { off: noBackground });
    setBlock('division', { inactive: noBackground });
    setBlock('bg-stroke', { off: !this._bgStrokeEnabled, inactive: noBackground });
    setBlock('bg-contour2', { off: !this._bgContour2Enabled, inactive: noBackground });

    const undivided = normalizeDivisionId(this._bgDivision) === 'none';
    root.querySelector('[data-role="division-color"]')?.classList.toggle('is-muted', undivided);

    // A shape without corners has nothing to round: there the radius cannot be set at all.
    const hasRadius = bgShapeHasRadius(this._bgShape);
    const radius = root.querySelector('[data-role="bg-radius"]');
    radius?.classList.toggle('is-muted', !hasRadius);
    for (const input of radius?.querySelectorAll('input') ?? []) input.disabled = !hasRadius;
  }

  _syncPreview(root) {
    this._presets.onStyleChanged();
    this._syncMuted(root);
    this._syncContrastHint(root);
    const thumb = root.querySelector('[data-role="preview-thumb"]');
    if (!thumb) return;

    const src = String(thumb.dataset?.src ?? '').trim();
    if (!src) return;

    // Re-hydrate preview when source or options change.
    const sig = JSON.stringify(this._getBakeOpts());
    if (thumb.dataset?.shPreviewSrc !== src || thumb.dataset?.shPreviewSig !== sig) {
      thumb.dataset.shPreviewSrc = src;
      thumb.dataset.shPreviewSig = sig;
      thumb.dataset.shPreviewReady = 'false';
      thumb.dataset.shPreviewFailed = 'false';
      this._hydratePreviewThumb(thumb, src);
    }
  }

  /** Opens the icon browser and takes the chosen file as the source. */
  async _openBrowser() {
    const picked = await IconBrowser.wait({ startDir: this._srcPath || this._startDir });
    const next = String(picked?.path ?? '').trim();
    if (!next) return;

    // A previously baked icon opens as its source with the style it was made with, so it can
    // be tweaked instead of stacking a second background on top of the first.
    const resolved = await resolveEditableSource(next);
    this._srcPath = resolved?.srcPath || next;
    if (resolved?.opts) this._applyOpts(resolved.opts);
    else this._resetPlacement(); // a new icon starts upright and centered
    this.render(false);
  }

  async _confirmSelection() {
    const srcPath = String(this._srcPath ?? '').trim();
    if (!srcPath) return;

    if (!_isSvgPath(srcPath)) {
      ui.notifications?.warn?.(_L('ICONIC.Editor.Errors.OnlySvg'));
      return;
    }

    const payload = {
      srcPath,
      color: this._color,
      opts: this._getBakeOpts(),
      target: this._target,
    };

    this._savePrefs();
    this._presets.onIconSaved(srcPath);

    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      resolve(payload);
    }

    await this.close();
  }

  /** Stores and previews a change; every input handler ends here. */
  _commit(root) {
    this._savePrefs();
    this._syncPreview(root);
  }

  /** Sets a color field and keeps its picker and hex field in step. */
  _setColor(root, key, value) {
    const field = COLOR_FIELDS[key];
    this[field] = _normalizeColor(value, this[field]);
    const picker = root.querySelector(`input[type="color"][data-action="${key}"]`);
    const hex = root.querySelector(`input[data-action="${key}-hex"]`);
    if (picker) picker.value = this[field];
    if (hex) hex.value = this[field];
    this._commit(root);
  }

  /** Keeps a slider and its number box in step, whichever of the two moved. */
  _syncTwins(root, key, source, value) {
    for (const input of root.querySelectorAll(`input[data-action="${key}"], input[data-action="${key}-number"]`)) {
      if (input !== source) input.value = String(value);
    }
  }

  _onRootInput(ev) {
    const root = ev.currentTarget;

    const actionEl = ev.target?.closest?.('[data-action]');
    const action = String(actionEl?.dataset?.action ?? '').trim();
    if (!action) return;

    if (action === 'apply-target') {
      this._target = String(actionEl.value ?? '').trim() || this._target;
      return;
    }

    if (action === 'bg-shape' || action === 'bg-division') {
      const value = String(actionEl.value ?? '').trim();
      if (action === 'bg-shape') this._bgShape = value;
      else this._bgDivision = normalizeDivisionId(value);
      this._commit(root);
      return;
    }

    const colorKey = action.endsWith('-hex') ? action.slice(0, -4) : action;
    if (Object.hasOwn(COLOR_FIELDS, colorKey) && (colorKey !== action || actionEl.type === 'color')) {
      this._setColor(root, colorKey, actionEl.value);
      return;
    }

    if (Object.hasOwn(CHECK_FIELDS, action)) {
      this[CHECK_FIELDS[action]] = Boolean(actionEl.checked);
      this._commit(root);
      return;
    }

    const numberKey = action.replace(/-number$/, '');
    if (Object.hasOwn(NUMBER_FIELDS, numberKey)) {
      const [field, min, max] = NUMBER_FIELDS[numberKey];
      this[field] = _clamp(actionEl.value, min, max);
      this._syncTwins(root, numberKey, actionEl, this[field]);
      this._commit(root);
      return;
    }

    if (Object.hasOwn(OPACITY_FIELDS, numberKey)) {
      const field = OPACITY_FIELDS[numberKey];
      this[field] = _pct01FromInt(actionEl.value);
      this._syncTwins(root, numberKey, actionEl, _intFromPct01(this[field]));
      this._commit(root);
    }
  }

  async _onRootClick(ev) {
    const el = ev.target?.closest?.('[data-action]');
    if (!el) return;

    const action = String(el.dataset.action ?? '').trim();

    // Buttons (not the inputs that also carry a data-action).
    if (!(el instanceof HTMLButtonElement)) return;

    ev.preventDefault();
    ev.stopPropagation();

    const root = ev.currentTarget;

    switch (action) {
      case 'pick-file':
        this._openBrowser();
        return;

      case 'swap-colors': {
        const [icon, background] = [this._color, this._bgColor];
        this._setColor(root, 'color', background);
        this._setColor(root, 'bg-color', icon);
        return;
      }

      case 'set-faction-color':
        if (this._factionColor) this._setColor(root, el.dataset.colorKey, this._factionColor);
        return;

      case 'invert-color': {
        const key = el.dataset.colorKey;
        this._setColor(root, key, _invertHex(this[COLOR_FIELDS[key]]));
        return;
      }

      case 'hint-icon-color':
        this._setColor(root, 'color', el.dataset.color);
        return;

      case 'hint-bg-color':
        this._setColor(root, 'bg-color', el.dataset.color);
        return;

      case 'flip-h':
        this._iconFlipH = !this._iconFlipH;
        break;

      case 'flip-v':
        this._iconFlipV = !this._iconFlipV;
        break;

      case 'reset-placement':
        this._resetPlacement();
        break;

      case 'confirm':
        await this._confirmSelection();
        return;

      case 'cancel':
        await this.close();
        return;

      default:
        return;
    }

    // What falls through changed the placement: store it and draw the window again.
    this._savePrefs();
    this.render(false);
  }
}
