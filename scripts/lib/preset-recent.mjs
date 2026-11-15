// The strip of recently used styles: a per-user cache, not the library. Pure logic: no DOM, no Foundry.
//
// An entry is a preset that was used, possibly only in part (`skip` names the fields it holds but leaves
// out), a snapshot of the settings a change of preset replaced, or the style of an icon that was saved.

import {
  PRESET_FIELD_IDS,
  PRESET_GROUPS,
  applyValues,
  cleanPresetName,
  collectValues,
  isSafePresetId,
  sanitizeValues,
  styleSig,
} from './preset-schema.mjs';

/** How many styles the strip keeps. */
export const RECENT_LIMIT = 6;

const KINDS = ['preset', 'snapshot', 'icon'];

/** What carries over to another icon: where an icon sits belongs to that icon alone. */
const STYLE_FIELD_IDS = PRESET_GROUPS
  .filter((group) => group.id !== 'placement')
  .flatMap((group) => group.fields.map((f) => f.id));

function _hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** The same content gives the same key, whatever the entry is called. */
export function entryKey(values, skip = []) {
  return _hash(JSON.stringify([values, skip]));
}

/** A clean entry; null when there is nothing left of it to apply. */
export function makeEntry({ kind = 'preset', presetId = null, name = '', values, skip = [], at = 0 }) {
  const clean = sanitizeValues(values);
  const left = new Set(Array.isArray(skip) ? skip : []);
  const skipped = PRESET_FIELD_IDS.filter((id) => left.has(id) && Object.hasOwn(clean, id));
  if (Object.keys(clean).length === skipped.length) return null;

  const type = KINDS.includes(kind) ? kind : 'preset';
  return {
    key: entryKey(clean, skipped),
    kind: type,
    presetId: type === 'preset' && isSafePresetId(presetId) ? presetId : null,
    name: type === 'snapshot' ? '' : cleanPresetName(name),
    values: clean,
    skip: skipped,
    at: Number.isFinite(at) ? at : 0,
  };
}

/** The whole of a style as an entry. */
export function snapshotEntry(style, at) {
  return makeEntry({ kind: 'snapshot', values: collectValues(style, PRESET_FIELD_IDS), at });
}

/** Puts an entry first: no two with the same content, and a named preset is not lost to a snapshot of it. */
export function pushEntry(list, entry, limit = RECENT_LIMIT) {
  const same = list.find((e) => e.key === entry.key);
  const kept = same?.kind === 'preset' && entry.kind === 'snapshot' ? { ...same, at: entry.at } : entry;
  return [kept, ...list.filter((e) => e.key !== entry.key)].slice(0, limit);
}

/** The strip as stored, trusting nothing about it. */
export function sanitizeRecent(raw) {
  if (!Array.isArray(raw)) return [];
  const list = [];
  for (const item of raw) {
    const entry = item && typeof item === 'object' ? makeEntry(item) : null;
    if (entry && !list.some((e) => e.key === entry.key)) list.push(entry);
  }
  return list.slice(0, RECENT_LIMIT);
}

/** What the entry makes of a style. */
export function entryResult(entry, style, factionColor = null) {
  return applyValues(style, entry.values, { skip: entry.skip, factionColor });
}

/** Does the style already show everything the entry would apply? */
export function isEntryActive(entry, style, factionColor = null) {
  return styleSig(entryResult(entry, style, factionColor)) === styleSig(style);
}

/**
 * What using an entry does. The settings it replaces go to the strip too, unless they are what the last
 * applied entry left, untouched: those can already be had again from the strip.
 * @param {object} input
 * @param {object} input.style the current style
 * @param {object} input.entry the entry to use
 * @param {object[]} input.recent the strip
 * @param {string|null} input.lastSig signature of the style right after the last entry was applied
 * @param {string|null} [input.factionColor]
 * @param {number} input.at the time
 * @returns {{merged: object, changed: boolean, recent: object[]}}
 */
export function planApply({ style, entry, recent, lastSig, factionColor = null, at }) {
  const merged = entryResult(entry, style, factionColor);
  const before = styleSig(style);
  const changed = styleSig(merged) !== before;

  let next = recent;
  if (changed && before !== lastSig) next = pushEntry(next, snapshotEntry(style, at));
  return { merged, changed, recent: pushEntry(next, { ...entry, at }) };
}

/** Does the entry bring back all of this style, whatever it is used on? */
function _holdsStyle(entry, style, factionColor) {
  if (!STYLE_FIELD_IDS.every((id) => Object.hasOwn(entry.values, id) && !entry.skip.includes(id))) return false;
  const given = collectValues(entryResult(entry, style, factionColor), STYLE_FIELD_IDS);
  return JSON.stringify(given) === JSON.stringify(collectValues(style, STYLE_FIELD_IDS));
}

/**
 * An icon was saved: its style goes first in the strip, for the next icon. A style the strip already holds
 * moves up as it is, under its own name.
 * @param {object} input
 * @param {object[]} input.recent the strip
 * @param {object} input.style the style of the saved icon
 * @param {string} input.name the icon, as the strip should call it
 * @param {string|null} [input.factionColor]
 * @param {number} input.at the time
 * @returns {object[]} the new strip
 */
export function rememberIconStyle({ recent, style, name, factionColor = null, at }) {
  const held = recent.find((entry) => _holdsStyle(entry, style, factionColor));
  const entry = held ?? makeEntry({ kind: 'icon', name, values: collectValues(style, STYLE_FIELD_IDS) });
  return pushEntry(recent, { ...entry, at });
}
