'use strict';

var H = require('./helpers');

// Rate gate: _inferRateClass, _resolveRateClass, _claimRate,
// per-binding self-check, jump-block, claim floor, and the
// Binding.input() dispatch integration.

// ── _inferRateClass ────────────────────────────────────────

test('_inferRateClass: encBeatjump → jump', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.encBeatjump}), 'jump');
});

test('_inferRateClass: beatjumpButton → jump', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.beatjumpButton}), 'jump');
});

test('_inferRateClass: reloopToggleResetAnchor → jump', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.reloopToggleResetAnchor}), 'jump');
});

test('_inferRateClass: beatloopActivateResetAnchor → jump', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.beatloopActivateResetAnchor}), 'jump');
});

test('_inferRateClass: encLoopMove → edit', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.encLoopMove}), 'edit');
});

test('_inferRateClass: encLoopMoveAccel → edit', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.encLoopMoveAccel}), 'edit');
});

test('_inferRateClass: encBeatjumpStepScale → claim', function(t) {
    t.eq(XoneK3._inferRateClass({func: XoneK3.FUNCS.encBeatjumpStepScale}), 'claim');
});

test('_inferRateClass: pressSetValue + beatloop_size → edit', function(t) {
    t.eq(XoneK3._inferRateClass({
        func: XoneK3.FUNCS.pressSetValue, inKey: 'beatloop_size'
    }), 'edit');
});

test('_inferRateClass: pressSetValue + beatjump_size → claim', function(t) {
    t.eq(XoneK3._inferRateClass({
        func: XoneK3.FUNCS.pressSetValue, inKey: 'beatjump_size'
    }), 'claim');
});

test('_inferRateClass: inKey beatjump_forward / beatjump_backward → jump', function(t) {
    t.eq(XoneK3._inferRateClass({inKey: 'beatjump_forward'}),  'jump');
    t.eq(XoneK3._inferRateClass({inKey: 'beatjump_backward'}), 'jump');
});

test('_inferRateClass: inKey beatjump_size does NOT match', function(t) {
    // The classifier must not label a size-set binding as
    // movement. The audit pattern in _validateBindings is
    // deliberately wider; the classifier is exact. See
    // INTERNALS §22 / §25.
    t.eq(XoneK3._inferRateClass({inKey: 'beatjump_size'}), null);
});

test('_inferRateClass: inKey beatjump_1_backward does NOT match', function(t) {
    // Only the exact movement COs classify. Numbered variants
    // aren't reachable as direct inKey values in shipped
    // configs — beatjumpButton passes them as args to _pulseCo,
    // not as the binding's inKey.
    t.eq(XoneK3._inferRateClass({inKey: 'beatjump_1_backward'}), null);
});

test('_inferRateClass: inKey reloop_toggle → jump', function(t) {
    t.eq(XoneK3._inferRateClass({inKey: 'reloop_toggle'}), 'jump');
});

test('_inferRateClass: inKey beatloop_activate → jump', function(t) {
    t.eq(XoneK3._inferRateClass({inKey: 'beatloop_activate'}), 'jump');
});

test('_inferRateClass: unrelated inKey → null', function(t) {
    t.eq(XoneK3._inferRateClass({inKey: 'play'}),  null);
    t.eq(XoneK3._inferRateClass({inKey: 'pfl'}),   null);
    t.eq(XoneK3._inferRateClass({}),               null);
});

test('_inferRateClass: func identity beats inKey', function(t) {
    t.eq(XoneK3._inferRateClass({
        func: XoneK3.FUNCS.encLoopMove, inKey: 'beatjump_size'
    }), 'edit');
});

// ── _resolveRateClass ──────────────────────────────────────

test('_resolveRateClass: rate false → null', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({rate: false}), null);
});

test('_resolveRateClass: explicit string honoured', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({rate: 'jump'}), 'jump');
    t.eq(c._resolveRateClass({rate: 'edit'}), 'edit');
    t.eq(c._resolveRateClass({rate: 'claim'}), 'claim');
});

test('_resolveRateClass: unknown string warns and returns null', function(t) {
    var c = H.ctrl();
    _printLog.length = 0;
    t.eq(c._resolveRateClass({rate: 'nonsense'}), null);
    t.ok(_printLog.join('\n').indexOf('unknown rate class') !== -1);
});

test('_resolveRateClass: inline object passed through', function(t) {
    var c = H.ctrl();
    var inline = {selfCheckMs: 5, selfScope: 'binding', jumpBlockMs: 30, claimMs: 30};
    t.eq(c._resolveRateClass({rate: inline}), inline);
});

test('_resolveRateClass: no rate → inference', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({func: XoneK3.FUNCS.encBeatjump}), 'jump');
});

test('_resolveRateClass: rate field wins over inference', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveRateClass({
        func: XoneK3.FUNCS.encLoopMove, rate: 'jump'
    }), 'jump');
});

// ── _claimRate: self-check ─────────────────────────────────

test('_claimRate: first claim always succeeds', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    t.ok(c._claimRate(b, 'edit'));
});

test('_claimRate: second claim within selfCheckMs blocked', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._lastGateMs = Date.now();
    t.notOk(c._claimRate(b, 'edit'));
});

test('_claimRate: second claim after selfCheckMs passes', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._lastGateMs = Date.now() - 100;
    t.ok(c._claimRate(b, 'edit'));
});

test('_claimRate: jump has no self-check', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._lastGateMs = Date.now();
    t.ok(c._claimRate(b, 'jump'));
});

test('_claimRate: claim writes b._lastGateMs', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._lastGateMs = 0;
    c._claimRate(b, 'edit');
    t.ok(b._lastGateMs > 0);
});

// ── _claimRate: jump-block ─────────────────────────────────

test('_claimRate: jump-blocked right after another jump', function(t) {
    var c = H.ctrl();
    var b1 = c.bindings.encoderL;
    var b2 = c.bindings.encoderR;
    c._claimRate(b1, 'jump');
    t.notOk(c._claimRate(b2, 'jump'));
});

test('_claimRate: edit allowed right after jump (60 < 120)', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderR;
    c._lastLoopChangeMs = Date.now() - 70;
    t.ok(c._claimRate(b, 'edit'));
});

test('_claimRate: edit blocked inside jump window', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderR;
    c._lastLoopChangeMs = Date.now() - 30;
    t.notOk(c._claimRate(b, 'edit'));
});

test('_claimRate: claim class has no jump-block', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    c._lastLoopChangeMs = Date.now();
    t.ok(c._claimRate(b, 'claim'));
});

// ── _claimRate: claim floor composition ────────────────────

test('_claimRate: edit claim leaves 60ms tail on jump clock', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    c._lastLoopChangeMs = 0;
    c._claimRate(b, 'edit');
    var age = Date.now() - c._lastLoopChangeMs;
    t.ok(age >= 55 && age <= 65, 'age=' + age);
});

test('_claimRate: jump claim leaves 120ms tail', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    c._lastLoopChangeMs = 0;
    c._claimRate(b, 'jump');
    var age = Date.now() - c._lastLoopChangeMs;
    t.ok(age <= 2, 'age=' + age);
});

test('_claimRate: claim class leaves 60ms tail', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    c._lastLoopChangeMs = 0;
    c._claimRate(b, 'claim');
    var age = Date.now() - c._lastLoopChangeMs;
    t.ok(age >= 55 && age <= 65, 'age=' + age);
});

test('_claimRate: claim never moves clock backwards', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    c._claimRate(b, 'jump');
    var firstTs = c._lastLoopChangeMs;
    c._claimRate(b, 'edit');
    t.ok(c._lastLoopChangeMs >= firstTs);
});

// ── _claimRate: diagnostics ────────────────────────────────

test('_claimRate: accepted increments counter', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._rateAccepted = 0;
    c._claimRate(b, 'edit');
    t.eq(b._rateAccepted, 1);
});

test('_claimRate: gated increments counter', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    b._lastGateMs = Date.now();
    b._rateGated = 0;
    c._claimRate(b, 'edit');
    t.eq(b._rateGated, 1);
});

test('_claimRate: sets controller _lastRateClaim', function(t) {
    var c = H.ctrl();
    var b = c.bindings.encoderL;
    c._claimRate(b, 'edit');
    t.eq(c._lastRateClaim.binding, 'encoderL');
    t.eq(c._lastRateClaim.className, 'edit');
});

test('_claimRate: no rate class → always passes', function(t) {
    var c = H.ctrl();
    var b = c.bindings.button0_0;
    t.ok(c._claimRate(b, null));
});

// ── Binding.input() integration ────────────────────────────

test('input: gated event does not fire func', function(t) {
    var c = H.ctrl();
    var fired = 0;
    c._applyBinding('encoderL', {
        func: function() { fired++; },
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();
    H.send(c, 'encoderL', 1);
    t.eq(fired, 0);
});

test('input: gated event still updates _normalized (knob)', function(t) {
    var c = H.ctrl();
    c._applyBinding('knob0_0', {
        func: function() {},
        group: '[Channel1]', inKey: 'volume'
    });
    var b = c.bindings.knob0_0;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();
    H.send(c, 'knob0_0', 64);
    t.ok(b._normalized !== undefined);
});

test('input: gated event still repaints observers', function(t) {
    var c = H.ctrl();
    c._applyBinding('encoderL', {
        func: function() {},
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();

    var fired = 0;
    b.addObserver({_refresh: function() { fired++; }});
    H.send(c, 'encoderL', 1);
    t.eq(fired, 1);
});

test('input: button release is never gated', function(t) {
    var c = H.ctrl();
    var pressCount = 0, releaseCount = 0;
    c._applyBinding('pressL', {
        func: function(args, ch, cc, v) {
            if (v > 0) pressCount++;
            else       releaseCount++;
        }
    });
    var b = c.bindings.pressL;
    b._rateClass = 'jump';
    // Block any jump by putting a recent claim on the shared clock.
    c._lastLoopChangeMs = Date.now();

    H.press(c, 'pressL');
    t.eq(pressCount, 0);    // gated
    t.eq(releaseCount, 0);

    H.release(c, 'pressL');
    t.eq(pressCount, 0);    // still gated (no press fired)
    t.eq(releaseCount, 1);  // release always dispatches
});

test('input: encoder CCW is gated same as CW', function(t) {
    var c = H.ctrl();
    var fired = 0;
    c._applyBinding('encoderL', {
        func: function() { fired++; },
        group: '[Channel1]', inKey: 'beatloop_size'
    });
    var b = c.bindings.encoderL;
    b._rateClass = 'edit';
    b._lastGateMs = Date.now();
    H.send(c, 'encoderL', 127);
    t.eq(fired, 0);
});