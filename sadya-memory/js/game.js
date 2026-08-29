/* =========================================================================
   ORMA SADHYA — "See it. Remember it. Serve it."
   Core game logic for the A-Frame WebXR prototype.

   Architecture (kept in one file for a fast hackathon build, but sectioned
   like separate modules so it can be split later if the project grows):
     - DATA           food/level/layout config
     - AudioEngine    synthesized SFX (no audio asset files required)
     - FX             floating text / rings / particle bursts
     - Components     idle-float, grab-hand (hand-tracking + controller + mouse)
     - GameManager    state machine: menu -> memorize -> reconstruct -> results
     - AIDirector     Gemma-style difficulty/feedback service with local fallback
     - Debug panel
   ========================================================================= */

(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // DATA
  // ---------------------------------------------------------------------

  // id must match the <img id="tex-<id>"> assets declared in index.html
  var FOOD_DB = {
    salt:     { name: 'Salt',                 w: 0.26, h: 0.17 },
    chip:     { name: 'Banana Chips',          w: 0.32, h: 0.21 },
    banana:   { name: 'Banana',                 w: 0.26, h: 0.17 },
    payasam:  { name: 'Payasam',                w: 0.23, h: 0.29 },
    rice:     { name: 'Rice',                   w: 0.35, h: 0.23 },
    sharkara: { name: 'Sharkara Varatti',       w: 0.30, h: 0.20 },
    sambar:   { name: 'Sambar',                 w: 0.30, h: 0.20 }
  };

  // Lower difficulty levels use a subset of these, in this priority order.
  var FOOD_PRIORITY_ORDER = ['chip', 'sharkara', 'banana', 'rice', 'sambar', 'payasam'];

  // index 0 = Level 1 ... index 4 = Level 5. itemCount is capped at 6 —
  // the full FOOD_DB roster (pappadam/banana are no longer in play).
  var LEVELS = [
    { itemCount: 6, memorizeTime: 5, radius: 0.32, distractors: 0 },
    { itemCount: 6, memorizeTime: 5, radius: 0.26, distractors: 0 },
    { itemCount: 6, memorizeTime: 5,  radius: 0.22, distractors: 2 },
    { itemCount: 6, memorizeTime: 5,  radius: 0.18, distractors: 3 },
    { itemCount: 6, memorizeTime: 5,  radius: 0.14, distractors: 4 }
  ];

  // World-space slots food items scatter to during reconstruction.
  // Chosen to stay within comfortable reach, never behind the player,
  // and clear of the leaf's own footprint (x:[-0.65,0.65] z:[-0.76,-0.14] y:[0.9,1.1]).
  var SCATTER_SLOTS = [
    [-0.55, 1.35, -0.15],
    [-0.60, 1.15, -0.05],
    [-0.30, 1.55, -0.35],
    [ 0.55, 1.35, -0.15],
    [ 0.60, 1.15, -0.05],
    [ 0.30, 1.55, -0.35],
    [ 0.00, 1.50, -0.10]
  ];
  var DECOY_SLOTS = [
    [-0.75, 1.00, 0.00],
    [ 0.75, 1.00, 0.00],
    [-0.15, 1.65, -0.05],
    [ 0.15, 1.65, -0.05]
  ];

  var GRAB_RADIUS = 0.16;
  var BUTTON_RADIUS = 0.35;

  function shuffled(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // ---------------------------------------------------------------------
  // AUDIO — everything synthesized via WebAudio, no sound asset files.
  // ---------------------------------------------------------------------

  var AudioEngine = {
    ctx: null,
    ensure: function () {
      if (!this.ctx) {
        var C = window.AudioContext || window.webkitAudioContext;
        this.ctx = new C();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone: function (freq, dur, type, peak, delay) {
      type = type || 'sine'; peak = peak || 0.18; delay = delay || 0;
      var ctx = this.ensure();
      var t0 = ctx.currentTime + delay;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    },
    grab: function () { this.tone(520, 0.06, 'triangle', 0.09, 0); },
    correct: function () { this.tone(660, 0.15, 'sine', 0.2, 0); this.tone(880, 0.2, 'sine', 0.18, 0.09); },
    incorrect: function () { this.tone(180, 0.22, 'sawtooth', 0.12, 0); },
    tick: function () { this.tone(440, 0.07, 'square', 0.05, 0); },
    warn: function () { this.tone(300, 0.18, 'square', 0.12, 0); },
    fanfare: function () {
      var self = this;
      [523, 659, 784, 1046].forEach(function (f, i) { self.tone(f, 0.28, 'triangle', 0.16, i * 0.11); });
    }
  };

  // ---------------------------------------------------------------------
  // FX — floating text, target pulses, particle bursts
  // ---------------------------------------------------------------------

  var FX = {
    root: null,
    init: function () { this.root = document.querySelector('#fx-root'); },

    // NOTE: initial position is always set via setAttribute (never raw object3D
    // writes) so the position *component*'s cached data matches what's on
    // screen — the animation component reads that cached data as its
    // interpolation "from" value, and a mismatch shows up as a visible
    // teleport at the start of the tween.
    floatingText: function (worldPos, text, color) {
      var el = document.createElement('a-text');
      el.setAttribute('value', text);
      el.setAttribute('align', 'center');
      el.setAttribute('color', color);
      el.setAttribute('width', 2.2);
      var x = worldPos.x, y = worldPos.y + 0.10, z = worldPos.z;
      el.setAttribute('position', x + ' ' + y + ' ' + z);
      this.root.appendChild(el);
      el.setAttribute('animation__rise', 'property: position; to: ' + x + ' ' + (y + 0.16) + ' ' + z + '; dur: 1100; easing: easeOutQuad');
      el.setAttribute('animation__fade', 'property: text.opacity; from: 1; to: 0; delay: 400; dur: 700; easing: easeInQuad');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1250);
    },

    pulseRing: function (worldPos, color) {
      var ring = document.createElement('a-ring');
      ring.setAttribute('rotation', '-90 0 0');
      ring.setAttribute('color', color);
      ring.setAttribute('material', 'shader:flat; opacity:0.9; side:double');
      ring.setAttribute('radius-inner', 0.015);
      ring.setAttribute('radius-outer', 0.03);
      ring.setAttribute('position', worldPos.x + ' ' + (worldPos.y + 0.004) + ' ' + worldPos.z);
      this.root.appendChild(ring);
      ring.setAttribute('animation__grow', 'property: radius-outer; from: 0.03; to: 0.16; dur: 650; easing: easeOutQuad');
      ring.setAttribute('animation__grow2', 'property: radius-inner; from: 0.015; to: 0.11; dur: 650; easing: easeOutQuad');
      ring.setAttribute('animation__fade', 'property: material.opacity; from: 0.9; to: 0; dur: 650; easing: easeInQuad');
      setTimeout(function () { if (ring.parentNode) ring.parentNode.removeChild(ring); }, 700);
    },

    burst: function (worldPos, color, count) {
      for (var i = 0; i < count; i++) {
        let s = document.createElement('a-sphere');
        s.setAttribute('radius', 0.007);
        s.setAttribute('color', color);
        s.setAttribute('material', 'shader:flat');
        s.setAttribute('position', worldPos.x + ' ' + worldPos.y + ' ' + worldPos.z);
        FX.root.appendChild(s);
        var ang = Math.random() * Math.PI * 2;
        var dist = 0.06 + Math.random() * 0.09;
        var tx = worldPos.x + Math.cos(ang) * dist;
        var tz = worldPos.z + Math.sin(ang) * dist;
        var ty = worldPos.y + 0.04 + Math.random() * 0.08;
        s.setAttribute('animation__fly', 'property: position; to: ' + tx + ' ' + ty + ' ' + tz + '; dur: 500; easing: easeOutQuad');
        s.setAttribute('animation__fade', 'property: material.opacity; from: 1; to: 0; dur: 500; easing: easeInQuad');
        setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 520);
      }
    }
  };

  // ---------------------------------------------------------------------
  // COMPONENTS
  // ---------------------------------------------------------------------

  AFRAME.registerComponent('idle-float', {
    init: function () {
      this.basePos = this.el.object3D.position.clone();
      this.phase = Math.random() * Math.PI * 2;
    },
    tick: function (t) {
      if (this.el.dataset.state !== 'available' || this.el.dataset.everGrabbed === 'true') return;
      this.el.object3D.position.y = this.basePos.y + Math.sin(t / 900 + this.phase) * 0.012;
      this.el.object3D.rotation.y += 0.0025;
    }
  });

  AFRAME.registerComponent('grab-hand', {
    schema: { hand: { type: 'string', default: 'right' } },
    init: function () {
      this.held = null;
      var self = this;
      this.onDown = function () { self.tryGrabOrClick(); };
      this.onUp = function () { self.tryRelease(); };
      ['triggerdown', 'gripdown', 'pinchstarted', 'selectstart'].forEach(function (evt) {
        self.el.addEventListener(evt, self.onDown);
      });
      ['triggerup', 'gripup', 'pinchended', 'selectend'].forEach(function (evt) {
        self.el.addEventListener(evt, self.onUp);
      });
    },
    tryGrabOrClick: function () {
      if (this.held) return;
      var handPos = new THREE.Vector3();
      this.el.object3D.getWorldPosition(handPos);

      // 1. UI buttons currently active take priority.
      var buttons = window.OrmaSadhya.getActiveButtons();
      var nearestBtn = null, nearestBtnD = BUTTON_RADIUS;
      buttons.forEach(function (b) {
        var p = new THREE.Vector3();
        b.object3D.getWorldPosition(p);
        var d = p.distanceTo(handPos);
        if (d < nearestBtnD) { nearestBtnD = d; nearestBtn = b; }
      });
      if (nearestBtn) { window.OrmaSadhya.onButtonActivate(nearestBtn); return; }

      // 2. grabbable food items
      var items = document.querySelectorAll('.grabbable');
      var nearest = null, nearestD = GRAB_RADIUS;
      items.forEach(function (it) {
        if (it.dataset.state === 'held' || it.dataset.state === 'locked') return;
        var p = new THREE.Vector3();
        it.object3D.getWorldPosition(p);
        var d = p.distanceTo(handPos);
        if (d < nearestD) { nearestD = d; nearest = it; }
      });
      if (nearest) {
        this.held = nearest;
        nearest.dataset.state = 'held';
        nearest.dataset.everGrabbed = 'true';
        this.el.object3D.attach(nearest.object3D);
        resyncPosition(nearest);
        window.OrmaSadhya.onGrab(nearest);
      }
    },
    tryRelease: function () {
      if (!this.held) return;
      var item = this.held;
      this.held = null;
      this.el.sceneEl.object3D.attach(item.object3D);
      resyncPosition(item);
      window.OrmaSadhya.onRelease(item);
    }
  });

  // ---------------------------------------------------------------------
  // AI DIRECTOR — Gemma-style service with a guaranteed local fallback.
  // The game must never stall waiting on a network/model call.
  // ---------------------------------------------------------------------

  var GemmaService = {
    // Extension point: point this at a real Gemma endpoint, e.g.
    //   fetch('http://localhost:11434/api/generate', {method:'POST', body: JSON.stringify({model:'gemma2', prompt: ...})})
    // and parse the structured {nextDifficulty, memorizationTime, distractorCount, targetTolerance, feedback} JSON back out.
    requestNextRound: function (stats) {
      return Promise.reject(new Error('No Gemma endpoint configured — using local fallback director.'));
    }
  };

  var FallbackGemmaService = {
    requestNextRound: function (stats) {
      var pct = stats.correctItems / stats.totalItems;
      var nextDifficulty = stats.difficulty;
      if (pct > 0.9) nextDifficulty = Math.min(5, stats.difficulty + 1);
      else if (pct < 0.6) nextDifficulty = Math.max(1, stats.difficulty - 1);

      var pool;
      if (pct >= 0.9 && stats.mistakes === 0) {
        pool = ['Adipoli! Perfect memory — every item exactly right!', 'Sadya Master! Flawless recall!', 'Polichu! Not a single mistake!'];
      } else if (pct >= 0.75) {
        pool = ['Great recall! Your placement accuracy is strong.', 'Nannayittundu! Solid Sadya, just a little off in places.', 'Very good — you are getting faster too.'];
      } else if (pct >= 0.5) {
        pool = ['Almost there! A couple of items got mixed up.', 'Halfway there — look at positions relative to the rice next time.', 'Not bad — one more look and you will have it.'];
      } else {
        pool = ['Take your time — look closely at where each item sits.', 'Let us slow down a little and try again.', 'Keep going, memory improves fast with practice!'];
      }
      var feedback = pool[Math.floor(Math.random() * pool.length)];
      var cfg = LEVELS[nextDifficulty - 1];
      return Promise.resolve({
        nextDifficulty: nextDifficulty,
        memorizationTime: cfg.memorizeTime,
        distractorCount: cfg.distractors,
        targetTolerance: cfg.radius,
        feedback: feedback
      });
    }
  };

  function getAIDirectorResult(stats) {
    return GemmaService.requestNextRound(stats).catch(function (err) {
      console.warn('[OrmaSadhya] ' + err.message);
      return FallbackGemmaService.requestNextRound(stats);
    });
  }

  // ---------------------------------------------------------------------
  // GAME MANAGER
  // ---------------------------------------------------------------------

  var state = {
    phase: 'menu',
    level: 1,
    round: 0,
    correctCount: 0,
    mistakes: 0,
    totalActive: 0,
    activeIds: [],
    placementRatios: [],
    reconstructStartTime: 0,
    countdownRemaining: 0,
    countdownTimer: null,
    activeButtons: [],
    pendingLevel: 1,
    targetsVisible: false
  };

  var els = {};

  function $(sel) { return document.querySelector(sel); }

  function cacheEls() {
    els.menuPanel = $('#menu-panel');
    els.startBtn = els.menuPanel.querySelector('[data-action="start"]');
    els.menuLevelLabel = $('#menu-level-label');
    els.memorizePanel = $('#memorize-panel');
    els.countdownText = $('#countdown-text');
    els.hudPanel = $('#hud-panel');
    els.progressText = $('#progress-text');
    els.mistakesText = $('#mistakes-text');
    els.resultsPanel = $('#results-panel');
    els.resultsTitle = $('#results-title');
    els.resultsBody = $('#results-body');
    els.resultsJudge = $('#results-judge');
    els.nextBtn = els.resultsPanel.querySelector('[data-action="next"]');
    els.targetZones = document.querySelectorAll('.target-zone');
  }

  function showPanel(el, visible) { el.setAttribute('visible', visible); }

  function setActiveButtons(list) { state.activeButtons = list; }

  function worldPosOf(el) {
    var v = new THREE.Vector3();
    el.object3D.getWorldPosition(v);
    return v;
  }

  // After a three.js object3D.attach() reparent, object3D.position is correct
  // but the A-Frame 'position' component's cached data is stale (attach()
  // bypasses setAttribute). Re-sync it so a later position animation reads
  // the right "from" value instead of teleporting from the stale point.
  function resyncPosition(el) {
    var p = el.object3D.position;
    el.setAttribute('position', { x: p.x, y: p.y, z: p.z });
  }

  function createItemsRoot() {
    var root = document.createElement('a-entity');
    root.id = 'items-root';
    document.querySelector('a-scene').appendChild(root);
    return root;
  }

  function clearItems() {
    while (els.itemsRoot.firstChild) els.itemsRoot.removeChild(els.itemsRoot.firstChild);
  }

  function spawnFoodEntity(id, worldPos, grabbable) {
    var def = FOOD_DB[id];
    var el = document.createElement('a-plane');
    el.setAttribute('src', '#tex-' + id);
    el.setAttribute('width', def.w);
    el.setAttribute('height', def.h);
    el.setAttribute('transparent', true);
    el.setAttribute('material', 'shader:flat; alphaTest:0.05; side:double');
    el.setAttribute('rotation', '-90 0 0');
    el.setAttribute('position', worldPos.x + ' ' + worldPos.y + ' ' + worldPos.z);
    el.dataset.item = id;
    el.dataset.state = grabbable ? 'available' : 'reference';
    if (grabbable) {
      el.classList.add('grabbable');
      el.setAttribute('idle-float', '');
      el.addEventListener('mousedown', function () { OrmaSadhya.desktopGrab(el); });
    }
    els.itemsRoot.appendChild(el);
    return el;
  }

  function spawnDecoyEntity(worldPos) {
    var el = document.createElement('a-circle');
    el.setAttribute('radius', 0.09);
    el.setAttribute('color', '#c9b98a');
    el.setAttribute('material', 'shader:flat; side:double');
    el.setAttribute('rotation', '-90 0 0');
    el.setAttribute('position', worldPos.x + ' ' + worldPos.y + ' ' + worldPos.z);
    el.dataset.item = '__decoy__';
    el.dataset.decoy = 'true';
    el.dataset.state = 'available';
    el.classList.add('grabbable');
    el.setAttribute('idle-float', '');
    el.addEventListener('mousedown', function () { OrmaSadhya.desktopGrab(el); });
    els.itemsRoot.appendChild(el);
    var txt = document.createElement('a-text');
    txt.setAttribute('value', '?');
    txt.setAttribute('align', 'center');
    txt.setAttribute('color', '#6b5a37');
    txt.setAttribute('width', 3);
    txt.setAttribute('rotation', '90 0 0');
    txt.setAttribute('position', '0 0.005 0');
    el.appendChild(txt);
    return el;
  }

  function findTargetZone(itemId) {
    for (var i = 0; i < els.targetZones.length; i++) {
      if (els.targetZones[i].dataset.item === itemId) return els.targetZones[i];
    }
    return null;
  }

  var OrmaSadhya = {
    init: function () {
      cacheEls();
      els.itemsRoot = createItemsRoot();
      FX.init();
      showPanel(els.memorizePanel, false);
      showPanel(els.hudPanel, false);
      showPanel(els.resultsPanel, false);
      showPanel(els.menuPanel, true);
      setActiveButtons([els.startBtn]);
      state.pendingLevel = 1;
      this.refreshMenuLabel();

      var self = this;
      els.startBtn.addEventListener('mousedown', function () { self.onButtonActivate(els.startBtn); });
      els.nextBtn.addEventListener('mousedown', function () { self.onButtonActivate(els.nextBtn); });
      document.addEventListener('mouseup', function () { self.desktopRelease(); });
    },

    // Desktop mouse fallback: mousedown on an item attaches it to the camera
    // (so mouse-look aims it) and mouseup drops it wherever the view landed.
    desktopGrab: function (item) {
      if (item.dataset.state === 'held' || item.dataset.state === 'locked') return;
      if (this.desktopHeld) return;
      item.dataset.state = 'held';
      item.dataset.everGrabbed = 'true';
      var cam = document.querySelector('#head');
      cam.object3D.attach(item.object3D);
      item.setAttribute('position', '0 -0.05 -0.5');
      item.setAttribute('rotation', '0 0 0');
      this.desktopHeld = item;
      this.onGrab(item);
    },
    desktopRelease: function () {
      if (!this.desktopHeld) return;
      var item = this.desktopHeld;
      this.desktopHeld = null;
      document.querySelector('a-scene').object3D.attach(item.object3D);
      resyncPosition(item);
      this.onRelease(item);
    },

    getActiveButtons: function () { return state.activeButtons; },

    refreshMenuLabel: function () {
      els.menuLevelLabel.setAttribute('value', 'Level ' + state.pendingLevel);
    },

    onButtonActivate: function (btnEl) {
      AudioEngine.ensure();
      var action = btnEl.dataset.action;
      if (action === 'start' || action === 'next') {
        AudioEngine.grab();
        this.startRound(state.pendingLevel);
      }
    },

    onGrab: function (item) {
      AudioEngine.grab();
      item.setAttribute('scale', '1.08 1.08 1.08');
    },

    onRelease: function (item) {
      item.setAttribute('scale', '1 1 1');

      if (item.dataset.decoy === 'true') {
        item.dataset.state = 'available';
        var p = worldPosOf(item);
        FX.pulseRing(p, '#cc5555');
        FX.floatingText(p, 'NOT NEEDED', '#e08a8a');
        AudioEngine.incorrect();
        return;
      }

      var target = findTargetZone(item.dataset.item);
      var itemPos = worldPosOf(item);
      var cfg = LEVELS[state.level - 1];

      if (target) {
        var targetPos = worldPosOf(target);
        var dist = itemPos.distanceTo(targetPos);
        if (dist <= cfg.radius) {
          this.correctPlacement(item, target, dist, cfg.radius);
          return;
        }
      }
      this.incorrectPlacement(item, itemPos);
    },

    correctPlacement: function (item, target, dist, radius) {
      item.dataset.state = 'locked';
      item.classList.remove('grabbable');
      var targetPos = worldPosOf(target);
      item.setAttribute('animation__snap', 'property: position; to: ' + targetPos.x + ' ' + (targetPos.y + 0.003) + ' ' + targetPos.z + '; dur: 220; easing: easeOutQuad');
      item.setAttribute('rotation', '-90 0 0');

      state.correctCount++;
      state.placementRatios.push(dist / radius);

      FX.pulseRing(targetPos, '#3fbf5f');
      FX.burst(targetPos, '#3fbf5f', 7);
      FX.floatingText(targetPos, '✓ CORRECT!', '#3fbf5f');
      AudioEngine.correct();

      this.updateHud();
      if (state.correctCount >= state.totalActive) {
        var self = this;
        setTimeout(function () { self.completeRound(); }, 500);
      }
    },

    incorrectPlacement: function (item, itemPos) {
      item.dataset.state = 'available';
      state.mistakes++;
      FX.pulseRing(itemPos, '#cc5555');
      FX.floatingText(itemPos, '✕ TRY AGAIN', '#e08a8a');
      AudioEngine.incorrect();
      this.updateHud();
    },

    updateHud: function () {
      els.progressText.setAttribute('value', state.correctCount + ' / ' + state.totalActive);
      els.mistakesText.setAttribute('value', state.mistakes > 0 ? (state.mistakes + ' mistake' + (state.mistakes > 1 ? 's' : '')) : '');
    },

    startRound: function (level) {
      state.level = level;
      state.round++;
      state.correctCount = 0;
      state.mistakes = 0;
      state.placementRatios = [];
      clearItems();

      var cfg = LEVELS[level - 1];
      state.activeIds = FOOD_PRIORITY_ORDER.slice(0, cfg.itemCount);
      state.totalActive = state.activeIds.length;

      // Show the reference memory image for 10 seconds
      var el = document.createElement('a-plane');
      el.setAttribute('src', '#tex-sadya');
      el.setAttribute('width', 0.9);
      el.setAttribute('height', 0.5);
      el.setAttribute('transparent', true);
      el.setAttribute('material', 'shader:flat; side:double');
      el.setAttribute('position', '0 1.3 -0.45');
      el.setAttribute('rotation', '-20 0 0');
      el.dataset.state = 'reference';
      el.setAttribute('scale', '0.001 0.001 0.001');
      el.setAttribute('animation__in', 'property: scale; to: 1 1 1; dur: 300; easing: easeOutBack');
      els.itemsRoot.appendChild(el);

      showPanel(els.menuPanel, false);
      showPanel(els.resultsPanel, false);
      showPanel(els.hudPanel, false);
      showPanel(els.memorizePanel, true);
      setActiveButtons([]);

      state.countdownRemaining = cfg.memorizeTime;
      els.countdownText.setAttribute('color', '#ffffff');
      els.countdownText.setAttribute('value', String(state.countdownRemaining));

      var self = this;
      clearInterval(state.countdownTimer);
      state.countdownTimer = setInterval(function () { self.tickCountdown(); }, 1000);
    },

    tickCountdown: function () {
      state.countdownRemaining--;
      if (state.countdownRemaining > 3) {
        AudioEngine.tick();
        els.countdownText.setAttribute('color', '#ffffff');
        els.countdownText.setAttribute('value', String(state.countdownRemaining));
      } else if (state.countdownRemaining > 1) {
        AudioEngine.warn();
        els.countdownText.setAttribute('color', '#ffcf4d');
        els.countdownText.setAttribute('value', '⚠ ' + state.countdownRemaining + ' SECONDS!');
      } else if (state.countdownRemaining === 1) {
        AudioEngine.warn();
        els.countdownText.setAttribute('color', '#ff6b4d');
        els.countdownText.setAttribute('value', 'LAST LOOK!');
      } else {
        clearInterval(state.countdownTimer);
        this.hideReferenceAndScatter();
      }
    },

    hideReferenceAndScatter: function () {
      var refItems = els.itemsRoot.querySelectorAll('[data-state="reference"]');
      refItems.forEach(function (el) {
        el.setAttribute('animation__out', 'property: scale; to: 0.001 0.001 0.001; dur: 450; easing: easeInQuad');
      });

      showPanel(els.memorizePanel, false);

      var self = this;
      setTimeout(function () { self.scatterItems(); }, 480);
    },

    scatterItems: function () {
      clearItems();
      var cfg = LEVELS[state.level - 1];

      var slots = shuffled(SCATTER_SLOTS).slice(0, state.activeIds.length);
      var ids = shuffled(state.activeIds);
      ids.forEach(function (id, i) {
        var v = new THREE.Vector3(slots[i][0], slots[i][1], slots[i][2]);
        spawnFoodEntity(id, v, true);
      });

      var decoySlots = shuffled(DECOY_SLOTS).slice(0, cfg.distractors);
      decoySlots.forEach(function (s) {
        spawnDecoyEntity(new THREE.Vector3(s[0], s[1], s[2]));
      });

      showPanel(els.hudPanel, true);
      this.updateHud();
      state.reconstructStartTime = performance.now();
    },

    completeRound: function () {
      var cfg = LEVELS[state.level - 1];
      var timeSec = (performance.now() - state.reconstructStartTime) / 1000;
      var itemsPct = state.correctCount / state.totalActive;
      var avgRatio = state.placementRatios.length
        ? state.placementRatios.reduce(function (a, b) { return a + b; }, 0) / state.placementRatios.length
        : 0;
      var positionAccuracy = Math.max(0, 1 - avgRatio);
      var speedBonus = Math.max(0, 1 - Math.min(1, timeSec / 60));
      var memoryScore = Math.round(Math.max(0, Math.min(100,
        itemsPct * 60 + positionAccuracy * 30 + speedBonus * 10 - state.mistakes * 2
      )));
      var points = Math.round(memoryScore * 100 + Math.max(0, 60 - timeSec) * 10);

      showPanel(els.hudPanel, false);
      AudioEngine.fanfare();

      var perfect = (state.correctCount === state.totalActive && state.mistakes === 0);
      els.resultsTitle.setAttribute('value', perfect ? '🎉 SADYA COMPLETE! PERFECT!' : '🍃 SADYA COMPLETE!');
      els.resultsBody.setAttribute('value',
        'ITEMS  ' + state.correctCount + ' / ' + state.totalActive + '\n' +
        'POSITION ACCURACY  ' + Math.round(positionAccuracy * 100) + '%\n' +
        'TIME  ' + timeSec.toFixed(1) + ' sec\n' +
        'MISTAKES  ' + state.mistakes + '\n' +
        'MEMORY SCORE  ' + memoryScore + ' / 100\n' +
        '⭐ ' + points.toLocaleString() + ' POINTS'
      );
      showPanel(els.resultsPanel, true);
      setActiveButtons([els.nextBtn]);

      var statsForDirector = {
        round: state.round,
        difficulty: state.level,
        correctItems: state.correctCount,
        totalItems: state.totalActive,
        positionAccuracy: positionAccuracy,
        completionTime: timeSec,
        mistakes: state.mistakes,
        memorizationTime: cfg.memorizeTime
      };

      var self = this;
      getAIDirectorResult(statsForDirector).then(function (result) {
        els.resultsJudge.setAttribute('value', '👵 ' + result.feedback);
        state.pendingLevel = result.nextDifficulty;
        self.refreshMenuLabel();
      });
    },

    // ---- Debug hooks ----
    debugSkipMemorize: function () {
      if (state.countdownRemaining > 0) { state.countdownRemaining = 1; this.tickCountdown(); }
    },
    debugCompleteRound: function () {
      if (els.hudPanel.getAttribute('visible') !== true) return;
      var remaining = els.itemsRoot.querySelectorAll('.grabbable:not([data-decoy="true"])');
      var self = this;
      remaining.forEach(function (el) {
        if (el.dataset.state === 'locked') return;
        var target = findTargetZone(el.dataset.item);
        if (target) self.correctPlacement(el, target, 0, LEVELS[state.level - 1].radius);
      });
    },
    debugResetRound: function () {
      clearInterval(state.countdownTimer);
      clearItems();
      showPanel(els.memorizePanel, false);
      showPanel(els.hudPanel, false);
      showPanel(els.resultsPanel, false);
      showPanel(els.menuPanel, true);
      setActiveButtons([els.startBtn]);
    },
    debugSetLevel: function (lvl) {
      state.pendingLevel = lvl;
      this.refreshMenuLabel();
    },
    debugToggleTargets: function () {
      state.targetsVisible = !state.targetsVisible;
      els.targetZones.forEach(function (tz) {
        if (state.targetsVisible) {
          var ring = document.createElement('a-ring');
          ring.classList.add('__debug_ring');
          ring.setAttribute('rotation', '-90 0 0');
          ring.setAttribute('radius-inner', 0.01);
          ring.setAttribute('radius-outer', LEVELS[state.level - 1].radius);
          ring.setAttribute('color', '#4fd1ff');
          ring.setAttribute('material', 'shader:flat; opacity:0.35; side:double');
          tz.appendChild(ring);
        } else {
          var existing = tz.querySelector('.__debug_ring');
          if (existing) tz.removeChild(existing);
        }
      });
    },
    getState: function () { return state; }
  };

  window.OrmaSadhya = OrmaSadhya;

  // ---------------------------------------------------------------------
  // BOOT + DEBUG PANEL WIRING
  // ---------------------------------------------------------------------

  document.querySelector('a-scene').addEventListener('loaded', function () {
    OrmaSadhya.init();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'd' || e.key === 'D') {
      var dbg = document.getElementById('dbg');
      dbg.style.display = (dbg.style.display === 'none' || !dbg.style.display) ? 'block' : 'none';
    }
  });

  document.querySelectorAll('[data-dbg]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var action = btn.dataset.dbg;
      if (action === 'skipMemorize') OrmaSadhya.debugSkipMemorize();
      else if (action === 'completeRound') OrmaSadhya.debugCompleteRound();
      else if (action === 'resetRound') OrmaSadhya.debugResetRound();
      else if (action === 'toggleTargets') OrmaSadhya.debugToggleTargets();
      else if (action.indexOf('lvl') === 0) OrmaSadhya.debugSetLevel(parseInt(action.slice(3), 10));
    });
  });

  setInterval(function () {
    var s = OrmaSadhya.getState();
    var stateEl = document.getElementById('dbg-state');
    var statsEl = document.getElementById('dbg-stats');
    if (stateEl) stateEl.textContent = 'panel: ' + (document.querySelector('#menu-panel').getAttribute('visible') ? 'menu' :
      document.querySelector('#memorize-panel').getAttribute('visible') ? 'memorize' :
      document.querySelector('#hud-panel').getAttribute('visible') ? 'reconstruct' :
      document.querySelector('#results-panel').getAttribute('visible') ? 'results' : '-');
    if (statsEl) statsEl.textContent = 'round:' + s.round + ' lvl:' + s.level + ' correct:' + s.correctCount + '/' + s.totalActive + ' mistakes:' + s.mistakes;
  }, 300);

})();
