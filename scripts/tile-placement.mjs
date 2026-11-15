// Putting a baked icon on the map as a Tile: a marker that is not an Actor or an Item.
//
// The icon follows the cursor until a click on the canvas drops it. The ghost is a plain image above
// the canvas rather than a preview placeable, so it needs nothing of Foundry's private layer workflow.

import { toFetchUrl } from './lib/storage.mjs';

/** The first Foundry generation whose Tile x/y name the tile's anchor (its center) and not its corner. */
const ANCHORED_TILE_GENERATION = 14;

/** A right button press that moved further than this (px) was a pan of the canvas, not a cancel. */
const RIGHT_CLICK_SLOP = 5;

const GHOST_CLASS = 'iconic-tile-ghost';

/**
 * The data of a square Tile centered on a point.
 * @param {object} args
 * @param {string} args.path The image of the tile
 * @param {{x:number, y:number}} args.center Where its center goes
 * @param {number} args.size Width and height in pixels
 * @param {number} args.generation Foundry's generation (`game.release.generation`)
 * @param {boolean} [args.hidden] Hidden from the players
 * @param {number} [args.sort] Stacking order
 * @returns {object}
 */
export function tileData({ path, center, size, generation, hidden = false, sort = 0 }) {
  const shift = generation >= ANCHORED_TILE_GENERATION ? 0 : size / 2;
  return {
    texture: { src: path },
    width: size,
    height: size,
    x: Math.round(center.x - shift),
    y: Math.round(center.y - shift),
    hidden,
    sort,
  };
}

/** The scene point under the pointer: on the grid, or exactly there with Shift held. */
function _pointOf(event) {
  const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
  return event.shiftKey ? point : canvas.tiles.getSnappedPoint(point);
}

/** Ends the placement that is running, if there is one (only one can run at a time). */
let _cancelRunning = null;

/**
 * Let the user choose a point of the scene with the icon following the cursor.
 * Left click takes the point (Shift: off the grid, Alt: hidden); Esc or a right click cancels.
 * @param {object} args
 * @param {string} args.path The image that follows the cursor
 * @param {number} args.size Its size in scene pixels
 * @returns {Promise<{x:number, y:number, hidden:boolean}|null>} null if cancelled
 */
export function choosePoint({ path, size }) {
  _cancelRunning?.();

  return new Promise((resolve) => {
    const view = canvas.app.view;
    const ghost = document.createElement('img');
    ghost.className = GHOST_CLASS;
    ghost.src = toFetchUrl(path);
    ghost.alt = '';
    ghost.hidden = true;
    document.body.append(ghost);

    let point = null;
    let rightDown = null;

    const draw = () => {
      if (!point) return;
      const { x, y } = canvas.clientCoordinatesFromCanvas(point);
      const side = `${size * canvas.stage.scale.x}px`;
      Object.assign(ghost.style, { left: `${x}px`, top: `${y}px`, width: side, height: side });
    };

    const onMove = (event) => {
      ghost.hidden = event.target !== view; // over the sidebar and the other windows there is no map
      if (ghost.hidden) return;
      point = _pointOf(event);
      draw();
    };

    const onDown = (event) => {
      if (event.target !== view) return;
      if (event.button === 2) {
        rightDown = { x: event.clientX, y: event.clientY }; // left to the canvas: dragging it pans
        return;
      }
      if (event.button !== 0) return;

      const chosen = _pointOf(event);
      if (!canvas.dimensions.rect.contains(chosen.x, chosen.y)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish({ x: chosen.x, y: chosen.y, hidden: event.altKey });
    };

    const onUp = (event) => {
      if (event.button !== 2 || !rightDown) return;
      const moved = Math.hypot(event.clientX - rightDown.x, event.clientY - rightDown.y);
      rightDown = null;
      if (moved <= RIGHT_CLICK_SLOP) finish(null);
    };

    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish(null);
    };

    const onTearDown = () => finish(null);

    function finish(result) {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      Hooks.off('canvasPan', draw);
      Hooks.off('canvasTearDown', onTearDown);
      ghost.remove();
      _cancelRunning = null;
      resolve(result);
    }

    // Capture: the canvas must not also take the click that drops the tile as a click of its own.
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('keydown', onKey, true);
    Hooks.on('canvasPan', draw);
    Hooks.on('canvasTearDown', onTearDown);
    _cancelRunning = () => finish(null);
  });
}
