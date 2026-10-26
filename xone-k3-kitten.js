// xone-k3-kitten.js — Kitten preset: Cat's layers, different boot.
//
// Loads after cat.js. Reuses XoneK3.CAT_LAYERS via XoneK3.bootCat.
// Only differences from Cat: channel 0x0D, both activeDeck and
// activeFx booted to side B.

'use strict';

(function() {
    if (typeof XoneK3 === 'undefined') {
        throw new Error('Xone K3: <filename> — xone-k3-lib-core.js must load first');
    }
    
    if (typeof XoneK3._requireLoad !== 'function') {
        throw new Error('Xone K3: xone-k3-kitten.js — xone-k3-cat.js must load first');
    }
    XoneK3._requireLoad('xone-k3-kitten.js', ['bootCat', 'CAT_LAYERS']);

    XoneK3.init = function() {
        XoneK3.bootCat({
            label: 'Kitten',
            midiChannel: 0x0D,
            initialDeckA: 2, initialDeckB: 4,
            initialFxA: 1,   initialFxB: 1,
            initialActiveDeck: 'A',
            initialActiveFx:   'A'
        });
    };
    XoneK3.shutdown = function() { XoneK3.halt(); };
})();