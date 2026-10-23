// xone-k3-lib-core.js — bootstrap, tunables, rate classes,
// patch names, timeline config, utilities, tokens, transfer
// curve, sysex math, beat math, K2 palette.
//
// Leaf module. Loads first. Defines no Binding or K3Controller —
// those live in lib-binding.js and lib-controller.js.
//
// Defines XoneK3._requireLoad, the load-order guard every later
// file calls at IIFE top.

'use strict';

// Bootstrap XoneK3. Mixxx's Qt engine evaluates every preset's
// script files into the same global object, so a top-level `var`
// here becomes a shared global for subsequent files. This is the
// only file that creates XoneK3 — every other file assumes it
// exists and throws clearly if it doesn't.
// eslint-disable-next-line no-implicit-globals
var XoneK3 = (typeof XoneK3 !== 'undefined') ? XoneK3 : {};

(function() {
    // ============================================================
    // LOAD-ORDER GUARD
    // ============================================================
    // Every file after this one calls XoneK3._requireLoad at IIFE
    // top with the symbols it needs. Missing symbol → throw with a
    // clear message and the fix location.
    XoneK3._requireLoad = function(file, prereqs) {
        var missing = [];
        for (var i = 0; i < prereqs.length; i++) {
            if (XoneK3[prereqs[i]] === undefined) missing.push(prereqs[i]);
        }
        if (missing.length > 0) {
            throw new Error('Xone K3: ' + file + ' requires ' +
                missing.join(', ') +
                ' — check the <scriptfiles> order in the preset .midi.xml');
        }
    };

    // ============================================================
    // TUNABLES
    // ============================================================
    XoneK3.SYSEX_THROTTLE_MS = 1;

    XoneK3.DEFAULT_RGB_BRIGHTNESS     = 110;
    XoneK3.DEFAULT_RGB_BRIGHTNESS_OFF = 12;

    XoneK3.CO_MATCH_EPSILON = 1 / 127;
    
    // Soft-takeover bridge tolerance. Strictly larger than
    // CO_MATCH_EPSILON: the LED claims "matched" only inside the
    // smaller band, so any matched display implies the bridge has
    // fired and Mixxx has taken control. The extra half-band is a
    // false-negative window (LED shows unmatched while control is
    // live) — harmless, because the user keeps turning until the
    // LED matches, at which point control has been live all along.
    XoneK3.TAKEOVER_EPSILON = 2 / 127;

    XoneK3.DEFAULT_CO_SCHEME = 'coMatch';

    XoneK3.K2_RG_THRESHOLD = 60;
    XoneK3.CURVE_GAIN = 4.0;
    XoneK3.RATIO_GAIN = 12.0;

    // Factory calibration for the K3. Single source of truth for
    // these numbers — presets that want different values declare
    // an override in init(); presets that don't inherit them via
    // bootCat's merge. The `calibration` string is hashed into
    // each controller's _calibKey, so changing it here is safe;
    // changing it at runtime needs a preset reload.
    XoneK3.HARDWARE_CALIB = {
        calibration:       'measuredRGB',
        calibrationMode:   'rms',
        wbGain:            [0.6, 1.0, 0.93],
        channelPerceptual: [1.35, 0.69, 0.19],
        hkBoost:           0.29,
        lumGamma:          0.32
    };

    XoneK3.DEFAULT_BAR_BEATS   = 4;
    XoneK3.DEFAULT_PHRASE_BARS = 4;
    XoneK3.DEFAULT_BEAT_DECK   = '$DECK_ACTIVE$';

    XoneK3.BEATJUMP_MIN = 1/32;
    XoneK3.BEATJUMP_MAX = 16;

    // Beat repaint throttle. Caps sysex rate during tight loops.
    XoneK3.BEAT_REPAINT_THROTTLE_MS = 30;

    // Loop-edit encoder self-accel rate window. encLoopMoveAccel
    // reads the binding's own _loopAccelEvents list, bounded to
    // this window.
    XoneK3.ENC_LOOP_ACCEL_WINDOW_MS = 150;

    XoneK3.LAYER_BUTTON_NOTE = 0x0C;
    XoneK3.SHIFT_BUTTON_NOTE = 0x0F;

    // ============================================================
    // RATE CLASSES
    // ============================================================
    // One registry for every input-rate throttle in the system.
    //
    // The gate is applied per-binding in Binding.input(), before
    // the func dispatches. Every binding gets a class either from
    // its config's `rate:` field or by inference from its inKey /
    // func — see XoneK3._inferRateClass.
    //
    // Why this exists: a loop is stable only while Mixxx can
    // settle between actions that touch it. Rapid loop moves can
    // push the playhead outside the loop and deactivate it. The
    // shared `_lastLoopChangeMs` clock tracks the last loop-moving
    // action on the controller; classes with jumpBlockMs > 0 wait
    // that long before firing.
    //
    // Class shape:
    //   selfCheckMs  minimum gap between two claims from the same
    //                binding, in ms. 0 = no per-binding self-gate.
    //   selfScope    'binding' — write a per-binding stamp so the
    //                            next self-check reads it.
    //                'none'    — no stamp written.
    //   jumpBlockMs  minimum gap after the last shared-clock claim.
    //                Reads _lastLoopChangeMs. 0 = no check.
    //   claimMs      how far to leave the shared clock in the
    //                future. jump.claimMs is the reference: a
    //                class that claims X ms blocks the next jump
    //                for X ms.
    XoneK3.RATE_CLASSES = {
        // Both loop boundaries move (beatjump, reloop, beatloop
        // activate). Full 120 ms on the shared clock.
        jump:  { selfCheckMs: 0,  selfScope: 'none',    jumpBlockMs: 120, claimMs: 120 },

        // One boundary moves (loop-point nudge, size set). Self-
        // gates spin at 10 ms per encoder; leaves a softer 60 ms
        // tail on the jump clock so a jump after an edit doesn't
        // try to fire before the loop is stable.
        edit:  { selfCheckMs: 10, selfScope: 'binding', jumpBlockMs: 60,  claimMs: 60  },

        // Doesn't move anything, but the change means a jump
        // shouldn't fire right after. Used by beatjump-size
        // stepping — the next jump reads the new size, so wait
        // for the user to settle.
        claim: { selfCheckMs: 0,  selfScope: 'none',    jumpBlockMs: 0,   claimMs: 60  },

        // No gate.
        free:  { selfCheckMs: 0,  selfScope: 'none',    jumpBlockMs: 0,   claimMs: 0   }
    };

    // Infer a rate class from a binding's config. Func identity
    // wins over inKey, because a func can write COs the config
    // never mentions (encBeatjumpStepScale writes
    // beatjump_size_halve/double, not beatjump_size).
    //
    // Called at bind time — FUNCS has been populated by then.
    // Returns a class name, or null for "no inference" (binding
    // is free unless it declares `rate:` explicitly).
    XoneK3._inferRateClass = function(cfg) {
        var F = XoneK3.FUNCS || {};
        var fn = cfg.func;
        var k = cfg.inKey || '';

        // Func-driven inference.
        if (fn === F.encBeatjump ||
            fn === F.beatjumpButton ||
            fn === F.reloopToggleResetAnchor ||
            fn === F.beatloopActivateResetAnchor) return 'jump';

        if (fn === F.encLoopMove ||
            fn === F.encLoopMoveAccel) return 'edit';

        if (fn === F.encBeatjumpStepScale) return 'claim';

        if (fn === F.pressSetValue) {
            if (k === 'beatloop_size') return 'edit';
            if (k === 'beatjump_size') return 'claim';
        }

        // inKey-driven inference (CO-backed bindings, no func).
        // Listed explicitly — the pattern form (/^beatjump_/)
        // also matched beatjump_size, which would misclassify a
        // size-set binding as movement. The classifier must stay
        // narrower than _validateBindings' audit pattern; see
        // INTERNALS §22 and §25.
        if (k === 'beatjump_forward' || k === 'beatjump_backward') return 'jump';
        if (k === 'reloop_toggle') return 'jump';
        if (k === 'beatloop_activate') return 'jump';

        return null;
    };

    // Escape detector constants. Only log an escape when it
    // happens within this many ms of the last shared-clock claim.
    // Escapes outside this window are usually UI clicks or
    // track_loaded, not throttle misses.
    XoneK3.ESCAPE_DETECT_WINDOW_MS = 500;

    // Bounded ring of escape records kept on the controller.
    XoneK3.ESCAPE_HISTORY_MAX = 16;

    // Bounded ring of accepted-event intervals kept per binding.
    // Used by inspect('rate') to compute min / p50 / max gaps.
    XoneK3.RATE_INTERVAL_SAMPLES = 32;

    // ============================================================
    // PATCH NAMES
    // ============================================================
    // Canonical names for every patch the runtime code and the
    // mode-swap funcs need to reference by string. Config files
    // use these too. Keep the string values stable — the .midi.xml
    // <scriptfiles> ordering and the CAT_LAYERS keys both depend
    // on the literal names.
    XoneK3.PATCH_NAMES = {
        FOCUS_BASE:       'topShared',
        FOCUS_LAYOUT:     'fxLayout',      // + 1..4
        TWODECK_BASE:     'twoDeck',
        TWODECK_A_LAYOUT: 'fxLayoutA',     // + 1..4
        TWODECK_B_LAYOUT: 'fxLayoutB',     // + 1..4
        MINI_BASE:        'twoDeckMini',
        MINI_LAYOUT:      'fxMini',        // + 1..4

        CHORD:            'chord',
        CUE:              'cue',
        LOOP:             'loop',
        ODD:              'oddLoop',

        SELECT_AB:        'selectAB',
        FX_ROUTING:       'fxRouting'
    };

    // ============================================================
    // TIMELINE
    // ============================================================
    // One virtual clock per channel: the loop clock. Starts on
    // loop-on, stops on loop-off, seeded from the playhead. Track
    // is the fallback reading whenever the loop clock isn't
    // running — there is no priority tunable and no display
    // question to answer.
    //
    // Per-clock tempo-tracking mode:
    //   trackTempo false (default) — advances in real seconds at
    //                     file_bpm. Rate changes don't affect the
    //                     clock. "Absolute phrasing timing."
    //   trackTempo true — follows position delta, so rate changes
    //                     count. Useful for tempo-building
    //                     transitions.
    XoneK3.VIRTUAL_CLOCKS = {
        loop: { trackTempo: false }
    };

    // Global time-signature override. Null = per-scheme values win.
    // Set via setTimeSig / clearTimeSig. Mutating TIME_SIG directly
    // works too, but won't repaint — use the setters.
    XoneK3.TIME_SIG = null;

    XoneK3.setTimeSig = function(barBeats, phraseBars) {
        if (!(barBeats > 0) || !(phraseBars > 0)) return;
        XoneK3.TIME_SIG = { barBeats: barBeats, phraseBars: phraseBars };
        if (!XoneK3.controllers) return;
        for (var i = 0; i < XoneK3.controllers.length; i++) {
            XoneK3.controllers[i]._refreshAllLeds('timesig');
        }
    };

    XoneK3.clearTimeSig = function() {
        XoneK3.TIME_SIG = null;
        if (!XoneK3.controllers) return;
        for (var i = 0; i < XoneK3.controllers.length; i++) {
            XoneK3.controllers[i]._refreshAllLeds('timesig');
        }
    };

    // ============================================================
    // DEBUG PRINTS
    // ============================================================
    XoneK3.PRINT_TABLES = [];
    XoneK3._debugPrintsOn = false;
    XoneK3._warned = {};

    XoneK3.registerPrintTable = function(table, name) {
        XoneK3.PRINT_TABLES.push({ table: table, name: name || 'unnamed' });
    };

    XoneK3._warnOnce = function(key, msg) {
        if (XoneK3._warned[key]) return;
        XoneK3._warned[key] = true;
        print('[k3] ' + msg);
    };

    XoneK3.debugPrint = function(key, vars) {
        if (!XoneK3._debugPrintsOn) return;
        var tpl = null;
        for (var i = 0; i < XoneK3.PRINT_TABLES.length; i++) {
            var t = XoneK3.PRINT_TABLES[i].table;
            if (t[key] !== undefined) { tpl = t[key]; break; }
        }
        if (tpl === null) return;
        if (vars) {
            for (var k in vars) {
                if (!vars.hasOwnProperty(k)) continue;
                tpl = tpl.split('{' + k + '}').join(vars[k]);
            }
        }
        print('[k3] ' + tpl);
    };

    XoneK3.registerPrintTable({
        overlayOn:  'overlay {name} ON',
        overlayOff: 'overlay {name} OFF'
    }, 'lib');

    // ============================================================
    // UTILITIES
    // ============================================================
    XoneK3.parseNum = function(s) {
        if (typeof s === 'number') return s;
        if (typeof s !== 'string') return NaN;
        s = s.trim();
        if (s === '') return NaN;
        var p = s.split('/');
        if (p.length === 2) {
            var a = parseFloat(p[0]), b = parseFloat(p[1]);
            if (!isNaN(a) && !isNaN(b) && b !== 0) return a / b;
        }
        return parseFloat(s);
    };

    XoneK3.readPath = function(obj, path) {
        if (obj === undefined || obj === null) return undefined;
        if (typeof path !== 'string' || path.indexOf('.') === -1) return obj[path];
        var parts = path.split('.'), cur = obj;
        for (var i = 0; i < parts.length; i++) {
            if (cur === undefined || cur === null) return undefined;
            cur = cur[parts[i]];
        }
        return cur;
    };

    XoneK3._selProp = function(kind, which) {
        return 'selected' + kind.charAt(0).toUpperCase() + kind.slice(1) + which;
    };

    // ============================================================
    // BINDING HASH
    // ============================================================
    // Hash of every binding field that affects runtime behaviour
    // or LED output. Used by _applyResolved to skip rebinds whose
    // config didn't change. Fields starting with '_' are structural
    // metadata and deliberately omitted.
    XoneK3._BINDING_CFG_FIELDS = [
        'group', 'inKey', 'outKey', 'type',
        'func', 'args',
        'valueCurve', 'softTakeover',
        'noLED', 'k2', 'accel', 'rate',
        'colorScheme'
    ];

    // Stable function identity for hashing. Functions get a
    // monotonic id on first sight; two references to the same
    // function return the same id, two different closures never
    // collide.
    XoneK3._funcIdCounter = 0;
    XoneK3._funcIdMap = new WeakMap();
    XoneK3._funcId = function(fn) {
        if (typeof fn !== 'function') return '';
        var id = XoneK3._funcIdMap.get(fn);
        if (id === undefined) {
            id = '_' + (XoneK3._funcIdCounter++);
            XoneK3._funcIdMap.set(fn, id);
        }
        return id;
    };

    XoneK3._stableStringify = function(o) {
        if (o === null) return 'null';
        if (o === undefined) return 'undefined';
        var t = typeof o;
        if (t === 'number' || t === 'boolean') return String(o);
        if (t === 'string') return JSON.stringify(o);
        if (t === 'function') return 'fn:' + XoneK3._funcId(o);
        if (Array.isArray(o)) {
            var arr = [];
            for (var i = 0; i < o.length; i++) {
                arr.push(XoneK3._stableStringify(o[i]));
            }
            return '[' + arr.join(',') + ']';
        }
        if (t === 'object') {
            var keys = Object.keys(o).sort();
            var parts = [];
            for (var k = 0; k < keys.length; k++) {
                var key = keys[k];
                parts.push(JSON.stringify(key) + ':' + XoneK3._stableStringify(o[key]));
            }
            return '{' + parts.join(',') + '}';
        }
        return String(o);
    };

    XoneK3._hashBindingValue = function(field, v) {
        if (v === undefined) return '';
        if (field === 'func') return XoneK3._funcId(v);
        if (typeof v === 'object' && v !== null) return XoneK3._stableStringify(v);
        // Strings are JSON-quoted so they can't introduce ambiguity
        // at the field boundary. Without this, group 'a|b' + inKey
        // 'c' hashed the same as group 'a' + inKey 'b|c'.
        if (typeof v === 'string') return JSON.stringify(v);
        return String(v);
    };

    XoneK3._hashBinding = function(cfg) {
        if (cfg === null || cfg === undefined) return null;
        var parts = [];
        for (var i = 0; i < XoneK3._BINDING_CFG_FIELDS.length; i++) {
            var f = XoneK3._BINDING_CFG_FIELDS[i];
            parts.push(XoneK3._hashBindingValue(f, cfg[f]));
        }
        // \u0001 is a control character that never appears in CO names
        // or numeric output. JSON-quoted strings (change 1) can't leak
        // a raw \u0001 either — JSON escapes it.
        return parts.join('\u0001');
    };

    XoneK3._auditBindingCfg = function(cfg, name) {
        if (!XoneK3._debugPrintsOn) return;
        for (var k in cfg) {
            if (!cfg.hasOwnProperty(k) || k.charAt(0) === '_') continue;
            if (XoneK3._BINDING_CFG_FIELDS.indexOf(k) === -1) {
                print('[k3] binding ' + name + ' has cfg key "' + k +
                      '" not in _BINDING_CFG_FIELDS — hash will miss it');
            }
        }
        if (cfg.accel && !cfg.func) {
            print('[k3] binding ' + name +
                  ' declares accel but has no func — accel is inert on the default input path');
        }
    };

    XoneK3._parseAccel = function(a) {
        if (!a) return null;
        var cfg = (typeof a === 'number') ? { amount: a } : a;
        if (typeof cfg !== 'object' || cfg === null) return null;
        var amount = cfg.amount;
        if (typeof amount !== 'number' || amount <= 1) return null;
        function pos(v, def) {
            return (typeof v === 'number' && v > 0) ? v : def;
        }
        return {
            amount: amount,
            curve:  pos(cfg.curve,  1),
            window: pos(cfg.window, 200),
            fullAt: pos(cfg.fullAt, 60)
        };
    };

    // ============================================================
    // SELECT TOKENS
    // ============================================================
    // Resolved at bind time in group, inKey, outKey,
    // schemeFromState.group, schemeFromState.co, and on.group.
    // See CUSTOMISE §2.4 for the full list.
    XoneK3.TOKENS = (function() {
        function channel(n) { return '[Channel' + n + ']'; }
        function unit(n)    { return '[EffectRack1_EffectUnit' + n + ']'; }
        function bare(n)    { return '' + n; }
        return [
            { token: '$DECK_A$',        state: 'selectedDeckA',     make: channel },
            { token: '$DECK_B$',        state: 'selectedDeckB',     make: channel },
            { token: '$DECK_C$',        state: 'selectedDeckC',     make: channel },
            { token: '$DECK_D$',        state: 'selectedDeckD',     make: channel },
            { token: '$DECK_ACTIVE$',   state: 'selectedDeckCurrent', make: channel },
            { token: '$DECK_ACTIVE_N$', state: 'selectedDeckCurrent', make: bare },
            { token: '$DECK_ALT$',      state: 'selectedDeckAlt',   make: channel },
            { token: '$DECK_ALT_N$',    state: 'selectedDeckAlt',   make: bare },
            { token: '$DECK_A_N$',      state: 'selectedDeckA',     make: bare },
            { token: '$DECK_B_N$',      state: 'selectedDeckB',     make: bare },

            { token: '$FX_A$',          state: 'selectedFxA',       make: unit },
            { token: '$FX_B$',          state: 'selectedFxB',       make: unit },
            { token: '$FX_C$',          state: 'selectedFxC',       make: unit },
            { token: '$FX_D$',          state: 'selectedFxD',       make: unit },
            { token: '$FX_ACTIVE$',     state: 'selectedFxCurrent', make: unit },
            { token: '$FX_ACTIVE_N$',   state: 'selectedFxCurrent', make: bare },
            { token: '$FX_ALT$',        state: 'selectedFxAlt',     make: unit },
            { token: '$FX_ALT_N$',      state: 'selectedFxAlt',     make: bare },
            { token: '$FX_A_N$',        state: 'selectedFxA',       make: bare },
            { token: '$FX_B_N$',        state: 'selectedFxB',       make: bare }
        ];
    })();

    XoneK3.resolve = function(str, ctrl) {
        if (typeof str !== 'string') return str;
        for (var i = 0; i < XoneK3.TOKENS.length; i++) {
            var t = XoneK3.TOKENS[i], v = ctrl[t.state];
            if (v === undefined) continue;
            str = str.split(t.token).join(t.make(v, ctrl));
        }
        return str;
    };

    XoneK3._findUnknownTokens = function(str) {
        if (typeof str !== 'string' || str.indexOf('$') === -1) return [];
        var out = [];
        var re = /\$[A-Z0-9_]+\$/g;
        var m;
        while ((m = re.exec(str)) !== null) {
            var tok = m[0];
            var known = false;
            for (var i = 0; i < XoneK3.TOKENS.length; i++) {
                if (XoneK3.TOKENS[i].token === tok) { known = true; break; }
            }
            if (!known && out.indexOf(tok) === -1) out.push(tok);
        }
        return out;
    };

    XoneK3._tokenFields = function(cfg) {
        var out = [];
        if (cfg.group  !== undefined) out.push(['group',  cfg.group]);
        if (cfg.inKey  !== undefined) out.push(['inKey',  cfg.inKey]);
        if (cfg.outKey !== undefined) out.push(['outKey', cfg.outKey]);
        var cs = cfg.colorScheme;
        if (cs && cs.schemeFromState) {
            if (cs.schemeFromState.group !== undefined)
                out.push(['schemeFromState.group', cs.schemeFromState.group]);
            if (cs.schemeFromState.co    !== undefined)
                out.push(['schemeFromState.co',    cs.schemeFromState.co]);
        }
        if (cs && cs.on && cs.on.group !== undefined)
            out.push(['on.group', cs.on.group]);
        return out;
    };

    // ============================================================
    // LED TRANSFER CURVE
    // ============================================================
    // Build a monotonic [hw, luminance] table per channel from a
    // raw {r, g, b} object. Non-monotonic input is flattened to
    // the previous value with a warn-once — hand-edited tables
    // otherwise silently break the calibration solve.
    XoneK3._buildTransferRGB = function(obj) {
        if (!obj || !obj.r || !obj.g || !obj.b) return null;
        var lists = { r: obj.r, g: obj.g, b: obj.b };
        var out = {};
        var keys = ['r', 'g', 'b'];
        for (var k = 0; k < 3; k++) {
            var list = lists[keys[k]];
            var sorted = list.slice().sort(function(a, b) { return a[0] - b[0]; });
            var maxLum = 0;
            for (var i = 0; i < sorted.length; i++) {
                if (sorted[i][1] > maxLum) maxLum = sorted[i][1];
            }
            if (maxLum <= 0) return null;
            var cur = [], prev = -Infinity;
            for (var j = 0; j < sorted.length; j++) {
                var hw = Math.max(0, Math.min(127, sorted[j][0]));
                var lum = sorted[j][1] / maxLum;
                if (lum < prev) {
                    XoneK3._warnOnce('transferNonMono:' + keys[k] + ':' + hw,
                        'transfer curve channel "' + keys[k] + '" not monotonic at hw=' + hw +
                        ' — flattening to previous value');
                    lum = prev;
                }
                if (lum > 1) lum = 1;
                cur.push([hw, lum]);
                prev = lum;
            }
            out[keys[k]] = cur;
        }
        return out;
    };

    // ============================================================
    // SYSEX
    // ============================================================
    function _clamp7f(x) { return Math.max(0, Math.min(0x7F, x | 0)); }

    XoneK3.noteToLEDIndex = function(n) {
        if (n >= 0x28 && n <= 0x33) { var i = n - 0x28, r = 2 - (i >> 2); return r * 4 + (i & 3); }
        if (n >= 0x18 && n <= 0x27) { var j = n - 0x18, rf = j >> 2; return 0x0C + (3 - rf) * 4 + (j & 3); }
        if (n === 0x0C) return 0x1C;
        if (n === 0x0F) return 0x1D;
        if (n >= 0x34 && n <= 0x37) return n - 0x34 + 0x1E;
        return -1;
    };

    XoneK3.buildSysExLED = function(idx, r, g, b, hw) {
        return [ 0xF0,0x00,0x00,0x1A,0x50,0x15,0x00,0x0E,
                 idx & 0x7F,
                 _clamp7f(r), _clamp7f(g), _clamp7f(b), _clamp7f(hw),
                 0xF7 ];
    };

    // ============================================================
    // BEAT MATH
    // ============================================================
    XoneK3.BEAT_HOLD = {};

    // Cascade chain per level: most-specific entry first, falling
    // through to the next field until a colour / brightness is
    // found. `null` means "the base beat block".
    var _BEAT_CHAIN = {
        prePhrase: ['prePhrase', 'phrase', 'bar', null],
        phrase:    ['phrase', 'bar', null],
        bar:       ['bar', null],
        beat:      [null]
    };

    function _colorHasBrightness(spec) {
        if (typeof spec === 'string') return spec.split(',').length >= 2;
        if (Array.isArray(spec)) return spec.length >= 4;
        return false;
    }

    XoneK3.beatLevel = function(beat, count) {
        var bpb, ppb;
        var sig = XoneK3.TIME_SIG;
        if (sig) {
            bpb = sig.barBeats;
            ppb = sig.phraseBars;
        } else {
            bpb = (typeof beat.barBeats === 'number' && beat.barBeats > 0)
                ? beat.barBeats : XoneK3.DEFAULT_BAR_BEATS;
            ppb = (typeof beat.phraseBars === 'number' && beat.phraseBars > 0)
                ? beat.phraseBars : XoneK3.DEFAULT_PHRASE_BARS;
        }
        var phraseLen = bpb * ppb;

        var preBeats;
        if (typeof beat.prePhraseBeats === 'number') preBeats = beat.prePhraseBeats;
        else preBeats = bpb;
        if (preBeats < 0) preBeats = 0;
        if (preBeats >= phraseLen) preBeats = phraseLen - 1;
        var preAt = phraseLen - preBeats;

        var c = ((count - 1) % phraseLen + phraseLen) % phraseLen;
        var level;
        if (preBeats > 0 && c === preAt) level = 'prePhrase';
        else if (c === 0)                level = 'phrase';
        else if (c % bpb === 0)          level = 'bar';
        else                             level = 'beat';

        if (beat.half && level === 'beat' && (((count % 2) + 2) % 2 === 1)) {
            return { skip: true };
        }

        var chain = _BEAT_CHAIN[level] || [null];
        var out = { level: level, color: null, brightness: null };
        for (var i = 0; i < chain.length; i++) {
            var key = chain[i];
            var e = (key === null) ? beat : beat[key];
            if (!e) continue;
            if (out.color === null && e.color !== undefined) out.color = e.color;
            if (out.brightness === null && e.brightness !== undefined) out.brightness = e.brightness;
        }
        return out;
    };

    XoneK3.applyBeat = function(entry, beat, count) {
        // Count 0 and negative counts are valid — the phrase origin
        // can sit anywhere in the track. Only undefined / null /
        // non-finite mean "nothing to apply".
        if (!beat || typeof count !== 'number' || !isFinite(count)) return entry;
        var lc = XoneK3.beatLevel(beat, count);
        if (!lc) return entry;
        if (lc.skip) return XoneK3.BEAT_HOLD;
        if (lc.color === null && lc.brightness === null) return entry;

        var out = {
            rgb: entry.rgb ? entry.rgb.slice() : null,
            brightness: entry.brightness,
            brightnessOff: entry.brightnessOff,
            type: entry.type
        };
        if (lc.color !== null) {
            var ce = XoneK3.resolveColorEntry(lc.color);
            if (ce && ce.rgb) {
                out.rgb = ce.rgb.slice();
                if (lc.brightness === null && _colorHasBrightness(lc.color)) {
                    out.brightness = ce.brightness;
                }
            }
        }
        if (typeof lc.brightness === 'number') out.brightness = lc.brightness;
        return out;
    };

    // ============================================================
    // K3-MIDI PALETTE
    // ============================================================
    XoneK3.rgbToK2 = function(r, g, b, hw) {
        if (hw <= 0) return -1;
        var peak = Math.max(r, g, b);
        if (peak < 8) return -1;
        var drg = r - g;
        if (drg >  XoneK3.K2_RG_THRESHOLD) return 0;
        if (drg < -XoneK3.K2_RG_THRESHOLD) return 2;
        return 1;
    };

    XoneK3.idxToK2 = function(idx) {
        if (idx >= 0x00 && idx <= 0x0B) {
            var r = idx >> 2, c = idx & 3;
            return { base: 0x28 + (2 - r) * 4 + c, step: 36 };
        }
        if (idx >= 0x0C && idx <= 0x1B) {
            var p = idx - 0x0C;
            var rf = 3 - (p >> 2);
            return { base: 0x18 + rf * 4 + (p & 3), step: 36 };
        }
        if (idx === 0x1C) return { base: 0x0C, step: 4 };
        if (idx === 0x1D) return { base: 0x0F, step: 4 };
        if (idx >= 0x1E && idx <= 0x21) return { base: 0x34 + (idx - 0x1E), step: 36 };
        return null;
    };

    XoneK3.sendK2Note = function(ch, idx, r, g, b, hw) {
        var pos = XoneK3.idxToK2(idx); if (!pos) return;
        var bucket = XoneK3.rgbToK2(r, g, b, hw);
        if (bucket < 0) { midi.sendShortMsg(0x90 + ch, pos.base, 0x00); return; }
        var peak = Math.max(r, g, b);
        var vel = Math.max(4, Math.min(127, Math.round(hw * peak / 127)));
        midi.sendShortMsg(0x90 + ch, pos.base + bucket * pos.step, vel);
    };
})();