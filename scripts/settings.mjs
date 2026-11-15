import { MODULE_ID, SETTING_OUTPUT_FOLDER, SETTING_PRESET_RECENT } from './lib/storage.mjs';
import { SETTING_HEADER_BUTTON } from './entry-points.mjs';
import { SETTING_RECENT } from './browser/files.mjs';

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_HEADER_BUTTON, {
    name: 'ICONIC.Settings.HeaderButton.Name',
    hint: 'ICONIC.Settings.HeaderButton.Hint',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, SETTING_OUTPUT_FOLDER, {
    name: 'ICONIC.Settings.OutputFolder.Name',
    hint: 'ICONIC.Settings.OutputFolder.Hint',
    scope: 'world',
    config: true,
    restricted: true,
    type: String,
    default: '',
  });

  // Paths of the icons this user made, newest first (the folder listing has no dates).
  game.settings.register(MODULE_ID, SETTING_RECENT, {
    scope: 'client',
    config: false,
    type: Array,
    default: [],
  });

  // The strip of recently used styles: this user's cache, not the preset library.
  game.settings.register(MODULE_ID, SETTING_PRESET_RECENT, {
    scope: 'client',
    config: false,
    type: Array,
    default: [],
  });
}
