// Ways into the editor. Every one sits next to what Foundry and other modules (Tokenizer) already
// offer; none takes over a click or a button that does something else:
//  1. an entry in the window menu ("⋮") of Actor / Item / Token / Tile sheets (Application V2);
//  2. a header button on Actor / Item sheets that still use Application V1 (PF2e and others);
//  3. an entry in the Actors / Items directory context menus (right click);
//  4. a button in the Tiles scene controls that makes a new icon tile;
//  5. a button in the HUD of SVG tiles.
// The Token Configuration window (placed and prototype tokens) gets the menu entry of 1.

import { MODULE_ID, SETTING_HEADER_BUTTON } from './lib/storage.mjs';
import { api, canEdit } from './api.mjs';
import { documentKind } from './apply.mjs';
import { editTokenConfigImage, tokenConfigSubject } from './token-config.mjs';

export { SETTING_HEADER_BUTTON };

const MENU_ACTION = 'iconic-edit';
const TILE_TOOL = 'iconic-tile';

/** May a sheet's menu offer Iconic for this document? (setting on, right kind, editable and allowed) */
function _headerEntryAllowed(app, document) {
  if (!documentKind(document)) return false;
  // Foundry 14's Tile palette is a sheet too, on an unsaved tile that only holds the defaults.
  if (documentKind(document) === 'tile' && !document.id) return false;
  if (!game.settings.get(MODULE_ID, SETTING_HEADER_BUTTON)) return false;
  return app.isEditable !== false && canEdit(document);
}

/** `getHeaderControlsApplicationV2`: adds "Edit icon" to the window menu. */
export function onHeaderControlsV2(app, controls) {
  // A token configuration window edits the image in its form, which the user then saves (token-config.mjs).
  const tokenConfig = tokenConfigSubject(app);
  const document = tokenConfig ? tokenConfig.document : app.document;
  if (!_headerEntryAllowed(app, document)) return;

  app.options.actions ??= {};
  app.options.actions[MENU_ACTION] = tokenConfig
    ? function openIconic() { return editTokenConfigImage(this); }
    : function openIconic() { return api.edit({ document: this.document }); };

  controls.push({ icon: 'fa-solid fa-icons', label: 'ICONIC.Menu.Edit', action: MENU_ACTION });
}

/** `getActorSheetHeaderButtons` / `getItemSheetHeaderButtons` (Application V1): adds a header button. */
export function onHeaderButtonsV1(app, buttons) {
  const document = app.document ?? app.object;
  if (!_headerEntryAllowed(app, document)) return;

  buttons.unshift({
    label: 'ICONIC.Menu.Header',
    icon: 'fa-solid fa-icons',
    class: MODULE_ID,
    onclick: () => api.edit({ document }),
  });
}

/** Directory entries carry the document id in a data attribute that differs between versions. */
function _entryId(li) {
  const d = li?.dataset ?? {};
  return d.entryId ?? d.documentId ?? d.actorId ?? d.itemId ?? null;
}

/** A context menu hands over an element, or a jQuery object when it was created the old way. */
const _element = (li) => (li?.jquery ? li[0] : li);

/**
 * A directory context menu entry for the documents of `collection` ('actors' | 'items').
 * It carries both the key names of Foundry 14 (label, visible, onClick) and of 13 (name, condition,
 * callback); each version reads its own and ignores the rest, so neither logs a deprecation.
 */
export function directoryEntry(collection) {
  const documentOf = (li) => {
    const id = _entryId(_element(li));
    return id ? game[collection]?.get(id) ?? null : null;
  };
  const visible = (li) => {
    const document = documentOf(li);
    return !!document && canEdit(document);
  };
  const open = (li) => {
    const document = documentOf(li);
    if (document) api.edit({ document });
  };

  return {
    label: 'ICONIC.Menu.Edit',
    icon: '<i class="fa-solid fa-icons"></i>',
    visible,
    onClick: (_event, li) => open(li),
    name: 'ICONIC.Menu.Edit',
    condition: visible,
    callback: (li) => open(li),
  };
}

/** `getSceneControlButtons`: adds "new icon tile" to the Tiles tools. */
export function onSceneControls(controls) {
  const tools = controls.tiles?.tools;
  if (!tools) return;

  tools[TILE_TOOL] = {
    name: TILE_TOOL,
    title: 'ICONIC.Tiles.Tool',
    icon: 'fa-solid fa-icons',
    order: Object.keys(tools).length + 1,
    button: true,
    visible: game.user.can('FILES_UPLOAD'),
    onChange: () => api.placeTile(),
  };
}

/** `renderTileHUD`: adds a button that restyles the tile, for SVG tiles (an icon, not a piece of the map). */
export function onRenderTileHud(app, element) {
  const document = app.document ?? app.object?.document;
  if (!String(document?.texture?.src ?? '').toLowerCase().endsWith('.svg')) return;
  if (!_headerEntryAllowed(app, document)) return;

  const root = _element(element);
  const column = root?.querySelector?.('.col.right');
  if (!column || column.querySelector(`[data-iconic="${MENU_ACTION}"]`)) return;

  const label = game.i18n.localize('ICONIC.Menu.Edit');
  const button = root.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'control-icon';
  button.dataset.iconic = MENU_ACTION;
  button.dataset.tooltip = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = '<i class="fa-solid fa-icons" inert></i>';
  button.addEventListener('click', () => api.edit({ document }));
  column.append(button);
}

export function registerEntryPoints() {
  Hooks.on('getHeaderControlsApplicationV2', onHeaderControlsV2);
  Hooks.on('getActorSheetHeaderButtons', onHeaderButtonsV1);
  Hooks.on('getItemSheetHeaderButtons', onHeaderButtonsV1);
  Hooks.on('getActorContextOptions', (_app, entries) => entries.push(directoryEntry('actors')));
  Hooks.on('getItemContextOptions', (_app, entries) => entries.push(directoryEntry('items')));
  Hooks.on('getSceneControlButtons', onSceneControls);
  Hooks.on('renderTileHUD', onRenderTileHud);
}
