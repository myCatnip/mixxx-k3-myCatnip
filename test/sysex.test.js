'use strict';

var H = require('./helpers');

// noteToLEDIndex, buildSysExLED, rgbToK2, idxToK2, sendK2Note,
// sendLED routing, LED cache.

// ── noteToLEDIndex ───────────────────────────────────────────

test('noteToLEDIndex: grid row 0 notes 0x28..0x2B → indices 8..11', function(t) {
    t.eq(XoneK3.noteToLEDIndex(0x28),  8);
    t.eq(XoneK3.noteToLEDIndex(0x29),  9);
    t.eq(XoneK3.noteToLEDIndex(0x2A), 10);
    t.eq(XoneK3.noteToLEDIndex(0x2B), 11);
});

test('noteToLEDIndex: grid row 2 notes 0x30..0x33 → indices 0..3', function(t) {
    t.eq(XoneK3.noteToLEDIndex(0x30), 0);
    t.eq(XoneK3.noteToLEDIndex(0x31), 1);
    t.eq(XoneK3.noteToLEDIndex(0x32), 2);
    t.eq(XoneK3.noteToLEDIndex(0x33), 3);
});

test('noteToLEDIndex: layer/shift button notes', function(t) {
    t.eq(XoneK3.noteToLEDIndex(0x0C), 0x1C);
    t.eq(XoneK3.noteToLEDIndex(0x0F), 0x1D);
});

test('noteToLEDIndex: encoder row notes 0x34..0x37', function(t) {
    t.eq(XoneK3.noteToLEDIndex(0x34), 0x1E);
    t.eq(XoneK3.noteToLEDIndex(0x37), 0x21);
});

test('noteToLEDIndex: unknown note → -1', function(t) {
    t.eq(XoneK3.noteToLEDIndex(0x00), -1);
    t.eq(XoneK3.noteToLEDIndex(0xFF), -1);
});

// ── buildSysExLED ────────────────────────────────────────────

test('buildSysExLED: frame shape', function(t) {
    var msg = XoneK3.buildSysExLED(5, 127, 0, 64, 100);
    t.eq(msg[0],  0xF0);
    t.eq(msg[1],  0x00);
    t.eq(msg[2],  0x00);
    t.eq(msg[3],  0x1A);
    t.eq(msg[4],  0x50);
    t.eq(msg[5],  0x15);
    t.eq(msg[6],  0x00);
    t.eq(msg[7],  0x0E);
    t.eq(msg[8],  5);
    t.eq(msg[9],  127);
    t.eq(msg[10], 0);
    t.eq(msg[11], 64);
    t.eq(msg[12], 100);
    t.eq(msg[13], 0xF7);
});

test('buildSysExLED: idx masked to 7 bits, rgb+hw clamped', function(t) {
    // idx uses & 0x7F; r,g,b,hw use Math.max(0, Math.min(0x7F, ...)).
    var msg = XoneK3.buildSysExLED(200, 200, -50, 300, -1);
    t.eq(msg[8],  200 & 0x7F);   // 72
    t.eq(msg[9],  127);          // 200 clamped
    t.eq(msg[10], 0);            // -50 clamped
    t.eq(msg[11], 127);          // 300 clamped
    t.eq(msg[12], 0);            // -1 clamped
});

// ── rgbToK2 ──────────────────────────────────────────────────
//
// Classification by r-g difference against K2_RG_THRESHOLD (60).
// Buckets: 0 = red-dominant, 1 = balanced, 2 = green-dominant.

test('rgbToK2: hw 0 → -1', function(t) {
    t.eq(XoneK3.rgbToK2(127, 0, 0, 0), -1);
});

test('rgbToK2: black → -1', function(t) {
    t.eq(XoneK3.rgbToK2(0, 0, 0, 127), -1);
});

test('rgbToK2: red-dominant → 0', function(t) {
    t.eq(XoneK3.rgbToK2(127, 20, 0, 127), 0);
});

test('rgbToK2: green-dominant → 2', function(t) {
    t.eq(XoneK3.rgbToK2(20, 127, 0, 127), 2);
});

test('rgbToK2: balanced (r≈g) → 1', function(t) {
    t.eq(XoneK3.rgbToK2(0, 20, 127, 127), 1);
    t.eq(XoneK3.rgbToK2(80, 80, 0, 127), 1);
    t.eq(XoneK3.rgbToK2(127, 127, 127, 127), 1);
});

// ── idxToK2 ──────────────────────────────────────────────────

test('idxToK2: encoder/grid row 0 (idx 0..3) → base 0x30', function(t) {
    t.eq(XoneK3.idxToK2(0).base, 0x30);
    t.eq(XoneK3.idxToK2(3).base, 0x33);
});

test('idxToK2: layer / shift', function(t) {
    t.eq(XoneK3.idxToK2(0x1C).base, 0x0C);
    t.eq(XoneK3.idxToK2(0x1D).base, 0x0F);
});

test('idxToK2: unknown idx → null', function(t) {
    t.eq(XoneK3.idxToK2(0xFF), null);
});

// ── sendK2Note ───────────────────────────────────────────────
//
// Bucket → offset: 0 → base+0, 1 → base+36, 2 → base+72.

test('sendK2Note: black → note-off on base', function(t) {
    XoneK3.sendK2Note(0x0E, 0, 0, 0, 0, 0);
    var last = midi._short[midi._short.length - 1];
    t.eq(last[0], 0x90 + 0x0E);
    t.eq(last[1], 0x30);
    t.eq(last[2], 0x00);
});

test('sendK2Note: red bucket uses offset 0', function(t) {
    XoneK3.sendK2Note(0x0E, 0, 127, 0, 0, 127);
    var last = midi._short[midi._short.length - 1];
    t.eq(last[1], 0x30);
});

test('sendK2Note: balanced bucket uses offset 36', function(t) {
    XoneK3.sendK2Note(0x0E, 0, 0, 0, 127, 127);
    var last = midi._short[midi._short.length - 1];
    t.eq(last[1], 0x30 + 36);
});

test('sendK2Note: green bucket uses offset 72', function(t) {
    XoneK3.sendK2Note(0x0E, 0, 0, 127, 0, 127);
    var last = midi._short[midi._short.length - 1];
    t.eq(last[1], 0x30 + 72);
});

// ── sendLED routing ─────────────────────────────────────────

test('sendLED: sysex path when sysex true', function(t) {
    var c = H.ctrl({sysex: true});
    H.clearLeds(c);
    c.sendLED(5, 100, 50, 25, 100);
    t.eq(midi._sysex.length, 1);
    t.eq(midi._short.length, 0);
});

test('sendLED: K2 path when sysex false', function(t) {
    var c = H.ctrl({sysex: false});
    H.clearLeds(c);
    c.sendLED(0, 127, 0, 0, 127);
    t.eq(midi._sysex.length, 0);
    t.ok(midi._short.length > 0);
});

test('sendLED: skip when idx < 0', function(t) {
    var c = H.ctrl();
    H.clearLeds(c);
    c.sendLED(-1, 100, 0, 0, 100);
    t.eq(midi._sysex.length, 0);
    t.eq(midi._short.length, 0);
});

test('sendLED: skip when shutting down', function(t) {
    var c = H.ctrl();
    c._shuttingDown = true;
    H.clearLeds(c);
    c.sendLED(5, 100, 0, 0, 100);
    t.eq(midi._sysex.length, 0);
});

// ── _ledCache dedup ─────────────────────────────────────────

test('_ledCache: identical value not resent', function(t) {
    var c = H.ctrl();
    H.clearLeds(c);
    c.sendLED(5, 100, 0, 0, 100);
    c.sendLED(5, 100, 0, 0, 100);
    t.eq(midi._sysex.length, 1);
});

test('_ledCache: different value resends', function(t) {
    var c = H.ctrl();
    H.clearLeds(c);
    c.sendLED(5, 100, 0, 0, 100);
    c.sendLED(5, 100, 0, 0, 101);
    t.eq(midi._sysex.length, 2);
});

// ── _blankLeds ──────────────────────────────────────────────

test('_blankLeds: sends note-offs and black sysex', function(t) {
    var c = H.ctrl();
    H.clearLeds(c);
    c._blankLeds();
    t.ok(midi._short.length > 0);
    t.ok(midi._sysex.length > 0);
    for (var i = 0; i < midi._sysex.length; i++) {
        var m = midi._sysex[i];
        t.eq(m[9],  0);
        t.eq(m[10], 0);
        t.eq(m[11], 0);
    }
});

test('_blankLeds: skips K2-locked indices', function(t) {
    var c = H.ctrl();
    c.k2Indices[5] = true;
    H.clearLeds(c);
    c._blankLeds();
    for (var i = 0; i < midi._sysex.length; i++) {
        t.notOk(midi._sysex[i][8] === 5);
    }
});