// What a style in the strip says about itself on hover. Pure logic: no DOM, no Foundry.
// The result is HTML and a preset's name comes from a file anyone can edit, so everything is escaped here.

import { PRESET_FIELD_IDS, groupFields, isFactionRef } from './preset-schema.mjs';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** One line per block: its name alone when it is all there, else the name and the fields. */
function _lines(fieldIds, values, t) {
  return groupFields(fieldIds).map(({ group, fields, whole }) => {
    const name = t(`ICONIC.Presets.Groups.${group.label}`);
    const linked = fields.some((f) => isFactionRef(values[f.id]));
    const parts = whole ? [] : fields.map((f) => t(`ICONIC.Presets.Fields.${f.label}`));
    const text = parts.length ? `${name}: ${parts.join(', ')}` : name;
    return linked ? `${text} (${t('ICONIC.Presets.Tooltip.Faction')})` : text;
  });
}

function _list(lines) {
  return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;
}

function _title(entry, t, formatTime) {
  if (entry.kind === 'snapshot') return t('ICONIC.Presets.Tooltip.Snapshot', { time: formatTime(entry.at) });
  if (entry.kind === 'icon') return t('ICONIC.Presets.Tooltip.Icon', { name: entry.name, time: formatTime(entry.at) });
  return entry.name;
}

/**
 * @param {object} entry an entry of the strip
 * @param {object} context
 * @param {(key: string, data?: object) => string} context.t
 * @param {string|null} [context.factionColor]
 * @param {(at: number) => string} [context.formatTime]
 * @returns {string} HTML
 */
export function entryTooltip(entry, { t, factionColor = null, formatTime = String }) {
  const ids = Object.keys(entry.values);
  const skipped = new Set(entry.skip);

  const parts = [`<strong>${escapeHtml(_title(entry, t, formatTime))}</strong>`];
  if (skipped.size) parts.push(`<p class="is-partial">${escapeHtml(t('ICONIC.Presets.Tooltip.Partial'))}</p>`);

  parts.push(`<p>${escapeHtml(t('ICONIC.Presets.Tooltip.Contains'))}</p>`);
  if (ids.length === PRESET_FIELD_IDS.length) parts.push(_list([t('ICONIC.Presets.Tooltip.Everything')]));
  else parts.push(_list(_lines(ids, entry.values, t)));

  if (skipped.size) {
    parts.push(`<p>${escapeHtml(t('ICONIC.Presets.Tooltip.NotApplied'))}</p>`);
    parts.push(_list(_lines(entry.skip, entry.values, t)));
  }

  const needsFaction = ids.some((id) => !skipped.has(id) && isFactionRef(entry.values[id]));
  if (needsFaction && !factionColor) {
    parts.push(`<p class="is-warning">${escapeHtml(t('ICONIC.Presets.Tooltip.NoFaction'))}</p>`);
  }

  return `<div class="iconic-presets-tip">${parts.join('')}</div>`;
}
