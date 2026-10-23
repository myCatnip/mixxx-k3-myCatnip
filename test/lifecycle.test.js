'use strict';

var H = require('./helpers');

// _applyBinding / _unbind lifecycle, soft takeover rearm,
// LED blanking on unbind, hash skip on identical cfg.

// ── bind / unbind basics ─────────────────────────────────────

test('rebind: replaces binding, LED updates', function(t) {
    var c = H.ctrl();
    c._applyBinding('button0_0', {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {scheme: 'red', on: {always: true}}
    });
    H.clearLeds();
    c._applyBinding('button0_0', {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {scheme: 'green', on: {always: true}}
    });
    var led = H.led(c, 'button0_0');
    t.rgb(led, 0, 127, 0);
});

test('unbind: nulls the binding and blanks the LED', function(t) {
    var c = H.ctrl();
    c._applyBinding('button0_0', {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {scheme: 'red', on: {always: true}}
    });
    H.clearLeds();
    c._applyBinding('button0_0', null);
    var led = H.led(c, 'button0_0');
    t.rgb(led, 0, 0, 0);
    t.hw(led, 0);
    t.eq(c.bindings.button0_0._rawCfg, null);
    t.eq(c.bindings.button0_0._csActive, false);
});

test('non-function func: warn, no crash, _func undefined', function(t) {
    var c = H.ctrl();
    c._applyBinding('press0', {
        group: '[Channel1]', inKey: 'play',
        func: 'not-a-function'
    });
    t.eq(c.bindings.press0._func, undefined);
});

// ── soft takeover ────────────────────────────────────────────

test('soft takeover: rearm on new group', function(t) {
    var c = H.ctrl();
    c._applyBinding('fader0', {group: '[Channel1]', inKey: 'volume'});
    engine._st = [];
    c._applyBinding('fader0', {group: '[Channel2]', inKey: 'volume'});
    t.eq(engine._st.length, 2);
    t.eq(engine._st[0], ['enable', '[Channel2]', 'volume', false]);
    t.eq(engine._st[1], ['enable', '[Channel2]', 'volume', true]);
});

test('soft takeover: unbind fires ignore-next-value', function(t) {
    var c = H.ctrl();
    c._applyBinding('fader0', {group: '[Channel1]', inKey: 'volume'});
    engine._st = [];
    c._applyBinding('fader0', null);
    t.eq(engine._st.length, 1);
    t.eq(engine._st[0], ['ignore', '[Channel1]', 'volume']);
});

test('soft takeover: no rearm when group/inKey unchanged', function(t) {
    var c = H.ctrl();
    c._applyBinding('fader0', {group: '[Channel1]', inKey: 'volume'});
    engine._st = [];
    c._applyBinding('fader0', {group: '[Channel1]', inKey: 'volume'});
    t.eq(engine._st.length, 0);
});

// ── hash skip ────────────────────────────────────────────────

test('_applyResolved: no rebind on identical cfg', function(t) {
    var c = H.ctrl();
    var cfg = {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {scheme: 'red', on: {always: true}}
    };
    c._applyResolved({button0_0: cfg});
    H.clearLeds();
    c._applyResolved({button0_0: cfg});
    t.eq(midi._sysex.length, 0);
});

test('_applyResolved: rebind on changed cfg', function(t) {
    var c = H.ctrl();
    c._applyResolved({button0_0: {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {scheme: 'red', on: {always: true}}
    }});
    H.clearLeds();
    c._applyResolved({button0_0: {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {scheme: 'blue', on: {always: true}}
    }});
    t.rgb(H.led(c, 'button0_0'), 0, 0, 127);
});

test('_applyResolved: removed bindings get unbound', function(t) {
    var c = H.ctrl();
    c._applyResolved({button0_0: {
        group: '[Channel1]', inKey: 'pfl',
        colorScheme: {scheme: 'red', on: {always: true}}
    }});
    H.clearLeds();
    c._applyResolved({});
    var led = H.led(c, 'button0_0');
    t.rgb(led, 0, 0, 0);
    t.hw(led, 0);
});

// ── observers on input dispatch ──────────────────────────────

test('input: fires binding func', function(t) {
    var c = H.ctrl();
    var seen = 0;
    c._applyBinding('press0', {
        func: function() { seen++; }
    });
    H.press(c, 'press0');
    t.eq(seen, 1);
});

test('input: func args passed through', function(t) {
    var c = H.ctrl();
    var captured = null;
    c._applyBinding('press0', {
        func: function(args) { captured = args; },
        args: ['a', 'b']
    });
    H.press(c, 'press0');
    t.eq(captured, ['a', 'b']);
});