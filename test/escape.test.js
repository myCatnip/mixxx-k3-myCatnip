'use strict';

var H = require('./helpers');

// Loop-escape detector. Fires when a loop turns off unexpectedly
// within ESCAPE_DETECT_WINDOW_MS of a rate claim, and wasn't a
// deliberate reloop or track load.

function setupWithLoop(c) {
    engine._set('[Channel1]', 'track_samples', 1000);
    engine._set('[Channel1]', 'loop_start_position', 200);
    engine._set('[Channel1]', 'loop_end_position',   800);
    engine._set('[Channel1]', 'loop_enabled', 1);
    c._decks[1].loopActive = true;
    c._decks[1].loopStartN = 0.2;
    c._decks[1].loopEndN   = 0.8;
}

function withClocks(c) {
    c._applyBinding('button0_0', {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {
            scheme: {colors: [[127,0,0]], beat: {color: 'blue'}}
        }
    });
    c._refreshAllLeds();
}

// ── escape detected ────────────────────────────────────────

test('escape: unexpected loop-off within window logs', function(t) {
    var c = H.ctrl(); withClocks(c); setupWithLoop(c);
    c._lastLoopChangeMs = Date.now() - 50;
    c._lastRateClaim = {binding: 'encoderL', className: 'edit', ts: Date.now() - 50};

    _printLog.length = 0;
    engine._set('[Channel1]', 'loop_enabled', 0);
    engine._trigger('[Channel1]', 'loop_enabled', 0);

    t.contains(_printLog.join('\n'), 'LOOP ESCAPE');
    t.eq(c._escapes.length, 1);
    t.eq(c._escapes[0].ch, 1);
    t.eq(c._escapes[0].claimedBy, 'encoderL');
});

test('escape: outside window silent', function(t) {
    var c = H.ctrl(); withClocks(c); setupWithLoop(c);
    c._lastLoopChangeMs = Date.now() - 5000;
    c._lastRateClaim = null;

    _printLog.length = 0;
    engine._set('[Channel1]', 'loop_enabled', 0);
    engine._trigger('[Channel1]', 'loop_enabled', 0);

    t.notOk(_printLog.join('\n').indexOf('LOOP ESCAPE') !== -1);
    t.eq(c._escapes.length, 0);
});

test('escape: no claim since boot → silent', function(t) {
    var c = H.ctrl(); withClocks(c); setupWithLoop(c);
    c._lastLoopChangeMs = 0;
    c._lastRateClaim = null;

    _printLog.length = 0;
    engine._set('[Channel1]', 'loop_enabled', 0);
    engine._trigger('[Channel1]', 'loop_enabled', 0);

    t.notOk(_printLog.join('\n').indexOf('LOOP ESCAPE') !== -1);
});

// ── deliberate marker ──────────────────────────────────────

test('escape: _expectingLoopOff suppresses', function(t) {
    var c = H.ctrl(); withClocks(c); setupWithLoop(c);
    c._lastLoopChangeMs = Date.now() - 50;
    c._lastRateClaim = {binding: 'x', className: 'edit', ts: Date.now()};
    c._expectingLoopOff[1] = Date.now();

    _printLog.length = 0;
    engine._set('[Channel1]', 'loop_enabled', 0);
    engine._trigger('[Channel1]', 'loop_enabled', 0);

    t.notOk(_printLog.join('\n').indexOf('LOOP ESCAPE') !== -1);
    t.eq(c._expectingLoopOff[1], 0);
});

test('escape: _expectingLoopOff cleared after consume', function(t) {
    var c = H.ctrl(); withClocks(c); setupWithLoop(c);
    c._expectingLoopOff[1] = Date.now();
    engine._set('[Channel1]', 'loop_enabled', 0);
    engine._trigger('[Channel1]', 'loop_enabled', 0);
    t.eq(c._expectingLoopOff[1], 0);
});

test('escape: _pulseCo deliberateLoopOff sets marker', function(t) {
    var c = H.ctrl();
    c._pulseCo('[Channel1]', 'reloop_toggle', {deliberateLoopOff: true});
    t.ok(c._expectingLoopOff[1] > 0);
});

test('escape: _pulseCo without option does not set marker', function(t) {
    var c = H.ctrl();
    c._pulseCo('[Channel1]', 'beatjump_1_backward');
    t.eq(c._expectingLoopOff[1], 0);
});

test('escape: track_loaded sets deliberate marker', function(t) {
    var c = H.ctrl(); withClocks(c);
    c._expectingLoopOff[1] = 0;
    engine._trigger('[Channel1]', 'track_loaded', 1);
    t.ok(c._expectingLoopOff[1] > 0);
});

test('escape: reloopToggleResetAnchor marks deliberate', function(t) {
    var c = H.ctrl(); withClocks(c); setupWithLoop(c);
    // Note: no controller timestamp here — the func must be able to
    // fire so it can set the marker before the pulse.
    c._lastRateClaim = {binding: 'pressL', className: 'jump', ts: Date.now()};

    c._applyBinding('pressL', {
        func: XoneK3.FUNCS.reloopToggleResetAnchor,
        group: '[Channel1]'
    });
    _printLog.length = 0;
    H.press(c, 'pressL');

    t.ok(c._expectingLoopOff[1] > 0);
});

// ── bounded history ────────────────────────────────────────

test('escape history: bounded at ESCAPE_HISTORY_MAX', function(t) {
    var c = H.ctrl(); withClocks(c); setupWithLoop(c);
    var max = XoneK3.ESCAPE_HISTORY_MAX;
    for (var i = 0; i < max + 5; i++) {
        c._lastLoopChangeMs = Date.now() - 50;
        c._lastRateClaim = {binding: 'x', className: 'edit', ts: Date.now()};
        engine._set('[Channel1]', 'loop_enabled', 1);
        engine._trigger('[Channel1]', 'loop_enabled', 1);
        engine._set('[Channel1]', 'loop_enabled', 0);
        engine._trigger('[Channel1]', 'loop_enabled', 0);
    }
    t.eq(c._escapes.length, max);
});

test('escape record: holds sinceClaim, claimedBy, bounds', function(t) {
    var c = H.ctrl(); withClocks(c); setupWithLoop(c);
    c._lastLoopChangeMs = Date.now() - 42;
    c._lastRateClaim = {binding: 'encoderL', className: 'edit', ts: 0};
    engine._set('[Channel1]', 'loop_enabled', 0);
    engine._trigger('[Channel1]', 'loop_enabled', 0);

    var e = c._escapes[0];
    t.ok(e.sinceClaim >= 40 && e.sinceClaim <= 60);
    t.eq(e.claimedBy, 'encoderL');
    t.eq(e.className, 'edit');
    t.approx(e.loopStartN, 0.2, 1e-9);
    t.approx(e.loopEndN,   0.8, 1e-9);
});

// ── inspect('rate') ────────────────────────────────────────

test('inspect rate: prints without error', function(t) {
    var c = H.ctrl();
    _printLog.length = 0;
    c.inspect('rate');
    t.ok(_printLog.length > 0);
});

test('inspect rate: lists claim + escapes', function(t) {
    var c = H.ctrl();
    c._lastRateClaim = {binding: 'encoderL', className: 'edit', ts: Date.now()};
    c._escapes = [{ch: 1, sinceClaim: 42, claimedBy: 'encoderL',
                   className: 'edit', loopStartN: 0.2, loopEndN: 0.8}];
    _printLog.length = 0;
    c.inspect('rate');
    var out = _printLog.join('\n');
    t.contains(out, 'encoderL');
    t.contains(out, 'escape');
});

test('inspect rate reset: clears counters and history', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateAccepted = 5;
    b._rateGated = 3;
    b._rateIntervals = [10, 20, 30];
    c._escapes = [{ch: 1, sinceClaim: 42}];

    _printLog.length = 0;
    c.inspect('rate', 'reset');

    t.eq(b._rateAccepted, 0);
    t.eq(b._rateGated, 0);
    t.eq(b._rateIntervals.length, 0);
    t.eq(c._escapes.length, 0);
});

// ── diagnostics counters ───────────────────────────────────

test('_recordRateAccept: pushes interval', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateLastAcceptedMs = Date.now() - 50;
    b._recordRateAccept(Date.now());
    t.eq(b._rateIntervals.length, 1);
    t.ok(b._rateIntervals[0] >= 45 && b._rateIntervals[0] <= 60);
});

test('_recordRateAccept: bounded ring', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    for (var i = 0; i < XoneK3.RATE_INTERVAL_SAMPLES + 10; i++) {
        b._recordRateAccept(Date.now() + i * 100);
    }
    t.eq(b._rateIntervals.length, XoneK3.RATE_INTERVAL_SAMPLES);
});

test('_resetRateStats: zeroes counters', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateAccepted = 5;
    b._rateGated = 3;
    b._rateIntervals = [1, 2, 3];
    b._resetRateStats();
    t.eq(b._rateAccepted, 0);
    t.eq(b._rateGated, 0);
    t.eq(b._rateIntervals.length, 0);
});