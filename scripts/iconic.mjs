// Iconic: turn SVG icons into portraits and tokens.

import { MODULE_ID } from './lib/storage.mjs';
import { api } from './api.mjs';
import { registerEntryPoints } from './entry-points.mjs';
import { registerSettings } from './settings.mjs';

Hooks.once('init', () => {
  registerSettings();
  // The sidebar directories render (and build their context menus, firing the hooks) in
  // initializeUI(), before `ready`, so the entry points have to be hooked up here.
  registerEntryPoints();
  game.modules.get(MODULE_ID).api = api;
});
