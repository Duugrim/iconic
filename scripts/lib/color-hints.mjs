// Where the editor's "use the faction color" button gets its color when the caller names none.
//
// A faction is an Actor with a color in `system.fColor` (the SpaceHolder system's `faction` type and the
// Azimuth module's `azimuth.faction` both use it); other documents point at a faction with a UUID in
// `system.gFaction` (Azimuth's global objects). Iconic reads those two fields, and any other module can add
// its own colors with a hook, without Iconic knowing about it:
//
//   Hooks.on('iconic.colorHints', ({ document, tokenDocument }, hints) => {
//     hints.push({ color: '#c1121f', label: 'House Redmark' });
//   });

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Name of the hook modules use to offer colors for a document. */
export const COLOR_HINTS_HOOK = 'iconic.colorHints';

/** Can documents have a faction color in this game at all? Only the SpaceHolder system and Azimuth give them one. */
export function factionColorsSupported() {
  const game = globalThis.game;
  return game?.system?.id === 'spaceholder' || Boolean(game?.modules?.get?.('azimuth')?.active);
}

/** '#abc' -> '#aabbcc'; '' for anything that is not a hex color. */
export function normalizeHint(raw) {
  const s = String(raw ?? '').trim();
  if (!HEX.test(s)) return '';
  if (s.length === 4) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  return s.toLowerCase();
}

/** A UUID as written in a field: plain, or inside an `@UUID[...]` link. */
function _uuidOf(raw) {
  const text = String(raw ?? '').trim();
  return (text.match(/@UUID\[(.+?)\]/)?.[1] ?? text).trim();
}

/** The Actor a document stands for: itself, or the actor of a token. */
function _actorOf(document, tokenDocument) {
  if (document?.documentName === 'Actor') return document;
  return tokenDocument?.actor ?? document?.actor ?? null;
}

/**
 * Faction colors the document is tied to: its own, if it is a faction, then its faction's.
 * @param {{document?: Document, tokenDocument?: TokenDocument}} context
 * @param {(uuid: string) => Promise<Document|null>} [resolve] how a UUID becomes a document
 * @returns {Promise<{color: string, label: string}[]>}
 */
export async function factionColorHints({ document, tokenDocument } = {}, resolve = (uuid) => fromUuid(uuid)) {
  const actor = _actorOf(document, tokenDocument);
  const hints = [];
  const add = (doc) => {
    const color = normalizeHint(doc?.system?.fColor);
    if (color && !hints.some((h) => h.color === color)) hints.push({ color, label: String(doc.name ?? '') });
  };

  add(actor);

  const uuid = _uuidOf(actor?.system?.gFaction);
  if (uuid) {
    try {
      add(await resolve(uuid));
    } catch (_) {
      // a link to something that is gone: no color from it
    }
  }
  return hints;
}

/**
 * Every color on offer for the document: the built-in faction colors, then whatever hook listeners add.
 * @returns {Promise<{color: string, label: string}[]>} valid colors only, first is the preferred one
 */
export async function collectColorHints(context, resolve) {
  const hints = await factionColorHints(context, resolve);
  try {
    Hooks.callAll(COLOR_HINTS_HOOK, context, hints);
  } catch (e) {
    console.warn('Iconic | a listener of the colorHints hook failed', e);
  }
  const seen = new Set();
  return hints
    .map((h) => ({ color: normalizeHint(h?.color), label: String(h?.label ?? '') }))
    .filter((h) => h.color && !seen.has(h.color) && seen.add(h.color));
}
