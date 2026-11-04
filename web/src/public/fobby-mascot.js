// Interactive Fobby symbol. The tag is the left eye, the document the right eye, the bar the mouth.
// Zero dependencies. Usage: const m = FobbyMascot.mount(el, { state: 'idle' }); m.set('thinking'); m.destroy();
(function (root) {
  'use strict';
  var BLUE = '#2456C9', WHITE = '#FFFFFF', NS = 'http://www.w3.org/2000/svg';

  // Same shapes as fobby-symbol.svg; the mouth rect (x 39..169, y 121..138, rx 8.5) is a round-capped 17px stroke.
  var SVG =
    '<svg xmlns="' + NS + '" viewBox="-20 -44 256 262" role="img" aria-label="Fobby">' +
    '<g data-z fill="none" stroke="' + BLUE + '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity="0">' +
    '<path d="M196 -6h14l-14 16h14"/><path d="M216 -30h10l-10 12h10"/></g>' +
    '<g data-body>' +
    '<path fill="' + BLUE + '" d="M44 6H172A40 40 0 0 1 212 46V134Q212 150 200.8 162.8L167 201Q163 206 162.5 200C163 178 178 160 204 150H170A20 20 0 0 0 150 170V208C140 200 135 190 122 190H44A40 40 0 0 1 4 150V46A40 40 0 0 1 44 6Z"/>' +
    '<g transform="translate(4 0)">' +
    '<g data-tag><g data-tag-swing>' +
    '<path fill="' + WHITE + '" stroke="' + WHITE + '" stroke-width="8" stroke-linejoin="round" d="M69.7 48H82A10 10 0 0 1 92 58V70.3L63 99.3L40.7 77Z"/>' +
    '<circle cx="79" cy="61" r="6.5" fill="' + BLUE + '"/></g></g>' +
    '<g data-doc>' +
    '<path fill="' + WHITE + '" d="M121 43H145L169 67V98A9 9 0 0 1 160 107H121A9 9 0 0 1 112 98V52A9 9 0 0 1 121 43Z"/>' +
    '<path fill="' + BLUE + '" d="M143 56V74H161Z"/></g>' +
    '<path data-mouth fill="none" stroke="' + WHITE + '" stroke-width="17" stroke-linecap="round"/>' +
    '</g></g></svg>';

  var TAG = { x: 66, y: 74 }, HOLE = { x: 79, y: 61 }, DOC = { x: 140.5, y: 75 }, FOOT = { x: 108, y: 208 };
  var MOUTH_Y = 129.5;

  // Each state: target values for the springs, plus what happens when it starts.
  // open: eye openness, curve: mouth bend (+ smile, - frown), x1/x2: mouth ends, gaze: 'pointer' or fixed [x, y].
  var STATES = {
    idle:      { label: 'Fobby',              open: 1,    eye: 1,    x1: 47.5, x2: 160.5, curve: 0,   gaze: 'pointer' },
    happy:     { label: 'Fobby is happy',     open: 1,    eye: 1,    x1: 52,   x2: 156,   curve: 22,  gaze: 'pointer', hop: 40 },
    thinking:  { label: 'Fobby is thinking',  open: 1,    eye: 1,    x1: 100,  x2: 150,   curve: -3,  gaze: [-6, -7], rot: -3 },
    searching: { label: 'Fobby is searching', open: 1,    eye: 1,    x1: 72,   x2: 136,   curve: 0,   gaze: 'scan' },
    done:      { label: 'Fobby is done',      open: 1,    eye: 1,    x1: 50,   x2: 158,   curve: 28,  gaze: [0, -2], hop: 90, swing: 260 },
    surprised: { label: 'Fobby is surprised', open: 1,    eye: 1.14, x1: 102,  x2: 106,   curve: 0,   gaze: [0, -3], hop: 50 },
    error:     { label: 'Fobby hit a problem', open: 0.62, eye: 1,   x1: 64,   x2: 144,   curve: -18, gaze: [0, 3], shake: 420 },
    sleeping:  { label: 'Fobby is asleep',    open: 0.07, eye: 1,    x1: 88,   x2: 120,   curve: 0,   gaze: [0, 4] }
  };

  function spring(x, k, c) { return { x: x, v: 0, t: x, k: k || 170, c: c || 20 }; }
  function step(s, dt) { s.v += (s.k * (s.t - s.x) - s.c * s.v) * dt; s.x += s.v * dt; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function mount(el, opts) {
    opts = opts || {};
    el.innerHTML = SVG;
    var svg = el.querySelector('svg');
    var q = function (n) { return svg.querySelector('[data-' + n + ']'); };
    var body = q('body'), tag = q('tag'), swingEl = q('tag-swing'), doc = q('doc'), mouth = q('mouth'), zs = q('z');
    var reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var s = {
      gx: spring(0, 120, 16), gy: spring(0, 120, 16),
      open: spring(1, 260, 24), eye: spring(1, 220, 14),
      x1: spring(47.5), x2: spring(160.5), curve: spring(0, 200, 16),
      hop: spring(0, 260, 14), sx: spring(1, 300, 12), rot: spring(0, 120, 14),
      shake: spring(0, 500, 9), swing: spring(0, 90, 5), z: spring(0, 60, 14)
    };
    var state = 'idle', cfg = STATES.idle, pointer = null, hover = false;
    var t0 = performance.now(), last = t0, nextBlink = t0 + 1500, blinkAt = -1;
    var sleepAfter = opts.sleepAfter === undefined ? 30000 : opts.sleepAfter, lastActive = t0, raf = 0;

    function impulse(spr, v) { if (!reduce) spr.v += v; }

    function set(name) {
      if (!STATES[name]) name = 'idle';
      state = name; cfg = STATES[name];
      svg.setAttribute('aria-label', cfg.label);
      s.open.t = cfg.open; s.eye.t = cfg.eye; s.x1.t = cfg.x1; s.x2.t = cfg.x2; s.curve.t = cfg.curve;
      s.rot.t = cfg.rot || 0; s.z.t = name === 'sleeping' ? 1 : 0;
      if (cfg.hop) { impulse(s.hop, -cfg.hop * 9); impulse(s.sx, cfg.hop / 30); }
      if (cfg.shake) impulse(s.shake, cfg.shake);
      if (cfg.swing) impulse(s.swing, cfg.swing);
      if (name !== 'sleeping') lastActive = performance.now();
      if (opts.onChange) opts.onChange(name);
    }

    function onMove(e) {
      pointer = { x: e.clientX, y: e.clientY };
      lastActive = performance.now();
      if (state === 'sleeping' && opts.wakeOnMove !== false) { set('surprised'); setTimeout(function () { if (state === 'surprised') set('idle'); }, 900); }
    }
    function onEnter() { hover = true; if (state === 'idle') s.curve.t = 12; }
    function onLeave() { hover = false; if (state === 'idle') s.curve.t = 0; }
    function onPoke() {
      lastActive = performance.now();
      impulse(s.sx, 3); impulse(s.swing, 160); blinkAt = performance.now();
      if (state === 'idle' || state === 'sleeping') { set('happy'); setTimeout(function () { if (state === 'happy') set('idle'); }, 1200); }
    }
    function onKey(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPoke(); } }

    root.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('click', onPoke);
    el.addEventListener('keydown', onKey);
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');

    function frame(now) {
      raf = root.requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, 1 / 30), t = (now - t0) / 1000;
      last = now;

      if (sleepAfter && state === 'idle' && now - lastActive > sleepAfter) set('sleeping');

      // Gaze target
      if (cfg.gaze === 'pointer' && pointer) {
        var r = svg.getBoundingClientRect();
        var dx = pointer.x - (r.left + r.width / 2), dy = pointer.y - (r.top + r.height / 2);
        var d = Math.sqrt(dx * dx + dy * dy) || 1, m = Math.min(d / 260, 1) * 7;
        s.gx.t = dx / d * m; s.gy.t = dy / d * m;
      } else if (cfg.gaze === 'scan') {
        s.gx.t = reduce ? 0 : Math.sin(t * 2.4) * 7; s.gy.t = 1;
      } else if (Array.isArray(cfg.gaze)) {
        s.gx.t = cfg.gaze[0]; s.gy.t = cfg.gaze[1];
      }

      // Blink: close in 70ms, open in 130ms, every 2.5-6s while awake
      if (state !== 'sleeping' && now > nextBlink) { blinkAt = now; nextBlink = now + 2500 + Math.random() * 3500; }
      var b = blinkAt < 0 ? 1 : (now - blinkAt) / 200, blink = 1;
      if (b < 1) blink = b < 0.35 ? 1 - b / 0.35 * 0.92 : 0.08 + (b - 0.35) / 0.65 * 0.92;

      for (var k in s) step(s[k], dt);

      var breathe = state === 'sleeping' && !reduce ? Math.sin(t * 1.6) * 0.025 : 0;
      var sx = clamp(s.sx.x, 0.8, 1.25), sy = 1 / sx + breathe;
      body.setAttribute('transform',
        'translate(' + s.shake.x.toFixed(2) + ' ' + s.hop.x.toFixed(2) + ') ' +
        'translate(' + FOOT.x + ' ' + FOOT.y + ') rotate(' + s.rot.x.toFixed(2) + ') scale(' + sx.toFixed(3) + ' ' + sy.toFixed(3) + ') translate(' + -FOOT.x + ' ' + -FOOT.y + ')');

      var open = clamp(s.open.x * blink, 0.05, 1.2), e = s.eye.x;
      var eyeT = function (c) {
        return 'translate(' + (s.gx.x + c.x).toFixed(2) + ' ' + (s.gy.x + c.y).toFixed(2) + ') scale(' + e.toFixed(3) + ' ' + (e * open).toFixed(3) + ') translate(' + -c.x + ' ' + -c.y + ')';
      };
      tag.setAttribute('transform', eyeT(TAG));
      doc.setAttribute('transform', eyeT(DOC));
      swingEl.setAttribute('transform', 'rotate(' + clamp(s.swing.x / 10, -25, 25).toFixed(2) + ' ' + HOLE.x + ' ' + HOLE.y + ')');

      // Mouth follows the gaze a little, ends never cross
      var mx = s.gx.x * 0.4, my = MOUTH_Y + s.gy.x * 0.3;
      var x1 = s.x1.x + mx, x2 = Math.max(s.x2.x + mx, x1 + 0.1), c = s.curve.x;
      mouth.setAttribute('d', 'M' + x1.toFixed(2) + ' ' + (my - c * 0.15).toFixed(2) + 'Q' + ((x1 + x2) / 2).toFixed(2) + ' ' + (my + c).toFixed(2) + ' ' + x2.toFixed(2) + ' ' + (my - c * 0.15).toFixed(2));

      zs.setAttribute('opacity', clamp(s.z.x, 0, 1).toFixed(2));
      zs.setAttribute('transform', 'translate(0 ' + (reduce ? 0 : -((t * 8) % 10)).toFixed(2) + ')');
    }

    set(opts.state || 'idle');
    raf = root.requestAnimationFrame(frame);

    return {
      set: set,
      get state() { return state; },
      states: Object.keys(STATES),
      destroy: function () {
        root.cancelAnimationFrame(raf);
        root.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerenter', onEnter);
        el.removeEventListener('pointerleave', onLeave);
        el.removeEventListener('click', onPoke);
        el.removeEventListener('keydown', onKey);
        el.innerHTML = '';
      }
    };
  }

  root.FobbyMascot = { mount: mount, states: Object.keys(STATES) };
})(window);
