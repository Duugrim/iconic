// node tests/imports.test.mjs
// Loads the module entry point with a stub of Foundry's globals, so a broken import, a syntax error or an
// import cycle shows up here instead of in the Foundry console.
import assert from 'node:assert/strict';
import fs from 'node:fs';

class ApplicationV2 {
  static DEFAULT_OPTIONS = {};
}
const hooks = [];
globalThis.foundry = {
  applications: {
    api: {
      ApplicationV2,
      HandlebarsApplicationMixin: (Base) => class extends Base {},
    },
    instances: new Map(),
  },
  utils: {},
};
globalThis.Hooks = { once: (name, fn) => hooks.push([name, fn]), on: (name, fn) => hooks.push([name, fn]) };

await import('../scripts/iconic.mjs');
// Everything is hooked up at `init`: the sidebar directories build their context menus (and fire the
// get...ContextOptions hooks) in initializeUI(), which runs before `ready`.
assert.deepEqual(hooks.map(([name]) => name), ['init']);
const [[, onInit]] = hooks;
globalThis.game = { settings: { register() {}, get() {} }, modules: new Map([['iconic', {}]]) };
hooks.length = 0;
onInit();
assert.deepEqual(hooks.map(([name]) => name).sort(), [
  'getActorContextOptions', 'getActorSheetHeaderButtons', 'getHeaderControlsApplicationV2',
  'getItemContextOptions', 'getItemSheetHeaderButtons', 'getSceneControlButtons', 'renderTileHUD',
]);
assert.equal(typeof game.modules.get('iconic').api.edit, 'function');

const { IconBrowser } = await import('../scripts/browser/browser-app.mjs');
assert.equal(IconBrowser.DEFAULT_OPTIONS.id, 'iconic-browser');
assert.equal(typeof IconBrowser.wait, 'function');

const { IconicEditor } = await import('../scripts/editor/editor-app.mjs');
assert.equal(IconicEditor.DEFAULT_OPTIONS.id, 'iconic-editor');

// The faction buttons work whenever there is a color; without one they say why not.
const factionTooltip = (options) => new IconicEditor(options)._factionTooltip();
assert.equal(factionTooltip({}), 'ICONIC.Editor.Tooltips.FactionUnsupported');
assert.match(factionTooltip({ factionColor: '#c1121f', factionName: 'Redmark' }), /Redmark$/, 'a color handed in needs neither');
game.system = { id: 'spaceholder' };
assert.equal(factionTooltip({}), 'ICONIC.Editor.Tooltips.NoFaction');
delete game.system;
game.modules.set('azimuth', { active: false });
assert.equal(factionTooltip({}), 'ICONIC.Editor.Tooltips.FactionUnsupported', 'an installed module that is off does not count');
game.modules.set('azimuth', { active: true });
assert.equal(factionTooltip({}), 'ICONIC.Editor.Tooltips.NoFaction');
game.modules.delete('azimuth');

// Foundry drops the outer element of a `root: true` part and keeps only its children, which took the
// editor's wrapper (and the CSS variables on it) away. The template part must not be a root part.
assert.ok(!IconicEditor.PARTS.main.root, 'the editor template part must not be root: true');
const css = fs.readFileSync(new URL('../styles/iconic.css', import.meta.url), 'utf8');
assert.match(css, /\.iconic-editor-window,[^{]*\{[^}]*--iconic-gap/, 'the CSS variables are also set on the window');

// Entry points never take a click over: that would need `document`, which does not exist here.
hooks.length = 0;
const { registerEntryPoints } = await import('../scripts/entry-points.mjs');
registerEntryPoints();
assert.equal(hooks.length, 7);

// Every control of the editor template is wired: its data-action is named in the editor's code
// (the "-hex" and "-number" twins of a color or a slider are handled with their base action). The rows
// built by a partial get their action as a parameter of the call: action="...".
const template = fs.readFileSync(new URL('../templates/editor.hbs', import.meta.url), 'utf8');
const editorSource = fs.readFileSync(new URL('../scripts/editor/editor-app.mjs', import.meta.url), 'utf8');
const actions = new Set([...template.matchAll(/\baction="([^"{]+)"|data-action="([^"{]+)"/g)]
  .map((m) => (m[1] ?? m[2]).replace(/-(hex|number)$/, '')));
assert.ok(actions.size >= 35, `found ${actions.size} actions`);
for (const action of actions) {
  assert.ok(editorSource.includes(`'${action}'`), `data-action "${action}" is in the template but not handled`);
}

console.log('imports ok');
