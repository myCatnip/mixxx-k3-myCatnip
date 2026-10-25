'use strict';

var H = require('./helpers');

function setupLab(overrides) {
    var cfg = Object.assign({
        patches: {
            colorLab:      {},
            colorLabShift: {},
            slots:         {},
            slotsShift:    {}
        },
        initialPatches: ['colorLab'],
        ledTargetGroups: {calib: ['grid0_0', 'grid1_0']},
        labPreviewTarget: 'button0_0',
        markerTarget:     'grid3_3'
    }, overrides || {});
    return H.bootLab(cfg);
}

// ── construction ─────────────────────────────────────────────

test('LabController extends K3Controller', function(t) {
    var c = setupLab();
    t.ok(c instanceof XoneK3.LabController);
    t.ok(c instanceof XoneK3.K3Controller);
});

test('boot seeds slot 0 with labDefault', function(t) {
    var c = setupLab();
    t.ok(c._lab.slots[0]);
    t.ok(c._lab.slots[0].colors);
});

test('boot initializes _lab state', function(t) {
    var c = setupLab();
    t.eq(c._lab.previewSource, 'edit');
    t.eq(c._lab.previewing,    false);
    t.eq(c._lab.saveArmed,     false);
    t.eq(c._lab.selectedSegment, 0);
    t.eq(c._lab.ratioEdit,     false);
    t.eq(c._lab.beatTarget,    null);
    t.eq(c._lab._version,      0);
});

// ── _cloneScheme ─────────────────────────────────────────────

test('_cloneScheme: deep copy', function(t) {
    var c = setupLab();
    var src = {colors: [[127,0,0]]};
    var cpy = c._cloneScheme(src);
    t.neq(cpy, src);
    t.neq(cpy.colors, src.colors);
    cpy.colors[0][0] = 0;
    t.eq(src.colors[0][0], 127);
});

test('_cloneScheme: null passthrough', function(t) {
    var c = setupLab();
    t.eq(c._cloneScheme(null), null);
});

// ── _editableScheme / _previewScheme / _labLEDScheme ────────

test('_editableScheme: returns edit buffer when colorLab active', function(t) {
    var c = setupLab();
    t.eq(c._editableScheme(), c._lab.edit);
});

test('_editableScheme: null outside colorLab', function(t) {
    var c = setupLab();
    c.activePatches = ['slots'];
    t.eq(c._editableScheme(), null);
});

test('_previewScheme: edit source', function(t) {
    var c = setupLab();
    c._lab.previewSource = 'edit';
    t.eq(c._previewScheme(), c._lab.edit);
});

test('_previewScheme: slot index', function(t) {
    var c = setupLab();
    c._lab.slots[5] = {colors: [[0,127,0]]};
    c._lab.previewSource = 5;
    t.eq(c._previewScheme(), c._lab.slots[5]);
});

test('_previewScheme: registry name', function(t) {
    var c = setupLab();
    c._lab.previewSource = 'coMatch';
    var s = c._previewScheme();
    t.ok(s);
    t.ok(Array.isArray(s.colors));
});

test('_previewScheme: unknown name → null', function(t) {
    var c = setupLab();
    c._lab.previewSource = 'noSuchScheme';
    t.eq(c._previewScheme(), null);
});

test('_labLEDScheme: edit mode not previewing → edit', function(t) {
    var c = setupLab();
    t.eq(c._labLEDScheme(), c._lab.edit);
});

test('_labLEDScheme: edit mode previewing → preview', function(t) {
    var c = setupLab();
    c._lab.slots[3] = {colors: [[0,127,0]]};
    c._lab.previewSource = 3;
    c._lab.previewing = true;
    t.eq(c._labLEDScheme(), c._lab.slots[3]);
});

test('_labLEDScheme: slots mode → preview', function(t) {
    var c = setupLab({initialPatches: ['slots']});
    c._lab.slots[3] = {colors: [[0,127,0]]};
    c._lab.previewSource = 3;
    t.eq(c._labLEDScheme(), c._lab.slots[3]);
});

// ── _commitPreview ──────────────────────────────────────────
//
// _commitPreview is a GATE, not a copier. Returns _lab.edit when
// previewSource === 'edit' (edit mode, not previewing), null
// otherwise (with a warn-once keyed labEditWhilePreviewing). It
// never copies a preview into edit and never clears any flag —
// those are the jobs of _loadPreview (shift+R), _editThis (slots
// mode), and the armed-slot save in _selectSlot. See INTERNALS §17.

test('_commitPreview: null while previewing (gate — no side effects)', function(t) {
    var c = setupLab();
    c._lab.slots[3] = {colors: [[0,127,0]]};
    c._lab.previewSource = 3;
    c._lab.previewing = true;
    var before = c._lab.edit;
    var result = c._commitPreview();
    t.eq(result, null);
    // Gate must not touch the edit buffer or the preview state.
    t.eq(c._lab.edit, before);
    t.eq(c._lab.previewSource, 3);
    t.eq(c._lab.previewing, true);
});

test('_commitPreview: returns edit buffer when previewSource is edit', function(t) {
    var c = setupLab();
    var before = c._lab.edit;
    c._lab.previewSource = 'edit';
    c._lab.previewing = false;
    t.eq(c._commitPreview(), before);
});

test('_commitPreview: no preview → returns edit unchanged', function(t) {
    var c = setupLab();
    var edit = c._lab.edit;
    t.eq(c._commitPreview(), edit);
});

test('_commitPreview: not in colorLab → null', function(t) {
    var c = setupLab({initialPatches: ['slots']});
    t.eq(c._commitPreview(), null);
});

// ── _setPreview ─────────────────────────────────────────────

test('_setPreview: sets source and flag, runs auto-bake', function(t) {
    var c = setupLab();
    // Populate slot 5 first so auto-bake has content to work with.
    c._lab.slots[5] = {colors: [[100, 100, 100]]};
    c._setPreview(5, 'slot5');
    t.eq(c._lab.previewSource, 5);
    t.eq(c._lab.previewing, true);
    t.ok(c._lab.slots[XoneK3.LAB_SLOT.SOURCE]);
});

// ── _trimTrailingZeros ──────────────────────────────────────

test('_trimTrailingZeros: removes trailing black stops', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[127,0,0], [0,0,0], [0,0,0]]};
    c._lab.selectedSegment = 0;
    c._trimTrailingZeros();
    t.eq(c._lab.edit.colors.length, 1);
});

test('_trimTrailingZeros: preserves selected stop', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[127,0,0], [0,0,0]]};
    c._lab.selectedSegment = 1;
    c._trimTrailingZeros();
    t.eq(c._lab.edit.colors.length, 2);
});

test('_trimTrailingZeros: always keeps ≥1 stop', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[0,0,0]]};
    c._lab.selectedSegment = -1;
    c._trimTrailingZeros();
    t.eq(c._lab.edit.colors.length, 1);
});

test('_trimTrailingZeros: stops at non-black', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[127,0,0], [0,127,0], [0,0,0]]};
    c._lab.selectedSegment = 0;
    c._trimTrailingZeros();
    t.eq(c._lab.edit.colors.length, 2);
});

// ── _applyAutoBake ─────────────────────────────────────────

test('_applyAutoBake: fills slots 12-15', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[127,0,0], [0,0,127]]};
    c._lab.previewSource = 'edit';
    c._applyAutoBake();
    var S = XoneK3.LAB_SLOT;
    t.ok(c._lab.slots[S.SOURCE]);
    t.ok(c._lab.slots[S.STRUCTURAL]);
    t.ok(c._lab.slots[S.SAMPLED]);
    t.ok(c._lab.slots[S.WIRE]);
});

test('_applyAutoBake: skips bake slots', function(t) {
    var c = setupLab();
    c._lab.slots[XoneK3.LAB_SLOT.STRUCTURAL] = 'sentinel';
    c._lab.previewSource = XoneK3.LAB_SLOT.STRUCTURAL;
    c._applyAutoBake();
    t.eq(c._lab.slots[XoneK3.LAB_SLOT.STRUCTURAL], 'sentinel');
});

test('_applyAutoBake: skips registry names', function(t) {
    var c = setupLab();
    var before = c._lab.slots[XoneK3.LAB_SLOT.SOURCE];
    c._lab.previewSource = 'coMatch';
    c._applyAutoBake();
    t.eq(c._lab.slots[XoneK3.LAB_SLOT.SOURCE], before);
});

// ── _selectSlot ────────────────────────────────────────────

test('_selectSlot: preview when not armed', function(t) {
    var c = setupLab();
    c._lab.slots[5] = {colors: [[0,127,0]]};
    c._selectSlot(5);
    t.eq(c._lab.previewSource, 5);
    t.eq(c._lab.previewing, true);
});

test('_selectSlot: armed saves into slot', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[10,20,30]]};
    c._lab.saveArmed = true;
    c._selectSlot(5);
    t.eq(c._lab.slots[5].colors[0][0], 10);
    t.eq(c._lab.saveArmed, false);
});

test('_selectSlot: armed save loads into edit and exits', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[10,20,30]]};
    c._lab.saveArmed = true;
    c._selectSlot(5);
    t.eq(c._lab.edit.colors[0][0], 10);
    t.eq(c._lab.previewSource, 'edit');
    t.notOk(c._patchActive('slots'));
});

test('_selectSlot: armed save overwrites with backup to console', function(t) {
    var c = setupLab();
    c._lab.slots[5] = {colors: [[99,99,99]]};
    c._lab.edit = {colors: [[10,20,30]]};
    c._lab.saveArmed = true;
    var before = _printLog.length;
    c._selectSlot(5);
    t.ok(_printLog.length > before, 'no overwrite backup printed');
});

test('_selectSlot: armed save over self-skips backup', function(t) {
    var c = setupLab();
    c._lab.slots[5] = {colors: [[99,99,99]]};
    c._lab.previewSource = 5;
    c._lab.saveArmed = true;
    var before = _printLog.length;
    c._selectSlot(5);
    t.eq(_printLog.length, before);
});

// ── _toggleSaveArm ─────────────────────────────────────────

test('_toggleSaveArm: flips flag', function(t) {
    var c = setupLab();
    c._toggleSaveArm();
    t.eq(c._lab.saveArmed, true);
    c._toggleSaveArm();
    t.eq(c._lab.saveArmed, false);
});

// ── _editReturn / _editThis / _loadPreview ─────────────────

test('_editReturn: replaces slots with colorLab', function(t) {
    var c = setupLab({initialPatches: ['slots']});
    c._lab.saveArmed = true;
    c._editReturn();
    t.ok(c._patchActive('colorLab'));
    t.eq(c._lab.saveArmed, false);
});

test('_editThis: copies preview into edit, exits', function(t) {
    var c = setupLab({initialPatches: ['slots']});
    c._lab.slots[5] = {colors: [[1,2,3]]};
    c._lab.previewSource = 5;
    c._editThis();
    t.eq(c._lab.edit.colors[0][0], 1);
    t.eq(c._lab.previewSource, 'edit');
    t.ok(c._patchActive('colorLab'));
});

test('_loadPreview: commit without leaving mode', function(t) {
    var c = setupLab();
    c._lab.slots[5] = {colors: [[1,2,3]]};
    c._lab.previewSource = 5;
    c._lab.previewing = true;
    c._loadPreview();
    t.eq(c._lab.edit.colors[0][0], 1);
    t.eq(c._lab.previewSource, 'edit');
});

// ── _editColorField ────────────────────────────────────────

test('_editColorField: stepped r on segment', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[50,0,0]]};
    c._lab.selectedSegment = 0;
    c._editColorField('r', 'step', 5);
    t.eq(c._lab.edit.colors[0][0], 55);
});

test('_editColorField: absolute fader r', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[50,0,0]]};
    c._lab.selectedSegment = 0;
    c._editColorField('r', 'abs', 100);
    t.eq(c._lab.edit.colors[0][0], 100);
});

test('_editColorField: clamped to 0..127', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[120,0,0]]};
    c._lab.selectedSegment = 0;
    c._editColorField('r', 'step', 100);
    t.eq(c._lab.edit.colors[0][0], 127);
});

test('_editColorField: marker stepped brightness writes on-phase', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[0,0,0]], markerColor: 'red, 60, 20'};
    c._lab.selectedSegment = -1;
    c._lab.previewOn = true;
    c._editColorField('brightness', 'step', 5);
    t.eq(c._lab.edit.markerColor[3], 65);
});

test('_editColorField: marker stepped brightness writes off-phase', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[0,0,0]], markerColor: 'red, 60, 20'};
    c._lab.selectedSegment = -1;
    c._lab.previewOn = false;
    c._editColorField('brightness', 'step', 5);
    t.eq(c._lab.edit.markerColor[4], 25);
});

test('_editColorField: not in colorLab → no-op', function(t) {
    var c = setupLab({initialPatches: ['slots']});
    var before = JSON.stringify(c._lab.edit);
    c._editColorField('r', 'step', 5);
    t.eq(JSON.stringify(c._lab.edit), before);
});

// ── _editBeatColor ─────────────────────────────────────────

test('_editBeatColor: creates beat block when missing', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[0,0,0]]};
    c._lab.beatTarget = 'beat';
    c._editBeatColor('r', 10, undefined);
    t.ok(c._lab.edit.beat);
    t.ok(c._lab.edit.beat.color);
});

test('_editBeatColor: absolute writes fader value', function(t) {
    var c = setupLab();
    c._lab.edit = {colors: [[0,0,0]]};
    c._lab.beatTarget = 'bar';
    c._editBeatColor('g', 0, 100);
    t.eq(c._lab.edit.beat.bar.color[1], 100);
});

test('_editBeatColor: no target → no-op', function(t) {
    var c = setupLab();
    c._lab.beatTarget = null;
    c._editBeatColor('r', 10, undefined);
    t.eq(c._lab.edit.beat, undefined);
});

// ── _previewLabel ──────────────────────────────────────────

test('_previewLabel: edit', function(t) {
    var c = setupLab();
    c._lab.previewSource = 'edit';
    t.eq(c._previewLabel(), 'edit');
});

test('_previewLabel: slot N', function(t) {
    var c = setupLab();
    c._lab.previewSource = 5;
    t.eq(c._previewLabel(), 'slot5');
});

test('_previewLabel: bake slots 12-15', function(t) {
    var c = setupLab();
    c._lab.previewSource = XoneK3.LAB_SLOT.SOURCE;
    t.eq(c._previewLabel(), 'bake0');
    c._lab.previewSource = XoneK3.LAB_SLOT.WIRE;
    t.eq(c._previewLabel(), 'bake3');
});

test('_previewLabel: registry name', function(t) {
    var c = setupLab();
    c._lab.previewSource = 'myScheme';
    t.eq(c._previewLabel(), 'myScheme');
});

// ── _isBeatEdit ────────────────────────────────────────────

test('_isBeatEdit: true when colorLabBeat active', function(t) {
    var c = setupLab({
        patches: {
            colorLab:     {},
            colorLabBeat: {_host: 'colorLab'}
        }
    });
    c.activePatches = ['colorLab', 'colorLabBeat'];
    t.ok(c._isBeatEdit());
});

test('_isBeatEdit: false otherwise', function(t) {
    var c = setupLab();
    t.notOk(c._isBeatEdit());
});