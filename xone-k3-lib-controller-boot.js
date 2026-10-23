// xone-k3-lib-controller-boot.js — rate gate, escape detector,
// init / shutdown, MIDI wiring, boot, halt.
//
// Loaded after lib-controller-render.js. Extends
// K3Controller.prototype. Defines XoneK3.boot / bootLab / halt.

'use strict';

if (typeof XoneK3 === 'undefined') {
    throw new Error('Xone K3: xone-k3-lib-controller-boot.js — xone-k3-lib-core.js must load first');
}
if (typeof XoneK3._requireLoad !== 'function') {
    throw new Error('Xone K3: xone-k3-lib-controller-boot.js — xone-k3-lib-core.js must load first');
}
XoneK3._requireLoad('xone-k3-lib-controller-boot.js',
    ['K3Controller', 'RATE_CLASSES', '_inferRateClass',
     'ESCAPE_DETECT_WINDOW_MS', 'ESCAPE_HISTORY_MAX']);

(function() {
    // Defensive elapsed-time. Date.now() is not monotonic — an NTP
    // step backward would make `now - then` negative, which would
    // incorrectly gate events (they'd look "too recent"). Clamping
    // to zero means "no time has passed", the conservative choice
    // for the rate gate. A forward step is the opposite failure
    // mode and no worse than the current behaviour.
    function elapsed(now, then) {
        var dt = now - then;
        return dt > 0 ? dt : 0;
    }

    // ============================================================
    // RATE GATE
    // ============================================================
    XoneK3.K3Controller.prototype._resolveRateClass = function(cfg) {
        if (cfg.rate === false) return null;
        if (typeof cfg.rate === 'string') {
            if (!XoneK3.RATE_CLASSES[cfg.rate]) {
                XoneK3._warnOnce('rateUnknown:' + cfg.rate,
                    'unknown rate class "' + cfg.rate + '" — expected one of ' +
                    Object.keys(XoneK3.RATE_CLASSES).join(', '));
                return null;
            }
            return cfg.rate;
        }
        if (cfg.rate && typeof cfg.rate === 'object') return cfg.rate;
        // Any other value except the passthrough (undefined / null
        // / true) is a probable typo — a number where an object or
        // a class name was intended. Warn once and fall through to
        // inference.
        if (cfg.rate !== undefined && cfg.rate !== null && cfg.rate !== true) {
            XoneK3._warnOnce('rateBadType:' + typeof cfg.rate,
                'binding rate must be a string, object, false, or undefined — got ' +
                typeof cfg.rate + ' (' + String(cfg.rate) + ')');
        }
        return XoneK3._inferRateClass(cfg);
    };

    XoneK3.K3Controller.prototype._claimRate = function(b, rateSpec) {
        // _resolveRateClass validated this at bind time — an
        // unresolvable string name warned there via
        // _warnOnce('rateUnknown:...') and stored null, which
        // Binding.input's `if (gateable && this._rateClass)` check
        // short-circuits. So _claimRate is only ever called with
        // an already-resolved class. The defensive fallthrough
        // below is a safety net for direct callers; it does not
        // warn (the warn already fired at bind).
        var cls = (typeof rateSpec === 'string')
            ? XoneK3.RATE_CLASSES[rateSpec]
            : rateSpec;
        if (!cls) return true;

        var now = Date.now();
        var gated = false;

        if (cls.selfCheckMs > 0 && cls.selfScope === 'binding') {
            if (b._lastGateMs && elapsed(now, b._lastGateMs) < cls.selfCheckMs) {
                gated = true;
            }
        }

        if (!gated && cls.jumpBlockMs > 0) {
            if (this._lastLoopChangeMs &&
                elapsed(now, this._lastLoopChangeMs) < cls.jumpBlockMs) {
                gated = true;
            }
        }

        if (gated) {
            b._recordRateGate();
            return false;
        }

        if (cls.claimMs > 0) {
            // Claim floor algebra:
            //
            //   _lastLoopChangeMs := now - jumpMax + claimMs
            //
            // A subsequent jump-class event gates while
            //   (now' - _lastLoopChangeMs) < jumpMax
            // Substituting:
            //   now' - (now - jumpMax + claimMs) < jumpMax
            //   now' - now < claimMs
            //
            // So the next jump-class event is blocked for exactly
            // `claimMs` ms from this claim — the class's declared
            // tail. jump.claimMs (120ms) is the reference.
            var jumpMax = XoneK3.RATE_CLASSES.jump.jumpBlockMs;
            var floor = now - (jumpMax - cls.claimMs);
            if (!this._lastLoopChangeMs || this._lastLoopChangeMs < floor) {
                this._lastLoopChangeMs = floor;
            }
        }

        if (cls.selfScope === 'binding') b._lastGateMs = now;

        b._recordRateAccept(now);
        this._lastRateClaim = {
            binding: b._name,
            className: (typeof rateSpec === 'string') ? rateSpec : 'inline',
            ts: now
        };

        return true;
    };

    // ============================================================
    // ESCAPE DETECTION
    // ============================================================
    XoneK3.K3Controller.prototype._checkLoopEscape = function(ch) {
        var now = Date.now();

        // Consume the deliberate-loop-off marker either way. If
        // the marker is still within its 1-second window, treat
        // this transition as intentional and return silently; if
        // it's stale, fall through to escape detection (the
        // marker has served its purpose).
        var expect = this._expectingLoopOff[ch];
        if (expect) {
            this._expectingLoopOff[ch] = 0;
            if (elapsed(now, expect) < 1000) return;
        }

        var sinceClaim = this._lastLoopChangeMs
            ? elapsed(now, this._lastLoopChangeMs)
            : Infinity;
        if (sinceClaim > XoneK3.ESCAPE_DETECT_WINDOW_MS) return;

        var claim = this._lastRateClaim;
        var st = this._decks[ch];
        var claimStr = claim
            ? (claim.binding + '/' + claim.className)
            : '—';

        var printKey = ch + ':' + (claim ? claim.binding : 'none');
        var bucket = Math.floor(now / 100);
        if (this._lastEscapePrintKey !== printKey ||
            this._lastEscapePrintBucket !== bucket) {
            print('[k3] LOOP ESCAPE deck=' + ch +
                  ' sinceClaim=' + sinceClaim + 'ms' +
                  ' claimedBy=' + claimStr +
                  ' loop=[' + st.loopStartN.toFixed(4) +
                  ',' + st.loopEndN.toFixed(4) + ']');
            this._lastEscapePrintKey = printKey;
            this._lastEscapePrintBucket = bucket;
        }

        this._escapes.push({
            ch: ch,
            ts: now,
            sinceClaim: sinceClaim,
            claimedBy: claim ? claim.binding : null,
            className: claim ? claim.className : null,
            loopStartN: st.loopStartN,
            loopEndN: st.loopEndN
        });
        if (this._escapes.length > XoneK3.ESCAPE_HISTORY_MAX) {
            this._escapes.shift();
        }
    };

    // ============================================================
    // INIT / SHUTDOWN
    // ============================================================
    XoneK3.K3Controller.prototype.init = function() {
        this._blankLeds();
        this._recompute();
        var self = this;
        this._initExtra();
        this._validateBindings();

        engine.beginTimer(250, function() {
            if (self._shuttingDown) return;
            self._closeBeatClocks();
            self._syncBeatClocks();
            self._syncFxLayout();
        }, true);
    };
    XoneK3.K3Controller.prototype._initExtra = function() {};
    XoneK3.K3Controller.prototype._shutdownExtra = function() {};

    // Shutdown:
    //   1. Set _shuttingDown. Blocks every other send path so the
    //      queue holds only blanks.
    //   2. _blankLeds(). Short messages inline; sysex pushed
    //      through the normal queue, which kicks the drain timer.
    //   3. Poll for _sysexQueue.length === 0. Once empty, stop the
    //      drain, close beat clocks, run subclass hook.
    //
    // The poll is the whole point: the drain timer runs normally,
    // one frame per tick, and shutdown doesn't tear down state
    // until the last frame is on the wire.
    XoneK3.K3Controller.prototype.shutdown = function() {
        if (this._shuttingDown) return;
        this._shuttingDown = true;

        this._blankLeds();

        var self = this;
        var elapsedWait = 0;
        var tick = 20;
        var maxWait = 2000;

        function finalize() {
            if (self._sysexQueue.length > 0 && elapsedWait < maxWait) {
                elapsedWait += tick;
                engine.beginTimer(tick, finalize, true);
                return;
            }
            self._stopSysExDrain();
            self._closeBeatClocks();
            self._shutdownExtra();
        }

        engine.beginTimer(tick, finalize, true);
    };

    // ============================================================
    // MIDI WIRING
    // ============================================================
    XoneK3._wireInputs = function(ctrl) {
        var noteOff = 0x80 + ctrl.midiChannel;
        for (var name in ctrl.bindings) {
            if (!ctrl.bindings.hasOwnProperty(name)) continue;
            (function(b) {
                function cb(_ch, _cc, v, s) {
                    if (b.input) b.input(_ch, _cc, v, s);
                }
                midi.makeInputHandler(b.midi[0], b.midi[1], cb);
                if ((b.midi[0] & 0xF0) === 0x90) {
                    midi.makeInputHandler(noteOff, b.midi[1], cb);
                }
            })(ctrl.bindings[name]);
        }
    };

    // ============================================================
    // BOOT / HALT
    // ============================================================
    XoneK3.controllers = [];

    XoneK3._bootWith = function(devices, Ctor, label) {
        print('\n=== Xone K3 INIT' + (label ? ' (' + label + ')' : '') + ' ===');
        XoneK3.controllers = [];
        XoneK3._schemeCache = {};
        XoneK3._compiledCache = {};
        XoneK3._warned = {};
        XoneK3._modeSeen = { edit: false, slots: false };
        
        // _funcId ids are boot-scoped: without this reset they grow
        // unboundedly across reloads and inspect() output shows
        // ids that depend on how many times the preset was reloaded.
        XoneK3._funcIdCounter = 0;
        XoneK3._funcIdMap = new WeakMap();
        // Segments-array ids are also boot-scoped. The segments
        // arrays themselves live in the per-boot _compiledCache,
        // so a fresh id space per boot is correct and matches the
        // _funcId treatment.
        XoneK3._segsCacheCounter = 0;
        XoneK3._populateColors();

        if (!Array.isArray(devices)) devices = [devices];
        XoneK3.TIME_SIG = (devices[0] && devices[0].timeSig)
            ? devices[0].timeSig : null;
        devices.forEach(function(d) {
            print('  spawning ' + d.label + ' ch 0x' + d.midiChannel.toString(16));
            var ctrl = new Ctor(d);
            ctrl.init();
            XoneK3._wireInputs(ctrl);
            XoneK3.controllers.push(ctrl);
        });
        XoneK3._auditSnapshotFields();
    };

    XoneK3.boot    = function(devices) { XoneK3._bootWith(devices, XoneK3.K3Controller, ''); };
    XoneK3.bootLab = function(devices) { XoneK3._bootWith(devices, XoneK3.LabController, 'colorLab'); };

    XoneK3.halt = function() {
        print('\n=== Xone K3 SHUTDOWN ===');
        XoneK3.controllers.forEach(function(ctrl) { ctrl.shutdown(); });
        XoneK3.controllers = [];
        print('=== done ===');
    };
})();