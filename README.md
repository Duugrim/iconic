# Iconic

Turn SVG icons into portraits and tokens for Foundry VTT (v13, v14): pick one from a built-in library of more than 4,000 icons, recolor it, scale and stroke it, and put it on a background shape: square, circle, map pin, regular hexagon (flat or pointy top) or one of eight heraldic shields.

## Installation

In Foundry's *Add-on Modules* → *Install Module*, paste the manifest URL:

```
https://github.com/Duugrim/iconic/releases/latest/download/module.json
```

Then enable the module in your world. Requires Foundry VTT v13 or v14. No particular game system is needed.

## Opening the editor

Iconic sits next to what Foundry and other modules (Tokenizer) already offer and takes nothing over: a click on a portrait still does what it always did.

- **Sheet menu** (the "⋮" of the window header): *Iconic*. On sheets that still use Application V1 (Pathfinder 2e, ...) there is an *Iconic* button in the window header instead.
- **Right-click** an actor or item in the sidebar directory: *Iconic*.
- **Token Configuration** (of a placed token or an actor's prototype token): *Iconic* in the "⋮" menu. It edits the image of that one token and puts the result into the field, like the file picker beside it: Foundry previews it, and *Update Token* saves it (closing it without saving keeps the old image).
- **Tiles controls:** *New icon tile* makes a marker with no actor or item behind it (see [Icon tiles](#icon-tiles)).

The module setting *Add Iconic to sheet menus* hides the sheet entry; the directory menu always has it. The result is applied to the portrait, the token or both; for an actor *Both* is preselected.

The editor opens on the image the document shows now. An icon made earlier opens as its original with the style it was made with, so you can tweak it instead of starting over. The result is written as a standalone SVG into `worlds/<world>/iconic/generated` (changeable in the module settings) and applied to the portrait, the token, or both.

## What the editor does

- **Icon:** color, size, opacity, an outline; **rotation**, **shift** and **flip** (horizontal / vertical) around the icon's own center, with a reset button. Where an icon sits is per icon: it is not carried over to the next one.
- **Background:** square, circle, map pin (a circle drawn to a point at the bottom), regular hexagon (flat or pointy top) or one of eight heraldic shields; corner radius, inset, opacity, outline, "fit icon" (scales the icon into the shape's safe area).
- **Field division:** paint a second color over part of the field, like a painted shield: per pale, per fess, per bend, per bend sinister, per chevron, per saltire, quarterly, chief, gyronny, paly, barry or chequy. With the outline on, the dividing lines take its color.
- **Second contour:** a second line inside the edge, running parallel to it at an even distance on every shape; color, width and gap are yours.
- **Contrast hint:** when the icon is hard to read on the background (below 3:1) a warning appears at the bottom of the window with colors that fix it, one click to take one. Each color of the field is judged on its own, and on it the icon reads by its fill or by its outline: a white icon with a black outline on dark red with a gold second color is fine (the outline reads on the gold, the white on the red). With a see-through or missing background there is nothing to judge. A faction color given by the caller (`factionColor`) is offered too when it reads well.

Everything with a color of its own has its own block. A part that is switched off, or that does nothing with the current settings, is dimmed and stays where it is, so the window never shifts.

## Styles

A style is a saved look: all of it, or only the parts you choose.

- **Save style** stores the current look in the library. Untick what the style should leave alone: it can hold just the background's shape. A color can be saved as "the faction color" instead of a fixed one; on a document with no faction the color it had when saved is used.
- **Library** loads any saved style, whole or in part, and can search, rename and delete. It stays open, so you can try several.
- **The strip under the preview** keeps the last six styles one click away, along with the settings they replaced and the style of every icon you save (without where that icon sat, which belongs to it alone). Those two are only remembered here, in this browser, and do not go to the library. A style loaded in part is marked, and it stays partial when clicked again. Hover over a tile to see what it holds and what it leaves out.

Styles are JSON files in `modules/iconic/storage/presets`: that folder survives module updates, is shared between worlds and can be copied to another install. Foundry cannot delete a file from the browser, so *Delete* only hides a style (a note goes to `storage/presets/removed`) and its file stays on the disk until you remove it by hand. *Rename* writes a new file and hides the old one.

## Icon tiles

For a mark on the map that needs no actor or item: a camp, a quest location, a ship on a world map. Only a GM can do this, as tiles are a GM's tool in Foundry.

1. Open the *Tiles* controls and press *New icon tile*. The editor opens as usual.
2. After *Select* the icon follows the cursor. Click the map to place it. It snaps to the grid; hold **Shift** to place it freely, **Alt** to hide it from the players. **Esc** or a right click cancels (dragging with the right button still pans the map).

The result is an ordinary Foundry tile, one grid square large: move, resize, turn, hide or copy it on the *Tiles* layer. To restyle it, use the Iconic button of its HUD (right click the tile) or *Iconic* in the "⋮" menu of its sheet; it keeps its place and size.

## Faction colors

The flag button next to every color takes the document's faction color. Iconic reads it out of the box for the author's own [SpaceHolder](https://github.com/Duugrim/spaceholder) system and the Azimuth world-building module; for every other system or module there is the hook below. With no color on offer the button is disabled, and its tooltip says whether Azimuth or SpaceHolder is missing or the document simply has no faction.

- an actor with a color in `system.fColor` (a faction: SpaceHolder's `faction`, Azimuth's `azimuth.faction`) offers its own color;
- an actor, or the actor behind a token, with a faction UUID in `system.gFaction` (Azimuth's global objects) offers that faction's color.

The button names the faction in its tooltip. A caller can still pass its own color (`factionColor`, with `factionName` for the tooltip), which wins. Any module can offer colors for a document without Iconic knowing it:

```js
Hooks.on('iconic.colorHints', ({ document, tokenDocument }, hints) => {
  hints.push({ color: '#c1121f', label: 'House Redmark' });   // unshift() to make it the first
});
```

The first valid color is the one the flag buttons use; `game.modules.get('iconic').api.colorHints(document)` shows what a document gets.

## The icon browser

*Choose icon* opens the browser. Search matches names, authors and categories (in Russian too); the sidebar lists the categories of game-icons.net with their sub-tags; a double click or Enter chooses.

- **Library**: the bundled game-icons.net icons, grouped by type, with the author and license of each icon shown next to it.
- **Created**: the icons you made with Iconic, newest first. Choosing one reopens it for editing.
- **My SVGs**: your own SVG files. Put them (in sub-folders if you like; each folder becomes a category) into `modules/iconic/storage/custom`; *Add your own SVGs…* opens a file browser there. That folder survives module updates.
- *Choose a file…* is Foundry's file picker, for any other image.

The browser does not slow down with the library's size: only the icons on screen exist in the page, and their thumbnails come from a few sheet images instead of thousands of small files.

## For developers

```js
const iconic = game.modules.get('iconic').api;
await iconic.edit({ document: actor });                 // open the editor on actor.img and apply the result
const path = await iconic.pick({ initialPath });        // just return the path of a new baked icon
const tile = await iconic.placeTile();                  // make an icon and place it as a tile (GM only)
iconic.canEdit(document);                               // may this user restyle the document's image?
await iconic.colorHints(document);                      // faction colors on offer: [{ color, label }]
```

Tests: `npm test`. Rebuilding the bundled library (maintainers only; needs `npm install` for the rasterizer):

```
node tools/fetch-tags.mjs <tags dir>                    # tag pages of game-icons.net, once
node tools/build-library.mjs --repo <clone of github.com/game-icons/icons> --tags <tags dir>
```

## Status

Version 0.2.0, early public release. Tried by hand in Foundry VTT 14.369 with the dnd5e (6.0.6), Pathfinder 2e (8.6.1) and SpaceHolder (0.178) systems. Foundry 13 is the declared minimum but has not been tried yet. The editor and the browser are also checked in headless Chrome (`npm test`). Bug reports are welcome in the [issue tracker](https://github.com/Duugrim/iconic/issues).

## Credits and licenses

The module's own code is released under the [MIT license](LICENSE). The bundled library is [game-icons.net](https://game-icons.net): icons by Lorc, Delapouite and 34 other authors, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (the icons of Viscious Speed and Zeromancer are CC0). **Icons made by the authors listed in [CREDITS.md](CREDITS.md), which names every author and every icon. Available on https://game-icons.net.**

Icons you restyle with Iconic are adaptations of these works. Iconic writes the author, the license and the icon's page into every SVG it makes from a library icon (a comment at the top of the file), so the credit travels with the picture. The archive's own notice is in `library/license.txt`.
