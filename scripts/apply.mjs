// Which image of a document Iconic edits, and how the result is written back.
//
// Targets: 'portrait' (Actor/Item `img`), 'token' (prototype token, or one placed token when a
// TokenDocument is given), 'both' (Actor only), 'tile' (a Tile on the map).

export const TARGET_PORTRAIT = 'portrait';
export const TARGET_TOKEN = 'token';
export const TARGET_BOTH = 'both';
export const TARGET_TILE = 'tile';

const TOKEN_FIELDS = new Set(['prototypeToken.texture.src', 'texture.src']);

/** What kind of document this is for Iconic: 'actor' | 'item' | 'token' | 'tile' | null (unsupported). */
export function documentKind(document) {
  switch (document?.documentName) {
    case 'Actor': return 'actor';
    case 'Item': return 'item';
    case 'Token': return 'token';
    case 'Tile': return 'tile';
    default: return null;
  }
}

/** The target ids that make sense for this document, in display order. */
export function targetIdsFor(document) {
  switch (documentKind(document)) {
    case 'actor': return [TARGET_PORTRAIT, TARGET_TOKEN, TARGET_BOTH];
    case 'item': return [TARGET_PORTRAIT];
    case 'token': return [TARGET_TOKEN];
    case 'tile': return [TARGET_TILE];
    default: return [];
  }
}

/**
 * Initial target. A caller that names the image field it started from ('img', 'prototypeToken.texture.src')
 * gets that image; otherwise an actor starts on both images, an item on its portrait, a token on itself.
 */
export function defaultTargetFor(document, field = null) {
  const ids = targetIdsFor(document);
  const named = String(field ?? '');
  if (TOKEN_FIELDS.has(named) && ids.includes(TARGET_TOKEN)) return TARGET_TOKEN;
  if (named && ids.includes(TARGET_PORTRAIT)) return TARGET_PORTRAIT;
  if (ids.includes(TARGET_BOTH)) return TARGET_BOTH;
  return ids[0] ?? null;
}

/** Path of the image that `target` currently shows (what the editor opens on). */
export function currentImageFor(document, target, tokenDocument = null) {
  try {
    if (target === TARGET_TILE) return String(document?.texture?.src ?? '').trim() || null;
    if (target === TARGET_TOKEN) {
      if (documentKind(document) === 'token') return String(document.texture?.src ?? '').trim() || null;
      return String(tokenDocument?.texture?.src ?? document?.prototypeToken?.texture?.src ?? '').trim() || null;
    }
    return String(document?.img ?? '').trim() || null;
  } catch (_) {
    return null;
  }
}

/**
 * Write `path` to the image(s) chosen by `target`.
 * @param {object} args
 * @param {Document} args.document Actor, Item, TokenDocument or TileDocument
 * @param {TokenDocument} [args.tokenDocument] A placed token to update instead of the prototype token
 * @param {string} args.target One of the TARGET_* ids
 * @param {string} args.path
 * @returns {Promise<boolean>}
 */
export async function applyImage({ document, tokenDocument = null, target, path } = {}) {
  const p = String(path ?? '').trim();
  if (!p || !document) return false;

  const kind = documentKind(document);

  if (kind === 'item') {
    await document.update({ img: p });
    return true;
  }

  if (kind === 'token' || kind === 'tile') {
    await document.update({ 'texture.src': p });
    return true;
  }

  if (kind !== 'actor') return false;

  const toPortrait = target === TARGET_PORTRAIT || target === TARGET_BOTH;
  const toToken = target === TARGET_TOKEN || target === TARGET_BOTH;
  if (!toPortrait && !toToken) return false;

  const placed = tokenDocument?.documentName === 'Token' && tokenDocument.update;

  const actorUpdate = {};
  if (toPortrait) actorUpdate.img = p;
  if (toToken && !placed) actorUpdate['prototypeToken.texture.src'] = p;

  const jobs = [];
  if (Object.keys(actorUpdate).length) jobs.push(document.update(actorUpdate));
  if (toToken && placed) jobs.push(tokenDocument.update({ 'texture.src': p }));

  await Promise.all(jobs);
  return true;
}
