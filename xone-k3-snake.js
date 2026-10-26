// Entry:   CHORD (shift + layer) press2 — the chord is a launcher,
//          it exits on entry and snake runs standalone.
// Start:   stationary until SHIFT is pressed (amber LED on shift
//          = "press to begin"). Pressing shift again turns right.
// Exit:    press2 always exits. When the game is over, ANY button
//          press also exits — playfield cells, layer, shift, press2.
// Turn:    layer = 90° CCW (left), shift = 90° CW (right).
// Playfield: every LED except layer (idx 28) and shift (idx 29).
// 32 cells in 4 columns × 8 rows, bottom-to-top:
//
//   row 7 (top):    press0..press3      idx 30 31 32 33
//   row 6:          button row 0        idx  0  1  2  3
//   row 5:          button row 1        idx  4  5  6  7
//   row 4:          button row 2        idx  8  9 10 11
//   row 3:          grid row 0          idx 12 13 14 15
//   row 2:          grid row 1          idx 16 17 18 19
//   row 1:          grid row 2          idx 20 21 22 23
//   row 0 (bottom): grid row 3          idx 24 25 26 27
//
// Snake starts at (3, 0) — directly above shift — heading up.
// Loads AFTER xone-k3-cat.js. Modifies CAT.CHORD and CAT_LAYERS.

'use strict';

(function() {
    if (typeof XoneK3 === 'undefined') {
        throw new Error('Xone K3: xone-k3-snake.js — xone-k3-lib-core.js must load first');
    }
    if (typeof XoneK3._requireLoad !== 'function') {
        throw new Error('Xone K3: xone-k3-snake.js — xone-k3-lib-core.js must load first');
    }
    XoneK3._requireLoad('xone-k3-snake.js',
        ['CAT', 'CAT_LAYERS', 'FUNCS', 'resolveColorEntry']);

    var F   = XoneK3.FUNCS;
    var CAT = XoneK3.CAT;

    // ============================================================
    // PLAYFIELD — every LED except layer (28) and shift (29).
    // ============================================================
    XoneK3.SNAKE_PLAYFIELD = [
        [24, 25, 26, 27],  // row 0 (bottom): grid row 3
        [20, 21, 22, 23],  // row 1:          grid row 2
        [16, 17, 18, 19],  // row 2:          grid row 1
        [12, 13, 14, 15],  // row 3:          grid row 0
        [ 8,  9, 10, 11],  // row 4:          button row 2
        [ 4,  5,  6,  7],  // row 5:          button row 1
        [ 0,  1,  2,  3],  // row 6:          button row 0
        [30, 31, 32, 33]   // row 7 (top):    press0..press3
    ];

    XoneK3.SNAKE_TICK_START_MS = 500;
    XoneK3.SNAKE_TICK_STEP_MS  = 5;
    XoneK3.SNAKE_TICK_MIN_MS   = 400;

    // Classic Snake: walls kill. Enable either axis independently
    // — horizontal wrap only, vertical wrap only, both, or neither.
    // On a 4-wide field, horizontal wrap is the more forgiving of
    // the two; vertical wrap is more useful on the 8-tall field.
    XoneK3.SNAKE_WRAP_X = true;
    XoneK3.SNAKE_WRAP_Y = true;

    // Layer / shift LEDs (28, 29) — status only, not playfield.
    var STATUS_LAYER = 28;
    var STATUS_SHIFT = 29;

    // ============================================================
    // COLOURS — hardcoded to avoid load-order issues. Resolving
    // 'green' etc. at load time returns null; XoneK3.COLORS isn't
    // populated until _bootWith runs.
    // ============================================================
    var C_SNAKE_HEAD = { rgb: [  0, 127,   0], brightness: 127 };
    var C_SNAKE_BODY = { rgb: [  0, 127,   0], brightness: 100 };
    var C_SNAKE_TAIL = { rgb: [  0, 127,   0], brightness:  60 };
    var C_FOOD       = { rgb: [127,   0,   0], brightness: 127 };
    var C_DEAD       = { rgb: [127,   0,   0], brightness: 127 };
    var C_TURN       = { rgb: [  0, 127, 127], brightness:  60 };
    var C_WAIT       = { rgb: [127,  64,   0], brightness: 127 };  // amber
    var C_STATUS_OFF = { rgb: [ 60,  60,  60], brightness:  40 };  // dim grey

    // ============================================================
    // PAINT
    // ============================================================
    function paintCell(ctrl, idx, entry) {
        if (!entry || !entry.rgb) { ctrl.sendLED(idx, 0, 0, 0, 0); return; }
        ctrl.sendLED(idx, entry.rgb[0], entry.rgb[1], entry.rgb[2], entry.brightness);
    }

    function paintStatus(ctrl) {
        var s = ctrl._snake;
        if (!s) return;
        if (s.won) {
            paintCell(ctrl, STATUS_LAYER, C_SNAKE_HEAD);
            paintCell(ctrl, STATUS_SHIFT, C_SNAKE_HEAD);
            return;
        }
        if (s.dead) {
            paintCell(ctrl, STATUS_LAYER, C_DEAD);
            paintCell(ctrl, STATUS_SHIFT, C_DEAD);
            return;
        }
        if (!s.started) {
            paintCell(ctrl, STATUS_LAYER, C_STATUS_OFF);   // layer: not usable yet
            paintCell(ctrl, STATUS_SHIFT, C_WAIT);         // shift: press to start
            return;
        }
        paintCell(ctrl, STATUS_LAYER, C_TURN);             // layer: turn left
        paintCell(ctrl, STATUS_SHIFT, C_TURN);             // shift: turn right
    }

    function paintAllRed(ctrl) {
        var field = XoneK3.SNAKE_PLAYFIELD;
        for (var y = 0; y < field.length; y++) {
            for (var x = 0; x < field[y].length; x++) {
                paintCell(ctrl, field[y][x], C_DEAD);
            }
        }
        paintStatus(ctrl);
    }

    function paintAllGreen(ctrl) {
        var field = XoneK3.SNAKE_PLAYFIELD;
        for (var y = 0; y < field.length; y++) {
            for (var x = 0; x < field[y].length; x++) {
                paintCell(ctrl, field[y][x], C_SNAKE_HEAD);
            }
        }
        paintStatus(ctrl);
    }

    // Only repaints cells that actually changed since the last
    // call — prevCells is the set of occupied (x,y) from the last
    // paint. Blank those, then paint the current set. Cells that
    // remain in both sets get repainted with the same colour, and
    // _ledCache dedupes the wire write.
function paintGame(ctrl) {
        var s = ctrl._snake;
        if (!s) return;
        var field = XoneK3.SNAKE_PLAYFIELD;
        var H = field.length, W = field[0].length;
        var i, seg, key, kind, entry;

        // First paint: explicitly blank every playfield cell.
        // _blankLeds() runs on entry but the drain is 1 frame/tick,
        // so a stray recompute inside the 1s paint-delay could
        // have repainted some cells. Blanking here guarantees a
        // clean field regardless of what the caller did. One-time
        // cost of 32 sends per game.
        if (s.prevCells === null) {
            for (var by = 0; by < H; by++) {
                for (var bx = 0; bx < W; bx++) {
                    ctrl.sendLED(field[by][bx], 0, 0, 0, 0);
                }
            }
        }

        // Diff-based paint. prevCells is a map "y,x" → kind
        // (head|body|tail|food). Only cells whose kind changed get
        // a sendLED call — the rest hit _ledCache and are dropped.
        //
        // The old blank-then-repaint forced every cell through the
        // cache twice per tick (~22 sends on a 10-cell snake, ~42
        // on a 20-cell snake), which exceeded the sysex drain rate
        // at high game speed. Diff-based is O(changes) — ~3 sends
        // per tick regardless of snake length.
        var prev = s.prevCells || {};
        var next = {};

        // Food.
        if (s.food) {
            key = s.food.y + ',' + s.food.x;
            next[key] = 'food';
            if (prev[key] !== 'food') {
                paintCell(ctrl, field[s.food.y][s.food.x], C_FOOD);
            }
        }

        // Snake.
        for (i = 0; i < s.snake.length; i++) {
            seg = s.snake[i];
            if (seg.y < 0 || seg.y >= H || seg.x < 0 || seg.x >= W) continue;
            key = seg.y + ',' + seg.x;
            kind = (i === 0) ? 'head'
                 : (i === s.snake.length - 1) ? 'tail'
                 : 'body';
            next[key] = kind;
            if (prev[key] === kind) continue;
            entry = (kind === 'head') ? C_SNAKE_HEAD
                  : (kind === 'tail') ? C_SNAKE_TAIL
                  : C_SNAKE_BODY;
            paintCell(ctrl, field[seg.y][seg.x], entry);
        }

        // Cells that disappeared since the last paint — blank.
        for (var pk in prev) {
            if (!prev.hasOwnProperty(pk)) continue;
            if (next[pk] !== undefined) continue;
            var parts = pk.split(',');
            var py = parseInt(parts[0], 10);
            var px = parseInt(parts[1], 10);
            if (py < 0 || py >= H || px < 0 || px >= W) continue;
            ctrl.sendLED(field[py][px], 0, 0, 0, 0);
        }

        s.prevCells = next;
        paintStatus(ctrl);
    }

    // ============================================================
    // GAME LOGIC
    // ============================================================
    function spawnFood(ctrl) {
        var s = ctrl._snake;
        var field = XoneK3.SNAKE_PLAYFIELD;
        var H = field.length, W = field[0].length;
        var occupied = {};
        for (var i = 0; i < s.snake.length; i++) {
            occupied[s.snake[i].y + ',' + s.snake[i].x] = true;
        }
        var candidates = [];
        for (var y = 0; y < H; y++) {
            for (var x = 0; x < W; x++) {
                if (!occupied[y + ',' + x]) candidates.push({ x: x, y: y });
            }
        }
        if (candidates.length === 0) return null;
        return candidates[Math.floor(Math.random() * candidates.length)];
    }

    function die(ctrl) {
        var s = ctrl._snake;
        if (!s) return;
        s.dead = true;
        if (s.timer) { engine.stopTimer(s.timer); s.timer = null; }
        paintAllRed(ctrl);
    }

    function tick(ctrl) {
        if (ctrl._shuttingDown) {
            if (ctrl._snake && ctrl._snake.timer) {
                engine.stopTimer(ctrl._snake.timer);
                ctrl._snake = null;
            }
            return;
        }
        var s = ctrl._snake;
        if (!s || s.dead || !s.started) return;

        var field = XoneK3.SNAKE_PLAYFIELD;
        var H = field.length, W = field[0].length;
        var head = s.snake[0];
        var nx = head.x + s.dir.dx;
        var ny = head.y + s.dir.dy;

        // Each axis resolves independently. Off the edge with that
        // axis enabled → wrap; off the edge with it disabled →
        // die. No wrap on x + wrap on y means the left/right walls
        // still kill, only top/bottom are open.
        if (nx < 0 || nx >= W) {
            if (XoneK3.SNAKE_WRAP_X) nx = ((nx % W) + W) % W;
            else { die(ctrl); return; }
        }
        if (ny < 0 || ny >= H) {
            if (XoneK3.SNAKE_WRAP_Y) ny = ((ny % H) + H) % H;
            else { die(ctrl); return; }
        }

        var willEat = s.food && nx === s.food.x && ny === s.food.y;
        var selfCheckEnd = willEat ? s.snake.length : s.snake.length - 1;
        for (var i = 0; i < selfCheckEnd; i++) {
            if (s.snake[i].x === nx && s.snake[i].y === ny) { die(ctrl); return; }
        }

        s.snake.unshift({ x: nx, y: ny });
        if (willEat) {
            s.food = spawnFood(ctrl);
            if (s.food === null) {
                // Board full — win, not death.
                s.won = true;
                if (s.timer) { engine.stopTimer(s.timer); s.timer = null; }
                paintAllGreen(ctrl);
                return;
            }
            s.speed = Math.max(XoneK3.SNAKE_TICK_MIN_MS,
                               s.speed - XoneK3.SNAKE_TICK_STEP_MS);
            if (s.timer) engine.stopTimer(s.timer);
            s.timer = engine.beginTimer(s.speed, function() { tick(ctrl); }, false);
        } else {
            s.snake.pop();
        }

        paintGame(ctrl);
    }

    // ============================================================
    // FUNCS
    // ============================================================
    F.snakeStart = function(args, ch, c, v, s) {
        if (!this._ctrl._isPress(v, s)) return;
        var ctrl = this._ctrl;
        if (ctrl._snake) return;

        ctrl._snake = {
            // Head at (3, 0) — directly above shift. Heading up.
            snake:      [{ x: 3, y: 0 }],
            dir:        { dx: 0, dy: 1 },
            food:       null,
            speed:      XoneK3.SNAKE_TICK_START_MS,
            timer:      null,
            paintTimer: null,
            dead:       false,
            won:        false,
            started:    false,
            paintReady: false,
            prevCells:  null
        };
        ctrl._snake.food = spawnFood(ctrl);

        // Chord was the launcher; snake runs standalone. Clear
        // both flags BEFORE the batch so the recompute doesn't
        // try to add shift companions or re-add chord.
        ctrl._chordActive = false;
        ctrl.isShifted = false;
        ctrl._batchPatches(function(patches) {
            var ci = patches.indexOf('chord');
            if (ci !== -1) patches.splice(ci, 1);
            if (patches.indexOf('snake') === -1) patches.push('snake');
        });

        // Blank all LEDs, reset _ledCache, clear the sysex queue.
        // Then wait 1s for the drain to catch up before painting —
        // at 20ms/frame the drain takes ~680ms to flush a full
        // sweep. The 1s window makes the game paint appear all at
        // once instead of rolling in behind the blank.
        ctrl._blankLeds();

        ctrl._snake.paintTimer = engine.beginTimer(1000, function() {
            if (ctrl._snake) ctrl._snake.paintTimer = null;
            if (ctrl._shuttingDown || !ctrl._snake) return;
            ctrl._snake.paintReady = true;
            paintGame(ctrl);
            // No game timer yet. Started by snakeControl on shift.
        }, true);
    };

    F.snakeExit = function(args, ch, c, v, s) {
        if (!this._ctrl._isPress(v, s)) return;
        var ctrl = this._ctrl;
        if (!ctrl._snake) return;
        if (ctrl._snake.paintTimer) engine.stopTimer(ctrl._snake.paintTimer);
        if (ctrl._snake.timer)      engine.stopTimer(ctrl._snake.timer);
        ctrl._snake = null;
        ctrl.removePatch('snake');
    };

    // Any playfield button press. Exits if the game is over;
    // no-op while the game is live (the buttons are the playfield
    // cells themselves — nothing to press them "for" during play).
    F.snakePressAny = function(args, ch, c, v, s) {
        if (!this._ctrl._isPress(v, s)) return;
        var ctrl = this._ctrl;
        if (!ctrl._snake) return;
        if (ctrl._snake.dead || ctrl._snake.won) F.snakeExit.call(this, args, ch, c, v, s);
    };

    // Shift: start if stationary, else turn right (CW). Exits if
    // the game is over — this is a button press like any other.
    F.snakeControl = function(args, ch, c, v, s) {
        if (!this._ctrl._isPress(v, s)) return;
        var ctrl = this._ctrl;
        if (!ctrl._snake) return;
        if (ctrl._snake.dead || ctrl._snake.won) { F.snakeExit.call(this, args, ch, c, v, s); return; }

        // Ignore presses during the blank-1s-paint window. Nothing
        // on the panel is lit yet, starting now would move a snake
        // on an invisible field.
        if (!ctrl._snake.paintReady) return;

        if (!ctrl._snake.started) {
            ctrl._snake.started = true;
            ctrl._snake.timer = engine.beginTimer(
                ctrl._snake.speed, function() { tick(ctrl); }, false);
            paintStatus(ctrl);
            return;
        }

        var d = ctrl._snake.dir;
        ctrl._snake.dir = { dx: d.dy, dy: -d.dx };   // 90° CW
    };

    // Layer: turn left (CCW). No-op until the game has started.
    // Exits if the game is over — this is a button press like any
    // other.
    F.snakeTurn = function(args, ch, c, v, s) {
        if (!this._ctrl._isPress(v, s)) return;
        var ctrl = this._ctrl;
        if (!ctrl._snake) return;
        if (ctrl._snake.dead || ctrl._snake.won) { F.snakeExit.call(this, args, ch, c, v, s); return; }
        if (!ctrl._snake.started) return;
        var d = ctrl._snake.dir;
        ctrl._snake.dir = { dx: -d.dy, dy: d.dx };   // 90° CCW
    };

    // Single entry point for the chord cell.
    F.toggleSnake = function(args, ch, c, v, s) {
        if (!this._ctrl._isPress(v, s)) return;
        if (this._ctrl._snake) F.snakeExit.call(this, args, ch, c, v, s);
        else                   F.snakeStart.call(this, args, ch, c, v, s);
    };

    // ============================================================
    // OVERLAY
    // ============================================================
    // _host lists base patches, not the chord — snake runs after
    // the chord has been removed. Every playfield cell is nulled
    // with {} so a recompute can't clobber the game paint.
    //
    // press0/1/3 nulled so accidental presses don't fire the base
    // fxRouting / keylock / sync action and disturb the game.
    //
    // press2 has noLED: true — its LED (idx 32) is a playfield
    // cell, painted by the game. The binding still fires on press
    // to exit.
    // Every playfield cell gets snakePressAny — dead-exit on any
    // button, no-op while live. noLED keeps the binding's render
    // path off (the game paints these cells directly via sendLED).
    var SNAKE_OVERLAY = {
        _host: ['topShared', 'twoDeck', 'twoDeckMini'],

        layer:  { func: F.snakeTurn,    noLED: true },
        shift:  { func: F.snakeControl, noLED: true },
        press2: { func: F.snakeExit,    noLED: true },

        press0: { func: F.snakePressAny, noLED: true },
        press1: { func: F.snakePressAny, noLED: true },
        press3: { func: F.snakePressAny, noLED: true },

        button0_0: { func: F.snakePressAny, noLED: true },
        button1_0: { func: F.snakePressAny, noLED: true },
        button2_0: { func: F.snakePressAny, noLED: true },
        button3_0: { func: F.snakePressAny, noLED: true },
        button0_1: { func: F.snakePressAny, noLED: true },
        button1_1: { func: F.snakePressAny, noLED: true },
        button2_1: { func: F.snakePressAny, noLED: true },
        button3_1: { func: F.snakePressAny, noLED: true },
        button0_2: { func: F.snakePressAny, noLED: true },
        button1_2: { func: F.snakePressAny, noLED: true },
        button2_2: { func: F.snakePressAny, noLED: true },
        button3_2: { func: F.snakePressAny, noLED: true },

        grid0_0: { func: F.snakePressAny, noLED: true },
        grid1_0: { func: F.snakePressAny, noLED: true },
        grid2_0: { func: F.snakePressAny, noLED: true },
        grid3_0: { func: F.snakePressAny, noLED: true },
        grid0_1: { func: F.snakePressAny, noLED: true },
        grid1_1: { func: F.snakePressAny, noLED: true },
        grid2_1: { func: F.snakePressAny, noLED: true },
        grid3_1: { func: F.snakePressAny, noLED: true },
        grid0_2: { func: F.snakePressAny, noLED: true },
        grid1_2: { func: F.snakePressAny, noLED: true },
        grid2_2: { func: F.snakePressAny, noLED: true },
        grid3_2: { func: F.snakePressAny, noLED: true },
        grid0_3: { func: F.snakePressAny, noLED: true },
        grid1_3: { func: F.snakePressAny, noLED: true },
        grid2_3: { func: F.snakePressAny, noLED: true },
        grid3_3: { func: F.snakePressAny, noLED: true }
    };

    // ============================================================
    // INSTALL
    // ============================================================
    XoneK3.CAT_LAYERS.snake = SNAKE_OVERLAY;

    // CHORD.press2 was empty in the shipped config — pure addition.
    // LED reflects `_snake` state, but the chord is removed the
    // instant snake starts, so it only lights if a recompute lands
    // between press and re-batch. Harmless.
    CAT.CHORD.press2 = {
        func: F.toggleSnake,
        colorScheme: {
            scheme: 'overlayChord',
            on: { state: '_snake' }
        }
    };
})();