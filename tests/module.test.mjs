/**
 * Logic tests for Iconic that need no Foundry: entry-point decisions, how results are applied
 * to documents, and reading the bake metadata of existing icons. Execute with:
 *   node tests/module.test.mjs
 */

// The editor class extends Foundry's ApplicationV2 at import time.
globalThis.foundry = {
  applications: { api: { HandlebarsApplicationMixin: (Base) => Base, ApplicationV2: class {} } },
};

const entryPoints = await import('../scripts/entry-points.mjs');
const { applyImage, currentImageFor, defaultTargetFor, documentKind, targetIdsFor } = await import('../scripts/apply.mjs');
const { extractBakeMeta, resolveEditableSource, normalizeBakeOptions } = await import('../scripts/lib/svg-bake.mjs');
const { tileData } = await import('../scripts/tile-placement.mjs');

let failed = 0;
function assert(label, cond, detail) {
  if (cond) {
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

// --- entry points: next to the standard ones, never in place of them -------------------

const settings = { showHeaderButton: true };
globalThis.game = {
  settings: { get: (_module, key) => settings[key] },
  user: { can: () => true },
  actors: new Map(),
  items: new Map(),
};
const editable = (documentName, extra = {}) => ({ documentName, canUserModify: () => true, ...extra });
const actorDoc = editable('Actor', { id: 'a1' });
const itemDoc = editable('Item', { id: 'i1' });

{
  const controls = [];
  const app = { document: actorDoc, options: {}, isEditable: true };
  entryPoints.onHeaderControlsV2(app, controls);
  assert('V2 sheet menu gets one Iconic entry', controls.length === 1 && controls[0].action === 'iconic-edit' && typeof app.options.actions['iconic-edit'] === 'function', controls);

  const none = (label, app2, setting = true) => {
    settings.showHeaderButton = setting;
    const c = [];
    entryPoints.onHeaderControlsV2(app2, c);
    settings.showHeaderButton = true;
    assert(label, c.length === 0);
  };
  none('no entry for documents Iconic cannot restyle', { document: { documentName: 'Scene', canUserModify: () => true }, options: {} });
  none('no entry on a sheet that is not editable', { document: actorDoc, options: {}, isEditable: false });
  none('no entry when the setting is off', { document: actorDoc, options: {} }, false);
  none('no entry without edit rights', { document: { documentName: 'Actor', canUserModify: () => false }, options: {} });
}

{
  const buttons = [{ class: 'close' }];
  const app = { document: itemDoc, isEditable: true };
  entryPoints.onHeaderButtonsV1(app, buttons);
  assert('V1 sheet gets a header button in front of the others',
    buttons.length === 2 && buttons[0].class === 'iconic' && typeof buttons[0].onclick === 'function' && buttons[1].class === 'close', buttons);

  const old = [];
  entryPoints.onHeaderButtonsV1({ object: actorDoc }, old);
  assert('V1 sheets that only have `object` are found too', old.length === 1);

  settings.showHeaderButton = false;
  const off = [];
  entryPoints.onHeaderButtonsV1({ document: actorDoc }, off);
  settings.showHeaderButton = true;
  assert('V1 header button respects the setting', off.length === 0);
}

{
  game.actors.set('a1', actorDoc);
  const entry = entryPoints.directoryEntry('actors');
  const li = (id) => ({ dataset: { entryId: id } });
  assert('directory entry shows for an actor the user may edit', entry.condition(li('a1')) === true);
  assert('directory entry hides for unknown ids', entry.condition(li('nope')) === false);
  assert('directory entry reads the id from either data attribute', entry.condition({ dataset: { documentId: 'a1' } }) === true);
  assert('directory entry takes an element or a jQuery-style wrapper', entry.visible({ jquery: '3', 0: li('a1') }) === true);
  assert('directory entry has the keys of Foundry 14 and of 13',
    ['label', 'visible', 'onClick', 'name', 'condition', 'callback'].every((k) => k in entry) && entry.visible === entry.condition);
}

{
  const controls = { tiles: { tools: { select: {}, tile: {} } }, tokens: { tools: {} } };
  entryPoints.onSceneControls(controls);
  const tool = controls.tiles.tools['iconic-tile'];
  assert('the Tiles controls get a button after the others', tool?.button === true && tool.order === 3 && typeof tool.onChange === 'function', tool);
  assert('the other controls are left alone', Object.keys(controls.tokens.tools).length === 0);

  const noTiles = {}; // the Tiles controls are not built for players
  entryPoints.onSceneControls(noTiles);
  assert('no Tiles controls, no button', Object.keys(noTiles).length === 0);
}

{
  const tileDoc = editable('Tile', { id: 't1', texture: { src: 'x/marker.svg' } });
  const controls = [];
  entryPoints.onHeaderControlsV2({ document: tileDoc, options: {}, isEditable: true }, controls);
  assert('the sheet of a tile gets the Iconic entry', controls.length === 1);

  const palette = [];
  entryPoints.onHeaderControlsV2({ document: editable('Tile', { id: null }), options: {} }, palette);
  assert('the Tile palette, a sheet on an unsaved tile, does not', palette.length === 0);

  game.i18n = { localize: (key) => key };
  const hud = (src) => {
    const added = [];
    const button = { dataset: {}, setAttribute() {}, addEventListener() {} };
    const column = { querySelector: () => null, append: (el) => added.push(el) };
    const root = { querySelector: () => column, ownerDocument: { createElement: () => button } };
    entryPoints.onRenderTileHud({ document: editable('Tile', { id: 't1', texture: { src } }) }, root);
    return added;
  };
  assert('the HUD of an SVG tile gets a button', hud('x/marker.SVG').length === 1);
  assert('the HUD of a picture tile does not', hud('x/map.webp').length === 0);
}

{
  const tc = await import('../scripts/token-config.mjs');
  const tokenDoc = editable('Token', { id: 'tk1', name: 'Scout', texture: { src: 't/old.svg' } });
  const placedConfig = { isPrototype: false, document: tokenDoc, actor: actorDoc, options: {}, isEditable: true };
  const protoConfig = { isPrototype: true, actor: actorDoc, options: {} };

  const placed = tc.tokenConfigSubject(placedConfig);
  assert('the config of a placed token edits that token', placed?.prototype === false && placed.document === tokenDoc && placed.actor === actorDoc, placed);
  const proto = tc.tokenConfigSubject(protoConfig);
  assert('the prototype token config edits the actor', proto?.prototype === true && proto.document === actorDoc, proto);
  assert('other windows are no token config', tc.tokenConfigSubject({ document: actorDoc }) === null);

  const controls = [];
  entryPoints.onHeaderControlsV2(protoConfig, controls);
  assert('the prototype token config, which has no document, gets the menu entry too', controls.length === 1 && typeof protoConfig.options.actions['iconic-edit'] === 'function');
}

assert('the portrait is never intercepted any more', !('shouldOpenIconic' in entryPoints) && !('PORTRAIT_FIELDS' in entryPoints));

// --- document kinds and targets -----------------------------------------------------

function fakeDoc(documentName, extra = {}) {
  const updates = [];
  return { documentName, updates, update: async (data) => { updates.push(data); }, ...extra };
}

const actor = fakeDoc('Actor', { img: 'a/portrait.svg', prototypeToken: { texture: { src: 'a/token.svg' } } });
const item = fakeDoc('Item', { img: 'i/icon.svg' });
const tokenDoc = fakeDoc('Token', { texture: { src: 't/placed.svg' } });

const tile = fakeDoc('Tile', { texture: { src: 'm/marker.svg' } });

assert('documentKind', documentKind(actor) === 'actor' && documentKind(item) === 'item' && documentKind(tokenDoc) === 'token' && documentKind(tile) === 'tile' && documentKind({ documentName: 'Scene' }) === null);
assert('a tile has one target, its own image, and the editor opens on it',
  targetIdsFor(tile).join() === 'tile' && defaultTargetFor(tile) === 'tile' && defaultTargetFor(tile, 'texture.src') === 'tile'
  && currentImageFor(tile, 'tile') === 'm/marker.svg');
assert('actor offers portrait, token, both', targetIdsFor(actor).join() === 'portrait,token,both');
assert('item offers only the portrait', targetIdsFor(item).join() === 'portrait');
assert('click on the actor portrait starts on "portrait"', defaultTargetFor(actor, 'img') === 'portrait');
assert('click on the prototype token image starts on "token"', defaultTargetFor(actor, 'prototypeToken.texture.src') === 'token');
assert('with no image named, an actor starts on both images, an item on its portrait, a token on itself',
  defaultTargetFor(actor) === 'both' && defaultTargetFor(item) === 'portrait' && defaultTargetFor(tokenDoc) === 'token');
assert('the editor opens on the image of the chosen target',
  currentImageFor(actor, 'portrait') === 'a/portrait.svg'
  && currentImageFor(actor, 'token') === 'a/token.svg'
  && currentImageFor(actor, 'token', tokenDoc) === 't/placed.svg'
  && currentImageFor(tokenDoc, 'token') === 't/placed.svg');

// --- applying -------------------------------------------------------------------------

{
  const a = fakeDoc('Actor');
  await applyImage({ document: a, target: 'portrait', path: 'x.svg' });
  assert('portrait: one actor update with img', a.updates.length === 1 && a.updates[0].img === 'x.svg' && !('prototypeToken.texture.src' in a.updates[0]), a.updates);
}
{
  const a = fakeDoc('Actor');
  await applyImage({ document: a, target: 'token', path: 'x.svg' });
  assert('token: prototype token only', a.updates.length === 1 && a.updates[0]['prototypeToken.texture.src'] === 'x.svg' && !('img' in a.updates[0]), a.updates);
}
{
  const a = fakeDoc('Actor');
  await applyImage({ document: a, target: 'both', path: 'x.svg' });
  assert('both: portrait and prototype token in a single update',
    a.updates.length === 1 && a.updates[0].img === 'x.svg' && a.updates[0]['prototypeToken.texture.src'] === 'x.svg', a.updates);
}
{
  const a = fakeDoc('Actor');
  const t = fakeDoc('Token');
  await applyImage({ document: a, tokenDocument: t, target: 'both', path: 'x.svg' });
  assert('both with a placed token: actor img + that token, prototype untouched',
    a.updates.length === 1 && a.updates[0].img === 'x.svg' && !('prototypeToken.texture.src' in a.updates[0])
    && t.updates.length === 1 && t.updates[0]['texture.src'] === 'x.svg', { a: a.updates, t: t.updates });
}
{
  const i = fakeDoc('Item');
  const t = fakeDoc('Token');
  await applyImage({ document: i, target: 'portrait', path: 'x.svg' });
  await applyImage({ document: t, target: 'token', path: 'y.svg' });
  assert('item and token documents', i.updates[0].img === 'x.svg' && t.updates[0]['texture.src'] === 'y.svg');
}
{
  const t = fakeDoc('Tile');
  await applyImage({ document: t, target: 'tile', path: 'x.svg' });
  assert('tile: only its image changes, so it keeps its place and size', t.updates.length === 1 && Object.keys(t.updates[0]).join() === 'texture.src' && t.updates[0]['texture.src'] === 'x.svg', t.updates);
}
assert('empty path applies nothing', (await applyImage({ document: actor, target: 'portrait', path: ' ' })) === false);

// --- tile data ------------------------------------------------------------------------

{
  const args = { path: 'm.svg', center: { x: 300, y: 500 }, size: 100 };
  const v14 = tileData({ ...args, generation: 14, sort: 7 });
  assert('Foundry 14: x/y of a tile are its center', v14.x === 300 && v14.y === 500, v14);
  const v13 = tileData({ ...args, generation: 13 });
  assert('Foundry 13: x/y of a tile are its corner', v13.x === 250 && v13.y === 450, v13);
  assert('the tile is square, with the image and the order asked for',
    v14.width === 100 && v14.height === 100 && v14.texture.src === 'm.svg' && v14.sort === 7 && v14.hidden === false, v14);
  const free = tileData({ ...args, center: { x: 10.4, y: 20.6 }, generation: 14, hidden: true });
  assert('off the grid the position is still whole pixels, as Foundry wants it', free.x === 10 && free.y === 21 && free.hidden === true, free);
}

// --- bake metadata ----------------------------------------------------------------------

const payload = encodeURIComponent(JSON.stringify({ src: 'lib/wolf.svg', color: '#ff8800', opts: { icon: { color: '#ff8800' } } }));
for (const tag of ['iconic', 'spaceholder']) {
  const meta = extractBakeMeta(`<svg><!-- ${tag}-bake:v2 data=${payload} --></svg>`);
  assert(`${tag}-bake metadata is readable`, meta?.srcPath === 'lib/wolf.svg' && meta.opts?.icon?.color === '#ff8800', meta);
}
assert('plain SVG has no metadata', extractBakeMeta('<svg></svg>') === null);

{
  const files = {
    '/baked.svg': `<svg><!-- iconic-bake:v2 data=${payload} --></svg>`,
    '/plain.svg': '<svg viewBox="0 0 10 10"></svg>',
  };
  globalThis.fetch = async (url) => (url in files
    ? { ok: true, status: 200, text: async () => files[url] }
    : { ok: false, status: 404, statusText: 'Not Found', text: async () => '' });

  const baked = await resolveEditableSource('baked.svg');
  assert('a baked icon resolves to its source and style', baked?.srcPath === 'lib/wolf.svg' && baked.opts?.icon?.color === '#ff8800', baked);

  const plain = await resolveEditableSource('plain.svg');
  assert('a plain SVG is its own source', plain?.srcPath === 'plain.svg' && plain.opts === null, plain);

  assert('non-SVG files cannot be edited', (await resolveEditableSource('photo.png')) === null);
  assert('unreadable files resolve to null', (await resolveEditableSource('missing.svg')) === null);
}

assert('normalizing options twice changes nothing',
  JSON.stringify(normalizeBakeOptions(normalizeBakeOptions({ background: { enabled: true, shape: 'shield-kite', radiusPct: 6, fitIcon: true } })))
  === JSON.stringify(normalizeBakeOptions({ background: { enabled: true, shape: 'shield-kite', radiusPct: 6, fitIcon: true } })));

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll Iconic tests passed');
