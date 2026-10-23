// xone-k3-lib-funcs.js — builders + XoneK3.FUNCS.
//
// Loaded by every preset, after lib-core and lib-schemes.
//
// QFX enable buttons are written inline in each preset's config,
// not built here. They need `loaded_chain_preset` (0-based) as
// their schemeFromState source, and the chain list from
// XoneK3.QFX_CHAIN_LIST.
//
// Rate gating is handled by Binding.input() — see
// XoneK3.RATE_CLASSES in lib-core.js. Funcs here do not check
// rate limits themselves; the gate is applied before dispatch.

'use strict';

(function() {
    if (typeof XoneK3 === 'undefined') {
        throw new Error('Xone K3: <filename> — xone-k3-lib-core.js must load first');
    }

    if (typeof XoneK3._requireLoad !== 'function') {
        throw new Error('Xone K3: xone-k3-lib-funcs.js — xone-k3-lib-core.js must load first');
    }
    XoneK3._requireLoad('xone-k3-lib-funcs.js',
        ['SCHEMES', 'SCHEME_DEFAULTS', '_funcId', '_warnOnce']);

    // ============================================================
    // CONFIG BUILDERS
    // ============================================================
    XoneK3.builders = {};

    XoneK3.builders._fxCs = function(opts) {
        var cs = {
            knob: opts.knob,
            scheme: XoneK3.builders.composeScheme(opts, undefined)
        };
        if (opts.schemeFromState !== undefined) {
            cs.schemeFromState = opts.schemeFromState;
        }
        return cs;
    };

    var EQ_BANDS = { high: 3, mid: 2, low: 1 };

    XoneK3.builders.composeScheme = function(opts, base) {
        if (!opts) return base;
        var ref = (opts.scheme !== undefined) ? opts.scheme : base;
        if (ref === undefined || ref === null) return null;

        var markerPosition = opts.markerPosition;
        if (markerPosition === undefined && opts.marker !== undefined) {
            markerPosition = XoneK3.builders.marker(opts.marker);
        }

        var hasOverride =
            opts.markerColor    !== undefined ||
            markerPosition      !== undefined ||
            opts.markerWidth    !== undefined ||
            opts.schemePosition !== undefined ||
            opts.reverse        !== undefined ||
            opts.curve          !== undefined ||
            opts.brightness     !== undefined ||
            opts.beat           !== undefined;

        if (typeof ref === 'function') {
            var capturedOpts = opts;
            var capturedBase = base;
            var capturedRef = ref;
            var warnedNull = false;

            if (!hasOverride) {
                return function() {
                    var v = capturedRef.call(this);
                    if ((v === undefined || v === null) && !warnedNull) {
                        warnedNull = true;
                        XoneK3._warnOnce('composeSchemeFnNull:' + XoneK3._funcId(capturedRef),
                            'composeScheme: scheme function returned ' +
                            (v === null ? 'null' : 'undefined') +
                            ' — LED will stay dark until it returns a usable ref');
                    }
                    return v;
                };
            }

            return function() {
                var inner = capturedRef.call(this);
                if (inner === undefined || inner === null) {
                    if (!warnedNull) {
                        warnedNull = true;
                        XoneK3._warnOnce('composeSchemeFnNull:' + XoneK3._funcId(capturedRef),
                            'composeScheme: scheme function returned ' +
                            (inner === null ? 'null' : 'undefined') +
                            ' — LED will stay dark until it returns a usable ref');
                    }
                    return null;
                }
                return XoneK3.builders.composeScheme(
                    Object.assign({}, capturedOpts, { scheme: inner }),
                    capturedBase);
            };
        }

        if (typeof ref === 'string' && !hasOverride) return ref;

        var resolved;
        if (typeof ref === 'string') {
            var reg = XoneK3.SCHEMES[ref];
            if (!reg) {
                XoneK3._warnOnce('composeSchemeMissing:' + ref,
                    'composeScheme: scheme "' + ref + '" not found');
                return null;
            }
            resolved = Object.assign({}, reg);
        } else if (typeof ref === 'object' && !Array.isArray(ref)) {
            if (ref.patch) {
                XoneK3._warnOnce('composeSchemePatch:' + JSON.stringify(ref).slice(0, 60),
                    'composeScheme: scheme patches are no longer supported — ' +
                    'pass a plain scheme object or a name plus inline overrides. ' +
                    'Got: ' + JSON.stringify(ref).slice(0, 120));
                return null;
            }
            resolved = Object.assign({}, ref);
        } else {
            return null;
        }

        if (opts.markerColor    !== undefined) resolved.markerColor    = opts.markerColor;
        if (markerPosition      !== undefined) resolved.markerPosition = markerPosition;
        if (opts.markerWidth    !== undefined) resolved.markerWidth    = opts.markerWidth;
        if (opts.schemePosition !== undefined) resolved.schemePosition = opts.schemePosition;
        if (opts.reverse        !== undefined) resolved.reverse        = opts.reverse;
        if (opts.curve          !== undefined) resolved.curve          = opts.curve;
        if (opts.brightness     !== undefined) resolved.brightness     = opts.brightness;
        if (opts.beat           !== undefined) resolved.beat           = opts.beat;

        return resolved;
    };

    XoneK3.builders.marker = function(v) {
        if (v === undefined) return undefined;
        if (v === 'low')  return 0;
        if (v === 'mid')  return 63.5;
        if (v === 'high') return 127;
        return v;
    };

    XoneK3.builders.ledTrackButton = function(knob, scheme, state, marker, schemePosition) {
        var opts = { scheme: scheme };
        if (marker !== undefined) opts.marker = marker;
        if (schemePosition !== undefined) opts.schemePosition = schemePosition;
        var cs = { knob: knob, scheme: XoneK3.builders.composeScheme(opts) };
        if (state === 'on') cs.on = true;
        return { colorScheme: cs };
    };

    XoneK3.builders.eqKnob = function(deck, band) {
        return {
            group: '[EqualizerRack1_' + deck + '_Effect1]',
            inKey: 'parameter' + EQ_BANDS[band]
        };
    };
    
    XoneK3.builders.fxUnitKnob = function(unit, key) {
        return {
            group: '[EffectRack1_EffectUnit' + unit + ']',
            inKey: key
        };
    };

    XoneK3.builders.fxKnob = function(unit, effect, param) {
        return {
            group: '[EffectRack1_EffectUnit' + unit + '_Effect' + effect + ']',
            inKey: (param === 'meta') ? 'meta' : ('parameter' + param)
        };
    };

    XoneK3.builders.fxEnabled = function(unit, effect, opts) {
        opts = opts || {};
        if (opts.scheme === undefined && opts.schemeFromState === undefined) {
            print('[k3] fxEnabled unit=' + unit + ' effect=' + effect +
                ' missing scheme — pass scheme: \'catFX\' (or similar)');
        }
        return {
            group: '[EffectRack1_EffectUnit' + unit + '_Effect' + effect + ']',
            inKey: 'enabled', outKey: 'enabled',
            colorScheme: XoneK3.builders._fxCs(opts)
        };
    };

    XoneK3.builders.fxButton = function(unit, effect, param, opts) {
        opts = opts || {};
        if (opts.scheme === undefined && opts.schemeFromState === undefined) {
            print('[k3] fxButton unit=' + unit + ' effect=' + effect +
                  ' param=' + param + ' missing scheme — pass scheme: \'catFX\' (or similar)');
        }
        var key = 'button_parameter' + param;
        return {
            group: '[EffectRack1_EffectUnit' + unit + '_Effect' + effect + ']',
            inKey: key, outKey: key,
            colorScheme: XoneK3.builders._fxCs(opts)
        };
    };

    XoneK3.builders.fxHeadphone = function(unit, opts) {
        opts = opts || {};
        if (opts.scheme === undefined && opts.schemeFromState === undefined) {
            print('[k3] fxHeadphone unit=' + unit +
                  ' missing scheme — pass scheme: \'catFX\' (or similar)');
        }
        return {
            group: '[EffectRack1_EffectUnit' + unit + ']',
            inKey: 'group_[Headphone]_enable',
            outKey: 'group_[Headphone]_enable',
            colorScheme: XoneK3.builders._fxCs(opts)
        };
    };

    XoneK3.builders.fxGroupEnable = function(unit, deck, opts) {
        opts = opts || {};
        if (opts.scheme === undefined && opts.schemeFromState === undefined) {
            print('[k3] fxGroupEnable unit=' + unit + ' deck=' + deck +
                  ' missing scheme — pass scheme: \'catFX\' (or similar)');
        }
        var key = 'group_' + deck + '_enable';
        return {
            group: '[EffectRack1_EffectUnit' + unit + ']',
            inKey: key, outKey: key,
            colorScheme: XoneK3.builders._fxCs(opts)
        };
    };

    XoneK3.builders.fxMix = function(unit) {
        return {
            group: '[EffectRack1_EffectUnit' + unit + ']',
            inKey: 'mix'
        };
    };

    XoneK3.builders.qfxKnob = function(deck) {
        return {
            group: '[QuickEffectRack1_' + deck + ']',
            inKey: 'super1'
        };
    };

    // ============================================================
    // FUNCS
    // ============================================================
    XoneK3.FUNCS = {
        // ----------------------------------------------------------
        // Select / focus
        // ----------------------------------------------------------
        k3Select: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            var kind = args[0], which = args[1], val = parseInt(args[2], 10);
            if (isNaN(val)) return;
            var ctrl = this._ctrl;
            if (kind === 'deck' && ctrl.loadState.pressed) {
                engine.setValue('[Channel' + val + ']', 'LoadSelectedTrack', 1);
            } else {
                ctrl.setSelectedFor(kind, which, val);
            }
        },
        k3SelectActive: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            var kind = args[0];
            var val  = parseInt(args[1], 10);
            if (isNaN(val)) return;
            var ctrl = this._ctrl;
            if (kind === 'deck' && ctrl.loadState.pressed) {
                engine.setValue('[Channel' + val + ']', 'LoadSelectedTrack', 1);
                return;
            }
            var slot = (kind === 'fx') ? ctrl.activeFx : ctrl.activeDeck;
            ctrl.setSelectedFor(kind, slot, val);
        },
        setActiveFxTo: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            this._ctrl.setActiveFx(args[0]);
        },
        toggleActiveFx: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            this._ctrl.setActiveFx(this._ctrl.activeFx === 'A' ? 'B' : 'A');
        },
        setActiveDeckTo: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            var ctrl = this._ctrl;
            var which = args[0];
            if (which !== 'A' && which !== 'B') return;
            if (ctrl.loadState.pressed) {
                // pressR is held on the cue layer: load the selected
                // track onto whichever channel this slot is currently
                // pinned to, instead of flipping focus. Slot A's
                // channel is selectedDeckA; slot B's is selectedDeckB.
                var channel = (which === 'A') ? ctrl.selectedDeckA : ctrl.selectedDeckB;
                engine.setValue('[Channel' + channel + ']', 'LoadSelectedTrack', 1);
                return;
            }
            ctrl.setActiveDeck(which);
        },
        toggleActiveDeck: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            this._ctrl.setActiveDeck(this._ctrl.activeDeck === 'A' ? 'B' : 'A');
        },

        // ----------------------------------------------------------
        // Shift / layer / chord
        // ----------------------------------------------------------
        shiftToggle: function(args, ch, c, v, s) {
            this._ctrl.onShiftButton(v, s);
        },
        layerButton: function(args, ch, c, v, s) {
            var ctrl = this._ctrl;
            var pressed = ctrl._isPress(v, s);
            if (pressed && ctrl.isShifted) {
                ctrl._enterChord();
                return;
            }
            if (!pressed && ctrl._chordActive) {
                ctrl._exitChord();
                return;
            }
            if (!pressed) return;
            ctrl.replacePatch(args[0], args[1]);
        },

        // ----------------------------------------------------------
        // Overlays
        // ----------------------------------------------------------
        toggleOverlay: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            var name = args[0];
            if (!name) return;
            var ctrl = this._ctrl;
            if (ctrl.activePatches.indexOf(name) !== -1) {
                ctrl._batchPatches(function(patches) {
                    var idx = patches.indexOf(name);
                    if (idx !== -1) patches.splice(idx, 1);
                });
                XoneK3.debugPrint('overlayOff', { name: name });
                return;
            }
            var siblings = Array.isArray(args[1]) ? args[1] : [];
            ctrl._batchPatches(function(patches) {
                if (siblings.length > 0) {
                    for (var i = patches.length - 1; i >= 0; i--) {
                        if (patches[i] !== name && siblings.indexOf(patches[i]) !== -1) {
                            patches.splice(i, 1);
                        }
                    }
                }
                patches.push(name);
            });
            XoneK3.debugPrint('overlayOn', { name: name });
        },
        layerExitOverlay: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            this._ctrl.removePatch(args[0]);
        },

        // ----------------------------------------------------------
        // Top-half mode swap
        // ----------------------------------------------------------
        // Focus ↔ twoDeck family. From mini goes to focus directly.
        toggleTopMode: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            var mode = this._ctrl.currentTopMode();
            if (mode === 'focus') this._ctrl.setTopMode('twoDeck');
            else                  this._ctrl.setTopMode('focus');
        },
        // twoDeck ↔ mini. No-op from focus.
        toggleMiniFx: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            var mode = this._ctrl.currentTopMode();
            if      (mode === 'twoDeck')     this._ctrl.setTopMode('twoDeckMini');
            else if (mode === 'twoDeckMini') this._ctrl.setTopMode('twoDeck');
            // focus: no-op
        },

        // ----------------------------------------------------------
        // Track load
        // ----------------------------------------------------------
        loadSelectedTrack: function(args, ch, c, v, s) {
            this._ctrl.loadState.pressed = this._ctrl._isPress(v, s);
        },

        // ----------------------------------------------------------
        // Encoders
        // ----------------------------------------------------------
        encPregainStep: function(args, ch, c, v, s) {
            var dir = (v === 1) ? 1 : -1;
            var step = XoneK3.parseNum(args[0]); if (isNaN(step)) step = 0.025;
            engine.setValue(this.group, this.inKey,
                engine.getValue(this.group, this.inKey) + dir * step);
        },
        encBpmPressedHeadMix: function(args, ch, c, v, s) {
            var dir = (v === 1) ? 1 : -1;
            if (this.pressHeld) {
                this.turnHappened = true;
                engine.setValue('[Master]', 'headMix',
                    engine.getValue('[Master]', 'headMix') + dir * 0.05);
            } else {
                engine.setValue(this.group, this.inKey,
                    engine.getValue(this.group, this.inKey) + dir * 0.1);
            }
        },
        encPlaylistNav: function(args, ch, c, v, s) {
            engine.setValue('[Playlist]',
                (v === 1) ? 'SelectNextTrack' : 'SelectPrevTrack', 1);
        },
        encQuickFxCycle: function(args, ch, c, v, s) {
            var grp = this.group;
            var len = XoneK3.QFX_CHAIN_LIST.length;
            var cur = Math.floor(engine.getValue(grp, 'loaded_chain_preset'));
            if (cur < 0) cur = 0;                       // -1 = unsaved preset
            var next = (cur + (v === 1 ? 1 : -1) + len) % len;
            engine.setValue(grp, 'loaded_chain_preset', next);
        },
        encKeyShift: function(args, ch, c, v, s) {
            engine.setValue(this.group, 'pitch_adjust',
                engine.getValue(this.group, 'pitch_adjust') + ((v === 1) ? 1 : -1));
        },
        encKeySyncReset: function(args, ch, c, v, s) {
            var dir = (v === 1) ? 1 : -1;
            if (dir > 0) engine.setValue(this.group, 'sync_key', 1);
            else engine.setValue(this.group, 'reset_key', 1);
        },
        // Any-direction key sync — pulses sync_key on every turn
        // event, CW or CCW. Same CO as the CW half of
        // encKeySyncReset.
        encKeySync: function(args, ch, c, v, s) {
            engine.setValue(this.group, 'sync_key', 1);
        },
        // Any-direction key reset — pulses reset_key on every turn
        // event. Same CO as the CCW half of encKeySyncReset.
        encKeyReset: function(args, ch, c, v, s) {
            engine.setValue(this.group, 'reset_key', 1);
        },
        encStepParam: function(args, ch, c, v, s) {
            var group = args[0], key = args[1];
            if (!group || !key) return;
            var dir = (v === 1) ? 1 : -1;
            var step = XoneK3.parseNum(args[2]); if (isNaN(step)) step = 0.02;
            var cur = engine.getParameter(group, key);
            engine.setParameter(group, key, Math.max(0, Math.min(1, cur + dir * step)));
        },

        // ----------------------------------------------------------
        // Loop movement — rate class 'jump'
        // ----------------------------------------------------------
        // Rate gating is external (Binding.input with inferred
        // 'jump'). Func just fires the pulse.
        // K3 encoder convention: v === 1 is CW (right turn). Right
        // turn → beatjump_forward.
        encBeatjump: function(args, ch, c, v, s) {
            var cw = (v === 1);
            var co = cw ? 'beatjump_forward' : 'beatjump_backward';
            this._ctrl._pulseCo(this.group, co);
        },
        beatjumpButton: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            this._ctrl._pulseCo(this.group, args[0]);
        },
        reloopToggleResetAnchor: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            engine.setValue(this.group, 'loop_anchor', 0);
            // Mark as a deliberate loop-off so the escape detector
            // doesn't log a false positive.
            this._ctrl._pulseCo(this.group, 'reloop_toggle',
                                { deliberateLoopOff: true });
        },
        beatloopActivateResetAnchor: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            engine.setValue(this.group, 'loop_anchor', 0);
            // Mark as a deliberate loop-off so the escape detector
            // doesn't log a false positive.
            this._ctrl._pulseCo(this.group, 'beatloop_activate',
                                { deliberateLoopOff: true });
        },

        // Single-boundary move. Rate gating is external.
        //
        // args: [anchor, step]
        //   anchor  'in'  — pin the in-point; the OUT-point moves
        //           'out' — pin the out-point; the IN-point moves
        //   step    base step in loop fraction
        //
        // "anchor" names the side that stays put, not the side
        // that moves. Setting loop_anchor before the write is what
        // makes the write move the opposite boundary.
        encLoopMove: function(args, ch, c, v, s) {
            var inSide = (args[0] === 'in');
            var step = XoneK3.parseNum(args[1]); if (isNaN(step)) step = 0.010;
            var dir = (v === 1) ? -1 : 1;
            var sign = inSide ? 1 : -1;
            var wantAnchor = inSide ? 1 : 0;
            if (engine.getValue(this.group, 'loop_anchor') !== wantAnchor)
                engine.setValue(this.group, 'loop_anchor', wantAnchor);
            engine.setValue(this.group, this.inKey,
                engine.getValue(this.group, this.inKey) + sign * dir * step);
        },
        
        // Self-accelerating loop-boundary move. Rate gating is
        // still external (the binding is class 'edit'), so the
        // event window records only accepted events — the
        // multiplier reflects accepted spin rate, not raw
        // physical rate.
        //
        // args: [anchor, step, cap, divisor]
        //   anchor  'in'  — pin the in-point; the OUT-point moves
        //           'out' — pin the out-point; the IN-point moves
        //   step        base step in loop fraction
        //   cap         maximum step multiplier (default 6)
        //   divisor     events/sec per multiplier step (default 12)
        //
        // Window length is XoneK3.ENC_LOOP_ACCEL_WINDOW_MS.
        //
        // K3 encoders top out around 40–80 Hz on a hard spin.
        // divisor 12 reaches 2x at a normal fast turn, 6x on a
        // hard spin.
        encLoopMoveAccel: function(args, ch, c, v, s) {
            var now = Date.now();

            var inSide  = (args[0] === 'in');
            var step    = XoneK3.parseNum(args[1]); if (isNaN(step)) step = 0.010;
            var cap     = XoneK3.parseNum(args[2]); if (isNaN(cap) || cap < 1) cap = 6;
            var divisor = XoneK3.parseNum(args[3]); if (isNaN(divisor) || divisor < 1) divisor = 12;

            var ev = this._loopAccelEvents;
            ev.push(now);
            var windowMs = XoneK3.ENC_LOOP_ACCEL_WINDOW_MS;
            while (ev.length > 0 && ev[0] < now - windowMs) ev.shift();
            var rate = ev.length * 1000 / windowMs;   // events per second
            var mult = Math.max(1, Math.min(cap, Math.round(rate / divisor)));

            var dir = (v === 1) ? -1 : 1;
            var sign = inSide ? 1 : -1;
            var wantAnchor = inSide ? 1 : 0;

            if (engine.getValue(this.group, 'loop_anchor') !== wantAnchor)
                engine.setValue(this.group, 'loop_anchor', wantAnchor);
            engine.setValue(this.group, this.inKey,
                engine.getValue(this.group, this.inKey) + sign * dir * step * mult);
        },

        // ----------------------------------------------------------
        // Loop size setting — rate class 'edit' or 'claim' by inKey
        // ----------------------------------------------------------
        pressSetValue: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            engine.setValue(this.group, this.inKey, XoneK3.parseNum(args[0]));
        },
        // Rate class 'claim' — changes the size used by the next
        // jump, doesn't move anything itself.
        encBeatjumpStepScale: function(args, ch, c, v, s) {
            var min = XoneK3.parseNum(args[0]); if (isNaN(min)) min = XoneK3.BEATJUMP_MIN;
            var max = XoneK3.parseNum(args[1]); if (isNaN(max)) max = XoneK3.BEATJUMP_MAX;
            var forward = (v === 1) ? -1 : 1;
            var cur = engine.getValue(this.group, 'beatjump_size');
            if (forward > 0) { if (cur <= min) return; engine.setValue(this.group, 'beatjump_size_halve', 1); }
            else { if (cur >= max) return; engine.setValue(this.group, 'beatjump_size_double', 1); }
        },

        // ----------------------------------------------------------
        // BPM tap
        // ----------------------------------------------------------
        bpmPress: function(args, ch, c, v, s) {
            var enc = args[0] && this._ctrl.bindings[args[0]];
            if (!enc) return;
            if (this._ctrl._isPress(v, s)) {
                enc.pressHeld = true;
                enc.turnHappened = false;
            } else {
                if (this._ctrl.isShifted && !enc.turnHappened) {
                    var cur = engine.getValue('[Master]', 'headSplit');
                    engine.setValue('[Master]', 'headSplit', cur ? 0 : 1);
                }
                enc.pressHeld = false;
            }
        },

        // ----------------------------------------------------------
        // Shutdown
        // ----------------------------------------------------------
        shutdownHold: function(args, ch, c, v, s) {
            if (this._ctrl._shuttingDown) return;
            var self = this;
            if (this._ctrl._isPress(v, s)) {
                if (self._shutdownHoldTimer) {
                    engine.stopTimer(self._shutdownHoldTimer);
                    self._shutdownHoldTimer = null;
                }
                self._shutdownHoldTimer = engine.beginTimer(2000, function() {
                    self._shutdownHoldTimer = null;
                    print('Xone K3: user shutdown');
                    self._ctrl.shutdown();
                }, true);
            } else {
                if (self._shutdownHoldTimer) {
                    engine.stopTimer(self._shutdownHoldTimer);
                    self._shutdownHoldTimer = null;
                }
            }
        },

        // ----------------------------------------------------------
        // Phrase origin
        // ----------------------------------------------------------
        setPhraseOriginHere: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            var chNum = this._ctrl._channelOf(this.group);
            if (!chNum) return;
            var pos = engine.getValue(this.group, 'playposition');
            this._ctrl._setPhraseOriginAt(chNum, pos);
        },
        hotcueWithPhraseCheck: function(args, ch, c, v, s) {
            var n = args[0];
            if (!n) return;
            if (this._ctrl._isPress(v, s)) {
                engine.setValue(this.group, this.inKey, 1);

                var color = engine.getValue(this.group, 'hotcue_' + n + '_color');
                if (!this._ctrl._isPhraseColor(color)) return;

                var chNum = this._ctrl._channelOf(this.group);
                if (!chNum) return;

                var samples = engine.getValue(this.group, 'track_samples');
                if (!(samples > 0)) return;

                var hotcueSamples = engine.getValue(this.group, 'hotcue_' + n + '_position');
                var pos = hotcueSamples / samples;
                this._ctrl._setPhraseOriginAt(chNum, pos, { rawPos: true });
            } else {
                engine.setValue(this.group, this.inKey, 0);
            }
        },

        // ----------------------------------------------------------
        // Timelines
        // ----------------------------------------------------------
        // Two readings: track and loop. Toggles the active deck's
        // display between them. No-op when the loop clock isn't
        // running — track is the only reading then. Manual choice
        // sticks until the next start / stop event re-resolves.
        cycleDisplaySource: function(args, ch, c, v, s) {
            if (!this._ctrl._isPress(v, s)) return;
            var chNum = this._ctrl._channelOf(this.group);
            if (!chNum) return;
            var ctrl = this._ctrl;
            var st = ctrl._decks[chNum];

            if (!st.loopClock.running) return;

            st.displaySource = (st.displaySource === 'loop') ? 'track' : 'loop';
            if (ctrl.selectedDeckCurrent === chNum) {
                ctrl._refreshDisplayFlags();
            }
            ctrl._syncBeatCount(chNum);
            // Flag-reading LEDs (grid2_0 on activeDeckVirtual, grid3_1 on
            // activeDisplaySource) have no CO connection — they only
            // repaint on a recompute or an explicit refresh. Repaint now
            // so the toggle reads as instant.
            ctrl._refreshAllLeds('display-cycle');
        }
    };
})();