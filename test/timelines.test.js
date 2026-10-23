'use strict';

var H = require('./helpers');

// Two timelines per channel: track and the loop clock.
// Phrase origin shared. Display source. Beat count.

function setupTrack(c, ch, opts) {
    opts = opts || {};
    engine._set('[Channel' + ch + ']', 'duration',           opts.duration || 300);
    engine._set('[Channel' + ch + ']', 'file_bpm',           opts.fileBpm  || 120);
    engine._set('[Channel' + ch + ']', 'track_samples',      opts.samples   || 1000);
    engine._set('[Channel' + ch + ']', 'intro_start_position', 0);
    engine._set('[Channel' + ch + ']', 'outro_end_position', opts.samples || 1000);
    engine._set('[Channel' + ch + ']', 'playposition',       opts.pos       || 0.5);
}

// ── _channelOf ──────────────────────────────────────────────

test('_channelOf: standard group', function(t) {
    var c = H.ctrl();
    t.eq(c._channelOf('[Channel1]'), 1);
    t.eq(c._channelOf('[Channel4]'), 4);
});

test('_channelOf: out-of-range → null', function(t) {
    var c = H.ctrl();
    t.eq(c._channelOf('[Channel0]'), null);
    t.eq(c._channelOf('[Channel5]'), null);
});

test('_channelOf: non-channel → null', function(t) {
    var c = H.ctrl();
    t.eq(c._channelOf('[Master]'),     null);
    t.eq(c._channelOf('not a string'), null);
    t.eq(c._channelOf(42),             null);
});

// ── _getContentBounds ───────────────────────────────────────

test('_getContentBounds: reads intro/outro', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'intro_start_position', 200);
    engine._set('[Channel1]', 'outro_end_position',   800);
    var b = c._getContentBounds(1);
    t.approx(b.start, 0.2, 1e-9);
    t.approx(b.end,   0.8, 1e-9);
});

test('_getContentBounds: no samples → null', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'track_samples', 0);
    t.eq(c._getContentBounds(1), null);
});

test('_getContentBounds: zero markers → 0..1', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'track_samples', 1000);
    var b = c._getContentBounds(1);
    t.eq(b.start, 0);
    t.eq(b.end,   1);
});

test('_getContentBounds: inverted markers → 0..1', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'intro_start_position', 900);
    engine._set('[Channel1]', 'outro_end_position',   100);
    var b = c._getContentBounds(1);
    t.eq(b.start, 0);
    t.eq(b.end,   1);
});

// ── _readFileBpm / _trackMeta ───────────────────────────────

test('_readFileBpm: reads file_bpm directly', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'file_bpm', 128);
    t.eq(c._readFileBpm(1), 128);
});

test('_readFileBpm: falls back to bpm/rate_ratio at unity', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'file_bpm', 0);
    engine._set('[Channel1]', 'bpm', 120);
    engine._set('[Channel1]', 'rate_ratio', 1);
    t.eq(c._readFileBpm(1), 120);
});

test('_readFileBpm: slider fallback scales by 1+rate', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'file_bpm', 0);
    engine._set('[Channel1]', 'bpm', 129.6);
    engine._set('[Channel1]', 'rate_ratio', 0);   // force slider fallback
    engine._set('[Channel1]', 'rate', 0.08);      // +8% pitch
    // file_bpm = bpm / (1 + rate) = 129.6 / 1.08 = 120
    t.approx(c._readFileBpm(1), 120, 1e-9);
});

test('_readFileBpm: no bpm → null', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'file_bpm', 0);
    engine._set('[Channel1]', 'bpm', 0);
    t.eq(c._readFileBpm(1), null);
});

test('_trackMeta: caches per channel', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'duration', 100);
    engine._set('[Channel1]', 'file_bpm', 120);
    var m1 = c._trackMeta(1);
    engine._set('[Channel1]', 'duration', 999);
    var m2 = c._trackMeta(1);
    t.eq(m1, m2);
    t.eq(m2.duration, 100);
});

test('_trackMeta: cache clear picks up new values', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'duration', 100);
    engine._set('[Channel1]', 'file_bpm', 120);
    c._trackMeta(1);
    engine._set('[Channel1]', 'duration', 200);
    c._trackMetaCache[1] = undefined;
    t.eq(c._trackMeta(1).duration, 200);
});

// ── _beatF / _computeAbsoluteBeat ───────────────────────────

test('_beatF: 0.5 into a 300s 120bpm track = 300 beats', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    t.approx(c._beatF(1, 0.5), 300, 1e-6);
});

test('_beatF: zero position → 0', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    t.approx(c._beatF(1, 0), 0, 1e-6);
});

test('_beatF: no duration → null', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'track_samples', 1000);
    t.eq(c._beatF(1, 0.5), null);
});

test('_beatF: no file_bpm → null', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'duration', 300);
    engine._set('[Channel1]', 'track_samples', 1000);
    t.eq(c._beatF(1, 0.5), null);
});

test('_beatF: non-number pos → null', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    t.eq(c._beatF(1, 'x'), null);
    t.eq(c._beatF(1, NaN), null);
});

test('_beatF: negative pos returns negative beat (no pos<0 guard)', function(t) {
    // INTERNALS §25: _beatF has no pos<0 guard. A position before
    // the intro marker returns a negative fractional beat;
    // _cascadeCount floors it and beatLevel normalises via modulo,
    // so the cascade shows the previous phrase's colours rather
    // than freezing the pipeline at pos <= 0.
    var c = H.ctrl();
    setupTrack(c, 1);   // duration 300s, 120bpm
    // pos -1 → (-1) * 300 * 120 / 60 = -600 fractional beats.
    t.approx(c._beatF(1, -1), -600, 1e-6);
});

test('_computeAbsoluteBeat: floors fractional beat', function(t) {
    var c = H.ctrl();
    // 0.503 * 600 = 301.8 → floor 301
    setupTrack(c, 1, {pos: 0.503});
    t.eq(c._computeAbsoluteBeat(1, 0.503), 301);
});

// ── _computeBeatState ──────────────────────────────────────

test('_computeBeatState: count = abs - origin + 1', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._phraseOrigin[1] = 0;
    var bs = c._computeBeatState(1);
    t.eq(bs.abs, 300);
    t.eq(bs.count, 301);
});

test('_computeBeatState: origin shifts count', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._phraseOrigin[1] = 100;
    t.eq(c._computeBeatState(1).count, 201);
});

test('_computeBeatState: frac is fractional part', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    var bs = c._computeBeatState(1);
    t.approx(bs.frac, 0, 1e-6);
});

test('_computeBeatState: no metadata → null', function(t) {
    var c = H.ctrl();
    t.eq(c._computeBeatState(1), null);
});

// ── _setPhraseOriginAt / _resetBeat ────────────────────────

test('_setPhraseOriginAt: sets origin from position', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._setPhraseOriginAt(1, 0.5);
    t.eq(c._phraseOrigin[1], 300);
});

test('_setPhraseOriginAt: no metadata no-op', function(t) {
    var c = H.ctrl();
    c._phraseOrigin[1] = 5;
    c._setPhraseOriginAt(1, 0.5);
    t.eq(c._phraseOrigin[1], 5);
});

test('_resetBeat: clears origin and state', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._phraseOrigin[1] = 50;
    c._decks[1].count = 99;
    c._resetBeat(1);
    t.eq(c._phraseOrigin[1], 0);
    t.eq(c._decks[1].count, 1);
});

// ── _syncBeatCount ─────────────────────────────────────────

test('_syncBeatCount: updates count from beat math', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    var changed = c._syncBeatCount(1);
    t.eq(changed, true);
    t.eq(c._decks[1].count, 301);
    t.eq(c._decks[1].hasBeat, true);
});

test('_syncBeatCount: unchanged count returns false', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._syncBeatCount(1);
    t.eq(c._syncBeatCount(1), false);
});

test('_syncBeatCount: no metadata returns false', function(t) {
    var c = H.ctrl();
    t.eq(c._syncBeatCount(1), false);
});

// ── _phraseSourcePos ───────────────────────────────────────

test('_phraseSourcePos: track mode reads playposition', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1, {pos: 0.3});
    c._decks[1].displaySource = 'track';
    t.approx(c._phraseSourcePos(1), 0.3, 1e-9);
});

test('_phraseSourcePos: loop mode reads loop clock', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._decks[1].displaySource = 'loop';
    c._decks[1].loopClock.running = true;
    c._decks[1].loopClock.pos = 0.7;
    t.approx(c._phraseSourcePos(1), 0.7, 1e-9);
});

test('_phraseSourcePos: virtual not running → fall back to playposition', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1, {pos: 0.2});
    c._decks[1].displaySource = 'loop';
    c._decks[1].loopClock.running = false;
    t.approx(c._phraseSourcePos(1), 0.2, 1e-9);
});

// ── _startVirtualClock / _stopVirtualClock ─────────────────

test('_startVirtualClock: seeds pos from playposition', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1, {pos: 0.42});
    c._startVirtualClock(1);
    t.eq(c._decks[1].loopClock.running, true);
    t.approx(c._decks[1].loopClock.pos, 0.42, 1e-9);
});

test('_startVirtualClock: refreshes display source', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._startVirtualClock(1);
    t.eq(c._decks[1].displaySource, 'loop');
});

test('_stopVirtualClock: clears running and re-resolves display', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._startVirtualClock(1);
    c._stopVirtualClock(1);
    t.eq(c._decks[1].loopClock.running, false);
    t.eq(c._decks[1].displaySource, 'track');
});

// ── _advanceVirtualClock ───────────────────────────────────

test('_advanceVirtualClock: not running → no-op', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    var before = c._decks[1].loopClock.pos;
    c._advanceVirtualClock(1, 0.6);
    t.eq(c._decks[1].loopClock.pos, before);
});

test('_advanceVirtualClock: real-time advances by dt/duration', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1, {duration: 100, pos: 0.1});
    engine._set('[Channel1]', 'play_indicator', 1);
    c._startVirtualClock(1);
    var start = c._decks[1].loopClock.pos;
    c._decks[1].loopClock.lastTs = Date.now() - 1000;
    c._advanceVirtualClock(1, 0.2);
    var advanced = c._decks[1].loopClock.pos - start;
    t.approx(advanced, 0.01, 0.005);
});

test('_advanceVirtualClock: real-time does not advance when paused', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1, {duration: 100});
    engine._set('[Channel1]', 'play_indicator', 0);
    c._startVirtualClock(1);
    var start = c._decks[1].loopClock.pos;
    c._decks[1].loopClock.lastTs = Date.now() - 1000;
    c._advanceVirtualClock(1, 0.6);
    t.eq(c._decks[1].loopClock.pos, start);
});

test('_advanceVirtualClock: trackTempo follows position delta', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    XoneK3.VIRTUAL_CLOCKS.loop.trackTempo = true;
    c._startVirtualClock(1);
    c._decks[1].loopClock.pos = 0.5;
    c._decks[1].loopClock.lastTrackPos = 0.5;
    c._advanceVirtualClock(1, 0.6);
    t.approx(c._decks[1].loopClock.pos, 0.6, 1e-9);
    XoneK3.VIRTUAL_CLOCKS.loop.trackTempo = false;
});

test('_advanceVirtualClock: trackTempo with loop wrap correction', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    XoneK3.VIRTUAL_CLOCKS.loop.trackTempo = true;
    c._decks[1].loopActive = true;
    c._decks[1].loopStartN = 0.2;
    c._decks[1].loopEndN   = 0.4;
    c._startVirtualClock(1);
    c._decks[1].loopClock.pos = 0.39;
    c._decks[1].loopClock.lastTrackPos = 0.39;
    c._advanceVirtualClock(1, 0.21);
    // Delta = -0.18 + 0.2 = +0.02 → pos 0.41
    t.approx(c._decks[1].loopClock.pos, 0.41, 1e-6);
    XoneK3.VIRTUAL_CLOCKS.loop.trackTempo = false;
});

// ── _resolveDisplaySource ──────────────────────────────────

test('_resolveDisplaySource: default track with no loop clock', function(t) {
    var c = H.ctrl();
    c._resolveDisplaySource(1);
    t.eq(c._decks[1].displaySource, 'track');
});

test('_resolveDisplaySource: loop clock running → loop', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._startVirtualClock(1);
    t.eq(c._decks[1].displaySource, 'loop');
});

test('_resolveDisplaySource: falls back to track when loop clock stops', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._startVirtualClock(1);
    c._stopVirtualClock(1);
    t.eq(c._decks[1].displaySource, 'track');
});

// ── _refreshDisplayFlags ───────────────────────────────────

test('_refreshDisplayFlags: reflects active deck state', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c.setSelectedFor('deck', 'A', 1);
    c.setActiveDeck('A');
    c._decks[1].displaySource = 'loop';
    c._decks[1].loopClock.running = true;
    c._refreshDisplayFlags();
    t.eq(c.activeDisplaySource, 'loop');
    t.eq(c.activeDeckVirtual, true);
    t.eq(c.activeLoopVirtual, true);
});

// ── Beat clock connections ─────────────────────────────────

test('_needsBeatClocks: false with no beat LEDs', function(t) {
    var c = H.ctrl();
    t.eq(c._needsBeatClocks(), false);
});

test('_syncBeatClocks: opens clocks when beat LED attached', function(t) {
    XoneK3.SCHEMES.tBeat = {colors: [[127,0,0]], beat: {color: 'blue'}};
    var c = H.ctrl();
    c._applyBinding('button0_0', {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {scheme: 'tBeat', on: {always: true}}
    });
    c._syncBeatClocks();
    t.ok(c._beatConns.length > 0);
});

test('_syncBeatClocks: closes clocks when beat LED removed', function(t) {
    XoneK3.SCHEMES.tBeat = {colors: [[127,0,0]], beat: {color: 'blue'}};
    var c = H.ctrl();
    c._applyBinding('button0_0', {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {scheme: 'tBeat', on: {always: true}}
    });
    c._syncBeatClocks();
    c._applyBinding('button0_0', null);
    c._syncBeatClocks();
    t.eq(c._beatConns.length, 0);
});

// ── _readLoopState ─────────────────────────────────────────

test('_readLoopState: reads bounds when enabled', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'loop_start_position', 100);
    engine._set('[Channel1]', 'loop_end_position', 500);
    engine._set('[Channel1]', 'loop_enabled', 1);
    c._readLoopState(1);
    t.eq(c._decks[1].loopActive, true);
    t.approx(c._decks[1].loopStartN, 0.1, 1e-9);
    t.approx(c._decks[1].loopEndN,   0.5, 1e-9);
});

test('_readLoopState: clears when disabled', function(t) {
    var c = H.ctrl();
    engine._set('[Channel1]', 'loop_enabled', 0);
    c._decks[1].loopActive = true;
    c._readLoopState(1);
    t.eq(c._decks[1].loopActive, false);
});

// ── cycleDisplaySource (func) ──────────────────────────────

test('cycleDisplaySource: no loop clock → stays track', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._applyBinding('grid2_0', {
        func: XoneK3.FUNCS.cycleDisplaySource, group: '[Channel1]'
    });
    c._decks[1].displaySource = 'track';
    H.press(c, 'grid2_0');
    t.eq(c._decks[1].displaySource, 'track');
});

test('cycleDisplaySource: track → loop when loop clock running', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._decks[1].loopClock.running = true;
    c._decks[1].displaySource = 'track';
    c._applyBinding('grid2_0', {
        func: XoneK3.FUNCS.cycleDisplaySource, group: '[Channel1]'
    });
    H.press(c, 'grid2_0');
    t.eq(c._decks[1].displaySource, 'loop');
});

test('cycleDisplaySource: loop → track', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._decks[1].loopClock.running = true;
    c._decks[1].displaySource = 'loop';
    c._applyBinding('grid2_0', {
        func: XoneK3.FUNCS.cycleDisplaySource, group: '[Channel1]'
    });
    H.press(c, 'grid2_0');
    t.eq(c._decks[1].displaySource, 'track');
});

// ── setPhraseOriginHere ────────────────────────────────────
//
// The func exists in XoneK3.FUNCS, but no shipped binding wires
// it — the shift+grid2_0 cell in shiftPhraseCells() has its
// `func:` line commented out. This test exercises the func
// directly against a hand-built binding, so it stays valid even
// though the shipped config no longer uses it.

test('setPhraseOriginHere: sets origin to current playpos', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    c._applyBinding('grid2_0', {
        func: XoneK3.FUNCS.setPhraseOriginHere, group: '[Channel1]'
    });
    H.press(c, 'grid2_0');
    t.eq(c._phraseOrigin[1], 300);
});

// ── hotcueWithPhraseCheck ──────────────────────────────────

test('hotcueWithPhraseCheck: non-matching colour → no origin change', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    engine._set('[Channel1]', 'hotcue_1_position', 500);
    engine._set('[Channel1]', 'hotcue_1_color', 0xFFFFFF);
    XoneK3.PHRASE_MARKER_COLORS = [0xC50A08];
    c._applyBinding('grid0_2', {
        func: XoneK3.FUNCS.hotcueWithPhraseCheck, args: [1],
        group: '[Channel1]', inKey: 'hotcue_1_activate'
    });
    H.press(c, 'grid0_2');
    t.eq(engine.getValue('[Channel1]', 'hotcue_1_activate'), 1);
    t.eq(c._phraseOrigin[1], 0);
    XoneK3.PHRASE_MARKER_COLORS = [];
});

test('hotcueWithPhraseCheck: matching colour sets origin', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    engine._set('[Channel1]', 'hotcue_1_position', 500);
    engine._set('[Channel1]', 'hotcue_1_color', 0xC50A08);
    XoneK3.PHRASE_MARKER_COLORS = [0xC50A08];
    c._applyBinding('grid0_2', {
        func: XoneK3.FUNCS.hotcueWithPhraseCheck, args: [1],
        group: '[Channel1]', inKey: 'hotcue_1_activate'
    });
    H.press(c, 'grid0_2');
    t.eq(c._phraseOrigin[1], 300);
    XoneK3.PHRASE_MARKER_COLORS = [];
});

test('hotcueWithPhraseCheck: release sends 0', function(t) {
    var c = H.ctrl();
    setupTrack(c, 1);
    engine._set('[Channel1]', 'hotcue_1_position', 500);
    engine._set('[Channel1]', 'hotcue_1_color', 0xFFFFFF);
    XoneK3.PHRASE_MARKER_COLORS = [];
    c._applyBinding('grid0_2', {
        func: XoneK3.FUNCS.hotcueWithPhraseCheck, args: [1],
        group: '[Channel1]', inKey: 'hotcue_1_activate'
    });
    H.release(c, 'grid0_2');
    t.eq(engine.getValue('[Channel1]', 'hotcue_1_activate'), 0);
});