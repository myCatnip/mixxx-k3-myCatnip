// xone-k3-lib-controller-beat.js — timeline (loop clock),
// display-source resolution, beat count derivation, beat clock
// connections.
//
// Loaded after lib-controller-colour.js. Extends K3Controller.prototype.
//
// Model: one pulse source (the track position's fractional beat,
// with beat_active edges preferred when present). Two cascade
// counts — track-derived from playposition, and loop-derived from
// the loop clock's accumulated position, which marches forward
// through wraps as if the loop played through in sequence.
//
// Accumulation, not a wall-clock timer, is what keeps two decks
// in phase: both advance by real playhead movement, so at the
// same tempo they advance at the same rate.

'use strict';

if (typeof XoneK3 === 'undefined') {
    throw new Error('Xone K3: xone-k3-lib-controller-beat.js — xone-k3-lib-core.js must load first');
}
if (typeof XoneK3._requireLoad !== 'function') {
    throw new Error('Xone K3: xone-k3-lib-controller-beat.js — xone-k3-lib-core.js must load first');
}
XoneK3._requireLoad('xone-k3-lib-controller-beat.js',
    ['K3Controller', '_freshDeckState', 'VIRTUAL_CLOCKS',
     'DEFAULT_BEAT_DECK', 'BEAT_REPAINT_THROTTLE_MS']);

(function() {
    var freshDeckState = XoneK3._freshDeckState;

    // Mixxx's hotcue ceiling — 36 per deck since 1.9.1. Reading
    // a hotcue CO on a build with fewer is safe: the colour
    // won't be in the marker list, so the entry is skipped
    // before the position is read. One source of truth for the
    // two loops that touch every hotcue slot — the origin
    // derivation scan and the hotcue observers.
    var HOTCUE_MAX = 16;

    // Loop-wrap adjustment to a position delta. Applied when the
    // loop clock is in tempo-tracking mode.
    //
    // A wrap is a jump in the direction opposite to playback. On
    // forward playback the playhead jumps backward by ~loopLen;
    // on reverse playback it jumps forward by ~loopLen. The old
    // boundary-proximity test missed wraps on tight loops (a
    // single tick could cross the whole boundary region), so the
    // detection is direction-based now, with the loop length
    // added back to keep the accumulated position marching
    // forward musically.
    function applyLoopWrapAdjust(st, clock, delta, newPos, reversing) {
        if (!st.loopActive || st.loopEndN <= st.loopStartN) return delta;
        var loopLen = st.loopEndN - st.loopStartN;
        if (!reversing) {
            if (delta < 0) return delta + loopLen;
        } else {
            if (delta > 0) return delta - loopLen;
        }
        return delta;
    }

    // ============================================================
    // CHANNEL / LOOP STATE
    // ============================================================
    XoneK3.K3Controller.prototype._channelOf = function(group) {
        if (typeof group !== 'string') return null;
        var m = /^\[Channel(\d)\]$/.exec(group);
        if (!m) return null;
        var n = parseInt(m[1], 10);
        return (n >= 1 && n <= 4) ? n : null;
    };

    XoneK3.K3Controller.prototype._readLoopBounds = function(ch) {
        var samples = this._trackMeta(ch).samples;
        if (!(samples > 0)) return null;
        var grp = '[Channel' + ch + ']';
        var start = engine.getValue(grp, 'loop_start_position');
        var end   = engine.getValue(grp, 'loop_end_position');
        if (!(end > start)) return null;
        return { start: start / samples, end: end / samples };
    };

    XoneK3.K3Controller.prototype._readLoopState = function(ch) {
        var st = this._decks[ch];
        var grp = '[Channel' + ch + ']';
        st.loopActive = engine.getValue(grp, 'loop_enabled') > 0;
        if (st.loopActive) {
            var b = this._readLoopBounds(ch);
            if (b) { st.loopStartN = b.start; st.loopEndN = b.end; }
        }
    };

    // ============================================================
    // PLAYBACK RATE
    // ============================================================
    // The playback multiplier for a channel, ~1.0 at unity.
    //
    // Mixxx's `rate` CO is the rate *slider position*, not a
    // multiplier — for -7% pitch it returns roughly -0.07, not 0.93.
    // `rate_ratio` is the actual ratio. Use that, and fall back to
    // `1 + rate` for builds that don't expose it.
    //
    // Do NOT read `rate` directly and guard with `<= 0` — the
    // slider position is <= 0 on every pitch-down AND at unity, so
    // the guard silently neutralises the multiplier.
    XoneK3.K3Controller.prototype._channelRate = function(ch) {
        var grp = '[Channel' + ch + ']';
        var ratio = engine.getValue(grp, 'rate_ratio');
        if (typeof ratio === 'number' && isFinite(ratio) && ratio > 0) {
            return ratio;
        }
        var slider = engine.getValue(grp, 'rate');
        if (typeof slider === 'number' && isFinite(slider)) {
            var m = 1 + slider;
            if (m > 0) return m;
        }
        return 1;
    };

    // ============================================================
    // VIRTUAL CLOCK (accumulated position)
    // ============================================================
    // `clock.pos` accumulates playhead movement through loop
    // wraps. It's the cascade source in loop mode. The
    // tempo-tracking flag picks between two equivalent accumulation
    // strategies; both rate-scale correctly.
    XoneK3.K3Controller.prototype._virtualTempoTrack = function() {
        var cfg = XoneK3.VIRTUAL_CLOCKS.loop;
        return !!(cfg && cfg.trackTempo);
    };

    XoneK3.K3Controller.prototype._startVirtualClock = function(ch) {
        var st = this._decks[ch];
        var clock = st.loopClock;
        var pos = engine.getValue('[Channel' + ch + ']', 'playposition');
        clock.pos = pos;
        clock.lastTrackPos = pos;
        clock.lastTs = Date.now();
        clock.running = true;
        this._resolveDisplaySource(ch);
    };

    XoneK3.K3Controller.prototype._stopVirtualClock = function(ch) {
        var st = this._decks[ch];
        st.loopClock.running = false;
        this._resolveDisplaySource(ch);
    };

    XoneK3.K3Controller.prototype._advanceVirtualClock = function(ch, newPos) {
        var st = this._decks[ch];
        var clock = st.loopClock;
        if (!clock.running) return;

        var now = Date.now();
        var grp = '[Channel' + ch + ']';
        if (this._virtualTempoTrack()) {
            var delta = newPos - clock.lastTrackPos;
            var reversing = engine.getValue(grp, 'reverse') > 0;
            delta = applyLoopWrapAdjust(st, clock, delta, newPos, reversing);
            clock.pos += delta;
        } else {
            // Real-seconds mode accumulates forward only. Reverse
            // playback is not handled here — use trackTempo: true
            // if you need reverse-accurate accumulation.
            //
            // dt is clamped to zero: Date.now() is not monotonic,
            // and a backward NTP step would otherwise subtract
            // from clock.pos, shifting the loop-mode cascade
            // count backward until the clock caught up.
            var playing = engine.getValue(grp, 'play_indicator') > 0;
            if (playing && clock.lastTs > 0) {
                var dt = (now - clock.lastTs) / 1000;
                if (dt < 0) dt = 0;
                var dur = this._trackMeta(ch).duration;
                var rate = this._channelRate(ch);
                if (dur > 0) clock.pos += (dt * rate) / dur;
            }
        }

        clock.lastTrackPos = newPos;
        clock.lastTs = now;
    };

    // ============================================================
    // DISPLAY SOURCE
    // ============================================================
    // displaySource picks which cascade count the LEDs read.
    // The pulse phase is always track-derived — see
    // _repaintFromPosition and the beat_active handler.
    XoneK3.K3Controller.prototype._resolveDisplaySource = function(ch) {
        var st = this._decks[ch];
        var choice = st.loopClock.running ? 'loop' : 'track';

        var changed = (choice !== st.displaySource);
        st.displaySource = choice;

        if (this.selectedDeckCurrent === ch) {
            this._refreshDisplayFlags();
        }
        if (changed) {
            this._syncBeatCount(ch);
            if (this.selectedDeckCurrent === ch) {
                this._refreshAllLeds('display-source');
            }
        }
    };

    // ============================================================
    // TRACK METADATA / BEAT MATH
    // ============================================================
    // Content bounds for the beat math and the track-end
    // countdown. Start is always 0 (file start) — intro_start
    // is never read here, never influences beat 0, never
    // influences phrase origin, never influences anything. End
    // is outro_end_position / samples (or 1 when unset) so the
    // countdown can still count down to the end of the track.
    XoneK3.K3Controller.prototype._getContentBounds = function(ch) {
        var samples = this._trackMeta(ch).samples;
        if (!(samples > 0)) return null;

        var grp = '[Channel' + ch + ']';
        var outroS = engine.getValue(grp, 'outro_end_position');

        var endN = (outroS > 0 && outroS <= samples) ? (outroS / samples) : 1;
        return { start: 0, end: endN };
    };

    XoneK3.K3Controller.prototype._readFileBpm = function(ch) {
        var grp = '[Channel' + ch + ']';
        var fileBpm = engine.getValue(grp, 'file_bpm');
        if (fileBpm > 0) return fileBpm;
        var bpm = engine.getValue(grp, 'bpm');
        if (!(bpm > 0)) return null;
        return bpm / this._channelRate(ch);
    };

    XoneK3.K3Controller.prototype._trackMeta = function(ch) {
        var cached = this._trackMetaCache[ch];
        if (cached !== undefined) return cached;
        var grp = '[Channel' + ch + ']';
        var dur = engine.getValue(grp, 'duration');
        var samples = engine.getValue(grp, 'track_samples');
        var meta = {
            duration: (dur > 0) ? dur : 0,
            fileBpm:  this._readFileBpm(ch),
            samples:  (samples > 0) ? samples : 0
        };
        if (meta.duration > 0) {
            this._trackMetaCache[ch] = meta;
        }
        return meta;
    };

    XoneK3.K3Controller.prototype._fileBpm = function(ch) {
        return this._trackMeta(ch).fileBpm;
    };

    XoneK3.K3Controller.prototype._beatF = function(ch, pos) {
        if (typeof pos !== 'number' || !isFinite(pos)) return null;
        var meta = this._trackMeta(ch);
        if (!(meta.duration > 0)) return null;
        if (!meta.fileBpm) return null;
        var bounds = this._getContentBounds(ch);
        if (!bounds) return null;
        return (pos - bounds.start) * meta.duration * meta.fileBpm / 60;
    };

    // Track-only position, for the pulse phase.
    XoneK3.K3Controller.prototype._trackBeatF = function(ch) {
        var pos = engine.getValue('[Channel' + ch + ']', 'playposition');
        return this._beatF(ch, pos);
    };

    // Legacy: reads whichever timeline is displayed. Kept for
    // inspect and tests; the cascade no longer uses it directly.
    XoneK3.K3Controller.prototype._phraseSourcePos = function(ch) {
        var st = this._decks[ch];
        if (st.displaySource === 'loop' && st.loopClock.running)
            return st.loopClock.pos;
        return engine.getValue('[Channel' + ch + ']', 'playposition');
    };

    XoneK3.K3Controller.prototype._computeBeatState = function(ch) {
        var beatF = this._trackBeatF(ch);
        if (beatF === null) return null;
        var abs = Math.floor(beatF);
        return {
            abs: abs,
            count: abs - this._phraseOrigin[ch] + 1,
            frac: beatF - abs
        };
    };

    // The count that drives the cascade. Track mode: derived from
    // the current track position. Loop mode: derived from the
    // loop clock's accumulated position, which marches forward
    // through wraps as if the loop played through in sequence.
    //
    // Both decks at the same tempo accumulate at the same rate
    // and stay in phase, because accumulation is driven by real
    // playhead movement — no JS timer jitter, no per-deck seed.
    XoneK3.K3Controller.prototype._cascadeCount = function(ch, trackBeatF) {
        var st = this._decks[ch];
        if (st.displaySource === 'loop' && st.loopClock.running) {
            var loopBeatF = this._beatF(ch, st.loopClock.pos);
            if (loopBeatF !== null) {
                return Math.floor(loopBeatF) - this._phraseOrigin[ch] + 1;
            }
        }
        return Math.floor(trackBeatF) - this._phraseOrigin[ch] + 1;
    };

    // Read-only view of the loop-mode beat, for inspect('beat').
    // Same derivation the cascade uses. Returns null when not in
    // loop mode or when metadata is missing.
    XoneK3.K3Controller.prototype._virtualBeatFor = function(ch) {
        var st = this._decks[ch];
        if (!st.loopClock.running) return null;
        var beatF = this._beatF(ch, st.loopClock.pos);
        if (beatF === null) return null;
        return Math.floor(beatF) - this._phraseOrigin[ch] + 1;
    };

    XoneK3.K3Controller.prototype._syncBeatCount = function(ch) {
        var st = this._decks[ch];
        var beatF = this._trackBeatF(ch);
        if (beatF === null) return false;
        var count = this._cascadeCount(ch, beatF);
        st.hasBeat = true;
        if (st.count === count) return false;
        st.count = count;
        this._refreshBeatLeds(ch);
        return true;
    };

    // Derive the phrase origin from the current position and the
    // set of phrase-marker hotcues. Any hotcue whose stored colour
    // is in PHRASE_MARKER_COLORS defines a phrase-start position;
    // the origin at any playhead position is the beat of the last
    // such marker at or before that position, or 0 if there is
    // none.
    //
    // Position-derived, not crossing-derived. No state is tracked
    // across ticks — any tick with the same playhead produces the
    // same answer, and forward / backward movement is handled by
    // the `markerPos > pos` comparison. Press, cross, scrub, load,
    // and forward beatjump all funnel through the same code.
    //
    // Frozen in loop mode. The loop clock accumulates forward as
    // if the loop played through in sequence; origin should stay
    // fixed for the loop's duration. First playposition tick after
    // the loop stops re-derives.
    //
    // Fast path: empty marker list, or no track metadata — return
    // without reading any COs.
    XoneK3.K3Controller.prototype._deriveOriginFromPosition = function(ch, pos) {
        var markers = XoneK3.PHRASE_MARKER_COLORS;
        if (!Array.isArray(markers) || markers.length === 0) return;

        var st = this._decks[ch];
        if (st.displaySource === 'loop' && st.loopClock.running) return;

        var meta = this._trackMeta(ch);
        if (!(meta.samples > 0)) return;

        var grp = '[Channel' + ch + ']';
        var best = null;
        var bestAhead = null;

        for (var n = 1; n <= HOTCUE_MAX; n++) {
            var color = engine.getValue(grp, 'hotcue_' + n + '_color');
            if (markers.indexOf(color) === -1) continue;
            var posFrames = engine.getValue(grp, 'hotcue_' + n + '_position');
            if (!(posFrames >= 0) || posFrames > meta.samples) continue;
            var markerPos = posFrames / meta.samples;
            if (markerPos <= pos) {
                if (best === null || markerPos > best) best = markerPos;
            } else {
                if (bestAhead === null || markerPos < bestAhead) bestAhead = markerPos;
            }
        }

        var refPos = (best !== null) ? best : bestAhead;
        var newOrigin;
        if (refPos !== null) {
            var beatF = this._beatF(ch, refPos);
            if (beatF === null) return;
            newOrigin = Math.floor(beatF);
        } else {
            newOrigin = 0;
        }

        if (this._phraseOrigin[ch] !== newOrigin) {
            this._phraseOrigin[ch] = newOrigin;
            this._syncBeatCount(ch);
        }
    };

    XoneK3.K3Controller.prototype._resetBeat = function(ch) {
        this._decks[ch] = freshDeckState();
        this._phraseOrigin[ch] = 0;
        if (this.selectedDeckCurrent === ch) {
            this._refreshDisplayFlags();
            this._refreshAllLeds('reset-beat');
        }
        this._refreshBeatLeds(ch);
    };

    XoneK3.K3Controller.prototype._repaintBeat = function(ch) {
        var refreshed = this._syncBeatCount(ch);
        if (!refreshed) this._refreshBeatLeds(ch);
    };

    // Pulse phase comes from the actual track position in BOTH
    // display modes. The loop clock's position never feeds the
    // pulse — it does not coincide with the audible beat edge,
    // and using it is what used to let two decks at the same
    // tempo drift apart the moment one of them looped.
    XoneK3.K3Controller.prototype._repaintFromPosition = function(ch) {
        var st = this._decks[ch];
        var trackBeatF = this._trackBeatF(ch);
        if (trackBeatF === null) return;

        var trackAbs = Math.floor(trackBeatF);
        var trackFrac = trackBeatF - trackAbs;
        var count = this._cascadeCount(ch, trackBeatF);

        var wasHasBeat = st.hasBeat;
        var wasActive  = st.active;
        var wasCount   = st.count;

        st.count = count;
        st.hasBeat = true;
        st.active = trackFrac < 0.5;

        if (!wasHasBeat || wasActive !== st.active || wasCount !== st.count) {
            this._refreshBeatLeds(ch);
        }
    };

    // ============================================================
    // DISPLAY FLAGS
    // ============================================================
    XoneK3.K3Controller.prototype._refreshDisplayFlags = function() {
        var st = this._decks[this.selectedDeckCurrent];
        if (!st) {
            this.activeDeckVirtual   = false;
            this.activeLoopVirtual   = false;
            this.activeDisplaySource = 'track';
            return;
        }
        this.activeDeckVirtual   = (st.displaySource !== 'track');
        this.activeLoopVirtual   = st.loopClock.running;
        this.activeDisplaySource = st.displaySource;
    };

    // ============================================================
    // BEAT CLOCKS
    // ============================================================
    XoneK3.K3Controller.prototype._openBeatClocks = function() {
        var self = this;
        for (var ch = 1; ch <= 4; ch++) {
            (function(ch) {
                var grp = '[Channel' + ch + ']';

                function wire(conns, co, fn) {
                    conns.push(engine.makeConnection(grp, co, fn));
                }

                wire(self._beatConns, 'beat_active', function(v) {
                    var st = self._decks[ch];
                    if (v === 1) st.lastBeatEdge = Date.now();

                    if (v === 1) {
                        var now = st.lastBeatEdge;
                        if (now - st.lastBeatRepaint < XoneK3.BEAT_REPAINT_THROTTLE_MS) {
                            st.active = true;
                            st.hasBeat = true;
                        } else {
                            st.lastBeatRepaint = now;
                            st.active = true;
                            st.hasBeat = true;
                            self._repaintBeat(ch);
                        }
                    } else {
                        st.active = false;
                        self._refreshBeatLeds(ch);
                    }
                    if (self._onBeat) self._onBeat(ch);
                });

                wire(self._playConns, 'playposition', function() {
                    var st = self._decks[ch];
                    var newPos = engine.getValue(grp, 'playposition');
                    self._advanceVirtualClock(ch, newPos);

                    var now = Date.now();
                    if (now - st.lastPositionSync < XoneK3.BEAT_REPAINT_THROTTLE_MS) return;
                    st.lastPositionSync = now;

                    // Derive origin from marker hotcues before any
                    // cascade / repaint reads it. No-op when the
                    // marker list is empty or the channel is in an
                    // active loop (origin frozen for the loop's
                    // duration).
                    self._deriveOriginFromPosition(ch, newPos);

                    var playing   = engine.getValue(grp, 'play_indicator') > 0;
                    var reversing = engine.getValue(grp, 'reverse') > 0;
                    if (playing && !reversing && (now - st.lastBeatEdge < 1500)) {
                        // Recent beat edge — pulse phase is beat_active's
                        // job, so skip _repaintFromPosition. But still
                        // check the count: a dropped or throttled edge
                        // would otherwise freeze the colour until the
                        // next edge, and position ticks are the only
                        // place that can catch up.
                        self._syncBeatCount(ch);
                        return;
                    }

                    self._repaintFromPosition(ch);
                });

                wire(self._playConns, 'play_indicator', function(v) {
                    var st = self._decks[ch];
                    st.playing = v > 0;
                    if (v === 1) {
                        st.loopClock.lastTs = Date.now();
                        self._syncBeatCount(ch);
                    }
                });

                wire(self._playConns, 'track_loaded', function(v) {
                    if (v !== 1) return;
                    self._expectingLoopOff[ch] = Date.now();
                    self._trackMetaCache[ch] = undefined;
                    self._resetBeat(ch);
                    self._readLoopState(ch);
                    self._syncBeatClocks();
                    if (self._decks[ch].loopActive) {
                        self._startVirtualClock(ch);
                    }
                    // _resetBeat set origin to 0 (intro start).
                    // Derive from markers for the current position
                    // so a load landing past a marker anchors
                    // immediately, without waiting for a
                    // playposition tick. Bails harmlessly when
                    // metadata isn't settled yet — the next tick
                    // catches it.
                    var pos = engine.getValue(grp, 'playposition');
                    self._deriveOriginFromPosition(ch, pos);
                });

                wire(self._playConns, 'loop_enabled', function() {
                    var st = self._decks[ch];
                    var wasActive = st.loopActive;
                    self._readLoopState(ch);
                    if (st.loopActive && !wasActive) {
                        self._startVirtualClock(ch);
                    } else if (!st.loopActive && wasActive) {
                        self._stopVirtualClock(ch);
                        self._checkLoopEscape(ch);
                    }
                });

                wire(self._playConns, 'slip_enabled', function() {
                    self._syncBeatCount(ch);
                });

                // Observe every hotcue slot so a hotcue that is
                // placed, recoloured, deleted, or dragged re-
                // derives the origin immediately. Without this,
                // placing a marker while paused doesn't update
                // origin until the playhead moves (playposition
                // is the only other trigger).
                //
                // Colour catches the "recolour to marker" step
                // (the common workflow: place → recolour). Pos-
                // ition catches place, delete, and drag. Both
                // are cheap; neither fires when the deck is
                // idle. Skipped entirely when no marker colours
                // are configured — no cost to users who don't
                // use the feature.
                if (Array.isArray(XoneK3.PHRASE_MARKER_COLORS) &&
                    XoneK3.PHRASE_MARKER_COLORS.length > 0) {
                    for (var hn = 1; hn <= HOTCUE_MAX; hn++) {
                        wire(self._playConns, 'hotcue_' + hn + '_color', function() {
                            var pos = engine.getValue(grp, 'playposition');
                            self._deriveOriginFromPosition(ch, pos);
                        });
                        wire(self._playConns, 'hotcue_' + hn + '_position', function() {
                            var pos = engine.getValue(grp, 'playposition');
                            self._deriveOriginFromPosition(ch, pos);
                        });
                    }
                }
            })(ch);
        }
        for (var ch2 = 1; ch2 <= 4; ch2++) {
            this._readLoopState(ch2);
            if (this._decks[ch2].loopActive) {
                this._startVirtualClock(ch2);
            }
        }
    };

    XoneK3.K3Controller.prototype._closeBeatClocks = function() {
        for (var i = 0; i < this._beatConns.length; i++)
            if (this._beatConns[i]) this._beatConns[i].disconnect();
        for (var j = 0; j < this._playConns.length; j++)
            if (this._playConns[j]) this._playConns[j].disconnect();
        this._beatConns = [];
        this._playConns = [];
        for (var ch = 1; ch <= 4; ch++) {
            this._decks[ch] = freshDeckState();
            // _phraseOrigin preserved — user intent, not derived state.
        }
        this._refreshDisplayFlags();
    };

    XoneK3.K3Controller.prototype._needsBeatClocks = function() {
        if (this._beatLeds.length > 0) return true;
        var applied = this._applied || {};
        for (var name in applied) {
            if (!applied.hasOwnProperty(name)) continue;
            var cfg = applied[name];
            if (!cfg || !cfg.colorScheme) continue;
            var cs = cfg.colorScheme;
            if (typeof cs.scheme === 'function') return true;
            if (cs.schemeFromState) return true;
            var s = cs.scheme;
            if (s && typeof s === 'object' && !Array.isArray(s) && s.beat) return true;
        }
        return false;
    };

    XoneK3.K3Controller.prototype._syncBeatClocks = function() {
        var want = this._needsBeatClocks();
        var have = this._beatConns.length > 0;
        if (XoneK3._debugPrintsOn) {
            var appliedCount = 0;
            var applied = this._applied || {};
            for (var k in applied) if (applied.hasOwnProperty(k)) appliedCount++;
            print('[k3] _syncBeatClocks want=' + want +
                  ' have=' + have +
                  ' _beatLeds=' + this._beatLeds.length +
                  ' applied=' + appliedCount);
        }
        if (want && !have) this._openBeatClocks();
        else if (!want && have) this._closeBeatClocks();
    };

    XoneK3.K3Controller.prototype._refreshBeatLeds = function(ch) {
        for (var i = 0; i < this._beatLeds.length; i++) {
            var b = this._beatLeds[i];
            try {
                if (ch === undefined) { b._refresh(); continue; }
                var deckCh;
                if (b._csScheme && b._csScheme.beat) {
                    deckCh = this._resolveDeckRef(b._csScheme.beat.deck);
                } else if (b._csCompiledMemo && b._csCompiledMemo.beat) {
                    deckCh = this._resolveDeckRef(b._csCompiledMemo.beat.deck);
                }
                if (deckCh === undefined || deckCh === null) { b._refresh(); continue; }
                if (deckCh === ch) b._refresh();
            } catch (e) {
                XoneK3._warnOnce('refreshBeatThrow:' + b._name,
                    '_refreshBeatLeds: ' + b._name + ' threw: ' +
                    (e && e.message ? e.message : e));
            }
        }
    };

    XoneK3.K3Controller.prototype._attachBeatLed = function(b) {
        if (this._beatLeds.indexOf(b) === -1) this._beatLeds.push(b);
    };

    XoneK3.K3Controller.prototype._detachBeatLed = function(b) {
        var i = this._beatLeds.indexOf(b);
        if (i >= 0) this._beatLeds.splice(i, 1);
    };

    XoneK3.K3Controller.prototype._resolveDeckRef = function(ref) {
        if (ref === undefined || ref === null) ref = XoneK3.DEFAULT_BEAT_DECK;
        if (typeof ref === 'number') return (ref >= 1 && ref <= 4) ? ref : null;
        if (typeof ref === 'string') {
            var s = XoneK3.resolve(ref, this);
            var m = /\[Channel(\d)\]/.exec(s);
            return m ? parseInt(m[1], 10) : null;
        }
        return null;
    };

    XoneK3.K3Controller.prototype._deckStateFor = function(compiled) {
        if (!compiled || !compiled.beat) return null;
        var ch = this._resolveDeckRef(compiled.beat.deck);
        return ch ? this._decks[ch] : null;
    };
})();