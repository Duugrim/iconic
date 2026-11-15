// Iconic in the Token Configuration window (of a placed token, or of an actor's prototype token), opened
// from its "⋮" menu (entry-points.mjs).
//
// There the image is a field of a form that the user saves (or not) with the window's own button, so
// Iconic acts like the file picker next to it: it fills the field, and Foundry previews and saves it.
// Only if the window was closed while the editor was open is the result written to the token directly.

import { canEdit, pick } from './api.mjs';
import { applyImage, TARGET_TOKEN } from './apply.mjs';
import { collectColorHints } from './lib/color-hints.mjs';

const IMAGE_FIELD = 'texture.src';

function _L(key, data) {
  try { return data ? game.i18n.format(key, data) : game.i18n.localize(key); } catch (_) { return key; }
}

/**
 * What a token configuration window edits, or null if `app` is not one.
 * @returns {{prototype: boolean, actor: Actor|null, token: TokenDocument|null, document: Document|null}|null}
 */
export function tokenConfigSubject(app) {
  const sheets = globalThis.foundry?.applications?.sheets ?? {};
  const isPrototypeConfig = (sheets.PrototypeTokenConfig && app instanceof sheets.PrototypeTokenConfig) || app?.isPrototype === true;
  const isTokenConfig = (sheets.TokenConfig && app instanceof sheets.TokenConfig) || app?.isPrototype === false;
  if (!isPrototypeConfig && !isTokenConfig) return null;

  let actor = null;
  try { actor = app.actor ?? null; } catch (_) { /* a token with no actor behind it */ }
  if (isPrototypeConfig) return { prototype: true, actor, token: null, document: actor };

  const token = app.document?.documentName === 'Token' ? app.document : null;
  return token ? { prototype: false, actor, token, document: token } : null;
}

/** The image field of the window's form (a <file-picker>), or null when it is not rendered. */
function _imageField(app) {
  const elements = app?.form?.elements;
  return elements?.namedItem?.(IMAGE_FIELD) ?? elements?.[IMAGE_FIELD] ?? null;
}

/** Name shown in the editor's title. */
function _subjectName(subject) {
  return subject.token?.name || subject.actor?.prototypeToken?.name || subject.actor?.name || '';
}

/**
 * Open the editor on the token image of a token configuration window and put the result into its form.
 * @returns {Promise<string|null>} the new image's path, or null if cancelled
 */
export async function editTokenConfigImage(app) {
  const subject = tokenConfigSubject(app);
  if (!subject?.document || !canEdit(subject.document)) return null;

  const field = _imageField(app);
  if (field?.disabled) {   // the image is fixed by the prototype token overrides
    ui.notifications?.warn?.(_L('ICONIC.TokenConfig.ImageLocked'));
    return null;
  }

  // The field holds what the user typed but has not saved yet; a wildcard ("tokens/*.png") is no image.
  const current = String(field?.value ?? subject.token?.texture?.src ?? subject.actor?.prototypeToken?.texture?.src ?? '').trim();
  const initialPath = current && !current.includes('*') ? current : null;

  const [hint] = await collectColorHints({ document: subject.actor ?? subject.token, tokenDocument: subject.token });
  const path = await pick({
    initialPath,
    factionColor: hint?.color ?? null,
    factionName: hint?.label ?? null,
    title: _L('ICONIC.TokenConfig.EditorTitle', { name: _subjectName(subject) }),
  });
  if (!path) return null;

  // The appearance tab may have been rendered again while the editor was open: look the field up anew.
  const target = app.rendered ? _imageField(app) : null;
  if (target && !target.disabled) {
    target.value = path;   // fires "change": Foundry updates its preview as for the file picker
    return path;
  }

  // The window is gone: there is no form to fill, so the token gets the image right away.
  try {
    if (subject.prototype) await applyImage({ document: subject.actor, target: TARGET_TOKEN, path });
    else await applyImage({ document: subject.token, target: TARGET_TOKEN, path });
  } catch (e) {
    console.error('Iconic | apply failed', e);
    ui.notifications?.error?.(_L('ICONIC.Editor.Errors.ApplyFailed'));
    return null;
  }
  return path;
}
