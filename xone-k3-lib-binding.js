// xone-k3-lib-binding.js — Binding primitive, its colour-scheme
// render path, and the snapshot field list that describes which
// binding state survives a rebind.
//
// Loaded after lib-core and lib-schemes. Loaded before
// lib-controller, which constructs Bindings in _buildHardware.
//
// Session-scoped fields — _normalized, _accelEvents,
// _loopAccelEvents, pressHeld, turnHappened, _ledObservers —
// live outside XoneK3._bindingDefaults on purpose. All are set
// in the constructor; none are reset by _reset.

'use strict';

if (typeof XoneK3 === 'undefined') {
    throw new Error('Xone K3: xone-k3-lib-binding.js — xone-k3-lib-core.js must load first');
}
if (typeof XoneK3._requireLoad !== 'function') {
    throw new Error('Xone K3: xone-k3-lib-binding.js — xone-k3-lib-core.js must load first');
}
XoneK3._requireLoad('xone-k3-lib-binding.js',
    ['_funcId', '_parseAccel', 'resolve', 'readPath',
     '_tokenFields', 'CO_MATCH_EPSILON', 'BEAT_HOLD', 'applyBeat']);

(function() {
    // ============================================================
    // RESET-ABLE BINDING FIELD FACTORY
    // ============================================================
    // Every field wiped on _reset (and therefore also set at
    // construction). Add a new reset-able field here, not in the
    // constructor and not in _reset.
    XoneK3._bindingDefaults = function() {
        return {
            // Binding target
            group:       undefined,
            inKey:       undefined,
            outKey:      undefined,
            buttonMode:  'toggle',
            softTakeover: false,
            // Func
            _func:       undefined,
            _funcArgs:   [],
            _usedTokens: [],
            _rawCfg:     null,
            // LED output flags
            _noLED:      false,
            _k2:         undefined,
            // Color scheme
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
            // Connections
            _valueConn:  null,
            _conns:      [],
            // Input mods
            _accel:      null,
            _valueCurve: 1,
            // Timers
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
        this._accelEvents = [];
        this._loopAccelEvents = [];
        this.pressHeld = false;
        this.turnHappened = false;
        this._ledObservers = [];
    };

    XoneK3.Binding.prototype._scaleValue = function(v) {
        if (v > 63) return (v - 1) / 126;
        return v / 128;
    };

    XoneK3.Binding.prototype.input = function(ch, cc, v, s) {
        // Fires for every binding including noLED cells and idx < 0
        // controls. Hook tracks controller state, not per-LED output.
        if (this._ctrl._onInput) this._ctrl._onInput(this);

        if (this.type === 'knob' || this.type === 'fader') {
            this._normalized = this._scaleValue(v);
        }

        var now = Date.now();
        var reps = this._applyInputMods(now);

        if (reps > 0) {
            var fn = this._func;
            if (fn) {
                for (var r = 0; r < reps; r++) {
                    fn.call(this, this._funcArgs, ch, cc, v, s);
                }
            } else {
                this._defaultInput(v, s);
            }
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

    XoneK3.Binding.prototype._applyInputMods = function(now) {
        if (this._accel) {
            var w = this._accel.window;
            var ev = this._accelEvents;
            ev.push(now);
            while (ev.length > 0 && ev[0] < now - w) ev.shift();

            var rate = ev.length * 1000 / w;
            var t = Math.min(1, rate / this._accel.fullAt);
            t = Math.pow(t, this._accel.curve);
            var reps = 1 + (this._accel.amount - 1) * t;
            return Math.max(1, Math.round(reps));
        }
        return 1;
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

    XoneK3.Binding.prototype._isOn = function() {
        if (this._csOn !== null && this._csOn !== undefined) {
            if (this._csOn === true)  return 1;
            if (this._csOn === false) return 0;
            var s = this._csOn;
            if (s.patchActive !== undefined) {
                var names = Array.isArray(s.patchActive) ? s.patchActive : [s.patchActive];
                for (var i = 0; i < names.length; i++) {
                    if (this._ctrl._patchActive(names[i])) return 1;
                }
                return 0;
            }
            var v;
            if (s.co !== undefined) {
                v = (s.group !== undefined) ? engine.getValue(s.group, s.co) : undefined;
            } else if (s.state !== undefined) {
                v = XoneK3.readPath(this._ctrl, s.state);
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
            } else {
                v = undefined;
            }
            if (s.equals !== undefined) return (v === s.equals) ? 1 : 0;
            if (s.contains !== undefined) {
                if (Array.isArray(v)) return (v.indexOf(s.contains) !== -1) ? 1 : 0;
                if (typeof v === 'string') return (v.indexOf(s.contains) !== -1) ? 1 : 0;
                return 0;
            }
            return v ? 1 : 0;
        }
        if (this.group && this.outKey) return engine.getValue(this.group, this.outKey) > 0 ? 1 : 0;
        return 0;
    };

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

    XoneK3.Binding.prototype._sendColor = function(entry, isOn) {
        if (!entry) { this._send(0, 0, 0, 0); return; }
        var rgb = entry.rgb, type = entry.type || 'rgb';
        if (type === 'mixxx') {
            if (!isOn) { this._send(0, 0, 0, 0); return; }
            var co = this.outKey, colourCo = null;
            if (co) {
                var m = co.match(/^(hotcue_\d+)_status$/);
                if (m) colourCo = m[1] + '_color';
            }
            var mx = (colourCo && this.group) ? engine.getValue(this.group, colourCo) : 0;
            rgb = XoneK3.mapMixxxColor(mx);
            if (!rgb) { this._send(0, 0, 0, 0); return; }
        }
        var hw = isOn ? entry.brightness
                      : (entry.brightnessOff !== undefined && entry.brightnessOff !== null
                         ? entry.brightnessOff : entry.brightness);
        if (!rgb) { this._send(0, 0, 0, 0); return; }
        this._send(rgb[0], rgb[1], rgb[2], hw);
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

    XoneK3.Binding.prototype._evaluateScheme = function() {
        var scheme = this._csScheme;
        if (this._csSchemeFn) {
            var ref = this._csSchemeFn();
            if (ref !== undefined && ref !== null) {
                if (ref !== this._csSchemeMemo) {
                    // Fresh-inline-object detection: identity changed
                    // but shape is identical. composeScheme caches;
                    // a raw inline literal recompiles per render.
                    if (typeof ref === 'object' && !Array.isArray(ref) &&
                        typeof this._csSchemeMemo === 'object' &&
                        this._csSchemeMemo !== null &&
                        !Array.isArray(this._csSchemeMemo)) {
                        var a = XoneK3._stableStringify(ref);
                        var b2 = XoneK3._stableStringify(this._csSchemeMemo);
                        if (a === b2) {
                            XoneK3._warnOnce('csSchemeFresh:' + this._name,
                                'colorScheme scheme function on ' + this._name +
                                ' returns a fresh object each call — LED ' +
                                'recompiles every render. Wrap with ' +
                                'XoneK3.builders.composeScheme or hoist the object.');
                        }
                    }
                    this._csSchemeMemo = ref;
                    this._csCompiledMemo = this._ctrl._resolveSchemeRef(ref);
                }
                if (this._csCompiledMemo) scheme = this._csCompiledMemo;
            }
        }
        return scheme;
    };

    XoneK3.Binding.prototype._refreshColorScheme = function() {
        if (this._csFailed) { this._send(0, 0, 0, 0); return; }

        var logicalOn = this._isOn();
        var scheme = this._evaluateScheme();
        if (!scheme) { this._send(0, 0, 0, 0); return; }

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
    // SNAPSHOT FIELD LIST
    // ============================================================
    // Source fields for K3Controller._snapshotBinding. Left column
    // read before _reset, right column the key consumers read.
    XoneK3._SNAPSHOT_FIELDS = [
        ['group',   'group'],
        ['inKey',   'inKey'],
        ['type',    'wasPot'],
        ['_rawCfg', 'wasBound'],
        ['_noLED',  'wasNoLED'],
        ['_k2',     'wasK2'],
        ['idx',     'idx']
    ];

    // Reset-able fields _unbind and _rearmSoftTakeover do not read.
    // Anything reset-able that isn't a snapshot source and isn't
    // here triggers a boot-time warning.
    XoneK3._SNAPSHOT_IGNORED = [
        'outKey', 'buttonMode', 'softTakeover',
        '_func', '_funcArgs', '_usedTokens',
        '_csActive', '_csFailed', '_csDeviation', '_csScheme', '_csSchemeFn',
        '_csSchemeMemo', '_csCompiledMemo',
        '_csKnob', '_csFromStateConn', '_csOn',
        '_valueConn', '_conns',
        '_accel', '_valueCurve',
        '_shutdownHoldTimer'
    ];

    XoneK3._snapshotTransform = function(sourceName, v) {
        if (sourceName === 'type')    return (v === 'knob' || v === 'fader');
        if (sourceName === '_rawCfg') return !!v;
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