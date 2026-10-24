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

test('connection counts: 4 beat + 20 play', function(t) {
    var c = setup();
    withBeat(c);
    // 1 beat_active per channel = 4
    t.eq(c._beatConns.length, 4);
    // 5 base play connections per channel × 4 = 20.
    // (Hotcue marker observers add 32 per channel when
    // PHRASE_MARKER_COLORS is non-empty; setup() clears it.)
    t.eq(c._playConns.length, 20);
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
    c._startVirtualClock(1, 'loop');
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

// ── play_indicator handler ─────────────────────────────────

test('play_indicator=1 resyncs clock anchors', function(t) {
    var c = setup();
    withBeat(c);
    c._startVirtualClock(1, 'loop');
    c._decks[1].loopClock.lastTs = 0;
    engine._trigger('[Channel1]', 'play_indicator', 1);
    t.ok(c._decks[1].loopClock.lastTs > 0);
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
    t.eq(c._decks[1].count, 1);
    t.eq(c._phraseOrigin[1], 0);
});

test('track_loaded starts loop clock when incoming track has loop', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'loop_enabled', 1);
    engine._set('[Channel1]', 'loop_start_position', 100);
    engine._set('[Channel1]', 'loop_end_position', 500);
    engine._trigger('[Channel1]', 'track_loaded', 1);
    t.eq(c._decks[1].loopClock.running, true);
});

test('track_loaded ignores v != 1', function(t) {
    var c = setup();
    withBeat(c);
    c._decks[1].count = 42;
    engine._trigger('[Channel1]', 'track_loaded', 0);
    t.eq(c._decks[1].count, 42);
});

// ── loop_enabled handler ───────────────────────────────────

test('loop_enabled rising edge starts loop clock', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'loop_start_position', 100);
    engine._set('[Channel1]', 'loop_end_position', 500);
    engine._set('[Channel1]', 'loop_enabled', 1);
    engine._trigger('[Channel1]', 'loop_enabled', 1);
    t.eq(c._decks[1].loopClock.running, true);
});

test('loop_enabled falling edge stops loop clock', function(t) {
    var c = setup();
    withBeat(c);
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'loop_start_position', 100);
    engine._set('[Channel1]', 'loop_end_position', 500);
    engine._set('[Channel1]', 'loop_enabled', 1);
    engine._trigger('[Channel1]', 'loop_enabled', 1);

    engine._set('[Channel1]', 'loop_enabled', 0);
    engine._trigger('[Channel1]', 'loop_enabled', 0);
    t.eq(c._decks[1].loopClock.running, false);
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