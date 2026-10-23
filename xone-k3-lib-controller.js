// xone-k3-lib-controller.js — K3Controller core: constructor,
// patch resolution, focus, top-half mode table, chord.
//
// Split across five files, all extending K3Controller.prototype:
//
//   lib-controller.js          this file — constructor, patches,
//                              focus, top modes, chord, binding
//                              application
//   lib-controller-colour.js   colour-scheme parser (on:, scheme,
//                              schemeFromState, setup)
//   lib-controller-beat.js     timeline, loop clock, display-
//                              source resolution, beat pipeline,
//                              beat clock connections
//   lib-controller-render.js   LED writes, sysex, calibration,
//                              ramp sampling
//   lib-controller-boot.js     rate gate, escape detector,
//                              init/shutdown, boot, halt
//
// Load order matters:
//   lib-controller.js
//   lib-controller-colour.js
//   lib-controller-beat.js
//   lib-controller-render.js
//   lib-controller-boot.js
//
// Inspection probes live in lib-inspect.js.

'use strict';

if (typeof XoneK3 === 'undefined') {
    throw new Error('Xone K3: xone-k3-lib-controller.js — xone-k3-lib-core.js must load first');
}
if (typeof XoneK3._requireLoad !== 'function') {
    throw new Error('Xone K3: xone-k3-lib-controller.js — xone-k3-lib-core.js must load first');
}
XoneK3._requireLoad('xone-k3-lib-controller.js',
    ['Binding', '_bindingDefaults', '_SNAPSHOT_FIELDS',
     '_snapshotTransform', '_parseAccel', '_buildTransferRGB',
     '_tokenFields', 'RATE_CLASSES', '_inferRateClass', 'PATCH_NAMES']);

(function() {
    var PN = XoneK3.PATCH_NAMES;

    // ============================================================
    // TOP-HALF MODE TABLE
    // ============================================================
    // One entry per mode. `owns` lists every patch name that
    // belongs to the mode. `activate(ctrl)` returns the list to
    // activate for the mode given the current focus selections.
    // setTopMode unwinds every patch owned by ANY mode, then adds
    // the target's activate list.
    XoneK3.TOP_MODES = {};
    XoneK3.TOP_MODES.focus = {
        owns: [
            PN.FOCUS_BASE,
            PN.FOCUS_LAYOUT + '1', PN.FOCUS_LAYOUT + '2',
            PN.FOCUS_LAYOUT + '3', PN.FOCUS_LAYOUT + '4'
        ],
        activate: function(ctrl) {
            return [
                PN.FOCUS_BASE,
                PN.FOCUS_LAYOUT + ctrl.selectedFxCurrent
            ];
        }
    };
    XoneK3.TOP_MODES.twoDeck = {
        owns: [
            PN.TWODECK_BASE,
            PN.TWODECK_A_LAYOUT + '1', PN.TWODECK_A_LAYOUT + '2',
            PN.TWODECK_A_LAYOUT + '3', PN.TWODECK_A_LAYOUT + '4',
            PN.TWODECK_B_LAYOUT + '1', PN.TWODECK_B_LAYOUT + '2',
            PN.TWODECK_B_LAYOUT + '3', PN.TWODECK_B_LAYOUT + '4'
        ],
        activate: function(ctrl) {
            return [
                PN.TWODECK_BASE,
                PN.TWODECK_A_LAYOUT + ctrl.selectedFxA,
                PN.TWODECK_B_LAYOUT + ctrl.selectedFxB
            ];
        }
    };
    XoneK3.TOP_MODES.twoDeckMini = {
        owns: [
            PN.MINI_BASE,
            PN.MINI_LAYOUT + '1', PN.MINI_LAYOUT + '2',
            PN.MINI_LAYOUT + '3', PN.MINI_LAYOUT + '4'
        ],
        activate: function(ctrl) {
            return [
                PN.MINI_BASE,
                PN.MINI_LAYOUT + ctrl.selectedFxCurrent
            ];
        }
    };

    // ============================================================
    // STATE FACTORIES
    // ============================================================
    function freshVirtualClock() {
        return { running: false, pos: 0, lastTs: 0, lastTrackPos: 0 };
    }

    function freshDeckState() {
        return {
            count: 1, active: false, hasBeat: false, loopActive: false,
            playing: false,
            displaySource: 'track',
            loopClock: freshVirtualClock(),
            loopStartN: 0, loopEndN: 0,
            lastBeatRepaint: 0, lastBeatEdge: 0, lastPositionSync: 0
        };
    }

    // Exposed for beat.js so _resetBeat / _closeBeatClocks can
    // build fresh state. Not part of the public API.
    XoneK3._freshDeckState = freshDeckState;

    // ============================================================
    // CONTROLLER
    // ============================================================
    XoneK3.K3Controller = function(cfg) {
        this.label = cfg.label;
        this.midiChannel = cfg.midiChannel;

        this.selectedDeckA = cfg.initialDeckA !== undefined ? cfg.initialDeckA : 1;
        this.selectedDeckB = cfg.initialDeckB !== undefined ? cfg.initialDeckB : 2;
        this.selectedDeckC = cfg.initialDeckC !== undefined ? cfg.initialDeckC : 3;
        this.selectedDeckD = cfg.initialDeckD !== undefined ? cfg.initialDeckD : 4;
        this.selectedFxA  = cfg.initialFxA  !== undefined ? cfg.initialFxA  : 1;
        this.selectedFxB  = cfg.initialFxB  !== undefined ? cfg.initialFxB  : 2;
        this.selectedFxC  = cfg.initialFxC  !== undefined ? cfg.initialFxC  : 3;
        this.selectedFxD  = cfg.initialFxD  !== undefined ? cfg.initialFxD  : 4;

        this.activeDeck = (cfg.initialActiveDeck === 'B') ? 'B' : 'A';
        this.activeFx   = (cfg.initialActiveFx   === 'B') ? 'B' : 'A';

        this.selectedDeckCurrent = this.selectedDeckA;
        this.selectedDeckAlt     = this.selectedDeckB;
        this.selectedFxCurrent   = this.selectedFxA;
        this.selectedFxAlt       = this.selectedFxB;

        this.activePatches = (cfg.initialPatches || []).slice();
        this.patches = cfg.patches || {};

        this.isShifted = false;
        this._chordActive = false;

        // Rate gate + escape detector state.
        this._lastLoopChangeMs = 0;
        this._lastRateClaim = null;
        this._expectingLoopOff = { 1: 0, 2: 0, 3: 0, 4: 0 };
        this._escapes = [];
        this._lastEscapePrintKey = null;
        this._lastEscapePrintBucket = 0;

        this._shuttingDown = false;
        this.loadState = { pressed: false };

        // Phase model. _recomputeDepth > 0 while a recompute is
        // running. _recomputeCompletedAt is stamped after the
        // recompute's internal _refreshAllLeds returns. Used by
        // _refreshAllLeds to warn when a caller refreshes
        // standalone right after a recompute, which is a
        // double-repaint.
        this._recomputeDepth = 0;
        this._recomputeCompletedAt = 0;
        // Re-entrancy guard for _refreshAllLeds. The only legitimate
        // nested path today is
        //   _refreshAllLeds → _syncBeatClocks → _openBeatClocks
        //     → _startVirtualClock → _resolveDisplaySource
        //       → _refreshAllLeds('display-source')
        // Skipping the nested call is safe: the outer call iterates
        // every binding after _syncBeatClocks returns, so the new
        // displaySource is picked up there.
        this._refreshAllLedsDepth = 0;

        // Memo for _resolvedTargetHash. WeakMap keyed on cfg
        // objects (owned by _resolvePatch's memo, never mutated,
        // collected with the patch). Entries carry a token
        // fingerprint — a positional snapshot of every field the
        // token table reads. Two reads with the same fingerprint
        // are guaranteed to resolve every token to the same value.
        // Because the fingerprint derives from XoneK3.TOKENS, any
        // state change that could alter a token's resolved value
        // changes the fingerprint, invalidating the entry. No
        // counter to remember to bump.
        this._resolvedTargetHashCache = new WeakMap();

        this.sysex = (cfg.sysex === false) ? false : true;

        this.channelPerceptual = cfg.channelPerceptual.slice();
        this.wbGain            = cfg.wbGain.slice();
        this.hkBoost           = cfg.hkBoost;
        this.lumGamma          = cfg.lumGamma;
        this.calibrationMode   = (cfg.calibrationMode === 'rms') ? 'rms' : 'off';
        this.wbActive          = (cfg.wbActive === false) ? false : true;

        this._phraseOrigin = { 1: 0, 2: 0, 3: 0, 4: 0 };

        this.activeDeckVirtual   = false;
        this.activeLoopVirtual   = false;
        this.activeDisplaySource = 'track';

        this._decks = {
            1: freshDeckState(),
            2: freshDeckState(),
            3: freshDeckState(),
            4: freshDeckState()
        };
        this._refreshActiveAlt();

        this._beatLeds = [];
        this._beatConns = [];
        this._playConns = [];
        this._onBeat = null;

        this._ledCache = {};
        this._sysexQueue = [];
        this._sysexTimer = null;

        this._transfer = null;
        if (typeof cfg.calibration === 'string') {
            var curve = (XoneK3.LED_TRANSFERS || {})[cfg.calibration];
            if (curve && curve.r && curve.g && curve.b) {
                this._transfer = XoneK3._buildTransferRGB(curve);
            } else {
                print('Xone K3: calibration curve "' + cfg.calibration +
                      '" missing for ' + this.label + '; calibration off.');
            }
        }
        if (!this._transfer) this.calibrationMode = 'off';

        this._trackMetaCache = {};
        this._hwCache = {};
        this._hwCacheSize = 0;
        // Per-controller cache for _flatTarget. Keyed first by a
        // per-segments-array id (segs._cacheId, assigned lazily),
        // then by _calibKey on read. Two controllers with
        // different _calibKey no longer thrash each other's
        // entries on the same compiled scheme.
        this._flatCache = {};
        // Curve name is part of the key: two controllers with
        // different LED transfer curves (same wbGain / perceptual /
        // hkBoost / lumGamma) must not share the flat target cache,
        // or the wrong flat target gets solved. 'none' covers the
        // "curve missing, calibration disabled" fallback above.
        this._calibKey = [
            cfg.calibration || 'none',
            this.calibrationMode,
            this.wbGain.join(','),
            this.channelPerceptual.join(','),
            this.hkBoost,
            this.lumGamma
        ].join('|');

        this._buildHardware();

        this.k2Indices = {};
        for (var pname in this.patches) {
            if (!this.patches.hasOwnProperty(pname)) continue;
            var patch = this.patches[pname];
            if (!patch || typeof patch !== 'object') continue;
            for (var bname in patch) {
                if (!patch.hasOwnProperty(bname)) continue;
                if (bname.charAt(0) === '_') continue;
                if (bname === 'patch') continue;
                var bcfg = patch[bname];
                if (!bcfg || typeof bcfg !== 'object') continue;
                if (bcfg.k2 !== true) continue;
                var b = this.bindings[bname];
                if (b && b.idx >= 0) this.k2Indices[b.idx] = true;
            }
        }
        if (Array.isArray(cfg.k2Indices)) {
            for (var ki = 0; ki < cfg.k2Indices.length; ki++) {
                this.k2Indices[cfg.k2Indices[ki]] = true;
            }
        }

        this._applied = {};
        this._appliedHashes = {};
        this._appliedCfgs = {};
        // Patches are set once at construction and never mutated.
        // Memoize the merged result per name so a repeated recompute
        // over the same stack reuses the same cfg object references.
        // That keeps _applyResolved's `oldCfgs[name] === cfg`
        // short-circuit live — otherwise every binding re-hashes on
        // every recompute.
        this._resolvedPatchCache = {};

        for (var pi = 0; pi < this.activePatches.length; pi++) {
            var pWant = this._resolveFxPatchName(this.activePatches[pi]);
            if (pWant) this.activePatches[pi] = pWant;
        }
    };

    // ============================================================
    // HARDWARE
    // ============================================================
    XoneK3.K3Controller.prototype._buildHardware = function() {
        var ch = this.midiChannel;
        var self = this;
        var bindings = {};

        function add(name, status, note, type) {
            var idx = XoneK3.noteToLEDIndex(note);
            bindings[name] = new XoneK3.Binding(
                name,
                { midi: [status + ch, note], type: type, idx: idx },
                self
            );
        }

        for (var i = 0; i < 4; i++) {
            add('encoder' + i, 0xB0, 0x00 + i, 'encoder');
            add('fader' + i,   0xB0, 0x10 + i, 'fader');
            add('press' + i,   0x90, 0x34 + i, 'button');
        }
        for (var r = 0; r < 3; r++) {
            for (var c = 0; c < 4; c++) {
                add('knob' + c + '_' + r, 0xB0, 0x04 + r * 4 + c, 'knob');
                add('button' + c + '_' + r, 0x90, 0x30 - r * 4 + c, 'button');
            }
        }
        add('encoderL', 0xB0, 0x14, 'encoder');
        add('encoderR', 0xB0, 0x15, 'encoder');
        add('pressL',   0x90, 0x0D, 'button');
        add('pressR',   0x90, 0x0E, 'button');

        for (var r2 = 0; r2 < 4; r2++) {
            for (var c2 = 0; c2 < 4; c2++) {
                add('grid' + c2 + '_' + r2, 0x90, 0x24 - r2 * 4 + c2, 'button');
            }
        }

        add('layer', 0x90, XoneK3.LAYER_BUTTON_NOTE, 'button');
        add('shift', 0x90, XoneK3.SHIFT_BUTTON_NOTE, 'button');

        this.bindings = bindings;
    };

    // ============================================================
    // PATCH RESOLUTION
    // ============================================================
    XoneK3.K3Controller.prototype._parentList = function(name) {
        var p = this.patches[name];
        if (!p || !p.patch) return [];
        return Array.isArray(p.patch) ? p.patch : [p.patch];
    };

    XoneK3.K3Controller.prototype._resolvePatch = function(name, seen) {
        // Memoized. Patches are fixed at construction; a resolved
        // patch is stable for the controller's lifetime. Returning
        // the cached object keeps cfg references identical across
        // recomputes, which is what makes the hash short-circuit
        // in _applyResolved fire.
        //
        // `seen` still guards cycle detection during the first
        // resolution. Cached results are only written on success,
        // so a cycle throws before anything is stored.
        var cached = this._resolvedPatchCache[name];
        if (cached !== undefined) return cached;

        var p = this.patches[name];
        if (!p) return {};
        seen = seen || {};
        if (seen[name]) throw new Error('Patch cycle: ' + name);
        seen[name] = true;
        var out = {};
        var parents = this._parentList(name);
        for (var i = 0; i < parents.length; i++) {
            Object.assign(out, this._resolvePatch(parents[i], seen));
        }
        var own = Object.assign({}, p);
        delete own.patch;
        delete own._host;
        Object.assign(out, own);
        seen[name] = false;
        this._resolvedPatchCache[name] = out;
        return out;
    };

    XoneK3.K3Controller.prototype._collectShiftPatches = function(name, out, seen) {
        var p = this.patches[name];
        if (!p || seen[name]) return;
        seen[name] = true;
        var parents = this._parentList(name);
        for (var i = 0; i < parents.length; i++) {
            this._collectShiftPatches(parents[i], out, seen);
        }
        if (p._shift && out.indexOf(p._shift) === -1) out.push(p._shift);
    };

    XoneK3.K3Controller.prototype._patchActive = function(name) {
        if (this.activePatches.indexOf(name) === -1) return false;
        var p = this.patches[name];
        if (!p) return false;
        if (!p._host) return true;
        var hosts = Array.isArray(p._host) ? p._host : [p._host];
        for (var i = 0; i < hosts.length; i++) {
            if (this.activePatches.indexOf(hosts[i]) !== -1) return true;
        }
        return false;
    };

    XoneK3.K3Controller.prototype._buildStack = function() {
        var stack = [];

        var hasChord = false;
        for (var i = 0; i < this.activePatches.length; i++) {
            var name = this.activePatches[i];
            if (!this.patches[name]) continue;
            if (!this._patchActive(name)) continue;
            if (name === PN.CHORD) { hasChord = true; continue; }
            if (stack.indexOf(name) === -1) stack.push(name);
        }

        if (this.isShifted) {
            var shiftPatches = [], seen = {};
            for (var j = 0; j < stack.length; j++) {
                this._collectShiftPatches(stack[j], shiftPatches, seen);
            }
            for (var k = 0; k < shiftPatches.length; k++) {
                if (stack.indexOf(shiftPatches[k]) === -1) stack.push(shiftPatches[k]);
            }
        }

        if (hasChord) stack.push(PN.CHORD);

        return stack;
    };

    XoneK3.K3Controller.prototype._resolveStack = function(stack) {
        var out = {};
        for (var i = 0; i < stack.length; i++) {
            Object.assign(out, this._resolvePatch(stack[i], {}));
        }
        return out;
    };

    // ============================================================
    // RECOMPUTE
    // ============================================================
    // The recompute cycle is self-contained: it ends with
    // _refreshAllLeds, so callers do not refresh afterward.
    // _recomputeDepth is incremented for the duration so that
    // _refreshAllLeds can distinguish "called from inside a
    // recompute" (expected) from "called standalone right after
    // one" (usually a double repaint — warn).
    XoneK3.K3Controller.prototype._recompute = function() {
        this._recomputeDepth++;
        try {
            var resolved = this._resolveStack(this._buildStack());
            this._applyResolved(resolved);
            // loadState.pressed is controller-scoped and is only
            // cleared by loadSelectedTrack's release branch. A
            // patch change can swap the binding under a held
            // pressR; the release event then goes to a different
            // binding, and the flag sticks true. The next
            // k3Select press would load a track instead of
            // selecting a channel. Clearing here keeps the flag
            // consistent with the current stack.
            this.loadState.pressed = false;
            this._afterRecompute();
            this._refreshAllLeds();
            this._recomputeCompletedAt = Date.now();
        } finally {
            this._recomputeDepth--;
        }
    };

    XoneK3.K3Controller.prototype._afterRecompute = function() {};
    XoneK3.K3Controller.prototype._onInput = function(b) {};
    XoneK3.K3Controller.prototype._onPatchChange = function(from, to) {};

    // ============================================================
    // PER-BINDING TRY/CATCH HELPER
    // ============================================================
    // A single throwing binding (bad scheme, bad config, transient
    // CO miss) must not stop a pass over every binding. _applyResolved
    // and _refreshAllLeds both use this so one bad binding warns
    // once and lets the rest of the pass continue.
    //
    // The method reference and its argument array are passed
    // separately. Loop variables are captured into `args` at the
    // call site, before entering the helper — so no closure over
    // `var`-scoped names exists, and the helper is safe under any
    // future change that would make it asynchronous or re-entrant.
    XoneK3.K3Controller.prototype._safeBinding = function(fn, thisArg, args, warnKey, warnPrefix) {
        try {
            fn.apply(thisArg, args);
        } catch (e) {
            XoneK3._warnOnce(warnKey, warnPrefix + (e && e.message ? e.message : e));
        }
    };

    // ============================================================
    // APPLY RESOLVED
    // ============================================================
    XoneK3.K3Controller.prototype._applyResolved = function(resolved) {
        var oldHashes = this._appliedHashes || {};
        var oldCfgs   = this._appliedCfgs   || {};
        var newHashes = {};
        var newCfgs   = {};
        var ctrl = this;

        for (var oldName in oldHashes) {
            if (!oldHashes.hasOwnProperty(oldName)) continue;
            if (oldName.charAt(0) === '_') continue;
            if (resolved[oldName] === undefined) {
                this._safeBinding(
                    ctrl._applyBinding, ctrl, [oldName, null],
                    'applyUnbindThrow:' + oldName,
                    '_applyBinding(' + oldName + ', null) threw: ');
            }
        }

        for (var name in resolved) {
            if (!resolved.hasOwnProperty(name)) continue;
            if (name.charAt(0) === '_') continue;
            var cfg = resolved[name];
            var h;
            if (oldCfgs[name] === cfg) {
                h = oldHashes[name];
            } else {
                h = XoneK3._hashBinding(cfg);
            }
            newHashes[name] = h;
            newCfgs[name]   = cfg;
            if (oldHashes[name] === h) continue;
            this._safeBinding(
                ctrl._applyBinding, ctrl, [name, cfg],
                'applyBindThrow:' + name,
                '_applyBinding(' + name + ') threw: ');
        }

        this._applied = resolved;
        this._appliedHashes = newHashes;
        this._appliedCfgs = newCfgs;
    };

    XoneK3.K3Controller.prototype._snapshotBinding = function(b) {
        var snap = {};
        for (var i = 0; i < XoneK3._SNAPSHOT_FIELDS.length; i++) {
            var src = XoneK3._SNAPSHOT_FIELDS[i][0];
            var dst = XoneK3._SNAPSHOT_FIELDS[i][1];
            snap[dst] = XoneK3._snapshotTransform(src, b[src]);
        }
        return snap;
    };

    XoneK3.K3Controller.prototype._unbind = function(b, prev) {
        if (prev.wasPot && prev.group && prev.inKey) {
            engine.softTakeoverIgnoreNextValue(prev.group, prev.inKey);
        }
        if (prev.wasBound && !prev.wasNoLED && prev.idx >= 0) {
            this.sendLED(prev.idx, 0, 0, 0, 0, prev.wasK2);
        }
    };

    XoneK3.K3Controller.prototype._bindCore = function(b, cfg) {
        b._rawCfg = cfg;
        b.group   = XoneK3.resolve(cfg.group, this);
        b.inKey   = XoneK3.resolve(cfg.inKey, this);
        b.outKey  = cfg.outKey ? XoneK3.resolve(cfg.outKey, this) : undefined;
        b.buttonMode = (cfg.type === 'push') ? 'push' : 'toggle';
        b.softTakeover = (cfg.softTakeover !== undefined)
            ? cfg.softTakeover
            : (b.type === 'knob' || b.type === 'fader');
        b._noLED = cfg.noLED === true;
        b._k2 = (cfg.k2 === true) ? true : undefined;
        b._accel      = XoneK3._parseAccel(cfg.accel);
        b._valueCurve = (typeof cfg.valueCurve === 'number' && cfg.valueCurve > 0)
            ? cfg.valueCurve : 1;
        b._rateClass  = this._resolveRateClass(cfg);
    };

    XoneK3.K3Controller.prototype._collectTokens = function(b, cfg) {
        var sources = XoneK3._tokenFields(cfg);
        for (var ti = 0; ti < XoneK3.TOKENS.length; ti++) {
            var tok = XoneK3.TOKENS[ti].token;
            for (var i = 0; i < sources.length; i++) {
                if (sources[i][1] !== undefined &&
                    typeof sources[i][1] === 'string' &&
                    sources[i][1].indexOf(tok) !== -1) {
                    b._usedTokens.push(tok);
                    break;
                }
            }
        }
    };

    XoneK3.K3Controller.prototype._rearmSoftTakeover = function(b, prev) {
        if (!prev.wasPot || !b.group || !b.inKey || !b.softTakeover) return;
        if (b.group === prev.group && b.inKey === prev.inKey) return;
        engine.softTakeover(b.group, b.inKey, false);
        engine.softTakeover(b.group, b.inKey, true);

        // Bridge. After rearm, Mixxx is uninitialized and will
        // drop the next write unless it lands within its internal
        // tolerance of the current CO. A physical that is already
        // near CO at rearm time — the common case when switching
        // back to a deck whose fader/knob hasn't moved — would
        // otherwise get stuck at the endpoint, because no physical
        // step can cross into tolerance when the physical sits at
        // the limit. Write CO's own value back to itself: diff is
        // zero, Mixxx's check passes, initialized flips to true,
        // subsequent writes are accepted regardless of step size.
        //
        // Tolerance is TAKEOVER_EPSILON, deliberately larger than
        // CO_MATCH_EPSILON. LED "matched" state implies control.
        // LED "unmatched" inside the gap is a false negative —
        // harmless, control is live, first touch flips the LED.
        if (b._normalized !== undefined) {
            var co = engine.getParameter(b.group, b.inKey);
            if (Math.abs(co - b._normalized) <= XoneK3.TAKEOVER_EPSILON) {
                engine.setParameter(b.group, b.inKey, co);
            }
        }
    };

    XoneK3.K3Controller.prototype._bindFunc = function(b, cfg) {
        if (!cfg.func) return;
        var f = cfg.func;
        if (typeof f !== 'function') {
            XoneK3._warnOnce('funcType:' + b._name,
                'binding func must be a function reference, got ' +
                typeof f + ' on ' + b._name);
            return;
        }
        b._func = f;
        b._funcArgs = cfg.args || [];
    };

    XoneK3.K3Controller.prototype._bindConns = function(b) {
        b._armOwnConn();
        // A hotcue LED also watches the hotcue's colour CO, so the
        // LED repaints when the user re-colours the pad in Mixxx.
        if (b.outKey && b.group) {
            var m = b.outKey.match(/^(hotcue_\d+)_status$/);
            if (m) {
                b._conns.push(engine.makeConnection(b.group, m[1] + '_color', function() {
                    b._refresh();
                }));
            }
        }
        // Wire the outKey listener — unless on: already owns the
        // on/off source (see _parseCsOn). _csOn is null when unset,
        // true/false for unconditional, or an object for conditional.
        if (b.group && b.outKey && (b._csOn === null || b._csOn === undefined)) {
            b._conns.push(engine.makeConnection(b.group, b.outKey, function() {
                b._refresh();
            }));
        }
    };

    // ============================================================
    // RESOLVED-TARGET HASH
    // ============================================================
    // Fingerprint of every controller field the token table reads
    // from. Positional, `|`-separated, so [1, 12] cannot collide
    // with [11, 2]. Derived from XoneK3.TOKENS — a new token
    // added to the registry is automatically covered, no counter
    // to remember to bump. Two fingerprints that compare equal
    // guarantee that every token resolves to the same value.
    XoneK3.K3Controller.prototype._tokenFingerprint = function() {
        var parts = [];
        for (var i = 0; i < XoneK3.TOKENS.length; i++) {
            parts.push(this[XoneK3.TOKENS[i].state]);
        }
        return parts.join('|');
    };

    // Resolve a binding's token-bearing fields to their current
    // targets and hash the result. Used by _reapplyByTokens to
    // skip bindings whose resolved target didn't change when a
    // focus token moved. Covers every field _tokenFields
    // enumerates, so the hash is complete.
    //
    // Memoized per (cfg, token fingerprint). The cfg object is
    // owned by _resolvePatch's memo, never mutated, so a cfg's
    // resolved hash is stable as long as the fingerprint is.
    // Callers that already hold a fingerprint (the hot path in
    // _reapplyByTokens, and _applyBinding when called from there)
    // pass it in; others let it compute on demand.
    XoneK3.K3Controller.prototype._resolvedTargetHash = function(cfg, fingerprint) {
        if (!cfg) return '';
        if (fingerprint === undefined) fingerprint = this._tokenFingerprint();

        var cached = this._resolvedTargetHashCache.get(cfg);
        if (cached && cached.fingerprint === fingerprint) return cached.value;

        var parts = [];
        parts.push(XoneK3.resolve(cfg.group,  this) || '');
        parts.push(XoneK3.resolve(cfg.inKey,  this) || '');
        parts.push(XoneK3.resolve(cfg.outKey, this) || '');
        var cs = cfg.colorScheme;
        if (cs) {
            if (cs.on && cs.on.group !== undefined) {
                parts.push(XoneK3.resolve(cs.on.group, this) || '');
            }
            if (cs.schemeFromState) {
                if (cs.schemeFromState.group !== undefined) {
                    parts.push(XoneK3.resolve(cs.schemeFromState.group, this) || '');
                }
                if (cs.schemeFromState.co !== undefined) {
                    parts.push(XoneK3.resolve(cs.schemeFromState.co, this) || '');
                }
            }
        }
        var value = parts.join('\u0001');
        this._resolvedTargetHashCache.set(cfg, { fingerprint: fingerprint, value: value });
        return value;
    };

    XoneK3.K3Controller.prototype._applyBinding = function(name, cfg, fingerprint) {
        var b = this.bindings[name];
        if (!b) return;

        var prev = this._snapshotBinding(b);
        b._reset();

        if (cfg === null || cfg === undefined) {
            this._unbind(b, prev);
            b._resolvedTargetHash = undefined;
            return;
        }

        this._bindCore(b, cfg);
        XoneK3._auditBindingCfg(cfg, name);
        this._collectTokens(b, cfg);
        this._rearmSoftTakeover(b, prev);
        this._bindFunc(b, cfg);

        if (cfg.colorScheme !== undefined) {
            this._setupColorScheme(b, cfg.colorScheme);
        }
        if (b._csSchemeFn || (b._csScheme && b._csScheme.beat)) {
            this._attachBeatLed(b);
        }

        this._bindConns(b);

        // Store the resolved-target hash so _reapplyByTokens can
        // skip this binding on the next focus flip if the token
        // resolution is unchanged. Cheap (one resolve per token
        // field), only runs on actual rebinds.
        //
        // _reapplyByTokens already holds a fingerprint for the
        // current pass and threads it in — the resolver then hits
        // its memo instead of recomputing the fingerprint. Other
        // callers (tests, direct invocations) pass undefined and
        // pay one fingerprint computation, which is fine.
        b._resolvedTargetHash = this._resolvedTargetHash(cfg, fingerprint);

        // Refresh this binding immediately. During a full _recompute
        // the trailing _refreshAllLeds also walks it — compute is
        // duplicated, wire send is deduped by _ledCache. Callers
        // that apply a single binding outside a recompute (tests,
        // _reapplyByTokens first pass, H.bind) rely on this.
        b._refresh();
    };

    // ============================================================
    // SCHEME COMPILATION — render-time entry point.
    // ============================================================
    // The parse-time half (on:, scheme, schemeFromState, setup)
    // lives in lib-controller-colour.js. This wrapper is called
    // from _evaluateScheme on every render of a scheme-function
    // binding, so it stays here with the other render-adjacent
    // core helpers.
    XoneK3.K3Controller.prototype._resolveSchemeRef = function(ref) {
        if (ref === undefined || ref === null) return null;
        return XoneK3.compileScheme(ref);
    };

    // ============================================================
    // PATCH LIST MUTATIONS
    // ============================================================
    XoneK3.K3Controller.prototype.addPatch = function(name) {
        if (!this.patches[name]) { print('Unknown patch: ' + name); return; }
        if (this.activePatches.indexOf(name) !== -1) return;
        this.activePatches.push(name);
        this._recompute();
        this._onPatchChange(null, name);
    };

    XoneK3.K3Controller.prototype.removePatch = function(name) {
        var i = this.activePatches.indexOf(name);
        if (i === -1) return;
        this.activePatches.splice(i, 1);
        this._recompute();
        this._onPatchChange(name, null);
    };

    XoneK3.K3Controller.prototype.replacePatch = function(from, to) {
        if (!this.patches[to]) { print('Unknown patch: ' + to); return; }
        var i = this.activePatches.indexOf(from);
        if (i === -1) return;
        this.activePatches[i] = to;
        this._recompute();
        this._onPatchChange(from, to);
    };

    XoneK3.K3Controller.prototype._batchPatches = function(mutator) {
        var before = this.activePatches.slice();
        try {
            mutator(this.activePatches);
        } catch (e) {
            this.activePatches.length = 0;
            for (var b = 0; b < before.length; b++) this.activePatches.push(before[b]);
            print('[k3] _batchPatches mutator threw: ' + (e && e.message ? e.message : e));
            throw e;
        }
        var after = this.activePatches;

        var beforeSet = {};
        for (var i = 0; i < before.length; i++) beforeSet[before[i]] = true;
        var afterSet = {};
        for (var j = 0; j < after.length; j++) afterSet[after[j]] = true;

        var anyChange = (before.length !== after.length);
        if (!anyChange) {
            for (var k = 0; k < before.length; k++) {
                if (before[k] !== after[k]) { anyChange = true; break; }
            }
        }
        if (!anyChange) return;

        this._recompute();

        for (var r = 0; r < before.length; r++) {
            if (!afterSet[before[r]]) this._onPatchChange(before[r], null);
        }
        for (var a = 0; a < after.length; a++) {
            if (!beforeSet[after[a]]) this._onPatchChange(null, after[a]);
        }
    };

    // ============================================================
    // TOP-HALF MODES
    // ============================================================
    XoneK3.K3Controller.prototype.currentTopMode = function() {
        for (var mode in XoneK3.TOP_MODES) {
            if (!XoneK3.TOP_MODES.hasOwnProperty(mode)) continue;
            if (this._patchActive(XoneK3.TOP_MODES[mode].owns[0])) return mode;
        }
        return null;
    };

    // Unwinds every patch owned by ANY top mode, then re-inserts
    // the target's activate list at the position where the first
    // owned patch sat. Non-owned patches (cue, overlays, …) keep
    // their relative order and stay on the same side of the
    // top-half block, so resolution precedence between top and
    // non-top patches is preserved across mode swaps.
    XoneK3.K3Controller.prototype.setTopMode = function(mode) {
        var target = XoneK3.TOP_MODES[mode];
        if (!target) { print('[k3] unknown top mode: ' + mode); return; }
        var ownedByAnyMode = {};
        for (var m in XoneK3.TOP_MODES) {
            if (!XoneK3.TOP_MODES.hasOwnProperty(m)) continue;
            var owns = XoneK3.TOP_MODES[m].owns;
            for (var i = 0; i < owns.length; i++) ownedByAnyMode[owns[i]] = true;
        }
        var ctrl = this;
        this._batchPatches(function(patches) {
            var insertAt = patches.length;
            for (var j = patches.length - 1; j >= 0; j--) {
                if (ownedByAnyMode[patches[j]]) {
                    patches.splice(j, 1);
                    insertAt = j;
                }
            }
            var adds = target.activate(ctrl);
            for (var k = 0; k < adds.length; k++) {
                patches.splice(insertAt + k, 0, adds[k]);
            }
        });
    };

    // ============================================================
    // SHIFT + CHORD
    // ============================================================
    XoneK3.K3Controller.prototype.shift = function() {
        if (this.isShifted) return;
        this.isShifted = true;
        this._recompute();
    };

    XoneK3.K3Controller.prototype.unshift = function() {
        if (!this.isShifted) return;
        this.isShifted = false;
        this._recompute();
    };

    XoneK3.K3Controller.prototype._enterChord = function() {
        if (this._chordActive) return;
        if (!this.patches[PN.CHORD]) return;
        this._chordActive = true;
        this.addPatch(PN.CHORD);
    };

    XoneK3.K3Controller.prototype._exitChord = function() {
        if (!this._chordActive) return;
        this._chordActive = false;
        this.removePatch(PN.CHORD);
    };

    XoneK3.K3Controller.prototype.onShiftButton = function(v, s) {
        var pressed = this._isPress(v, s);
        if (pressed) {
            this.shift();
        } else {
            if (this._chordActive) this._exitChord();
            this.unshift();
        }
    };

    // ============================================================
    // LED REPAINT
    // ============================================================
    // Re-entrancy guard. The only legitimate nested path today is
    //   _refreshAllLeds → _syncBeatClocks → _openBeatClocks
    //     → _startVirtualClock → _resolveDisplaySource
    //       → _refreshAllLeds('display-source')
    // Skipping the nested call is safe: the outer call iterates
    // every binding after _syncBeatClocks returns, so the new
    // displaySource is picked up there.
    //
    // Per-binding try/catch via _safeBinding. A single throwing
    // binding (bad scheme, transient CO miss) must not stop the
    // pass — later bindings (layer, shift) would otherwise never
    // repaint, and the layer/shift beat pulse would visibly freeze
    // even though the clocks were open.
    XoneK3.K3Controller.prototype._refreshAllLeds = function(why) {
        if (this._refreshAllLedsDepth > 0) return;
        this._refreshAllLedsDepth++;
        try {
            if (this._recomputeDepth === 0 &&
                this._recomputeCompletedAt &&
                (Date.now() - this._recomputeCompletedAt) < 10 &&
                why === undefined) {
                XoneK3._warnOnce('redundantRefresh:' + this.label,
                    this.label + ': _refreshAllLeds called outside a recompute ' +
                    'within 10ms of one finishing — the recompute already ' +
                    'refreshed. If this standalone refresh is intentional ' +
                    '(token reapply, timesig change, lab), pass a reason string.');
            }
            this._syncBeatClocks();
            for (var k in this.bindings) {
                if (!this.bindings.hasOwnProperty(k)) continue;
                var b = this.bindings[k];
                if (b.idx < 0) continue;
                this._safeBinding(
                    b._refresh, b, [],
                    'refreshAllThrow:' + b._name,
                    '_refreshAllLeds: ' + b._name + ' threw: ');
            }
        } finally {
            this._refreshAllLedsDepth--;
        }
    };

    XoneK3.K3Controller.prototype._validateBindings = function() {
        if (this._validated) return;
        this._validated = true;

        var issues = 0;
        var seen = {};

        for (var name in this.bindings) {
            if (!this.bindings.hasOwnProperty(name)) continue;
            var b = this.bindings[name];
            if (!b._rawCfg) continue;
            var sources = XoneK3._tokenFields(b._rawCfg);

            for (var s = 0; s < sources.length; s++) {
                var field = sources[s][0];
                var val   = sources[s][1];
                if (typeof val !== 'string') continue;
                var unknown = XoneK3._findUnknownTokens(val);
                for (var u = 0; u < unknown.length; u++) {
                    var key = name + '|' + field + '|' + unknown[u];
                    if (seen[key]) continue;
                    seen[key] = true;
                    XoneK3._warnOnce('token:' + key,
                        'unknown token ' + unknown[u] +
                        ' in ' + b._name + '.' + field);
                    issues++;
                }
            }

            if (XoneK3._debugPrintsOn) {
                var cfg = b._rawCfg;
                var inferred = XoneK3._inferRateClass(cfg);
                var declared = cfg.rate;
                if (declared === false && inferred) {
                    print('[k3] binding ' + name +
                        ' writes loop-relevant CO but rate: false — ' +
                        'loop could skip on this control (inferred: ' +
                        inferred + ')');
                    issues++;
                } else if (typeof declared === 'string' && inferred &&
                           declared !== inferred) {
                    print('[k3] binding ' + name +
                        ' declares rate "' + declared +
                        '" but inKey/func implies "' + inferred + '"');
                    issues++;
                } else if (inferred === null && declared === undefined &&
                           typeof cfg.func === 'function' &&
                           cfg.inKey &&
                           // Broad audit predicate — deliberately wider
                           // than _inferRateClass's inKey branches. The
                           // classifier maps specific movement COs to
                           // specific classes and must NOT, e.g., label
                           // beatjump_size as 'jump'. The audit just
                           // wants to catch "custom func touches a
                           // loop-adjacent CO without declaring a rate".
                           // Do not fold these two predicates together.
                           /^(beatjump_|beatloop_|reloop_|loop_)/.test(cfg.inKey)) {
                    print('[k3] binding ' + name +
                        ' — custom func + loop-relevant inKey, no rate class ' +
                        "inferred. Set rate: 'jump' / 'edit', or rate: false " +
                        'to silence.');
                    issues++;
                }
            }
        }

        if (issues > 0) {
            print('[k3] ' + issues + ' binding warning(s) — check the tokens above.');
        }
    };

    // ============================================================
    // SELECT / STATE
    // ============================================================
    XoneK3.K3Controller.prototype.setSelectedFor = function(kind, which, value) {
        if (value < 1 || value > 4) return;
        var stateProp = XoneK3._selProp(kind, which);
        if (this[stateProp] === undefined || this[stateProp] === value) return;
        this[stateProp] = value;
        this._refreshActiveAlt();

        var upper = kind.toUpperCase();
        var tokens = [
            '$' + upper + '_' + which + '$',
            '$' + upper + '_' + which + '_N$'
        ];
        if (kind === 'deck') {
            if (which === this.activeDeck) tokens.push('$DECK_ACTIVE$', '$DECK_ACTIVE_N$');
            else                          tokens.push('$DECK_ALT$',    '$DECK_ALT_N$');
        } else if (kind === 'fx') {
            if (which === this.activeFx)  tokens.push('$FX_ACTIVE$', '$FX_ACTIVE_N$');
            else                          tokens.push('$FX_ALT$',    '$FX_ALT_N$');
        }

        // FX path: skip the token-reapply refresh. _syncFxLayout
        // runs its own recompute (which refreshes) when it
        // actually swaps the layout patch; if it doesn't swap,
        // refresh here instead. One repaint either way.
        var isFx   = (kind === 'fx');
        var isDeck = (kind === 'deck');
        this._reapplyByTokens(tokens, { skipRefresh: isFx || isDeck });
        if (isFx || isDeck) {
            var r = this._syncFxLayout();
            if (!r.swapped) this._refreshAllLeds(isFx ? 'focus-fx' : 'focus-deck');
        }
    };

    XoneK3.K3Controller.prototype.setActiveDeck = function(slot) {
        if (slot !== 'A' && slot !== 'B') return;
        if (this.activeDeck === slot) return;
        this.activeDeck = slot;
        this._refreshActiveAlt();
        this._reapplyByTokens(['$DECK_ACTIVE$', '$DECK_ACTIVE_N$',
                            '$DECK_ALT$',    '$DECK_ALT_N$'],
                            { skipRefresh: true });
        // _syncFxLayout refreshes via its own recompute when it
        // swaps the fxLayoutA*/fxLayoutB* patches; we refresh here
        // when it doesn't. One repaint per focus flip.
        var r = this._syncFxLayout();
        if (!r.swapped) this._refreshAllLeds('focus-deck');
    };

    XoneK3.K3Controller.prototype.setActiveFx = function(slot) {
        if (slot !== 'A' && slot !== 'B') return;
        if (this.activeFx === slot) return;
        this.activeFx = slot;
        this._refreshActiveAlt();
        // Same skip pattern as setSelectedFor: _syncFxLayout
        // refreshes via its recompute when it swaps; we refresh
        // here when it doesn't. One repaint per focus flip.
        this._reapplyByTokens(['$FX_ACTIVE$', '$FX_ACTIVE_N$',
                            '$FX_ALT$',    '$FX_ALT_N$'],
                            { skipRefresh: true });
        var r = this._syncFxLayout();
        if (!r.swapped) this._refreshAllLeds('focus-fx');
    };

    XoneK3.K3Controller.prototype._refreshActiveAlt = function() {
        var isDeckB = (this.activeDeck === 'B');
        var isFxB   = (this.activeFx   === 'B');
        this.selectedDeckCurrent = isDeckB ? this.selectedDeckB : this.selectedDeckA;
        this.selectedDeckAlt     = isDeckB ? this.selectedDeckA : this.selectedDeckB;
        this.selectedFxCurrent   = isFxB   ? this.selectedFxB   : this.selectedFxA;
        this.selectedFxAlt       = isFxB   ? this.selectedFxA   : this.selectedFxB;
        this._refreshDisplayFlags();
    };

    XoneK3.K3Controller.prototype._reapplyByTokens = function(tokens, opts) {
        // Short-circuit: if the resolved target (after token
        // substitution) is identical to what the binding already
        // has, skip the rebind. A focus flip between two slots
        // that resolve to the same channel no longer disconnects
        // and reconnects every token-carrying binding's CO
        // listeners.
        //
        // b._resolvedTargetHash is written by _applyBinding at
        // every successful bind, so this is a true identity
        // comparison, not a "have we seen this before" cache.
        // _resolvedTargetHash itself is memoized per (cfg, token
        // fingerprint), so the per-binding compare is a WeakMap
        // hit against a fingerprint computed once for the whole
        // pass — not a fresh resolve per binding. The fingerprint
        // is also threaded into _applyBinding so a real rebind
        // reuses the same fingerprint for its hash write.
        //
        // Fingerprint is computed lazily on first hit. A stack
        // with no token-carrying bindings never pays for it.
        var fingerprint = null;

        for (var name in this.bindings) {
            var b = this.bindings[name];
            if (!b._usedTokens || !b._rawCfg) continue;
            var hit = false;
            for (var i = 0; i < tokens.length; i++) {
                if (b._usedTokens.indexOf(tokens[i]) !== -1) { hit = true; break; }
            }
            if (!hit) continue;
            if (fingerprint === null) fingerprint = this._tokenFingerprint();
            var h = this._resolvedTargetHash(b._rawCfg, fingerprint);
            if (b._resolvedTargetHash === h) continue;
            this._applyBinding(name, b._rawCfg, fingerprint);
        }
        // Callers that will refresh themselves — setSelectedFor and
        // setActiveFx via _syncFxLayout — pass { skipRefresh: true }
        // to avoid a double repaint on a focus flip. Everything else
        // (deck focus, direct callers) refreshes here.
        if (!(opts && opts.skipRefresh)) {
            this._refreshAllLeds('token-reapply');
        }
    };

    XoneK3.K3Controller.prototype._resolveFxPatchName = function(name) {
        var m = /^fx(Layout[AB]?|Mini)(\d)$/.exec(name);
        if (m) {
            var kind = m[1];
            var want;
            if      (kind === 'LayoutA') want = PN.TWODECK_A_LAYOUT + this.selectedFxA;
            else if (kind === 'LayoutB') want = PN.TWODECK_B_LAYOUT + this.selectedFxB;
            else if (kind === 'Mini')    want = PN.MINI_LAYOUT    + this.selectedFxCurrent;
            else                         want = PN.FOCUS_LAYOUT   + this.selectedFxCurrent;
            return this.patches[want] ? want : null;
        }
        return undefined;
    };

    XoneK3.K3Controller.prototype._syncFxLayout = function() {
        var swaps = [];
        var sawMissing = false;
        var missingNames = [];
        for (var i = 0; i < this.activePatches.length; i++) {
            var from = this.activePatches[i];
            var want = this._resolveFxPatchName(from);
            if (want === undefined) continue;
            if (want === null) {
                sawMissing = true;
                if (missingNames.indexOf(from) === -1) missingNames.push(from);
                continue;
            }
            if (want === from) continue;
            swaps.push({ from: from, to: want });
        }
        if (sawMissing) {
            XoneK3._warnOnce('fxLayoutMissing:' + missingNames.join(','),
                '_syncFxLayout: fx-pattern patch ' + missingNames.join(',') +
                ' has no matching target — check the patches: table');
        }
        if (swaps.length === 0) {
            return { swapped: false, reason: sawMissing ? 'missing' : 'noop' };
        }
        this._batchPatches(function(patches) {
            for (var s = 0; s < swaps.length; s++) {
                var idx = patches.indexOf(swaps[s].from);
                if (idx !== -1) patches[idx] = swaps[s].to;
            }
        });
        return { swapped: true, reason: 'swapped' };
    };

    XoneK3.K3Controller.prototype._isPress = function(v, s) { return v > 0; };
})();