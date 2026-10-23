// xone-k3-lib-controller-colour.js — colour-scheme parser for
// K3Controller: on: shapes, base scheme resolution, schemeFromState
// closures, and the whole _setupColorScheme entry point.
//
// Loaded after lib-controller.js and before lib-controller-beat.js.
// Extends K3Controller.prototype. The render-time half of scheme
// compilation (_resolveSchemeRef) stays in lib-controller.js;
// this file is the parse half, run once per bind.
//
// Every function here is called from _applyBinding.

'use strict';

(function() {
    if (typeof XoneK3 === 'undefined') {
        throw new Error('Xone K3: xone-k3-lib-controller-colour.js — xone-k3-lib-core.js must load first');
    }
    if (typeof XoneK3._requireLoad !== 'function') {
        throw new Error('Xone K3: xone-k3-lib-controller-colour.js — xone-k3-lib-core.js must load first');
    }
    XoneK3._requireLoad('xone-k3-lib-controller-colour.js',
        ['K3Controller', 'resolve', '_warnOnce']);

    // ============================================================
    // on: PARSING
    // ============================================================
    XoneK3.K3Controller.prototype._parseCsOn = function(b, cs) {
        if (cs.on === undefined || cs.on === null) return;
        // on is true, false, or a conditional object. true / false
        // are the unconditional forms; the object carries a condition.
        if (cs.on === true)  { b._csOn = true;  return; }
        if (cs.on === false) { b._csOn = false; return; }
        if (typeof cs.on !== 'object' || Array.isArray(cs.on)) {
            XoneK3._warnOnce('csOnShape:' + b._name,
                'colorScheme.on must be true, false, or a conditional object on ' + b._name +
                ' — got ' + (Array.isArray(cs.on) ? 'array' : typeof cs.on));
            return;
        }

        // Known on: fields — anything else is warned and ignored.
        var KNOWN_ON = ['patchActive', 'state', 'equals', 'contains', 'co', 'group'];

        var o = {};
        if (cs.on.patchActive !== undefined) o.patchActive = cs.on.patchActive;
        if (cs.on.state       !== undefined) o.state = cs.on.state;
        if (cs.on.equals      !== undefined) o.equals = cs.on.equals;
        if (cs.on.contains    !== undefined) o.contains = cs.on.contains;
        if (cs.on.co !== undefined) {
            var g = cs.on.group ? XoneK3.resolve(cs.on.group, this) : b.group;
            if (!g) {
                XoneK3._warnOnce('csOnCoGroup:' + b._name,
                    'colorScheme.on.co on ' + b._name +
                    ' has no group and the binding has no group either');
                return;
            }
            o.co = cs.on.co;
            o.group = g;
        }
        for (var k in cs.on) {
            if (!cs.on.hasOwnProperty(k)) continue;
            if (KNOWN_ON.indexOf(k) === -1) {
                XoneK3._warnOnce('csOnUnknown:' + b._name + ':' + k,
                    'colorScheme.on on ' + b._name +
                    ' has unknown field "' + k + '" — ignored');
            }
        }
        if (Object.keys(o).length === 0) {
            XoneK3._warnOnce('csOnEmpty:' + b._name,
                'colorScheme.on has no recognised fields on ' + b._name +
                ' — LED will stay dark.');
            return;
        }

        if (o.co && o.group) {
            b._conns.push(engine.makeConnection(o.group, o.co, function() {
                b._refresh();
            }));
        }

        b._csOn = o;
    };

    // ============================================================
    // BASE SCHEME
    // ============================================================
    // Parse the base-scheme half of a colorScheme. Sets b._csScheme
    // and/or b._csSchemeFn. Called from _parseCsScheme.
    XoneK3.K3Controller.prototype._parseSchemeValue = function(b, cs) {
        var hasBase = cs.scheme !== undefined && cs.scheme !== null;
        var schemeIsFn = (typeof cs.scheme === 'function');
        if (!hasBase) return { hasBase: false, schemeIsFn: false };

        if (!schemeIsFn) {
            var comp = this._resolveSchemeRef(cs.scheme);
            if (!comp) {
                XoneK3._warnOnce('csUnresolved:' + b._name,
                    'colorScheme: cannot resolve scheme for ' + b._name +
                    ' — ' + String(JSON.stringify(cs.scheme)).slice(0, 120));
                b._csFailed = true;
                return { hasBase: true, schemeIsFn: false };
            }
            b._csScheme = comp;
        }
        return { hasBase: true, schemeIsFn: schemeIsFn };
    };

    // ============================================================
    // schemeFromState
    // ============================================================
    // Parse schemeFromState. Sets b._csSchemeFn when a closure is
    // built. Called from _parseCsScheme.
    XoneK3.K3Controller.prototype._parseSchemeFromState = function(b, cs, schemeIsFn) {
        var sf = cs.schemeFromState;
        if (!sf || typeof sf !== 'object' || Array.isArray(sf)) return false;

        if (schemeIsFn) {
            XoneK3._warnOnce('csDoubleDynamic:' + b._name,
                'colorScheme on ' + b._name +
                ' has both schemeFromState and scheme: function' +
                ' — using schemeFromState');
        }
        var closure = this._buildCsFromStateClosure(b, sf);
        if (closure) b._csSchemeFn = closure;
        return true;
    };

    XoneK3.K3Controller.prototype._parseCsScheme = function(b, cs) {
        var hasBase = cs.scheme !== undefined && cs.scheme !== null;
        var fromState = cs.schemeFromState;
        var hasFromState = fromState && typeof fromState === 'object' &&
                        !Array.isArray(fromState);

        if (!hasBase && !hasFromState) {
            XoneK3._warnOnce('csMissing:' + b._name,
                'colorScheme: missing scheme for ' + b._name +
                (cs.knob !== undefined ? ' (deviation)' : '') +
                " — pass scheme: 'name' or a colour spec, or schemeFromState");
            b._csFailed = true;
            return;
        }

        b._csDeviation = (cs.knob !== undefined);

        var baseResult = this._parseSchemeValue(b, cs);
        if (b._csFailed) return;

        if (hasFromState) {
            this._parseSchemeFromState(b, cs, baseResult.schemeIsFn);
        } else if (baseResult.schemeIsFn) {
            b._csSchemeFn = cs.scheme;
        }

        if (cs.knob === undefined) return;
        var knob = this.bindings[cs.knob];
        if (!knob) {
            XoneK3._warnOnce('csKnobMissing:' + b._name,
                'colorScheme: knob "' + cs.knob + '" not found for ' + b._name);
            b._csFailed = true;
            return;
        }
        b._csKnob = knob;
        knob.addObserver(b);
    };

    XoneK3.K3Controller.prototype._buildCsFromStateClosure = function(b, sf) {
        var sd = {};

        if (sf.state && sf.co) {
            XoneK3._warnOnce('csFsBoth:' + b._name,
                'colorScheme.schemeFromState on ' + b._name +
                ' has both state and co — using state, ignoring co');
        }
        if (sf.state) sd.state = sf.state;
        else if (sf.co) {
            sd.co = XoneK3.resolve(sf.co, this);
            sd.group = sf.group ? XoneK3.resolve(sf.group, this) : b.group;
        }
        if (sf.map) sd.map = sf.map;
        else if (sf.list) sd.list = sf.list.slice();
        if (!sd.state && !sd.co) {
            XoneK3._warnOnce('csFsEmpty:' + b._name,
                'colorScheme.schemeFromState on ' + b._name +
                ' has neither state nor co — LED will stay dark');
            return null;
        }

        if (sd.co && sd.group) {
            b._csFromStateConn = engine.makeConnection(sd.group, sd.co,
                function() { b._refresh(); });
        }

        var ctrl = this;
        return function() {
            var stateVal;
            if (sd.co) stateVal = engine.getValue(sd.group, sd.co);
            else       stateVal = XoneK3.readPath(ctrl, sd.state);

            var entryRef;
            if (sd.map) {
                entryRef = sd.map[stateVal];
            } else if (sd.list) {
                var sidx = Math.floor(stateVal);
                if (!isFinite(sidx)) sidx = 0;
                if (sidx < 0) sidx = 0;
                if (sidx >= sd.list.length) sidx = sd.list.length - 1;
                entryRef = sd.list[sidx];
            }

            if (typeof entryRef === 'function') entryRef = entryRef();
            return entryRef;
        };
    };

    // ============================================================
    // SETUP ENTRY POINT
    // ============================================================
    XoneK3.K3Controller.prototype._setupColorScheme = function(b, cs) {
        if (!cs || typeof cs !== 'object' || Array.isArray(cs)) {
            print('[k3] colorScheme must be an object on ' + b._name +
                ' — got ' + (cs === null ? 'null' : typeof cs));
            b._csActive = false;
            return;
        }
        b._csActive = true;
        b._csFailed = false;
        b._csDeviation = false;
        b._csScheme = null;
        b._csSchemeFn = null;
        b._csOn = null;
        this._parseCsOn(b, cs);
        this._parseCsScheme(b, cs);
    };
})();