// xone-k3-lib-controller-beat.js — timeline (loop clock),
// display-source resolution, beat count derivation, beat clock
// connections.
//
// Loaded after lib-controller-colour.js. Extends K3Controller.prototype.
//
// One pulse source (track position's fractional beat, with
// beat_active edges preferred). Two cascade counts — track-derived
// from playposition, and loop-derived from the loop clock's
// accumulated position, which marches forward through wraps as if
// the loop played through in sequence.

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

    // Hotcue slots snapshotted for phrase-marker colours and
    // watched for hotcue place/recolour/delete/drag. 16 = Mixxx's
    // full range. Read at clock-open time by _seedHotcueCache and
    // maintained by the hotcue observers thereafter.
    XoneK3.HOTCUE_MAX = 16;

    // Wrap detection is direction-based: a jump opposite playback
    // direction is a wrap. Loop length is added back so the
    // accumulated position keeps marching forward musically.
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
    // Mixxx's `rate` CO is the rate *slider position*
    // (~-0.08..+0.08), not a multiplier. `rate_ratio` is the
    // actual ratio. Prefer the cached rate_ratio value populated
    // by the listener in _openChannelBeatClocks and the initial
    // read in _catchUpChannel — falls back to a live CO read on
    // a cold cache. The fallback to `1 + rate` covers Mixxx
    // builds that predate rate_ratio.
    XoneK3.K3Controller.prototype._channelRate = function(ch) {
        var cached = this._rateCache[ch];
        if (typeof cached === 'number' && isFinite(cached) && cached > 0) {
            return cached;
        }
        var grp = '[Channel' + ch + ']';
        var ratio = engine.getValue(grp, 'rate_ratio');
        if (typeof ratio === 'number' && isFinite(ratio) && ratio > 0) {
            this._rateCache[ch] = ratio;
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
    // clock.pos accumulates playhead movement through loop wraps.
    // It's the cascade source in loop mode. trackTempo picks
    // between two equivalent accumulation strategies.
    XoneK3.K3Controller.prototype._virtualTempoTrack = function() {
        var cfg = XoneK3.VIRTUAL_CLOCKS.loop;
        return !!(cfg && cfg.trackTempo);
    };

    XoneK3.K3Controller.prototype._startVirtualClock = function(ch) {
        var st = this._decks[ch];
        var clock = st.loopClock;
        var grp = '[Channel' + ch + ']';
        // Sync st.playing from the CO before starting. When called
        // via _syncVirtualClock the flag is already correct (the
        // caller only routes here because st.playing is true), but
        // direct callers (tests, external scripts) don't always
        // wire the play_indicator listener first. Reading here makes
        // _startVirtualClock self-contained and guarantees
        // _advanceVirtualClock's st.playing gate sees the right
        // value regardless of listener state. One CO read per clock
        // start — negligible.
        st.playing = engine.getValue(grp, 'play_indicator') > 0;
        var pos = engine.getValue(grp, 'playposition');
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

    // Single start/stop decision. The loop clock runs iff the
    // channel is in a loop AND the deck is playing — pause is
    // equivalent to exiting the loop, resume to entering it.
    // Returns true if the clock state changed, false on no-op.
    // The bool lets callers (`_onPlayIndicator`) distinguish
    // "the clock-start path already repainted" from "nothing
    // happened, I need an explicit refresh".
    XoneK3.K3Controller.prototype._syncVirtualClock = function(ch) {
        var st = this._decks[ch];
        var shouldRun = st.loopActive && st.playing;
        if (shouldRun && !st.loopClock.running) {
            this._startVirtualClock(ch);
            return true;
        }
        if (!shouldRun && st.loopClock.running) {
            this._stopVirtualClock(ch);
            return true;
        }
        return false;
    };

    XoneK3.K3Controller.prototype._advanceVirtualClock = function(ch, newPos) {
        var st = this._decks[ch];
        var clock = st.loopClock;
        if (!clock.running) return;

        var now = Date.now();
        if (this._virtualTempoTrack()) {
            var delta = newPos - clock.lastTrackPos;
            var reversing = this._reverseCache[ch] > 0;
            delta = applyLoopWrapAdjust(st, clock, delta, newPos, reversing);
            clock.pos += delta;
        } else {
            // Real-seconds mode: forward-only. dt is clamped to
            // zero — Date.now() is not monotonic.
            //
            // st.playing mirrors play_indicator via the
            // _onPlayIndicator CO listener. _channelRate reads
            // the _rateCache populated by the rate_ratio CO
            // listener (with a cold-cache live-read fallback).
            // Both used to be live CO reads at every throttled
            // tick (~200 reads/sec per playing deck); the caches
            // cut that to zero.
            if (st.playing && clock.lastTs > 0) {
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
    // Called from _startVirtualClock and _stopVirtualClock only.
    // No change means nothing to repaint — the display source is
    // already what the loop state implies, and every reader is
    // up to date.
    XoneK3.K3Controller.prototype._resolveDisplaySource = function(ch) {
        var st = this._decks[ch];
        var choice = st.loopClock.running ? 'loop' : 'track';
        if (choice === st.displaySource) return;

        st.displaySource = choice;
        this._syncBeatCount(ch);
        if (this.selectedDeckCurrent === ch) {
            this._refreshDisplayFlags();
            this._refreshAllLeds('display-source');
        }
    };

    // ============================================================
    // TRACK METADATA / BEAT MATH
    // ============================================================
    // start is always 0 (file start) — intro_start is never read.
    // end is outro_end_position / samples, or 1 when unset.
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

    // Incomplete reads (duration 0) are not cached — the CO tree
    // may not be settled at first read. Cached only when duration
    // > 0.
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
        if (!(meta.samples > 0)) return null;
        // bounds.start is always 0 (file start); bounds.end feeds
        // only the track-end countdown, not beat math. Skipping
        // _getContentBounds eliminates one outro_end_position CO
        // read per call — two per throttled playposition tick in
        // the common path.
        return pos * meta.duration * meta.fileBpm / 60;
    };

    XoneK3.K3Controller.prototype._trackBeatF = function(ch) {
        var pos = engine.getValue('[Channel' + ch + ']', 'playposition');
        return this._beatF(ch, pos);
    };

    // Legacy accessor for inspect / tests. The cascade uses
    // _cascadeCount directly.
    XoneK3.K3Controller.prototype._phraseSourcePos = function(ch) {
        var st = this._decks[ch];
        if (st.displaySource === 'loop' && st.loopClock.running)
            return st.loopClock.pos;
        return engine.getValue('[Channel' + ch + ']', 'playposition');
    };

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

    XoneK3.K3Controller.prototype._virtualBeatFor = function(ch) {
        var st = this._decks[ch];
        if (!st.loopClock.running) return null;
        var beatF = this._beatF(ch, st.loopClock.pos);
        if (beatF === null) return null;
        return Math.floor(beatF) - this._phraseOrigin[ch] + 1;
    };

    XoneK3.K3Controller.prototype._syncBeatCount = function(ch, pos) {
        var st = this._decks[ch];
        var beatF = (pos !== undefined)
            ? this._beatF(ch, pos)
            : this._trackBeatF(ch);
        if (beatF === null) return false;
        var count = this._cascadeCount(ch, beatF);
        var wasHasBeat = st.hasBeat;
        st.hasBeat = true;
        if (st.count === count && wasHasBeat) return false;
        st.count = count;
        this._refreshBeatLeds(ch);
        return true;
    };

    // Snapshot every hotcue CO into this deck's hotcueState.
    // Called at clock-open, on track_loaded (post-reset fallback),
    // and on track_samples change (load-over-current). After this,
    // _deriveOriginFromPosition reads only st.hotcueState — the
    // per-tick origin scan used to fire 32 CO reads per deck every
    // 30ms and that's what thrashed the CO mutex against the audio
    // thread.
    //
    // Self-guarding: if PHRASE_MARKER_COLORS is empty the feature
    // is off; leave the cache empty and skip the reads.
    XoneK3.K3Controller.prototype._seedHotcueCache = function(ch) {
        var st = this._decks[ch];
        st.hotcueState = {};
        if (!Array.isArray(XoneK3.PHRASE_MARKER_COLORS) ||
            XoneK3.PHRASE_MARKER_COLORS.length === 0) return;

        var grp = '[Channel' + ch + ']';
        for (var n = 1; n <= XoneK3.HOTCUE_MAX; n++) {
            st.hotcueState[n] = {
                color: engine.getValue(grp, 'hotcue_' + n + '_color'),
                pos:   engine.getValue(grp, 'hotcue_' + n + '_position')
            };
        }
    };

    // Position-derived origin from marker hotcues. Any hotcue
    // whose stored colour is in PHRASE_MARKER_COLORS defines a
    // phrase-start position; origin is the beat of the last such
    // marker at or before the playhead, or 0.
    //
    // Frozen in loop mode: origin stays fixed for the loop's
    // duration. First playposition tick after the loop stops
    // re-derives.
    //
    // Pure cache iteration — zero CO reads. The hotcue observers
    // keep st.hotcueState current; this is the per-tick consumer.
    XoneK3.K3Controller.prototype._deriveOriginFromPosition = function(ch, pos) {
        var markers = XoneK3.PHRASE_MARKER_COLORS;
        if (!Array.isArray(markers) || markers.length === 0) return;

        var st = this._decks[ch];
        if (st.displaySource === 'loop' && st.loopClock.running) return;

        var meta = this._trackMeta(ch);
        if (!(meta.samples > 0)) return;

        var best = null;
        var bestAhead = null;
        var cache = st.hotcueState;

        for (var n in cache) {
            if (!cache.hasOwnProperty(n)) continue;
            var h = cache[n];
            if (markers.indexOf(h.color) === -1) continue;
            if (!(h.pos >= 0) || h.pos > meta.samples) continue;
            var markerPos = h.pos / meta.samples;
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
            this._syncBeatCount(ch, pos);
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
    // pulse.
    //
    // `pos` may be passed by the caller to avoid re-reading
    // playposition — the caller just read it for `_advanceVirtualClock`.
    XoneK3.K3Controller.prototype._repaintFromPosition = function(ch, pos) {
        var st = this._decks[ch];
        var trackBeatF = (pos !== undefined)
            ? this._beatF(ch, pos)
            : this._trackBeatF(ch);
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
    // BEAT CLOCKS — OPEN
    // ============================================================
    XoneK3.K3Controller.prototype._openBeatClocks = function() {
        for (var ch = 1; ch <= 4; ch++) this._openChannelBeatClocks(ch);
        for (var ch2 = 1; ch2 <= 4; ch2++) this._catchUpChannel(ch2);
    };

    XoneK3.K3Controller.prototype._openChannelBeatClocks = function(ch) {
        var self = this;
        var grp = '[Channel' + ch + ']';
        function wire(conns, co, fn) {
            conns.push(engine.makeConnection(grp, co, fn));
        }

        wire(this._beatConns, 'beat_active', function(v) {
            self._onBeatActive(ch, v);
        });
        wire(this._playConns, 'playposition', function() {
            self._onPlayposition(ch);
        });
        wire(this._playConns, 'play_indicator', function(v) {
            self._onPlayIndicator(ch, v);
        });
        wire(this._playConns, 'track_loaded', function(v) {
            self._onTrackLoaded(ch, v);
        });
        wire(this._playConns, 'loop_enabled', function() {
            self._onLoopEnabled(ch);
        });
        wire(this._playConns, 'slip_enabled', function() {
            self._syncBeatCount(ch);
        });
        // rate_ratio changes only when the deck's effective rate
        // changes (pitch slider move, tempo follow). Cached here
        // so _channelRate doesn't have to read the CO on every
        // throttled playposition tick.
        wire(this._playConns, 'rate_ratio', function(v) {
            self._rateCache[ch] = v;
        });
        // reverse changes only on user action (reverse toggle).
        // Cached so the beat-edge guard and _advanceVirtualClock
        // don't read the CO per throttled playposition tick.
        wire(this._playConns, 'reverse', function(v) {
            self._reverseCache[ch] = v > 0 ? 1 : 0;
        });

        // Track identity changed. `track_loaded` fires 0→1 on the
        // first load but may not fire when a new track replaces
        // the current one, and even when it does fire it can
        // arrive before Mixxx has settled `duration` / `file_bpm`
        // — the resulting cache fill grabs the previous track's
        // metadata. `track_samples` changes reliably on every
        // load and fires regardless of play state.
        //
        // Also re-seeds hotcueState: if track_loaded doesn't
        // re-fire, the hotcue cache would keep the previous
        // track's markers until the new track's hotcues load and
        // their observers fire. One seed per load closes that
        // window.
        //
        // Re-derives origin as well — a load that bypasses
        // track_loaded (load-over-current) would otherwise leave
        // _phraseOrigin at the previous track's beat, and the
        // cascade would show the wrong colour (paused deck, no
        // playposition tick to correct it).
        wire(this._playConns, 'track_samples', function() {
            self._trackMetaCache[ch] = undefined;
            self._seedHotcueCache(ch);
            var pos = engine.getValue(grp, 'playposition');
            self._deriveOriginFromPosition(ch, pos);
            self._syncBeatCount(ch);
        });

        if (Array.isArray(XoneK3.PHRASE_MARKER_COLORS) &&
            XoneK3.PHRASE_MARKER_COLORS.length > 0) {
            this._wireHotcueObservers(ch, grp);
        }
    };

    // Seed the cache once, then wire per-slot observers that keep
    // it current. Two observers per hotcue slot: colour catches
    // recolour-to-marker (the event that can add or remove a
    // marker), position catches place/delete/drag. Each fires a
    // 1-CO read (the CO that changed), updates one cache field,
    // then re-derives origin from the cache — no scan.
    //
    // The previous implementation used one shared `rederive`
    // closure that re-scanned all 16 hotcues (32 CO reads) on
    // every single observer fire. During a track load, Mixxx
    // writes 16 positions + 16 colours per channel — that's 32
    // fires × 32 reads = 1024 CO reads per channel in a burst,
    // which is what contended the CO mutex against the audio
    // thread.
    //
    // Observer bodies read self._decks[ch] fresh on every fire.
    // _resetBeat (from track_loaded) replaces this._decks[ch]
    // with a new freshDeckState; a captured reference would keep
    // writing into the pre-reset cache while
    // _deriveOriginFromPosition reads the current one, so user
    // hotcue changes after a load would never reach origin
    // derivation.
    XoneK3.K3Controller.prototype._wireHotcueObservers = function(ch, grp) {
        // Seed first so the observer's cache write always has a
        // slot to write into, even if a CO fires before the
        // wiring loop completes.
        this._seedHotcueCache(ch);

        var self = this;
        var maxCue = XoneK3.HOTCUE_MAX;

        function onColor(n) {
            var st = self._decks[ch];
            st.hotcueState[n].color =
                engine.getValue(grp, 'hotcue_' + n + '_color');
            var pos = engine.getValue(grp, 'playposition');
            self._deriveOriginFromPosition(ch, pos);
        }
        function onPosition(n) {
            var st = self._decks[ch];
            st.hotcueState[n].pos =
                engine.getValue(grp, 'hotcue_' + n + '_position');
            var pos = engine.getValue(grp, 'playposition');
            self._deriveOriginFromPosition(ch, pos);
        }

        for (var hn = 1; hn <= maxCue; hn++) {
            (function(n) {
                self._playConns.push(
                    engine.makeConnection(grp, 'hotcue_' + n + '_color',
                        function() { onColor(n); }));
                self._playConns.push(
                    engine.makeConnection(grp, 'hotcue_' + n + '_position',
                        function() { onPosition(n); }));
            })(hn);
        }
    };

    // Startup catch-up: CO connections fire on change, not on
    // setup. A preset reload during an active loop would leave
    // the loop clock idle; a reload during playback would leave
    // st.playing = false, rendering the paused beat mode on a
    // playing deck.
    XoneK3.K3Controller.prototype._catchUpChannel = function(ch) {
        // playing first — the clock only runs while playing, and
        // a reload during an active loop should leave the clock
        // stopped until the deck is actually playing.
        this._decks[ch].playing =
            engine.getValue('[Channel' + ch + ']', 'play_indicator') > 0;
        // Populate the rate cache so _channelRate's first call
        // doesn't have to live-read. The listener wired in
        // _openChannelBeatClocks keeps it current from here on.
        this._rateCache[ch] =
            engine.getValue('[Channel' + ch + ']', 'rate_ratio');
        this._reverseCache[ch] =
            engine.getValue('[Channel' + ch + ']', 'reverse') > 0 ? 1 : 0;
        this._readLoopState(ch);
        this._syncVirtualClock(ch);
        this._syncBeatCount(ch);
    };

    // ============================================================
    // BEAT CLOCKS — CO HANDLERS
    // ============================================================
    XoneK3.K3Controller.prototype._onBeatActive = function(ch, v) {
        var st = this._decks[ch];
        if (v === 1) {
            st.lastBeatEdge = Date.now();
            st.active = true;
            st.hasBeat = true;
            if (st.lastBeatEdge - st.lastBeatRepaint >=
                XoneK3.BEAT_REPAINT_THROTTLE_MS) {
                st.lastBeatRepaint = st.lastBeatEdge;
                this._repaintBeat(ch);
            }
        } else {
            st.active = false;
            this._refreshBeatLeds(ch);
        }
        if (this._onBeat) this._onBeat(ch);
    };

    XoneK3.K3Controller.prototype._onPlayposition = function(ch) {
        var st = this._decks[ch];
        var grp = '[Channel' + ch + ']';
        var newPos = engine.getValue(grp, 'playposition');
        // Backward movement — jog-scrub leftward while playing, or
        // a manual reverse. Either way `reverse` may be 0 (jog
        // doesn't toggle it), so the guard can't rely on it alone.
        // Recorded on every tick, before the throttle gate, so
        // the next non-gated tick sees the direction that
        // actually happened — not a stale comparison against a
        // pre-gate position.
        var movingBackward = (st.lastPlayPos !== undefined) && (newPos < st.lastPlayPos);
        st.lastPlayPos = newPos;

        var now = Date.now();
        if (now - st.lastPositionSync < XoneK3.BEAT_REPAINT_THROTTLE_MS) return;
        st.lastPositionSync = now;

        // Throttled. The clock accumulates by dt (real seconds)
        // or by playhead delta (track tempo) — same total either
        // way, just larger steps at lower frequency. Real-seconds
        // mode used to read play_indicator + rate_ratio per call;
        // both are now cached (st.playing via _onPlayIndicator,
        // rate_ratio via the listener in _openChannelBeatClocks),
        // so the only remaining CO read here is play_indicator —
        // for the `playing` local below.
        this._advanceVirtualClock(ch, newPos);

        this._deriveOriginFromPosition(ch, newPos);

        // st.playing is kept current by the play_indicator CO
        // listener; _reverseCache by the reverse CO listener. If
        // either transitions in the same engine frame as this
        // tick, the corresponding handler catches up in the same
        // event-loop batch and repaints — no missed paint.
        var playing   = st.playing;
        var reversing = this._reverseCache[ch] > 0;
        // `beat_active` fires reliably forward but irregularly on
        // backward jog. With the guard active, st.active (pulse
        // phase) is left frozen for up to 1.5 s while count keeps
        // moving via _syncBeatCount — the "held bar" symptom.
        // Force the position repaint on backward movement so both
        // st.count and st.active update from the same source.
        if (playing && !reversing && !movingBackward && (now - st.lastBeatEdge < 1500)) {
            this._syncBeatCount(ch, newPos);
            return;
        }

        // Pass newPos — we already read it, no need for
        // _repaintFromPosition to re-read it.
        this._repaintFromPosition(ch, newPos);
    };

    XoneK3.K3Controller.prototype._onPlayIndicator = function(ch, v) {
        var st = this._decks[ch];
        var wasPlaying = st.playing;
        st.playing = v > 0;
        if (wasPlaying !== st.playing) {
            // Play state gates the loop clock. Pause stops it
            // (displaySource reverts to 'track'); resume re-seeds
            // from the playhead, identical to entering the loop.
            //
            // When the clock starts or stops, the repaint comes
            // for free via _resolveDisplaySource → _syncBeatCount
            // → _refreshBeatLeds. Only the no-loop case has no
            // such path, and _isBeatOffPhase still needs to pick
            // up the new st.playing — hence the explicit refresh
            // on the no-op branch.
            if (!this._syncVirtualClock(ch)) this._refreshBeatLeds(ch);
        }
        if (v === 1) {
            this._syncBeatCount(ch);
        }
    };

    XoneK3.K3Controller.prototype._onTrackLoaded = function(ch, v) {
        if (v !== 1) return;
        var grp = '[Channel' + ch + ']';
        this._trackMetaCache[ch] = undefined;
        this._resetBeat(ch);
        this._lastLoopTouchMs[ch] = 0;
        // _resetBeat wiped st.playing. Re-read before the clock
        // start — a track can load while the deck is playing, and
        // the clock only runs when playing.
        this._decks[ch].playing = engine.getValue(grp, 'play_indicator') > 0;
        // Refresh the rate cache too — a load with sync engaged
        // can change the effective rate_ratio. The listener also
        // catches this if rate_ratio changes, but the track-loaded
        // path is the natural point to be sure.
        this._rateCache[ch] = engine.getValue(grp, 'rate_ratio');
        this._reverseCache[ch] = engine.getValue(grp, 'reverse') > 0 ? 1 : 0;
        this._readLoopState(ch);
        // _resetBeat also wiped hotcueState. Re-seed before
        // _deriveOriginFromPosition below — if the clocks were
        // already open, _syncBeatClocks won't reopen them and
        // _wireHotcueObservers won't re-seed on its own. Reads
        // may return the previous track's hotcues here; the
        // track_samples listener re-seeds once the new track's
        // hotcues settle.
        this._seedHotcueCache(ch);
        this._syncBeatClocks();
        this._syncVirtualClock(ch);
        // Derive from markers for the current position so a load
        // landing past a marker anchors immediately.
        var pos = engine.getValue(grp, 'playposition');
        this._deriveOriginFromPosition(ch, pos);
        this._syncBeatCount(ch);
    };

    // Enabling the loop while paused does not start the clock —
    // `_syncVirtualClock` gates on both loopActive and playing.
    XoneK3.K3Controller.prototype._onLoopEnabled = function(ch) {
        this._readLoopState(ch);
        this._syncVirtualClock(ch);
    };

    // ============================================================
    // BEAT CLOCKS — CLOSE / SYNC
    // ============================================================
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

    // ============================================================
    // BEAT LED BOOKKEEPING
    // ============================================================
    XoneK3.K3Controller.prototype._refreshBeatLeds = function(ch) {
        for (var i = 0; i < this._beatLeds.length; i++) {
            var b = this._beatLeds[i];
            try {
                if (ch === undefined) { b._refresh(); continue; }
                // A function scheme can change shape at runtime —
                // countdownScheme returns 'countdownIdle' (no beat)
                // before a track loads and 'countdownA1..4' (beat)
                // afterwards. Probe the current evaluation: if no
                // beat block is present, this binding has no
                // business repainting on every beat edge. Every FX
                // layout cell goes through this path (its scheme is
                // a composed closure over fxScheme(n), which has no
                // beat), so this is what stops the per-beat churn.
                // _evaluateScheme is memoized — a stable ref just
                // hits the cache.
                var beat = (b._csScheme && b._csScheme.beat)
                        || (b._csCompiledMemo && b._csCompiledMemo.beat)
                        || null;
                if (!beat && b._csSchemeFn) {
                    var probe = b._evaluateScheme();
                    beat = (probe && probe.beat) || null;
                }
                if (!beat) continue;
                var deckCh = this._resolveDeckRef(beat.deck);
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