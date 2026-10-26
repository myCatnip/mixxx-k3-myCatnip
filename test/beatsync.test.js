'use strict';

var H = require('./helpers');

// Beat clock wiring: connections per channel. Verifies handlers
// actually open/close/advance the timelines.

function setup(patches) {
    var c = H.ctrl({patches: patches || {}});
    // Cat's schemes ship with PHRASE_MARKER_COLORS = [0xF2F2FF],
    // which wires 32 hotcue observers per channel (color + position
    // for hotcues 1..16). These tests only verify base connection
    // counts, so clear the marker list — otherwise _playConns grows
    // to 148 (37 × 4) and the count assertions break.
    XoneK3.PHRASE_MARKER_COLORS = [];
    engine._set('[Channel1]', 'duration', 300);
    engine._set('[Channel1]', 'file_bpm', 120);
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'intro_start_position', 0);
    engine._set('[Channel1]', 'outro_end_position', 1000);
    engine._set('[Channel1]', 'playposition', 0.5);
    return c;
}

function withBeat(c) {
    c._applyBinding('button0_0', {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {
            scheme: {colors: [[127,0,0]], beat: {color: 'blue'}}
        }
    });
    c._refreshAllLeds();
}

// ── clock open / close ──────────────────────────────────────

test('clocks closed with no beat scheme', function(t) {
    var c = setup();
    t.eq(c._beatConns.length, 0);
});

test('clocks open when a beat scheme is bound', function(t) {
    var c = setup();
    withBeat(c);
    t.ok(c._beatConns.length > 0);
});

test('clocks closed on unbind of the last beat LED', function(t) {
    var c = setup();
    withBeat(c);
    c._applyBinding('button0_0', null);
    c._refreshAllLeds();
    t.eq(c._beatConns.length, 0);
});

test('connection counts: 4 beat + 24 play', function(t) {
    var c = setup();
    withBeat(c);
    // 1 beat_active per channel = 4
    t.eq(c._beatConns.length, 4);
    // 6 base play connections per channel × 4 = 24:
    // playposition, play_indicator, track_loaded, loop_enabled,
    // slip_enabled, track_samples. Hotcue marker observers add
    // 32 per channel when PHRASE_MARKER_COLORS is non-empty;
    // setup() clears it.
    t.eq(c._playConns.length, 24);
});

test('track_samples change invalidates _trackMetaCache', function(t) {
    var c = setup();
    withBeat(c);

    // Prime the cache with the current track's metadata.
    c._trackMeta(1);
    t.eq(c._trackMetaCache[1].duration, 300);

    // Mixxx starts loading a new track over the current one:
    // duration changes but track_loaded does not re-fire (it's
    // a level CO, not an edge). Without the track_samples
    // listener the cache keeps the old duration forever.
    engine._set('[Channel1]', 'duration', 999);
    engine._set('[Channel1]', 'track_samples', 2000);
    engine._trigger('[Channel1]', 'track_samples', 2000);

    t.eq(c._trackMetaCache[1].duration, 999,
         'cache must reflect the new duration after track_samples change');
});

// ── beat_active handler ─────────────────────────────────────

test('beat_active=1 in track mode sets hasBeat + active', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[1].displaySource = 'track';
    engine._trigger('[Channel1]', 'beat_active', 1);
    t.eq(c._decks[1].hasBeat, true);
    t.eq(c._decks[1].active,  true);
});

test('beat_active=0 in track mode clears active', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[1].displaySource = 'track';
    engine._trigger('[Channel1]', 'beat_active', 1);
    engine._trigger('[Channel1]', 'beat_active', 0);
    t.eq(c._decks[1].active, false);
});

test('beat_active fires in loop mode too (pulse is track-derived in both modes)', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[1].displaySource = 'loop';
    c._decks[1].active = false;
    engine._trigger('[Channel1]', 'beat_active', 1);
    t.eq(c._decks[1].active, true);
    t.ok(c._decks[1].lastBeatEdge > 0);
});

test('beat_active on channel 2 does not touch channel 1', function(t) {
    var c = setup();
    withBeat(c);
    // _openBeatClocks catch-up already seeds hasBeat for any
    // channel with metadata. Reset so the test isolates
    // trigger routing, not the catch-up loop.
    c._decks[1].hasBeat = false;
    c._decks[2].hasBeat = false;
    engine._trigger('[Channel2]', 'beat_active', 1);
    t.eq(c._decks[1].hasBeat, false);
    t.eq(c._decks[2].hasBeat, true);
});

test('beat_active fires _onBeat hook', function(t) {
    var c = setup();
    withBeat(c);
    var fired = 0;
    c._onBeat = function() { fired++; };
    engine._trigger('[Channel1]', 'beat_active', 1);
    t.eq(fired, 1);
});

// ── playposition handler ────────────────────────────────────

test('playposition advances running virtual clocks in trackTempo mode', function(t) {
    var c = setup();
    withBeat(c);
    XoneK3.VIRTUAL_CLOCKS.loop.trackTempo = true;
    c._startVirtualClock(1);
    c._decks[1].loopClock.lastTrackPos = 0.4;
    engine._set('[Channel1]', 'playposition', 0.6);
    engine._trigger('[Channel1]', 'playposition', 0.6);
    t.approx(c._decks[1].loopClock.pos, 0.7, 1e-6);
    XoneK3.VIRTUAL_CLOCKS.loop.trackTempo = false;
});

test('playposition does not advance stopped clocks', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[1].loopClock.pos = 0.5;
    engine._set('[Channel1]', 'playposition', 0.6);
    engine._trigger('[Channel1]', 'playposition', 0.6);
    t.eq(c._decks[1].loopClock.pos, 0.5);
});

test('playposition in virtual mode repaints phase from frac', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[1].displaySource = 'loop';
    c._decks[1].loopClock.running = true;
    c._decks[1].loopClock.pos = 0.5;
    engine._trigger('[Channel1]', 'playposition', 0.5);
    t.eq(c._decks[1].active, true);
});

test('track mode guard: recent beat_active suppresses position repaint', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'play_indicator', 1);
    engine._set('[Channel1]', 'reverse', 0);

    c._decks[1].lastBeatEdge = Date.now();
    c._decks[1].active = true;

    engine._set('[Channel1]', 'playposition', 0.507);
    engine._trigger('[Channel1]', 'playposition', 0.507);

    t.eq(c._decks[1].active, true);
});

test('track mode guard: backward movement bypasses the beat-edge window', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'play_indicator', 1);
    engine._set('[Channel1]', 'reverse', 0);

    // Simulate: user was playing forward, pulse currently
    // off-phase, then jogs the playhead backward without
    // stopping. `reverse` stays 0 — the guard would normally
    // fire on the recent beat edge and leave st.active frozen.
    c._decks[1].lastBeatEdge = Date.now();
    c._decks[1].active = false;
    c._decks[1].lastPlayPos = 0.5;

    engine._set('[Channel1]', 'playposition', 0.42);
    engine._trigger('[Channel1]', 'playposition', 0.42);

    t.eq(c._decks[1].active, true,
         'backward movement must update pulse phase via _repaintFromPosition');
});

// ── play_indicator handler ─────────────────────────────────

test('pause+play in active loop: clock stops, resumes, re-seeds', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'loop_start_position', 100);
    engine._set('[Channel1]', 'loop_end_position', 500);
    engine._set('[Channel1]', 'duration', 100);
    engine._set('[Channel1]', 'playposition', 0.2);

    // Start playing with the loop on.
    engine._set('[Channel1]', 'play_indicator', 1);
    engine._trigger('[Channel1]', 'play_indicator', 1);
    engine._set('[Channel1]', 'loop_enabled', 1);
    engine._trigger('[Channel1]', 'loop_enabled', 1);
    t.eq(c._decks[1].loopClock.running, true, 'setup: clock running');
    t.eq(c._decks[1].displaySource, 'loop', 'setup: reads loop');

    // Pause: clock stops, display falls back to track.
    engine._set('[Channel1]', 'play_indicator', 0);
    engine._trigger('[Channel1]', 'play_indicator', 0);
    t.eq(c._decks[1].loopClock.running, false, 'pause stops clock');
    t.eq(c._decks[1].displaySource, 'track', 'pause reads track');

    // Jog the playhead while paused — paused reading comes from
    // playposition, not the (frozen) loop clock.
    engine._set('[Channel1]', 'playposition', 0.3);

    // Resume: clock re-seeds from the playhead.
    engine._set('[Channel1]', 'play_indicator', 1);
    engine._trigger('[Channel1]', 'play_indicator', 1);
    t.eq(c._decks[1].loopClock.running, true,  'play restarts clock');
    t.eq(c._decks[1].displaySource, 'loop', 'play reads loop');
    t.approx(c._decks[1].loopClock.pos, 0.3, 1e-9, 're-seeded from playhead');
});

// ── track_loaded handler ───────────────────────────────────

test('track_loaded clears _trackMetaCache, picks up fresh values', function(t) {
    var c = setup();
    withBeat(c);

    // Warm cache with the initial metadata.
    c._trackMeta(1);
    t.eq(c._trackMetaCache[1].duration, 300);

    // Change metadata without triggering track_loaded. The cache
    // still holds the old value.
    engine._set('[Channel1]', 'duration', 999);
    engine._set('[Channel1]', 'track_samples', 2000);
    t.eq(c._trackMeta(1).duration, 300);

    // track_loaded clears the cache. The next _trackMeta call
    // re-reads — whether the clear happened before
    // _deriveOriginFromPosition ran (which may re-populate the
    // cache with fresh values) doesn't matter; either path yields
    // the new metadata.
    engine._trigger('[Channel1]', 'track_loaded', 1);
    t.eq(c._trackMeta(1).duration, 999);
    t.eq(c._trackMeta(1).samples, 2000);
});

test('track_loaded resets beat state', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[1].count = 42;
    c._phraseOrigin[1] = 10;

    engine._trigger('[Channel1]', 'track_loaded', 1);
    // _resetBeat clears the stale count; the handler tail's
    // _syncBeatCount re-derives it from the current playhead
    // (0.5 → beat 301). Origin stays 0 — no marker hotcues.
    t.neq(c._decks[1].count, 42, 'stale count cleared');
    t.eq(c._decks[1].count, 301, 'count re-derived from position');
    t.eq(c._phraseOrigin[1], 0);
});

test('track_loaded clears _lastLoopTouchMs for that channel', function(t) {
    var c = setup();
    withBeat(c);
    c._lastLoopTouchMs[1] = Date.now();
    c._lastLoopTouchMs[2] = Date.now();
    engine._trigger('[Channel1]', 'track_loaded', 1);
    t.eq(c._lastLoopTouchMs[1], 0);
    t.ok(c._lastLoopTouchMs[2] > 0);
});

test('track_loaded starts loop clock when track has loop and playing', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'play_indicator', 1);
    engine._set('[Channel1]', 'loop_enabled', 1);
    engine._set('[Channel1]', 'loop_start_position', 100);
    engine._set('[Channel1]', 'loop_end_position', 500);
    engine._trigger('[Channel1]', 'track_loaded', 1);
    t.eq(c._decks[1].loopClock.running, true);
});

test('track_loaded leaves clock stopped when track loads paused', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'play_indicator', 0);
    engine._set('[Channel1]', 'loop_enabled', 1);
    engine._set('[Channel1]', 'loop_start_position', 100);
    engine._set('[Channel1]', 'loop_end_position', 500);
    engine._trigger('[Channel1]', 'track_loaded', 1);
    t.eq(c._decks[1].loopClock.running, false,
         'paused load must not start the clock');
});

test('track_loaded ignores v != 1', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[1].count = 42;
    engine._trigger('[Channel1]', 'track_loaded', 0);
    t.eq(c._decks[1].count, 42);
});

// ── loop_enabled handler ───────────────────────────────────

test('loop_enabled rising edge starts loop clock when playing', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'loop_start_position', 100);
    engine._set('[Channel1]', 'loop_end_position', 500);
    engine._set('[Channel1]', 'play_indicator', 1);
    engine._trigger('[Channel1]', 'play_indicator', 1);
    engine._set('[Channel1]', 'loop_enabled', 1);
    engine._trigger('[Channel1]', 'loop_enabled', 1);
    t.eq(c._decks[1].loopClock.running, true);
});

test('loop_enabled rising edge leaves clock stopped when paused', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'loop_start_position', 100);
    engine._set('[Channel1]', 'loop_end_position', 500);
    engine._set('[Channel1]', 'play_indicator', 0);
    engine._set('[Channel1]', 'loop_enabled', 1);
    engine._trigger('[Channel1]', 'loop_enabled', 1);
    t.eq(c._decks[1].loopClock.running, false,
         'enabling a loop while paused must not start the clock');
});

test('loop_enabled falling edge stops running clock', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'loop_start_position', 100);
    engine._set('[Channel1]', 'loop_end_position', 500);
    engine._set('[Channel1]', 'play_indicator', 1);
    engine._trigger('[Channel1]', 'play_indicator', 1);
    engine._set('[Channel1]', 'loop_enabled', 1);
    engine._trigger('[Channel1]', 'loop_enabled', 1);
    t.eq(c._decks[1].loopClock.running, true, 'setup: clock running');

    engine._set('[Channel1]', 'loop_enabled', 0);
    engine._trigger('[Channel1]', 'loop_enabled', 0);
    t.eq(c._decks[1].loopClock.running, false, 'loop off stops clock');
    t.eq(c._decks[1].displaySource, 'track');
});

test('loop_enabled no transition → no start / stop', function(t) {
    var c = setup();
    withBeat(c);
    engine._trigger('[Channel1]', 'loop_enabled', 0);
    t.eq(c._decks[1].loopClock.running, false);
});

// ── slip_enabled handler ───────────────────────────────────

test('slip_enabled triggers count resync', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[1].count = 999;
    engine._trigger('[Channel1]', 'slip_enabled', 1);
    t.eq(c._decks[1].count, 301);
});

// ── close ──────────────────────────────────────────────────

test('closing clocks disconnects all connections', function(t) {
    var c = setup();
    withBeat(c);
    t.ok(c._beatConns.length > 0);
    c._closeBeatClocks();
    t.eq(c._beatConns.length, 0);
    t.eq(c._playConns.length, 0);
});

test('closing clocks resets every deck state', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[2].count = 42;
    c._closeBeatClocks();
    t.eq(c._decks[2].count, 1);
    t.eq(c._phraseOrigin[2], 0);
});

test('closing clocks refreshes display flags', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[1].displaySource = 'loop';
    c._refreshDisplayFlags();
    c._closeBeatClocks();
    t.eq(c.activeDisplaySource, 'track');
});