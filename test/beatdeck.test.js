'use strict';

var H = require('./helpers');

// _resolveDeckRef, _deckStateFor, _isBeatOffPhase.

// ── _resolveDeckRef ──────────────────────────────────────────

test('_resolveDeckRef: number passes through', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveDeckRef(1), 1);
    t.eq(c._resolveDeckRef(4), 4);
});

test('_resolveDeckRef: out-of-range number → null', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveDeckRef(0), null);
    t.eq(c._resolveDeckRef(5), null);
});

test('_resolveDeckRef: undefined/null uses default (active deck)', function(t) {
    var c = H.ctrl();
    c.setSelectedFor('deck', 'A', 3);
    c.setActiveDeck('A');
    t.eq(c._resolveDeckRef(undefined), 3);
    t.eq(c._resolveDeckRef(null),      3);
});

test('_resolveDeckRef: $DECK_ACTIVE$ follows activeDeck', function(t) {
    var c = H.ctrl();
    c.setSelectedFor('deck', 'A', 2);
    c.setSelectedFor('deck', 'B', 4);
    c.setActiveDeck('A');
    t.eq(c._resolveDeckRef('$DECK_ACTIVE$'), 2);
    c.setActiveDeck('B');
    t.eq(c._resolveDeckRef('$DECK_ACTIVE$'), 4);
});

test('_resolveDeckRef: $DECK_ALT$', function(t) {
    var c = H.ctrl();
    c.setSelectedFor('deck', 'A', 2);
    c.setSelectedFor('deck', 'B', 4);
    c.setActiveDeck('A');
    t.eq(c._resolveDeckRef('$DECK_ALT$'), 4);
});

test('_resolveDeckRef: non-token string → null', function(t) {
    var c = H.ctrl();
    t.eq(c._resolveDeckRef('nonsense'), null);
    t.eq(c._resolveDeckRef('[Master]'), null);
});

// ── _deckStateFor ────────────────────────────────────────────

test('_deckStateFor: numeric deck returns that deck state', function(t) {
    var c = H.ctrl();
    t.eq(c._deckStateFor({beat: {deck: 2}}), c._decks[2]);
});

test('_deckStateFor: token follows activeDeck', function(t) {
    var c = H.ctrl();
    c.setSelectedFor('deck', 'A', 1);
    c.setSelectedFor('deck', 'B', 3);
    c.setActiveDeck('A');
    t.eq(c._deckStateFor({beat: {deck: '$DECK_ACTIVE$'}}), c._decks[1]);
    c.setActiveDeck('B');
    t.eq(c._deckStateFor({beat: {deck: '$DECK_ACTIVE$'}}), c._decks[3]);
});

test('_deckStateFor: no beat → null', function(t) {
    var c = H.ctrl();
    t.eq(c._deckStateFor({}),   null);
    t.eq(c._deckStateFor(null), null);
});

// ── _isBeatOffPhase ──────────────────────────────────────────

test('_isBeatOffPhase: no beat → false', function(t) {
    var c = H.ctrl();
    var b = c.bindings.press0;
    t.eq(b._isBeatOffPhase({}), false);
});

test('_isBeatOffPhase: no hasBeat → false', function(t) {
    var c = H.ctrl();
    var b = c.bindings.press0;
    c._decks[2].hasBeat = false;
    t.eq(b._isBeatOffPhase({beat: {deck: 2}}), false);
});

test('_isBeatOffPhase: active beat → false', function(t) {
    var c = H.ctrl();
    var b = c.bindings.press0;
    c._decks[2].hasBeat = true;
    c._decks[2].active  = true;
    t.eq(b._isBeatOffPhase({beat: {deck: 2}}), false);
});

test('_isBeatOffPhase: between beats → true', function(t) {
    var c = H.ctrl();
    var b = c.bindings.press0;
    c._decks[2].hasBeat = true;
    c._decks[2].active  = false;
    t.eq(b._isBeatOffPhase({beat: {deck: 2}}), true);
});

test('_isBeatOffPhase: token deck re-resolves on focus change', function(t) {
    var c = H.ctrl();
    var b = c.bindings.press0;
    c.setSelectedFor('deck', 'A', 1);
    c.setSelectedFor('deck', 'B', 3);
    c.setActiveDeck('A');

    c._decks[1].hasBeat = true;  c._decks[1].active = false;
    c._decks[3].hasBeat = false; c._decks[3].active = false;

    var scheme = {beat: {deck: '$DECK_ACTIVE$'}};
    t.eq(b._isBeatOffPhase(scheme), true);

    c.setActiveDeck('B');
    t.eq(b._isBeatOffPhase(scheme), false);

    c._decks[3].hasBeat = true;
    t.eq(b._isBeatOffPhase(scheme), true);
});

// ── _beatStateFor ────────────────────────────────────────────

test('_beatStateFor: null without hasBeat', function(t) {
    var c = H.ctrl();
    var b = c.bindings.press0;
    t.eq(b._beatStateFor({beat: {deck: 1}}), null);
});

test('_beatStateFor: returns deck state when hasBeat', function(t) {
    var c = H.ctrl();
    var b = c.bindings.press0;
    c._decks[1].hasBeat = true;
    t.eq(b._beatStateFor({beat: {deck: 1}}), c._decks[1]);
});