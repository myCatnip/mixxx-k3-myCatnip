// xone-k3-lib-binding.js — Binding primitive, its colour-scheme
// render path, the snapshot field list, and the transaction model
// for physical button presses.
//
// Loaded after lib-core and lib-schemes, before lib-controller
// (which constructs Bindings in _buildHardware).
//
// Session-scoped fields (_normalized, _ledObservers, _transaction)
// are set in the constructor after _bindingDefaults() — _reset
// doesn't touch them.
//
// Transaction model
// -----------------
// A physical button press is a transaction. It is captured at
// physical press, dispatched at physical release, and survives
// rebinds (marked "orphaned") without dispatching early. This is
// what makes rebind-during-hold behave: the release fires against
// the config that was live when the button went down, not against
// whatever the binding happens to be now.
//
// The transaction also serves as the "is this physical control
// currently held" indicator for the modifier system (see
// lib-controller.js:_isHeld).
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
        this._ledObservers = [];

        // Physical-button transaction. Persists across _reset and
        // across rebinds (as "orphaned"). Set on physical press,
        // dispatched on physical release. See the file header.
        this._transaction = {
            active: false,
            orphaned: false,
            group: undefined,
            inKey: undefined,
            func: undefined,
            funcArgs: [],
            buttonMode: 'toggle',
            type: 'button'
        };
    };

    XoneK3.Binding.prototype._scaleValue = function(v) {
        if (v > 63) return (v - 1) / 126;
        return v / 128;
    };

    // ============================================================
    // TRANSACTION
    // ============================================================
    XoneK3.Binding.prototype._captureTransaction = function() {
        var t = this._transaction;
        t.active = true;
        t.orphaned = false;
        t.group = this.group;
        t.inKey = this.inKey;
        t.func = this._func;
        t.funcArgs = (this._funcArgs || []).slice();
        t.buttonMode = this.buttonMode;
        t.type = this.type;
    };

    // Fire the captured release against the captured config.
    // Temporarily installs the captured fields on `this` so the
    // func sees the same surface it saw at press time, then
    // restores. Any throw is caught and warned; state is restored
    // via try/finally.
    //
    // Funcs may read `this._transaction.orphaned` during dispatch
    // to suppress user-facing side effects when the press was
    // orphaned by a rebind.
    XoneK3.Binding.prototype._dispatchCapturedRelease = function() {
        var t = this._transaction;

        var savedGroup      = this.group;
        var savedInKey      = this.inKey;
        var savedFunc       = this._func;
        var savedFuncArgs   = this._funcArgs;
        var savedButtonMode = this.buttonMode;

        try {
            this.group      = t.group;
            this.inKey      = t.inKey;
            this._func      = t.func;
            this._funcArgs  = t.funcArgs;
            this.buttonMode = t.buttonMode;

            if (t.func) {
                t.func.call(this, t.funcArgs, undefined, undefined, 0, undefined);
            } else {
                this._defaultInput(0, undefined);
            }
        } catch (e) {
            XoneK3._warnOnce('txReleaseThrow:' + this._name,
                'captured release threw on ' + this._name + ': ' +
                (e && e.message ? e.message : e));
        } finally {
            this.group      = savedGroup;
            this.inKey      = savedInKey;
            this._func      = savedFunc;
            this._funcArgs  = savedFuncArgs;
            this.buttonMode = savedButtonMode;
        }
    };

    // ============================================================
    // INPUT
    // ============================================================
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

        var isPush = (this.type === 'button' && this.buttonMode === 'push');
        // Snapshot pre-capture state. The capture block below sets
        // active=true on the first press; the bounce guard further
        // down must test the state BEFORE capture, or it blocks
        // the first press too.
        var wasActive = this._transaction.active;

        // ---- Physical press ----
        if (v > 0 && isPush && !this._transaction.active) {
            this._captureTransaction();
            this._ctrl._onBindingPress(this._name);
        }

        // ---- Physical release with an active transaction ----
        // Dispatches the captured release against the press-time
        // config. Happens even if the binding's current
        // buttonMode is 'toggle' — the transaction was captured
        // when this was a push binding, and it must be closed.
        if (v === 0 && this._transaction.active) {
            this._dispatchCapturedRelease();
            this._transaction.active = false;
            this._ctrl._onBindingRelease(this._name);
            this._refreshObservers();
            return;
        }

        // ---- Bounce guard ----
        // A v>0 event while a transaction was ALREADY active
        // before this call is a hardware bounce — the user's
        // physical state hasn't changed. Skip func dispatch so
        // per-press flags (_bpmHeldTurned, shutdownHold's timer)
        // aren't reset mid-hold. The eventual real release still
        // dispatches the captured release normally.
        //
        // `wasActive` (pre-capture) is the discriminator. Testing
        // the current value would return on the very first press,
        // because _captureTransaction just set it to true above.
        if (v > 0 && isPush && wasActive) {
            return;
        }

        // ---- Normal dispatch ----
        // A throwing func or engine call must not escape the MIDI
        // handler — Mixxx logs it or crashes depending on version,
        // and the observer repaint below is skipped so LED state
        // diverges until the next input.
        try {
            var fn = this._func;
            if (fn) fn.call(this, this._funcArgs, ch, cc, v, s);
            else    this._defaultInput(v, s);
        } catch (e) {
            XoneK3._warnOnce('inputThrow:' + this._name,
                'binding func threw on ' + this._name + ': ' +
                (e && e.message ? e.message : e));
        }

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

        // _transaction is session-scoped — not wiped here. The
        // transaction must survive rebinds.
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

        // CO observers registered via _bindConns,
        // _wireCsOnConnection, and _buildCsFromStateClosure call
        // _refresh directly with no wrapper. A throw would escape
        // through Mixxx's CO event loop. Catch here so every
        // _refresh call site is protected regardless of caller.
        // The external wrappers (_safeBinding, _refreshBeatLeds's
        // inline try/catch) stay for their own pre/post work but
        // no longer see throws from this body.
        try {
            if (this._csActive) {
                this._refreshColorScheme();
                return;
            }

            if (this.group && this.outKey) {
                var v = engine.getValue(this.group, this.outKey) > 0;
                this._send(v ? 127 : 0, v ? 127 : 0, v ? 127 : 0, v ? 127 : 0);
            }
        } catch (e) {
            XoneK3._warnOnce('refreshThrow:' + this._name,
                'refresh threw on ' + this._name + ': ' +
                (e && e.message ? e.message : e));
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