// What a preset can hold, and how it is read from a style and put back on one. Pure logic: no DOM, no Foundry.
//
// A preset is a flat map of field id -> value. The id is the value's path in the bake options
// ('background.shape'), and the map holds only the fields it was saved with, so "just the shape of the
// background" needs no special case. A color may be a link to the faction color instead of a hex value.
// Files get passed around and edited by hand: everything read from one goes through sanitizeValues.

import { DIVISION_IDS, normalizeDivisionId } from './bg-division.mjs';
import { normalizeBgShapeId } from './bg-shapes.mjs';
import { normalizeBakeOptions, normalizeHexColor } from './svg-bake.mjs';

export const PRESET_FORMAT = 'iconic-preset';
export const PRESET_VERSION = 1;
export const PRESET_REMOVED_FORMAT = 'iconic-preset-removed';

const FACTION = '$faction';
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME = 80;
const FALLBACK_COLOR = '#ffffff';

const field = (id, kind, label) => ({ id, kind, label });

/** The blocks of the editor (a color of its own makes a block) with their fields, in display order. */
export const PRESET_GROUPS = [
  { id: 'icon', label: 'Icon', fields: [
    field('icon.color', 'color', 'Color'),
    field('icon.opacity', 'number', 'Opacity'),
    field('icon.scalePct', 'number', 'Size'),
  ] },
  { id: 'placement', label: 'Placement', fields: [
    field('icon.rotationDeg', 'number', 'Rotation'),
    field('icon.offsetXPct', 'number', 'ShiftX'),
    field('icon.offsetYPct', 'number', 'ShiftY'),
    field('icon.flipH', 'bool', 'FlipH'),
    field('icon.flipV', 'bool', 'FlipV'),
  ] },
  { id: 'iconStroke', label: 'IconStroke', fields: [
    field('icon.stroke.enabled', 'bool', 'Enabled'),
    field('icon.stroke.color', 'color', 'Color'),
    field('icon.stroke.widthPct', 'number', 'Width'),
    field('icon.stroke.opacity', 'number', 'Opacity'),
  ] },
  { id: 'background', label: 'Background', fields: [
    field('background.enabled', 'bool', 'Enabled'),
    field('background.color', 'color', 'Color'),
    field('background.opacity', 'number', 'Opacity'),
    field('background.shape', 'shape', 'Shape'),
    field('background.insetPct', 'number', 'Inset'),
    field('background.radiusPct', 'number', 'Radius'),
    field('background.fitIcon', 'bool', 'FitIcon'),
  ] },
  { id: 'division', label: 'Division', fields: [
    field('background.division.type', 'division', 'Pattern'),
    field('background.division.color', 'color', 'Color'),
  ] },
  { id: 'bgStroke', label: 'BgStroke', fields: [
    field('background.stroke.enabled', 'bool', 'Enabled'),
    field('background.stroke.color', 'color', 'Color'),
    field('background.stroke.widthPct', 'number', 'Width'),
    field('background.stroke.opacity', 'number', 'Opacity'),
  ] },
  { id: 'contour2', label: 'Contour2', fields: [
    field('background.contour2.enabled', 'bool', 'Enabled'),
    field('background.contour2.color', 'color', 'Color'),
    field('background.contour2.widthPct', 'number', 'Width'),
    field('background.contour2.gapPct', 'number', 'Gap'),
  ] },
];

export const PRESET_FIELDS = PRESET_GROUPS.flatMap((group) => group.fields);
export const PRESET_FIELD_IDS = PRESET_FIELDS.map((f) => f.id);

function _get(obj, id) {
  return id.split('.').reduce((node, key) => node?.[key], obj);
}

function _set(obj, id, value) {
  const keys = id.split('.');
  const last = keys.pop();
  const parent = keys.reduce((node, key) => (node[key] ??= {}), obj);
  parent[last] = value;
}

/** A number within its field's range: the bake options know the ranges, so it goes through them. */
function _clampNumber(id, value) {
  // Without `fitIcon` the options count as legacy data and drop the corner radius.
  const probe = { background: { fitIcon: true } };
  _set(probe, id, value);
  return _get(normalizeBakeOptions(probe), id);
}

/** A known id, written the way it is stored; an alias or anything else does not count. */
function _exactId(raw, normalize) {
  const id = normalize(raw);
  return typeof raw === 'string' && id === raw ? id : undefined;
}

/** The clean form of a value of a field; undefined when it cannot be one. */
function _cleanValue({ id, kind }, raw) {
  switch (kind) {
    case 'color':
      if (isFactionRef(raw)) return factionRef(raw.fallback);
      return typeof raw === 'string' ? normalizeHexColor(raw, '') || undefined : undefined;
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? _clampNumber(id, raw) : undefined;
    case 'bool':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'shape':
      return _exactId(raw, normalizeBgShapeId);
    case 'division':
      return DIVISION_IDS.includes(raw) ? _exactId(raw, normalizeDivisionId) : undefined;
    default:
      return undefined;
  }
}

export function isFactionRef(value) {
  return Boolean(value) && typeof value === 'object' && value[FACTION] === true;
}

/** "The faction color"; `fallback` is the color used where there is no faction. */
export function factionRef(fallback) {
  return { [FACTION]: true, fallback: normalizeHexColor(fallback, FALLBACK_COLOR) };
}

/** Keeps the known fields with a valid value, in display order; anything else is dropped. */
export function sanitizeValues(raw) {
  const values = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return values;
  for (const f of PRESET_FIELDS) {
    if (!Object.hasOwn(raw, f.id)) continue;
    const value = _cleanValue(f, raw[f.id]);
    if (value !== undefined) values[f.id] = value;
  }
  return values;
}

/**
 * The chosen fields of a style as preset values.
 * @param {object} style bake options
 * @param {string[]} fieldIds fields to take
 * @param {string[]} [factionIds] color fields to store as a link to the faction color
 */
export function collectValues(style, fieldIds, factionIds = []) {
  const opts = normalizeBakeOptions(style);
  const chosen = new Set(fieldIds);
  const linked = new Set(factionIds);
  const values = {};
  for (const { id, kind } of PRESET_FIELDS) {
    if (!chosen.has(id)) continue;
    const value = _get(opts, id);
    values[id] = kind === 'color' && linked.has(id) ? factionRef(value) : value;
  }
  return values;
}

/**
 * A style with preset values put on it; whatever they do not name stays as it is.
 * @param {object} style bake options
 * @param {object} values preset values
 * @param {object} [options]
 * @param {string[]} [options.skip] fields to leave out
 * @param {string|null} [options.factionColor] what a link to the faction color means here
 */
export function applyValues(style, values, { skip = [], factionColor = null } = {}) {
  const out = normalizeBakeOptions(style);
  const skipped = new Set(skip);
  const faction = normalizeHexColor(factionColor, '');
  for (const { id } of PRESET_FIELDS) {
    if (skipped.has(id) || !Object.hasOwn(values, id)) continue;
    const value = values[id];
    _set(out, id, isFactionRef(value) ? faction || value.fallback : value);
  }
  return normalizeBakeOptions(out, { fallbackColor: out.icon.color });
}

/** Two styles with the same signature look the same and hold the same settings. */
export function styleSig(style) {
  return JSON.stringify(normalizeBakeOptions(style));
}

/** Fields by block, for telling what a set of fields is: [{ group, fields, whole }]. */
export function groupFields(fieldIds) {
  const ids = new Set(fieldIds);
  return PRESET_GROUPS.flatMap((group) => {
    const fields = group.fields.filter((f) => ids.has(f.id));
    return fields.length ? [{ group, fields, whole: fields.length === group.fields.length }] : [];
  });
}

export function cleanPresetName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/** The content of a preset file. */
export function buildPreset({ id, name, created, values }) {
  return {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    id,
    name: cleanPresetName(name),
    created,
    values,
  };
}

/**
 * Reads the content of a preset file.
 * @returns {{id: string, name: string, created: number, values: object}|null} null if it is not a preset
 *   this version can read, or holds nothing usable
 */
export function parsePreset(raw) {
  if (!raw || typeof raw !== 'object' || raw.format !== PRESET_FORMAT) return null;
  if (!Number.isInteger(raw.version) || raw.version < 1 || raw.version > PRESET_VERSION) return null;
  if (typeof raw.id !== 'string' || !SAFE_ID.test(raw.id)) return null;

  const values = sanitizeValues(raw.values);
  if (!Object.keys(values).length) return null;

  const created = Number(raw.created);
  return {
    id: raw.id,
    name: cleanPresetName(raw.name) || raw.id,
    created: Number.isFinite(created) ? created : 0,
    values,
  };
}

/** Is this an id that can safely become a file name? */
export function isSafePresetId(id) {
  return typeof id === 'string' && SAFE_ID.test(id);
}

/** Latin letters and digits of the name, then the id that makes the file name unique. */
export function presetFileName(name, id) {
  const slug = String(name ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${slug || 'preset'}-${id}.json`;
}

/** The library as shown: nothing removed, each id once, newest first. */
export function visiblePresets(presets, removedIds) {
  const hidden = new Set(removedIds);
  const seen = new Set();
  return presets
    .filter((p) => !hidden.has(p.id) && !seen.has(p.id) && seen.add(p.id))
    .sort((a, b) => b.created - a.created || a.name.localeCompare(b.name));
}
