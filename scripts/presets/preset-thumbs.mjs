// Small pictures of a style: the current icon baked with it, so a preset shows what it would do to this icon.

import { buildBakedSvgText } from '../lib/svg-bake.mjs';
import { styleSig } from '../lib/preset-schema.mjs';

const MAX_CACHED = 300;

/** Stands in for the icon while none is chosen. */
const PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">'
  + '<path fill="#fff" d="M256 48l61 141 153 14-116 101 35 150-133-79-133 79 35-150L42 203l153-14z"/></svg>';

export class PresetThumbs {
  constructor() {
    this._svg = PLACEHOLDER_SVG;
    this._cache = new Map();
  }

  /** @returns {boolean} whether the source changed, and pictures made so far are out of date */
  setSource(svgText) {
    const next = String(svgText ?? '') || PLACEHOLDER_SVG;
    if (next === this._svg) return false;
    this._svg = next;
    this._cache.clear();
    return true;
  }

  /** Data URI of the source baked with a style. */
  uriFor(style) {
    const key = styleSig(style);
    let uri = this._cache.get(key);
    if (uri === undefined) {
      const svg = buildBakedSvgText(this._svg, { opts: style, includeMeta: false });
      uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      if (this._cache.size >= MAX_CACHED) this._cache.delete(this._cache.keys().next().value);
      this._cache.set(key, uri);
    }
    return uri;
  }
}
