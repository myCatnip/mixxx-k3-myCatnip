'use strict';

var H = require('./helpers');

// Lab painters. Uses H.bind so cell-discovery helpers see the
// applied bindings, and H.clearLeds(c) to reset both the mock log
// and the controller's _ledCache.
//
// When a test mutates _lab.edit directly (bypassing an input
// func), it must bump _lab._version so _compiledPreview()
// invalidates. setEdit() does both.

function setupLab(overrides) {
    var cfg = Object.assign({
        patches: {
            colorLab:      {},
            colorLabShift: {},
            slots:         {},
            slotsShift:    {},
            colorLabBeat:  {_host: 'colorLab'}
        },
        initialPatches: ['colorLab'],
        ledTargetGroups: {calib: ['grid0_0', 'grid1_0', 'grid2_0']},
        labPreviewTarget: 'button0_0',
        markerTarget:     'grid3_3',
        labPreviewCO: {group: '[QuickEffectRack1_[Channel1]]', name: 'super1'}
    }, overrides || {});
    var c = H.bootLab(cfg);
    H.clearLeds(c);
    return c;
}

// Mutate the edit buffer AND invalidate the compile cache, the way
// a real input func would (via _onInput).
function setEdit(c, scheme) {
    c._lab.edit = scheme;
    c._lab._version++;
}

function setPreviewCO(v) {
    engine._params['[QuickEffectRack1_[Channel1]]|super1'] = v;
}

// ── _buildCellIndex / _findCellsByFunc ─────────────────────

test('_findCellsByFunc: finds cells by func id', function(t) {
    var c = setupLab();
    H.bind(c, 'grid0_0', {
        func: XoneK3.FUNCS.ledSelectTarget, args: ['grid0_0']
    });
    var cells = c._findCellsByFunc([XoneK3.FUNCS.ledSelectTarget]);
    t.hasKey(cells, 'grid0_0');
    t.eq(cells.grid0_0, ['grid0_0']);
});

test('_findCellsByFunc: caches until _applied changes', function(t) {
    var c = setupLab();
    H.bind(c, 'grid0_0', {
        func: XoneK3.FUNCS.ledSelectTarget, args: ['grid0_0']
    });
    c._findCellsByFunc([XoneK3.FUNCS.ledSelectTarget]);
    t.eq(c._cellIndexFor, c._applied);
});

test('_claimedCells: returns union of painter-owned cells', function(t) {
    var c = setupLab();
    H.bind(c, 'grid0_0', {
        func: XoneK3.FUNCS.labSlotPress, args: [0]
    });
    var claimed = c._claimedCells();
    t.hasKey(claimed, 'grid0_0');
});

// ── _renderSegmentGrid ────────────────────────────────────

test('_renderSegmentGrid: paints each stop', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0], [0,127,0], [0,0,127]]});
    H.clearLeds(c);
    c._renderSegmentGrid();
    t.rgb(H.led(c, 'grid0_0'), 127, 0, 0);
});

test('_renderSegmentGrid: unset cells go dark', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]]});
    H.clearLeds(c);
    c._renderSegmentGrid();
    var l1 = H.led(c, 'grid1_0');
    t.eq(l1.r, 0);
    t.eq(l1.g, 0);
    t.eq(l1.b, 0);
});

test('_renderSegmentGrid: out-of-range cells go black', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]]});
    c._lab.selectedSegment = 2;
    H.clearLeds(c);
    c._renderSegmentGrid();
    var led = H.led(c, 'grid2_0');
    t.eq(led.r, 0);
    t.eq(led.g, 0);
    t.eq(led.b, 0);
});

// ── _renderMarkerLED ──────────────────────────────────────

test('_renderMarkerLED: paints marker colour', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]], markerColor: 'green, 90'});
    var compiled = XoneK3.compileScheme(XoneK3.resolveScheme(c._lab.edit));
    H.clearLeds(c);
    c._renderMarkerLED(compiled);
    t.rgb(H.led(c, 'grid3_3'), 0, 127, 0);
});

test('_renderMarkerLED: no marker → black', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]]});
    var compiled = XoneK3.compileScheme(XoneK3.resolveScheme(c._lab.edit));
    H.clearLeds(c);
    c._renderMarkerLED(compiled);
    t.rgb(H.led(c, 'grid3_3'), 0, 0, 0);
});

// ── _renderSlotLEDs ───────────────────────────────────────

test('_renderSlotLEDs: empty slot → black', function(t) {
    var c = setupLab({initialPatches: ['slots']});
    H.bind(c, 'grid0_0', {
        func: XoneK3.FUNCS.labSlotPress, args: [5]
    });
    H.clearLeds(c);
    c._renderSlotLEDs();
    var led = H.led(c, 'grid0_0');
    t.eq(led.r, 0);
});

test('_renderSlotLEDs: populated save slot → yellow', function(t) {
    var c = setupLab({initialPatches: ['slots']});
    c._lab.slots[5] = {colors: [[0,0,0]]};
    H.bind(c, 'grid0_0', {
        func: XoneK3.FUNCS.labSlotPress, args: [5]
    });
    H.clearLeds(c);
    c._renderSlotLEDs();
    var led = H.led(c, 'grid0_0');
    t.eq(led.r, 127);
    t.eq(led.g, 127);
});

test('_renderSlotLEDs: slot 0 → green', function(t) {
    var c = setupLab({initialPatches: ['slots']});
    H.bind(c, 'grid0_0', {
        func: XoneK3.FUNCS.labSlotPress, args: [0]
    });
    H.clearLeds(c);
    c._renderSlotLEDs();
    t.rgb(H.led(c, 'grid0_0'), 0, 127, 0);
});

test('_renderSlotLEDs: previewed slot brighter', function(t) {
    var c = setupLab({initialPatches: ['slots']});
    c._lab.slots[5] = {colors: [[0,0,0]]};
    H.bind(c, 'grid0_0', {
        func: XoneK3.FUNCS.labSlotPress, args: [5]
    });
    H.clearLeds(c);
    c._renderSlotLEDs();
    var dimLed = H.led(c, 'grid0_0');

    c._lab.previewSource = 5;
    H.clearLeds(c);
    c._renderSlotLEDs();
    var brightLed = H.led(c, 'grid0_0');

    t.ok(brightLed.hw > dimLed.hw);
});

// ── _renderBeatGrid ───────────────────────────────────────

test('_renderBeatGrid: target cells painted', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]], beat: {bar: {color: 'red'}}});
    H.bind(c, 'grid0_0', {
        func: XoneK3.FUNCS.labBeatSelect, args: ['bar']
    });
    H.clearLeds(c);
    c._renderBeatGrid();
    t.rgb(H.led(c, 'grid0_0'), 127, 0, 0);
});

test('_renderBeatGrid: unset target shows dim grey', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]], beat: {barBeats: 4}});
    H.bind(c, 'grid0_0', {
        func: XoneK3.FUNCS.labBeatSelect, args: ['bar']
    });
    H.clearLeds(c);
    c._renderBeatGrid();
    var led = H.led(c, 'grid0_0');
    t.ok(led.r > 0 && led.g > 0 && led.b > 0);
});

test('_renderBeatGrid: toggle cell green when on', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]], beat: {color: 'red'}});
    H.bind(c, 'grid0_1', {
        func: XoneK3.FUNCS.labBeatToggleEnabled
    });
    H.clearLeds(c);
    c._renderBeatGrid();
    t.rgb(H.led(c, 'grid0_1'), 0, 127, 0);
});

test('_renderBeatGrid: toggle cell red when off', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]], beat: {enabled: false, color: 'red'}});
    H.bind(c, 'grid0_1', {
        func: XoneK3.FUNCS.labBeatToggleEnabled
    });
    H.clearLeds(c);
    c._renderBeatGrid();
    t.rgb(H.led(c, 'grid0_1'), 127, 0, 0);
});

// ── _renderPreviewLED ────────────────────────────────────

test('_renderPreviewLED: unknown knob → white', function(t) {
    var c = setupLab();
    c._lab.previewKnown = false;
    H.clearLeds(c);
    c._renderPreviewLED();
    t.rgb(H.led(c, 'button0_0'), 127, 127, 127);
});

test('_renderPreviewLED: samples ramp at previewPos', function(t) {
    var c = setupLab();
    c._lab.previewKnown = true;
    c._lab.previewPos = 0.25;
    c._lab.previewOn = true;
    setEdit(c, {colors: [[127,0,0], [0,0,127]], coScheme: null});
    setPreviewCO(0.25);
    H.clearLeds(c);
    c._renderPreviewLED();
    t.rgb(H.led(c, 'button0_0'), 127, 0, 0, 3);
});

test('_renderPreviewLED: marker at center shows marker colour', function(t) {
    var c = setupLab();
    c._lab.previewKnown = true;
    c._lab.previewPos = 0.5;
    c._lab.previewOn = true;
    setEdit(c, {colors: [[127,0,0], [0,0,127]],
                 markerColor: 'green, 90', markerWidth: 20});
    setPreviewCO(0.5);
    H.clearLeds(c);
    c._renderPreviewLED();
    t.rgb(H.led(c, 'button0_0'), 0, 127, 0);
});

test('_renderPreviewLED: off-phase shows off-ramp', function(t) {
    var c = setupLab();
    c._lab.previewKnown = true;
    c._lab.previewPos = 0.25;
    c._lab.previewOn = false;
    setEdit(c, {colors: [[127,0,0], [0,0,127]], coScheme: null});
    setPreviewCO(0.25);
    H.clearLeds(c);
    c._renderPreviewLED();
    var led = H.led(c, 'button0_0');
    t.ok(led.hw <= 20);
});

// ── _compiledPreview cache ────────────────────────────────

test('_compiledPreview: returns object with resolved + compiled', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]]});
    var r = c._compiledPreview();
    t.ok(r.resolved);
    t.ok(r.compiled);
});

test('_compiledPreview: cache hit between reads', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]]});
    var r1 = c._compiledPreview();
    var r2 = c._compiledPreview();
    t.eq(r1, r2);
});

test('_compiledPreview: cache miss after _version bump', function(t) {
    var c = setupLab();
    setEdit(c, {colors: [[127,0,0]]});
    var r1 = c._compiledPreview();
    c._lab._version++;
    var r2 = c._compiledPreview();
    t.neq(r1, r2);
});

test('_onInput bumps version', function(t) {
    var c = setupLab();
    var v0 = c._lab._version;
    c._onInput(c.bindings.button0_0);
    t.ok(c._lab._version > v0);
});

// ── _needsBeatClocks override ─────────────────────────────

test('_needsBeatClocks: true when _onBeat set', function(t) {
    var c = setupLab();
    t.eq(c._needsBeatClocks(), true);
});

// ── _paintRGB / _paintLED ─────────────────────────────────

test('_paintRGB: paints through sendLED', function(t) {
    var c = setupLab();
    H.clearLeds(c);
    c._paintRGB('button0_0', 100, 50, 25, 100);
    t.rgb(H.led(c, 'button0_0'), 100, 50, 25);
});

test('_paintLED: parses colour spec', function(t) {
    var c = setupLab();
    H.clearLeds(c);
    c._paintLED('button0_0', 'red, 80');
    t.rgb(H.led(c, 'button0_0'), 127, 0, 0);
    t.hw(H.led(c, 'button0_0'), 80);
});

test('_paintLED: no rgb → no write', function(t) {
    var c = setupLab();
    H.clearLeds(c);
    c._paintLED('button0_0', 'mixxx');
    t.eq(midi._sysex.length, 0);
});