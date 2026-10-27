// xone-k3-lib-binding.js — Binding primitive, its colour-scheme
// render path, and the snapshot field list that describes which
// binding state survives a rebind.
//
// Loaded after lib-core and lib-schemes, before lib-controller
// (which constructs Bindings in _buildHardware).
//
// Session-scoped fields (_normalized, pressHeld, turnHappened,
// _ledObservers, _held) are set in the constructor after
// _bindingDefaults() — _reset doesn't touch them.
//
// _SNAPSHOT_FIELDS / _SNAPSHOT_IGNORED are derived from
// XoneK3._BINDING_FIELDS in lib-core.js. The transform names
// referenced from that table live here.

'use strict';

if (typeof XoneK3 === 'undefined') {
    throw new Error('Xone K3: xone-k3-lib-binding.js — xone-k3-lib-core.js must load first');
}
if (typeof XoneK3._requireLoad !== 'function') {
    throw new Error('Xone K3: xone-k3-lib-binding.js — xone-k3-lib-core.js must load first');
}
XoneK3._requireLoad('xone-k3-lib-binding.js',
    ['_funcId', 'resolve', 'readPath',
     '_tokenFields', 'CO_MATCH_EPSILON', 'BEAT_HOLD', 'applyBeat',
     '_BINDING_FIELDS', '_SNAPSHOT_FIELDS', '_SNAPSHOT_IGNORED']);

(function() {
    // ============================================================
    // RESET-ABLE BINDING FIELD FACTORY
    // ============================================================
    // Every field wiped on _reset (and therefore also set at
    // construction). Add a new reset-able field here AND to
    // XoneK3._BINDING_FIELDS in lib-core.js (as either snapshot
    // or ignored) so the boot-time audit stays clean.
    XoneK3._bindingDefaults = function() {
        return {
            group:       undefined,
            inKey:       undefined,
            outKey:      undefined,
            buttonMode:  'toggle',
            softTakeover: false,
            _func:       undefined,
            _funcArgs:   [],
            _usedTokens: [],
            _rawCfg:     null,
            _noLED:      false,
            _k2:         undefined,
            _csActive:          false,
            _csFailed:          false,
            _csDeviation:       false,
            _csScheme:          null,
            _csSchemeFn:        null,
            _csSchemeMemo:      null,
            _csCompiledMemo:    null,
            _csKnob:            null,
            _csFromStateConn:   null,
            _csOn:              null,
            _valueConn:  null,
            _conns:      [],
            _valueCurve: 1,
            _shutdownHoldTimer: null
        };
    };

    // ============================================================
    // BINDING
    // ============================================================
    XoneK3.Binding = function(name, spec, ctrl) {
        this._name = name;
        this._ctrl = ctrl;
        this.midi = spec.midi;
        this.type = spec.type;
        this.idx = spec.idx;

        var d = XoneK3._bindingDefaults();
        for (var k in d) {
            if (d.hasOwnProperty(k)) this[k] = d[k];
        }
        // Pots want soft-takeover on; buttons don't.
        if (spec.type === 'knob' || spec.type === 'fader') {
            this.softTakeover = true;
        }

        // Session-scoped — survive _reset.
        this._normalized = undefined;
        this.pressHeld = false;
        this.turnHappened = false;
        this._ledObservers = [];
        // Push-button held state. Set on physical press, cleared
        // by physical release OR by K3Controller._releaseHeldWrite
        // when a rebind fires between press and release. The clear
        // in _releaseHeldWrite is essential — without it, a push
        // binding swapped to a toggle and back leaves _held true,
        // and the next rebind writes 0 to a CO the user set under
        // the toggle leg.
        this._held = false;
    };

    XoneK3.Binding.prototype._scaleValue = function(v) {
        if (v > 63) return (v - 1) / 126;
        return v / 128;
    };

    XoneK3.Binding.prototype.input = function(ch, cc, v, s) {
        // Preset reload: Mixxx calls old shutdown (sets _shuttingDown)
        // then immediately wires new handlers. Physical input in that
        // window reaches the outgoing binding, which would write
        // stale COs (_defaultInput has no gate). Momentary presses
        // self-cancel via the matching release; toggles don't and
        // leave the old CO stuck at 1.
        if (this._ctrl._shuttingDown) return;
        if (this._ctrl._onInput) this._ctrl._onInput(this);

        if (this.type === 'knob' || this.type === 'fader') {
            this._normalized = this._scaleValue(v);
        }
        if (this.type === 'button' && this.buttonMode === 'push') {
            this._held = v > 0;
        }

        var fn = this._func;
        if (fn) fn.call(this, this._funcArgs, ch, cc, v, s);
        else    this._defaultInput(v, s);

        this._refreshObservers();
    };

    XoneK3.Binding.prototype._defaultInput = function(v, s) {
        if (!this.group || !this.inKey) return;
        if (this.type === 'button') {
            if (this.buttonMode === 'push') {
                engine.setValue(this.group, this.inKey, v > 0 ? 1 : 0);
            } else if (v > 0) {
                var cur = engine.getValue(this.group, this.inKey);
                engine.setValue(this.group, this.inKey, cur ? 0 : 1);
            }
        } else if (this.type === 'knob' || this.type === 'fader') {
            engine.setParameter(this.group, this.inKey,
                this._applyValueCurve(this._normalized));
        }
    };

    XoneK3.Binding.prototype._applyValueCurve = function(n) {
        var c = this._valueCurve;
        if (!c || c === 1) return n;
        if (n <= 0) return 0;
        if (n >= 1) return 1;
        return Math.pow(n, c);
    };

    XoneK3.Binding.prototype.addObserver = function(led) {
        if (this._ledObservers.indexOf(led) === -1) this._ledObservers.push(led);
    };

    XoneK3.Binding.prototype.removeObserver = function(led) {
        var i = this._ledObservers.indexOf(led);
        if (i >= 0) this._ledObservers.splice(i, 1);
    };

    // A single throwing observer (bad scheme, transient CO miss)
    // must not starve the rest of the loop.
    XoneK3.Binding.prototype._refreshObservers = function() {
        for (var i = 0; i < this._ledObservers.length; i++) {
            var obs = this._ledObservers[i];
            try {
                obs._refresh();
            } catch (e) {
                XoneK3._warnOnce('obsRefreshThrow:' + obs._name,
                    'observer repaint threw on ' + obs._name + ': ' +
                    (e && e.message ? e.message : e));
            }
        }
    };

    XoneK3.Binding.prototype._reset = function() {
        this._ctrl._detachBeatLed(this);

        if (this._valueConn) { this._valueConn.disconnect(); }
        for (var i = 0; i < this._conns.length; i++) {
            if (this._conns[i]) this._conns[i].disconnect();
        }
        if (this._csFromStateConn) { this._csFromStateConn.disconnect(); }
        if (this._csKnob) { this._csKnob.removeObserver(this); }
        if (this._shutdownHoldTimer) {
            engine.stopTimer(this._shutdownHoldTimer);
        }

        var d = XoneK3._bindingDefaults();
        for (var k in d) {
            if (d.hasOwnProperty(k)) this[k] = d[k];
        }
    };

    XoneK3.Binding.prototype._armOwnConn = function() {
        if (this._valueConn) { this._valueConn.disconnect(); this._valueConn = null; }
        if (this.group === undefined || this.inKey === undefined) return;
        var self = this;
        this._valueConn = engine.makeConnection(this.group, this.inKey, function() {
            self._refreshObservers();
        });
    };

    XoneK3.Binding.prototype._send = function(r, g, b, hw) {
        if (this.idx < 0) return;
        if (this._noLED) return;
        if (this._ctrl._shuttingDown) return;
        this._ctrl.sendLED(this.idx, r, g, b, hw, this._k2);
    };

    // ============================================================
    // ON-STATE DISPATCH
    // ============================================================
    // `_csOn` is the parsed on: block (see lib-controller-colour.js
    // _parseCsOn). Three shapes:
    //   true / false     — unconditional
    //   { patchActive }  — list of patch names, OR'd
    //   { state | co }   — value, optionally gated by equals / contains
    //
    // Return 1 or 0. Also the only caller of the truthy-state
    // warning — a binding whose LED never renders never fires it.
    XoneK3.Binding.prototype._isOn = function() {
        if (this._csOn !== null && this._csOn !== undefined) {
            if (this._csOn === true)  return 1;
            if (this._csOn === false) return 0;
            return this._evalCsOn(this._csOn);
        }
        if (this.group && this.outKey) {
            return engine.getValue(this.group, this.outKey) > 0 ? 1 : 0;
        }
        return 0;
    };

    XoneK3.Binding.prototype._evalCsOn = function(s) {
        if (s.patchActive !== undefined) return this._evalPatchActive(s.patchActive);

        var v;
        if (s.co !== undefined)         v = this._evalOnCoValue(s);
        else if (s.state !== undefined) v = this._evalOnStateValue(s);
        else                            v = undefined;

        return this._matchOnValue(s, v);
    };

    XoneK3.Binding.prototype._evalPatchActive = function(patchActive) {
        var names = Array.isArray(patchActive) ? patchActive : [patchActive];
        for (var i = 0; i < names.length; i++) {
            if (this._ctrl._patchActive(names[i])) return 1;
        }
        return 0;
    };

    XoneK3.Binding.prototype._evalOnCoValue = function(s) {
        if (s.group === undefined) return undefined;
        return engine.getValue(s.group, s.co);
    };

    XoneK3.Binding.prototype._evalOnStateValue = function(s) {
        var v = XoneK3.readPath(this._ctrl, s.state);
        // A numeric on.state with no comparator is truthy by
        // construction — the LED would always be on. Warn once per
        // binding the first time it renders. Deliberately not
        // fired at bind time: most bindings that trigger this
        // have never rendered, and we only want to flag ones that
        // actually reach the wire.
        if (s.equals === undefined && s.contains === undefined) {
            var truthyByConstruction =
                (typeof v === 'number' && v > 0) ||
                (typeof v === 'string' && v.length > 0);
            if (truthyByConstruction) {
                XoneK3._warnOnce('csOnTruthyState:' + this._name,
                    'colorScheme.on.state "' + s.state + '" on ' + this._name +
                    ' resolves to a value (' + JSON.stringify(v) + ')' +
                    ' that is truthy by construction with no equals — the LED' +
                    ' will always be on. Add equals: V for a slot / mode comparison.');
            }
        }
        return v;
    };

    XoneK3.Binding.prototype._matchOnValue = function(s, v) {
        if (s.equals !== undefined) return (v === s.equals) ? 1 : 0;
        if (s.contains !== undefined) {
            if (Array.isArray(v)) return (v.indexOf(s.contains) !== -1) ? 1 : 0;
            if (typeof v === 'string') return (v.indexOf(s.contains) !== -1) ? 1 : 0;
            return 0;
        }
        return v ? 1 : 0;
    };

    // ============================================================
    // REFRESH / RENDER
    // ============================================================
    XoneK3.Binding.prototype._refresh = function() {
        if (this.idx < 0) return;
        if (this._noLED) return;
        if (this._ctrl._shuttingDown) return;

        if (this._csActive) {
            this._refreshColorScheme();
            return;
        }

        if (this.group && this.outKey) {
            var v = engine.getValue(this.group, this.outKey) > 0;
            this._send(v ? 127 : 0, v ? 127 : 0, v ? 127 : 0, v ? 127 : 0);
        }
    };

    // ============================================================
    // COLOUR SEND
    // ============================================================
    XoneK3.Binding.prototype._sendColor = function(entry, isOn) {
        if (!entry) { this._send(0, 0, 0, 0); return; }
        var rgb = entry.rgb, type = entry.type || 'rgb';
        if (type === 'mixxx') {
            if (!isOn) { this._send(0, 0, 0, 0); return; }
            rgb = this._resolveMixxxColor();
            if (!rgb) { this._send(0, 0, 0, 0); return; }
        }
        var hw = isOn ? entry.brightness
                      : (entry.brightnessOff !== undefined && entry.brightnessOff !== null
                         ? entry.brightnessOff : entry.brightness);
        if (!rgb) { this._send(0, 0, 0, 0); return; }
        this._send(rgb[0], rgb[1], rgb[2], hw);
    };

    // Resolve a 'mixxx' scheme's colour from the pad's hotcue
    // colour CO. Only `hotcue_<n>_status` outKeys map to a colour
    // CO. Anything else (or a CO that hasn't been set yet) yields
    // null — the LED is painted black.
    XoneK3.Binding.prototype._resolveMixxxColor = function() {
        var co = this.outKey;
        if (!co) return null;
        var m = co.match(/^(hotcue_\d+)_status$/);
        if (!m) return null;
        if (!this.group) return null;
        var mx = engine.getValue(this.group, m[1] + '_color');
        return XoneK3.mapMixxxColor(mx);
    };

    XoneK3.Binding.prototype._sendSampled = function(ramp, t, compiled, isOn, skipBeat) {
        var entry = this._ctrl._sampleRamp(ramp, t, compiled, isOn, skipBeat);
        if (entry === XoneK3.BEAT_HOLD) return;
        this._sendColor(entry, isOn);
    };

    // Shared preamble for every beat-aware render path. Returns
    // the deck state for this binding's scheme when the deck has
    // fired at least one beat; null otherwise.
    XoneK3.Binding.prototype._beatStateFor = function(compiled) {
        if (!compiled || !compiled.beat) return null;
        var st = this._ctrl._deckStateFor(compiled);
        if (!st || !st.hasBeat) return null;
        return st;
    };

    XoneK3.Binding.prototype._isBeatOffPhase = function(compiled) {
        var st = this._beatStateFor(compiled);
        if (!st) return false;
        var mode = st.playing ? XoneK3.BEAT_PLAYING_MODE : XoneK3.BEAT_PAUSED_MODE;
        if (mode === 'solid') return false;
        if (mode === 'off')   return true;
        return !st.active;
    };

    XoneK3.Binding.prototype._renderStatic = function(scheme, isOn) {
        var ramp = isOn ? scheme.on : scheme.off;
        if (!ramp || ramp.length === 0) { this._send(0, 0, 0, 0); return; }
        var entry = ramp[0].color;
        entry = this._applyBeatStatic(entry, scheme, isOn);
        if (entry === XoneK3.BEAT_HOLD) return;
        this._sendColor(entry, isOn);
    };

    XoneK3.Binding.prototype._renderCoMatch = function(knob, scheme, isOn, physical) {
        if (!knob.group || !knob.inKey) return false;
        var steer = XoneK3.coMatchSample(scheme, knob.group, knob.inKey, physical, isOn);
        if (!steer) return false;
        this._sendSampled(steer.ramp, steer.t, scheme.co, isOn, true);
        return true;
    };

    XoneK3.Binding.prototype._renderMarker = function(scheme, isOn, devDir) {
        if (!XoneK3.markerHit(scheme, devDir)) return false;
        var entry = this._applyBeatStatic(scheme.marker, scheme, isOn);
        if (entry === XoneK3.BEAT_HOLD) return true;
        this._sendColor(entry, isOn);
        return true;
    };

    XoneK3.Binding.prototype._renderDeviation = function(scheme, isOn) {
        var knob = this._csKnob;
        if (!knob || knob._normalized === undefined) {
            // Boot-white: knob hasn't reported yet.
            this._sendColor({ rgb: [127, 127, 127], brightness: 127, brightnessOff: 127 }, isOn);
            return;
        }
        var physical = knob._normalized;
        if (this._renderCoMatch(knob, scheme, isOn, physical)) return;

        var dev = (physical - 0.5) * 2;
        var devDir = scheme.reverse ? -dev : dev;
        if (this._renderMarker(scheme, isOn, devDir)) return;

        var t = (devDir + 1) / 2;
        var ramp = isOn ? scheme.on : scheme.off;
        this._sendSampled(ramp, t, scheme, isOn, false);
    };

    // ============================================================
    // SCHEME EVALUATION
    // ============================================================
    XoneK3.Binding.prototype._evaluateScheme = function() {
        var scheme = this._csScheme;
        if (this._csSchemeFn) {
            var ref = this._csSchemeFn();
            if (ref !== undefined && ref !== null) {
                if (ref !== this._csSchemeMemo) {
                    this._warnIfFreshScheme(ref);
                    this._csSchemeMemo = ref;
                    this._csCompiledMemo = this._ctrl._resolveSchemeRef(ref);
                }
                if (this._csCompiledMemo) scheme = this._csCompiledMemo;
            }
        }
        return scheme;
    };

    // Fresh-inline-object detection. composeScheme caches its
    // result; a raw object literal inside the scheme function
    // recompiles on every render. Warns once per binding — the
    // fix is composeScheme or hoisting the object out of the
    // closure.
    //
    // Only fires when the previous memo is also an object — the
    // first transition from string to object isn't suspicious,
    // and neither is any array-vs-object swap.
    XoneK3.Binding.prototype._warnIfFreshScheme = function(ref) {
        var memo = this._csSchemeMemo;
        if (typeof ref !== 'object' || Array.isArray(ref)) return;
        if (typeof memo !== 'object' || memo === null || Array.isArray(memo)) return;
        var a = XoneK3._stableStringify(ref);
        var b = XoneK3._stableStringify(memo);
        if (a !== b) return;
        XoneK3._warnOnce('csSchemeFresh:' + this._name,
            'colorScheme scheme function on ' + this._name +
            ' returns a fresh object each call — LED ' +
            'recompiles every render. Wrap with ' +
            'XoneK3.builders.composeScheme or hoist the object.');
    };

    XoneK3.Binding.prototype._refreshColorScheme = function() {
        if (this._csFailed) { this._send(0, 0, 0, 0); return; }

        var logicalOn = this._isOn();
        var scheme = this._evaluateScheme();
        if (!scheme) {
            if (this._csSchemeFn) {
                XoneK3._warnOnce('csDarkFromFn:' + this._name,
                    'colorScheme scheme function on ' + this._name +
                    ' returned null/undefined and no base scheme is set — LED stays dark.');
            }
            this._send(0, 0, 0, 0);
            return;
        }

        var beatOffPhase = this._isBeatOffPhase(scheme);
        if (beatOffPhase && !logicalOn) { this._send(0, 0, 0, 0); return; }
        var isOn = (logicalOn && !beatOffPhase) ? 1 : 0;

        if (this._csDeviation) this._renderDeviation(scheme, isOn);
        else                   this._renderStatic(scheme, isOn);
    };

    XoneK3.Binding.prototype._applyBeatStatic = function(entry, compiled, isOn) {
        if (!isOn) return entry;
        var st = this._beatStateFor(compiled);
        if (!st) return entry;
        return XoneK3.applyBeat(entry, compiled.beat, st.count);
    };

    // ============================================================
    // SNAPSHOT TRANSFORM
    // ============================================================
    // Named transforms referenced from XoneK3._BINDING_FIELDS[i].
    // snapshot.transform in lib-core.js. _SNAPSHOT_FIELDS /
    // _SNAPSHOT_IGNORED are derived from that table; this file
    // only provides the transform implementations.
    XoneK3._snapshotTransform = function(transform, v) {
        if (transform === 'isPot')  return (v === 'knob' || v === 'fader');
        if (transform === 'truthy') return !!v;
        return v;
    };

    XoneK3._auditSnapshotFields = function() {
        if (!XoneK3._debugPrintsOn) return;
        var defaults = XoneK3._bindingDefaults();
        var sources = {};
        for (var i = 0; i < XoneK3._SNAPSHOT_FIELDS.length; i++) {
            sources[XoneK3._SNAPSHOT_FIELDS[i][0]] = true;
        }
        for (var k in defaults) {
            if (!defaults.hasOwnProperty(k)) continue;
            if (sources[k]) continue;
            if (XoneK3._SNAPSHOT_IGNORED.indexOf(k) !== -1) continue;
            print('[k3] reset-able Binding field "' + k +
                  '" not classified for _snapshotBinding');
        }
    };
})();