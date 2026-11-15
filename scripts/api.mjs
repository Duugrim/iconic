// Public API of Iconic: `game.modules.get('iconic').api`.
//
//   await api.edit({ document, field?, tokenDocument?, factionColor?, startDir? }) -> path | null
//     Open the editor on the current image of an Actor / Item / TokenDocument / TileDocument and write the result back.
//   await api.pick({ initialPath?, initialOpts?, defaultColor?, factionColor?, startDir?, title? }) -> path | null
//     Open the editor and return the baked icon's path without touching any document.
//   await api.placeTile({ initialPath?, initialOpts?, defaultColor?, factionColor?, startDir?, title? }) -> TileDocument | null
//     Open the editor, then put the icon on the current scene as a tile where the user clicks.
//   api.canEdit(document) -> boolean

import { IconicEditor } from './editor/editor-app.mjs';
import {
  bakeSvgToGenerated,
  normalizeBakeOptions,
  normalizeHexColor,
  resolveEditableSource,
} from './lib/svg-bake.mjs';
import { CUSTOM_LIBRARY_DIR } from './lib/storage.mjs';
import { rememberIcon } from './browser/files.mjs';
import { collectColorHints, normalizeHint } from './lib/color-hints.mjs';
import {
  applyImage,
  currentImageFor,
  defaultTargetFor,
  documentKind,
  targetIdsFor,
} from './apply.mjs';
import { choosePoint, tileData } from './tile-placement.mjs';

const TARGET_LABEL_KEYS = {
  portrait: 'ICONIC.Editor.Targets.Portrait',
  token: 'ICONIC.Editor.Targets.Token',
  both: 'ICONIC.Editor.Targets.Both',
  tile: 'ICONIC.Editor.Targets.Tile',
};

function _L(key) {
  try { return game.i18n.localize(key); } catch (_) { return key; }
}

/** Can the current user restyle this document's image (right type, may update it, may upload)? */
export function canEdit(document) {
  if (!documentKind(document)) return false;
  if (!game.user.can('FILES_UPLOAD')) return false;
  try {
    return document.canUserModify?.(game.user, 'update') ?? Boolean(document.isOwner);
  } catch (_) {
    return false;
  }
}

/**
 * Open the editor and bake the result.
 * @returns {Promise<{path:string, target:string|null}|null>} null if cancelled or failed.
 */
export async function pickDetailed({
  defaultColor = '#ffffff',
  title = null,
  factionColor = null,
  factionName = null,
  initialPath = null,
  initialOpts = null,
  startDir = null,
  targets = [],
  target = null,
} = {}) {
  if (!game.user.can('FILES_UPLOAD')) {
    ui.notifications?.warn?.(_L('ICONIC.Errors.NoUploadPermission'));
    return null;
  }

  // Opening a baked icon edits its source with the style it was made with.
  const initial = initialPath ? await resolveEditableSource(initialPath) : null;
  const effectiveInitialPath = String(initial?.srcPath ?? '').trim();
  const effectiveInitialOpts = initialOpts ?? initial?.opts ?? null;

  // Start the picker color from the icon's own color, so the UI matches what is being edited.
  const effectiveDefaultColor = effectiveInitialOpts?.icon?.color ?? defaultColor;

  const selection = await IconicEditor.wait({
    title,
    defaultColor: effectiveDefaultColor,
    factionColor,
    factionName,
    startDir: startDir || CUSTOM_LIBRARY_DIR,
    autoOpenBrowser: !effectiveInitialPath,
    initialPath: effectiveInitialPath || null,
    initialOpts: effectiveInitialOpts,
    targets,
    target,
  });
  if (!selection) return null;

  const srcPath = String(selection.srcPath ?? '').trim();
  if (!srcPath) return null;

  const color = normalizeHexColor(selection.color, normalizeHexColor(defaultColor));
  const opts = normalizeBakeOptions(selection.opts, { fallbackColor: color });
  opts.icon.color = color;

  try {
    const path = await bakeSvgToGenerated({ srcPath, color, opts });
    await rememberIcon(path);
    return { path, target: selection.target ?? null };
  } catch (e) {
    console.error('Iconic | bake failed', e);
    ui.notifications?.error?.(_L('ICONIC.Editor.Errors.BakeFailed'));
    return null;
  }
}

export async function pick(options = {}) {
  return (await pickDetailed(options))?.path ?? null;
}

/**
 * Edit the image of a document: open the editor on what it shows now, then apply the result.
 * @param {object} options
 * @param {Document} options.document Actor, Item, TokenDocument or TileDocument
 * @param {string} [options.field] The field of the clicked image ('img', 'prototypeToken.texture.src'...)
 * @param {TokenDocument} [options.tokenDocument] A placed token to update instead of the prototype token
 * @param {string} [options.factionColor] The color the "faction color" buttons use. Without it the document's
 *   own faction color is looked up (see lib/color-hints.mjs).
 */
export async function edit({ document, field = null, tokenDocument = null, ...rest } = {}) {
  if (!canEdit(document)) return null;

  const targetIds = targetIdsFor(document);
  const target = defaultTargetFor(document, field);

  let { factionColor = null, factionName = null } = rest;
  if (!normalizeHint(factionColor)) {
    const [hint] = await collectColorHints({ document, tokenDocument });
    factionColor = hint?.color ?? null;
    factionName = hint?.label ?? null;
  }

  const picked = await pickDetailed({
    ...rest,
    factionColor,
    factionName,
    initialPath: rest.initialPath ?? currentImageFor(document, target, tokenDocument),
    targets: targetIds.map((id) => ({ id, label: _L(TARGET_LABEL_KEYS[id]) })),
    target,
  });
  if (!picked) return null;

  try {
    await applyImage({ document, tokenDocument, target: picked.target ?? target, path: picked.path });
    return picked.path;
  } catch (e) {
    console.error('Iconic | apply failed', e);
    ui.notifications?.error?.(_L('ICONIC.Editor.Errors.ApplyFailed'));
    return null;
  }
}

/**
 * Make an icon and put it on the viewed scene as a tile: a marker with no Actor or Item behind it.
 * The tile is one grid square large, and ordinary from then on: it moves, resizes and turns on the
 * Tiles layer, which only a GM can use.
 * @param {object} [options] What `pick` takes.
 * @returns {Promise<TileDocument|null>} null if cancelled or failed.
 */
export async function placeTile({ title = _L('ICONIC.Tiles.EditorTitle'), ...rest } = {}) {
  if (!game.user.isGM) {
    ui.notifications?.warn?.(_L('ICONIC.Tiles.Errors.GmOnly'));
    return null;
  }
  if (!canvas?.ready || !canvas.scene) {
    ui.notifications?.warn?.(_L('ICONIC.Tiles.Errors.NoScene'));
    return null;
  }

  const path = (await pickDetailed({ ...rest, title }))?.path;
  if (!path) return null;

  try {
    // The scene may have been closed while the editor was open.
    if (!canvas.ready) throw new Error('no scene to place the tile on');
    canvas.tiles.activate({ tool: 'select' });

    const size = canvas.dimensions.size;
    ui.notifications?.info?.(_L('ICONIC.Tiles.PlaceHint'));
    const point = await choosePoint({ path, size });
    if (!point) return null;

    const data = tileData({
      path,
      size,
      center: point,
      hidden: point.hidden,
      generation: game.release.generation,
      sort: Math.max(canvas.tiles.getMaxSort() + 1, 0),
    });
    // The Tile palette of Foundry 14 holds the defaults of new tiles (the viewed level among them).
    const palette = canvas.tiles.paletteCreateData ?? {};
    const merged = foundry.utils.mergeObject(palette, data, { inplace: false });
    const [tile] = await canvas.scene.createEmbeddedDocuments('Tile', [merged]);
    tile?.object?.control({ releaseOthers: true });
    return tile ?? null;
  } catch (e) {
    console.error('Iconic | placing the tile failed', e);
    ui.notifications?.error?.(_L('ICONIC.Tiles.Errors.PlaceFailed'));
    return null;
  }
}

/**
 * The colors on offer for a document (its faction's color first), as the editor would show them.
 * @returns {Promise<{color: string, label: string}[]>}
 */
export function colorHints(document, tokenDocument = null) {
  return collectColorHints({ document, tokenDocument });
}

export const api = { edit, pick, placeTile, canEdit, colorHints };
