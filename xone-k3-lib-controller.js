// xone-k3-lib-controller.js — K3Controller core: constructor,
// patch resolution, focus, top-half mode table, chord, binding
// application.
//
// Split across five files, all extending K3Controller.prototype:
//
//   lib-controller.js          this file — constructor, patches,
//                              focus, top modes, chord, binding
//                              application
//   lib-controller-colour.js   colour-scheme parser
//   lib-controller-beat.js     timeline, loop clock, display-
//                              source resolution, beat pipeline,
//                              beat clock connections
//   lib-controller-render.js   LED writes, sysex, calibration,
//                              ramp sampling, beatjump gate
//   lib-controller-boot.js     init/shutdown, boot, halt
//
// Load order: controller → colour → beat → render → boot.
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
     '_tokenFields', '_BINDING_FIELDS', 'PATCH_NAMES']);

(function() {
    var PN = XoneK3.PATCH_NAMES;

    // ============================================================
    // TOP-HALF MODE TABLE
    // ============================================================
    // owns      every patch name belonging to the mode, for unwind.
    // activate  the exact list to add given the current focus.
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
            lastBeatRepaint: 0, lastBeatEdge: 0, lastPositionSync: 0,
            // Previous playposition reading. Undefined until the
            // first tick. Used by _onPlayposition to detect
            // backward movement (jog-scrub) so the beat-edge
            // guard can be bypassed — see the comment there.
            lastPlayPos: undefined,
            // Marker-hotcue snapshot for the current track. Keyed
            // by hotcue index, values {color, pos}. Populated by
            // _seedHotcueCache and kept current by the hotcue
            // observers. _deriveOriginFromPosition reads only
            // this — the per-tick origin scan used to fire 32 CO
            // reads every 30ms per deck, and the observers give
            // us the same data for free.
            hotcueState: {}
        };
    }

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

        // Per-channel timestamp of the last loop-touching event
        // (beatjump, loop-boundary edit, loop size/state change).
        // Consumed by the beatjump gate in lib-controller-render.js.
        this._lastLoopTouchMs = { 1: 0, 2: 0, 3: 0, 4: 0 };

        this._shuttingDown = false;
        this.loadState = { pressed: false };

        // _batchPatches re-entrancy guard. addPatch / removePatch /
        // replacePatch throw while active; nested _batchPatches
        // throws.
        this._batchPatchesActive = false;

        // Recompute phase tracking + LED re-entrancy guard.
        this._recomputeDepth = 0;
        this._recomputeCompletedAt = 0;
        this._refreshAllLedsDepth = 0;

        // Memo for _resolvedTargetHash. WeakMap keyed on cfg
        // objects owned by _resolvePatch (never mutated, collected
        // with the patch).
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
        // Per-channel rate_ratio. Populated by _catchUpChannel and
        // by the rate_ratio CO listener wired in
        // _openChannelBeatClocks. _channelRate reads this first;
        // it falls back to a live CO read on a cold cache.
        // Eliminates a per-tick CO read from _advanceVirtualClock.
        this._rateCache = { 1: null, 2: null, 3: null, 4: null };
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
        this._flatCache = {};
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
            // A shift companion can also be independently active in
            // activePatches (unusual but legal). Skip those so the
            // final stack has no duplicates.
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
    // Self-contained: ends with _refreshAllLeds. Callers do not
    // refresh afterward.
    XoneK3.K3Controller.prototype._recompute = function() {
        this._recomputeDepth++;
        try {
            var resolved = this._resolveStack(this._buildStack());
            this._applyResolved(resolved);
            // loadState.pressed is controller-scoped and only
            // cleared by loadSelectedTrack's release branch. A
            // patch change can swap the binding under a held
            // pressR; the release goes to a different binding and
            // the flag sticks true. Reset here so the next
            // k3Select press selects a channel instead of loading.
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

    // One throwing binding must not stop the pass. Caller
    // captures loop variables into `args` at the call site.
    XoneK3.K3Controller.prototype._safeBinding = function(fn, thisArg, args, warnKey, warnPrefix) {
        try {
            fn.apply(thisArg, args);
        } catch (e) {
            XoneK3._warnOnce(warnKey, warnPrefix + (e && e.message ? e.message : e));
        }
    };

    // Explicit single-binding refresh. _applyBinding no longer
    // refreshes on its own — every batch caller (_applyResolved,
    // _unbindRemoved, _reapplyByTokens) passes skipRefresh=true
    // and relies on the trailing _refreshAllLeds. Standalone
    // callers (tests, external scripts) should either omit
    // skipRefresh on the _applyBinding call or invoke this after.
    XoneK3.K3Controller.prototype._refreshBinding = function(name) {
        var b = this.bindings[name];
        if (b) b._refresh();
    };

    // ============================================================
    // APPLY RESOLVED
    // ============================================================
    XoneK3.K3Controller.prototype._applyResolved = function(resolved) {
        var oldHashes = this._appliedHashes || {};
        var oldCfgs   = this._appliedCfgs   || {};
        var newHashes = {};
        var newCfgs   = {};

        // Per-binding refresh is redundant only when _recompute follows
        // with _refreshAllLeds. Direct callers (tests, external
        // scripts) don't get that sweep, so they still need
        // _applyBinding to refresh.
        var skipRefresh = this._recomputeDepth > 0;

        this._unbindRemoved(resolved, oldHashes, skipRefresh);

        for (var name in resolved) {
            if (!resolved.hasOwnProperty(name)) continue;
            if (name.charAt(0) === '_') continue;
            var cfg = resolved[name];
            var h = (oldCfgs[name] === cfg)
                ? oldHashes[name]
                : XoneK3._hashBinding(cfg);
            newHashes[name] = h;
            newCfgs[name]   = cfg;
            if (oldHashes[name] === h) continue;
            this._applyOneSafe(name, cfg, skipRefresh);
        }

        this._applied = resolved;
        this._appliedHashes = newHashes;
        this._appliedCfgs = newCfgs;
    };

    XoneK3.K3Controller.prototype._unbindRemoved = function(resolved, oldHashes, skipRefresh) {
        for (var oldName in oldHashes) {
            if (!oldHashes.hasOwnProperty(oldName)) continue;
            if (oldName.charAt(0) === '_') continue;
            if (resolved[oldName] !== undefined) continue;
            this._applyOneSafe(oldName, null, skipRefresh);
        }
    };

    // A single throwing binding must not abort the pass. cfg ===
    // null / undefined means "unbind". skipRefresh is passed
    // through to _applyBinding — batch callers set it true and
    // rely on the trailing _refreshAllLeds.
    XoneK3.K3Controller.prototype._applyOneSafe = function(name, cfg, skipRefresh) {
        try {
            this._applyBinding(name, cfg, undefined, skipRefresh);
        } catch (e) {
            var isUnbind = (cfg === null || cfg === undefined);
            var key    = (isUnbind ? 'applyUnbindThrow:' : 'applyBindThrow:') + name;
            var prefix = '_applyBinding(' + name +
                         (isUnbind ? ', null' : '') + ') threw: ';
            XoneK3._warnOnce(key, prefix + (e && e.message ? e.message : e));
        }
    };

    XoneK3.K3Controller.prototype._snapshotBinding = function(b) {
        var snap = {};
        for (var i = 0; i < XoneK3._SNAPSHOT_FIELDS.length; i++) {
            var src = XoneK3._SNAPSHOT_FIELDS[i][0];
            var dst = XoneK3._SNAPSHOT_FIELDS[i][1];
            var tr  = XoneK3._SNAPSHOT_FIELDS[i][2];
            snap[dst] = XoneK3._snapshotTransform(tr, b[src]);
        }
        return snap;
    };

    // A push button that is being unbound or rebound while held
    // has latched its CO at 1. Physical release will fire against
    // the NEW binding (if any), so the OLD CO would otherwise
    // stay at 1 forever — and for a hotcue that means Mixxx
    // stays in preview mode and eats the next play press.
    //
    // Fire the release against prev.group / prev.inKey here. Skip
    // when the binding is being rebound to the same push-mode CO:
    // the natural physical-release path writes 0 to the same
    // target, and duplicating it would be a redundant CO write.
    //
    // _held is session-scoped (set in Binding.input, cleared on
    // physical release). It is NOT in _bindingDefaults, so
    // _reset — which _applyBinding calls before this — leaves it
    // intact.
    XoneK3.K3Controller.prototype._releaseHeldWrite = function(b, prev) {
        if (!b._held) return;
        if (!prev.wasBound || !prev.group || !prev.inKey) return;
        var samePushTarget = (b.group === prev.group &&
                              b.inKey === prev.inKey &&
                              b.buttonMode === 'push');
        if (samePushTarget) return;
        engine.setValue(prev.group, prev.inKey, 0);
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

        // Bridge. Mixxx uninitialises soft takeover on rearm and
        // drops the next write unless it lands within its own
        // tolerance of the current CO. A physical already near CO
        // at rearm — the common case — would otherwise get stuck
        // at the endpoint.
        //
        // A zero-distance write (CO's own value back to itself)
        // flips initialised without a value change. TAKEOVER_EPSILON
        // is deliberately larger than CO_MATCH_EPSILON, so an LED
        // showing "matched" always implies control is live — the
        // extra half-band is a harmless false-negative on the LED.
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
        // A hotcue LED also watches the pad's colour CO so it
        // repaints when the user recolours in Mixxx.
        if (b.outKey && b.group) {
            var m = b.outKey.match(/^(hotcue_\d+)_status$/);
            if (m) {
                b._conns.push(engine.makeConnection(b.group, m[1] + '_color', function() {
                    b._refresh();
                }));
            }
        }
        // outKey listener, unless on: already owns the on/off
        // source (see _parseCsOn).
        if (b.group && b.outKey && (b._csOn === null || b._csOn === undefined)) {
            b._conns.push(engine.makeConnection(b.group, b.outKey, function() {
                b._refresh();
            }));
        }
    };

    // ============================================================
    // RESOLVED-TARGET HASH
    // ============================================================
    // Positional fingerprint of every controller field the token
    // table reads from. Derived from XoneK3.TOKENS so a new token
    // is covered automatically.
    XoneK3.K3Controller.prototype._tokenFingerprint = function() {
        var parts = [];
        for (var i = 0; i < XoneK3.TOKENS.length; i++) {
            parts.push(this[XoneK3.TOKENS[i].state]);
        }
        return parts.join('|');
    };

    // Table-driven. Iterates XoneK3._BINDING_FIELDS rows that
    // carry a token label, resolves each against current focus,
    // and joins the results. Adding a new tokenable field is a
    // single row in lib-core.js — no edit here.
    XoneK3.K3Controller.prototype._resolvedTargetHash = function(cfg, fingerprint) {
        if (!cfg) return '';
        if (fingerprint === undefined) fingerprint = this._tokenFingerprint();

        var cached = this._resolvedTargetHashCache.get(cfg);
        if (cached && cached.fingerprint === fingerprint) return cached.value;

        var parts = [];
        for (var i = 0; i < XoneK3._BINDING_FIELDS.length; i++) {
            var row = XoneK3._BINDING_FIELDS[i];
            if (!row.token) continue;
            var v = XoneK3.readPath(cfg, row.name);
            if (v === undefined) v = '';
            parts.push(XoneK3.resolve(v, this) || '');
        }
        var value = parts.join('\u0001');
        this._resolvedTargetHashCache.set(cfg, { fingerprint: fingerprint, value: value });
        return value;
    };

    XoneK3.K3Controller.prototype._applyBinding = function(name, cfg, fingerprint, skipRefresh) {
        var b = this.bindings[name];
        if (!b) return;

        var prev = this._snapshotBinding(b);
        b._reset();

        if (cfg === null || cfg === undefined) {
            this._releaseHeldWrite(b, prev);
            this._unbind(b, prev);
            b._resolvedTargetHash = undefined;
            return;
        }

        this._bindCore(b, cfg);
        // Rebind path: if this binding was a held push button and
        // the new target differs, release the old CO now. Must
        // happen after _bindCore so we can compare new target to
        // the snapshot.
        this._releaseHeldWrite(b, prev);
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

        b._resolvedTargetHash = this._resolvedTargetHash(cfg, fingerprint);

        // Every batch caller (_applyResolved, _unbindRemoved,
        // _reapplyByTokens) passes skipRefresh=true and relies on
        // the trailing _refreshAllLeds. Standalone callers (tests,
        // external scripts) should either omit skipRefresh here or
        // call _refreshBinding(name) explicitly.
        if (!skipRefresh) b._refresh();
    };

    XoneK3.K3Controller.prototype._resolveSchemeRef = function(ref) {
        if (ref === undefined || ref === null) return null;
        return XoneK3.compileScheme(ref);
    };

    // ============================================================
    // PATCH LIST MUTATIONS
    // ============================================================
    // The mutator receives a *copy* of activePatches. It may
    // mutate the copy in place (return ignored) or return a
    // fresh array. Whatever ends up in the copy (or in the return
    // value) becomes the new activePatches. activePatches is
    // untouched until the mutator returns cleanly.
    //
    // addPatch / removePatch / replacePatch throw while a mutator
    // is active. Nested _batchPatches throws too. Both are
    // programmer errors: mutate the array argument.
    XoneK3.K3Controller.prototype._batchPatches = function(mutator) {
        if (this._batchPatchesActive) {
            throw new Error('_batchPatches cannot nest');
        }
        var before = this.activePatches.slice();
        var copy = before.slice();
        var returned;
        this._batchPatchesActive = true;
        try {
            returned = mutator(copy);
        } catch (e) {
            print('[k3] _batchPatches mutator threw: ' + (e && e.message ? e.message : e));
            throw e;
        } finally {
            this._batchPatchesActive = false;
        }
        var result = Array.isArray(returned) ? returned : copy;

        var diff = this._diffPatches(before, result);
        if (!diff) return;

        this.activePatches.length = 0;
        for (var m = 0; m < result.length; m++) this.activePatches.push(result[m]);

        this._recompute();

        for (var r = 0; r < diff.removed.length; r++) {
            this._onPatchChange(diff.removed[r], null);
        }
        for (var a = 0; a < diff.added.length; a++) {
            this._onPatchChange(null, diff.added[a]);
        }
    };

    // Structural diff between two patch-name arrays. Returns
    // { added, removed } or null when the arrays are identical
    // (same length, same element order). A re-order is a change —
    // later patches override earlier ones, so shifting a name
    // changes resolution and needs a recompute.
    XoneK3.K3Controller.prototype._diffPatches = function(before, after) {
        var same = (before.length === after.length);
        if (same) {
            for (var i = 0; i < before.length; i++) {
                if (before[i] !== after[i]) { same = false; break; }
            }
        }
        if (same) return null;

        var beforeSet = {};
        for (var b = 0; b < before.length; b++) beforeSet[before[b]] = true;
        var afterSet = {};
        for (var a = 0; a < after.length; a++) afterSet[after[a]] = true;

        var added = [], removed = [];
        for (var r = 0; r < before.length; r++) {
            if (!afterSet[before[r]]) removed.push(before[r]);
        }
        for (var n = 0; n < after.length; n++) {
            if (!beforeSet[after[n]]) added.push(after[n]);
        }
        return { added: added, removed: removed };
    };

    XoneK3.K3Controller.prototype.addPatch = function(name) {
        if (this._batchPatchesActive) {
            throw new Error('addPatch called inside a _batchPatches mutator — mutate the array argument instead');
        }
        if (!this.patches[name]) { print('Unknown patch: ' + name); return; }
        if (this.activePatches.indexOf(name) !== -1) return;
        this.activePatches.push(name);
        this._recompute();
        this._onPatchChange(null, name);
    };

    XoneK3.K3Controller.prototype.removePatch = function(name) {
        if (this._batchPatchesActive) {
            throw new Error('removePatch called inside a _batchPatches mutator — mutate the array argument instead');
        }
        var i = this.activePatches.indexOf(name);
        if (i === -1) return;
        this.activePatches.splice(i, 1);
        this._recompute();
        this._onPatchChange(name, null);
    };

    XoneK3.K3Controller.prototype.replacePatch = function(from, to) {
        if (this._batchPatchesActive) {
            throw new Error('replacePatch called inside a _batchPatches mutator — mutate the array argument instead');
        }
        if (!this.patches[to]) { print('Unknown patch: ' + to); return; }
        var i = this.activePatches.indexOf(from);
        if (i === -1) return;
        this.activePatches[i] = to;
        this._recompute();
        this._onPatchChange(from, to);
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

    // Unwinds every patch owned by ANY mode, then re-inserts the
    // target's activate list at the position where the first owned
    // patch sat. Non-owned patches keep their relative order.
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
    // Re-entrancy guard. Legitimate nested path is
    //   _refreshAllLeds → _syncBeatClocks → _openBeatClocks
    //     → _startVirtualClock → _resolveDisplaySource
    //       → _refreshAllLeds('display-source')
    // Skipping the nested call is safe — outer sweeps every
    // binding after _syncBeatClocks returns.
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
                    'within 10ms of one finishing — pass a reason string if intentional');
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
        }

        if (issues > 0) {
            print('[k3] ' + issues + ' binding warning(s) — check the tokens above.');
        }
    };

    // ============================================================
    // FOCUS
    // ============================================================
    // Shared tail for the three focus setters:
    //   1. _refreshActiveAlt  — recompute derived fields.
    //   2. _reapplyByTokens   — rebind token-carrying bindings
    //                           whose resolved target moved.
    //   3. _syncFxLayout      — swap focused FX layout patch if
    //                           needed; its recompute refreshes.
    //   4. _refreshAllLeds    — only when step 3 didn't swap.
    // Exactly one repaint per focus change on every path.
    XoneK3.K3Controller.prototype._afterFocusChanged = function(tokens, reason) {
        this._refreshActiveAlt();
        this._reapplyByTokens(tokens, { skipRefresh: true });
        if (!this._syncFxLayout().swapped) this._refreshAllLeds(reason);
    };

    XoneK3.K3Controller.prototype.setSelectedFor = function(kind, which, value) {
        if (value < 1 || value > 4) return;
        var stateProp = XoneK3._selProp(kind, which);
        if (this[stateProp] === undefined || this[stateProp] === value) return;
        this[stateProp] = value;

        var upper = kind.toUpperCase();
        var tokens = [
            '$' + upper + '_' + which + '$',
            '$' + upper + '_' + which + '_N$'
        ];
        if (kind === 'deck') {
            if (which === this.activeDeck) tokens.push('$DECK_ACTIVE$', '$DECK_ACTIVE_N$');
            else                          tokens.push('$DECK_ALT$',    '$DECK_ALT_N$');
        } else {
            if (which === this.activeFx)  tokens.push('$FX_ACTIVE$', '$FX_ACTIVE_N$');
            else                          tokens.push('$FX_ALT$',    '$FX_ALT_N$');
        }

        this._afterFocusChanged(tokens, 'focus-' + kind);
    };

    XoneK3.K3Controller.prototype.setActiveDeck = function(slot) {
        if (slot !== 'A' && slot !== 'B') return;
        if (this.activeDeck === slot) return;
        this.activeDeck = slot;
        this._afterFocusChanged(
            ['$DECK_ACTIVE$', '$DECK_ACTIVE_N$', '$DECK_ALT$', '$DECK_ALT_N$'],
            'focus-deck');
    };

    XoneK3.K3Controller.prototype.setActiveFx = function(slot) {
        if (slot !== 'A' && slot !== 'B') return;
        if (this.activeFx === slot) return;
        this.activeFx = slot;
        this._afterFocusChanged(
            ['$FX_ACTIVE$', '$FX_ACTIVE_N$', '$FX_ALT$', '$FX_ALT_N$'],
            'focus-fx');
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

    // Short-circuit on resolved-target equality. b._resolvedTargetHash
    // is written by _applyBinding at every bind, so this is a true
    // identity compare — not a "have we seen this before" cache.
    XoneK3.K3Controller.prototype._reapplyByTokens = function(tokens, opts) {
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
            this._applyBinding(name, b._rawCfg, fingerprint, true);
        }
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