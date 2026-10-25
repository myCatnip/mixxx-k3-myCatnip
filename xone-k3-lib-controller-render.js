// xone-k3-lib-controller-render.js — LED writes, sysex queue,
// calibration math, ramp sampling, beatjump gate.
//
// Loaded after lib-controller-beat.js. Extends K3Controller.prototype.

'use strict';

if (typeof XoneK3 === 'undefined') {
    throw new Error('Xone K3: xone-k3-lib-controller-render.js — xone-k3-lib-core.js must load first');
}
if (typeof XoneK3._requireLoad !== 'function') {
    throw new Error('Xone K3: xone-k3-lib-controller-render.js — xone-k3-lib-core.js must load first');
}
XoneK3._requireLoad('xone-k3-lib-controller-render.js',
    ['K3Controller', 'buildSysExLED', 'sendK2Note',
     'sampleT', 'sampleSegs', 'applyBeat', 'BEAT_HOLD', 'scaleTarget']);

(function() {
    // Per-boot counter for segments-array ids. Cleared in _bootWith.
    XoneK3._segsCacheCounter = 0;

    // ============================================================
    // LED WRITE + CALIBRATION
    // ============================================================
    XoneK3.K3Controller.prototype._wbRGB = function(r, g, b) {
        if (!this.wbActive) return [r, g, b];
        var wb = this.wbGain;
        if (!wb) return [r, g, b];
        return [
            Math.max(0, Math.min(127, Math.round(r * wb[0]))),
            Math.max(0, Math.min(127, Math.round(g * wb[1]))),
            Math.max(0, Math.min(127, Math.round(b * wb[2])))
        ];
    };

    XoneK3.K3Controller.prototype._sendSysExLED = function(idx, r, g, b, hw) {
        var val = r + ':' + g + ':' + b + ':' + hw;
        if (this._ledCache[idx] === val) return;
        this._ledCache[idx] = val;

        var msg = XoneK3.buildSysExLED(idx, r, g, b, hw);
        if (XoneK3.SYSEX_THROTTLE_MS <= 0) { midi.sendSysexMsg(msg, msg.length); return; }

        for (var i = 0; i < this._sysexQueue.length; i++) {
            if (this._sysexQueue[i].idx === idx) {
                this._sysexQueue[i].msg = msg;
                return;
            }
        }
        this._sysexQueue.push({ idx: idx, msg: msg });
        if (this._sysexQueue.length > 128)
            this._sysexQueue.splice(0, this._sysexQueue.length - 128);

        var self = this;
        if (!this._sysexTimer) {
            this._sysexTimer = engine.beginTimer(Math.max(1, XoneK3.SYSEX_THROTTLE_MS), function() {
                // No _shuttingDown bail. The drain runs until the
                // queue empties or _stopSysExDrain is called.
                // Shutdown relies on this.
                if (self._sysexQueue.length === 0) {
                    engine.stopTimer(self._sysexTimer);
                    self._sysexTimer = null;
                    return;
                }
                var m = self._sysexQueue.shift();
                midi.sendSysexMsg(m.msg, m.msg.length);
                if (self._sysexQueue.length === 0) {
                    engine.stopTimer(self._sysexTimer);
                    self._sysexTimer = null;
                }
            }, false);
        }
    };

    XoneK3.K3Controller.prototype._stopSysExDrain = function() {
        if (this._sysexTimer) {
            engine.stopTimer(this._sysexTimer);
            this._sysexTimer = null;
        }
    };

    XoneK3.K3Controller.prototype.sendLED = function(idx, r, g, b, hw, k2Override) {
        if (this._shuttingDown) return;
        if (idx < 0) return;
        var useK2 = (typeof k2Override === 'boolean') ? k2Override : !this.sysex;
        if (useK2) { XoneK3.sendK2Note(this.midiChannel, idx, r, g, b, hw); return; }
        if (this.calibrationMode !== 'off') {
            var wbRgb = this._wbRGB(r, g, b);
            r = wbRgb[0]; g = wbRgb[1]; b = wbRgb[2];
        }
        this._sendSysExLED(idx, r, g, b, hw);
    };

    // Short messages inline; sysex goes through the queue so
    // shutdown can wait for the last blank frame.
    XoneK3.K3Controller.prototype._blankLeds = function() {
        this._stopSysExDrain();
        this._sysexQueue = [];
        this._ledCache = {};

        for (var n = 0x0C; n <= 0x37; n++) {
            midi.sendShortMsg(0x90 + this.midiChannel, n, 0x00);
        }

        if (this.sysex !== false) {
            for (var idx = 0; idx <= 0x21; idx++) {
                if (this.k2Indices && this.k2Indices[idx]) continue;
                this._sendSysExLED(idx, 0, 0, 0, 0);
            }
        }
    };

    XoneK3.K3Controller.prototype._pulseCo = function(group, co) {
        engine.setValue(group, co, 1);
        engine.beginTimer(1, function() {
            engine.setValue(group, co, 0);
        }, true);
    };

    // ============================================================
    // BEATJUMP GATE
    // ============================================================
    // A beatjump is gated on its channel's loop being active.
    // Outside a loop: always allowed, no stamp. Inside a loop:
    // blocked when less than BEATJUMP_GAP_MS has elapsed since
    // the last loop-touching event on the same channel; on a
    // pass, records the beatjump as the new "last touch" so two
    // rapid in-loop beatjumps also gate each other.
    XoneK3.K3Controller.prototype._beatjumpAllowed = function(group) {
        var ch = this._channelOf(group);
        if (!ch) return true;
        var loopOn = engine.getValue('[Channel' + ch + ']', 'loop_enabled') > 0;
        var now = Date.now();
        if (loopOn) {
            var last = this._lastLoopTouchMs[ch];
            if (last && now - last < XoneK3.BEATJUMP_GAP_MS) {
                if (XoneK3._debugPrintsOn) {
                    print('[k3] beatjump gated: ' + (now - last) + 'ms / ' +
                          XoneK3.BEATJUMP_GAP_MS + 'ms');
                }
                return false;
            }
            this._lastLoopTouchMs[ch] = now;
        }
        return true;
    };

    // Record a loop-touching event on this group's channel.
    // Beatjump will gate against this timestamp when the channel
    // is in an active loop.
    XoneK3.K3Controller.prototype._touchLoop = function(group) {
        var ch = this._channelOf(group);
        if (ch) this._lastLoopTouchMs[ch] = Date.now();
    };

    // ============================================================
    // CALIBRATION MATH
    // ============================================================
    function _saturation(rgb) {
        var mx = Math.max(rgb[0], rgb[1], rgb[2]);
        if (mx <= 0) return 0;
        var mn = Math.min(rgb[0], rgb[1], rgb[2]);
        return (mx - mn) / mx;
    }

    function _sampleTransfer(table, hw) {
        if (hw <= table[0][0]) return table[0][1];
        var last = table.length - 1;
        if (hw >= table[last][0]) return table[last][1];
        for (var i = 0; i < last; i++) {
            if (hw <= table[i + 1][0]) {
                var span = table[i + 1][0] - table[i][0];
                if (span <= 0) return table[i][1];
                var t = (hw - table[i][0]) / span;
                return table[i][1] * (1 - t) + table[i + 1][1] * t;
            }
        }
        return table[last][1];
    }

    XoneK3.K3Controller.prototype._channelEmit = function(rgb, hw) {
        var wbRgb = this._wbRGB(rgb[0], rgb[1], rgb[2]);
        var t = this._transfer, w = this.channelPerceptual;
        if (!t) {
            var lv = hw / 127;
            return [
                (wbRgb[0] / 127) * lv * w[0],
                (wbRgb[1] / 127) * lv * w[1],
                (wbRgb[2] / 127) * lv * w[2]
            ];
        }
        return [
            (wbRgb[0] / 127) * _sampleTransfer(t.r, hw) * w[0],
            (wbRgb[1] / 127) * _sampleTransfer(t.g, hw) * w[1],
            (wbRgb[2] / 127) * _sampleTransfer(t.b, hw) * w[2]
        ];
    };

    XoneK3.K3Controller.prototype._emitAt = function(rgb, hw) {
        var c = this._channelEmit(rgb, hw);
        var Y = c[0] + c[1] + c[2];
        if (Y <= 0) return 0;
        var P = (this.lumGamma === 1.0) ? Y : Math.pow(Y, this.lumGamma);
        return P * (1 + this.hkBoost * _saturation(rgb));
    };

    XoneK3.K3Controller.prototype._solveHw = function(rgb, hw, ramp, compiled) {
        if (!compiled.calibration) return hw;
        if (this.calibrationMode === 'off') return hw;
        if (rgb[0] === 0 && rgb[1] === 0 && rgb[2] === 0) return hw;
        var target = this._flatTarget(ramp);
        if (target === null) return hw;
        target = XoneK3.scaleTarget(target, compiled.brightnessScale);
        return this._calibratedHw(rgb, target);
    };

    XoneK3.K3Controller.prototype._flatTarget = function(segs) {
        if (!segs || segs.length === 0) return null;
        if (this.calibrationMode === 'off') return null;

        // Segments-array cache ids are boot-scoped. The arrays
        // themselves live in XoneK3._compiledCache, reset per boot.
        if (segs._cacheId === undefined) {
            segs._cacheId = ++XoneK3._segsCacheCounter;
        }
        var cache = this._flatCache;
        var entry = cache[segs._cacheId];
        if (entry && entry.key === this._calibKey) return entry.value;

        var minEmit = Infinity;
        for (var i = 0; i < segs.length; i++) {
            var c = segs[i].color;
            if (c.rgb[0] === 0 && c.rgb[1] === 0 && c.rgb[2] === 0) continue;
            var e = this._emitAt(c.rgb, c.brightness);
            if (e < minEmit) minEmit = e;
        }
        var value = isFinite(minEmit) ? minEmit : null;
        cache[segs._cacheId] = { key: this._calibKey, value: value };
        return value;
    };

    XoneK3.K3Controller.prototype._calibratedHw = function(rgb, targetLum) {
        if (targetLum <= 0) return 0;
        var key = rgb[0] + ':' + rgb[1] + ':' + rgb[2] + ':' + targetLum.toFixed(6);
        var cached = this._hwCache[key];
        if (cached !== undefined) return cached;

        var lo = 0, hi = 127;
        for (var i = 0; i < 12; i++) {
            var mid = (lo + hi) / 2;
            if (this._emitAt(rgb, mid) < targetLum) lo = mid;
            else hi = mid;
        }
        var value = Math.round((lo + hi) / 2);
        if (this._hwCacheSize >= 1024) {
            this._hwCache = {};
            this._hwCacheSize = 0;
        }
        this._hwCache[key] = value;
        this._hwCacheSize++;
        return value;
    };

    XoneK3.K3Controller.prototype._sampleRamp = function(ramp, t, compiled, isOn, skipBeat) {
        var tw = XoneK3.sampleT(compiled, t);
        var entry = XoneK3.sampleSegs(ramp, tw, compiled.interp);
        if (!entry) return null;
        if (isOn) {
            entry.brightness = this._solveHw(entry.rgb, entry.brightness, ramp, compiled);
        }
        if (!skipBeat && isOn && compiled.beat) {
            var st = this._deckStateFor(compiled);
            if (st && st.hasBeat) {
                var beat = XoneK3.applyBeat(entry, compiled.beat, st.count);
                if (beat === XoneK3.BEAT_HOLD) return XoneK3.BEAT_HOLD;
                entry = beat;
            }
        }
        return entry;
    };
})();