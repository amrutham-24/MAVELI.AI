/* =====================================================================
   VALLAM KALI VR — Kerala Snake Boat Obstacle Race
   A-Frame 1.5 / WebXR.  No Unity, no raw three.js scene setup.

   Design decision (spec §7 Option B): the BOAT STAYS AT WORLD ORIGIN.
   The river, banks, obstacles and finish gate stream toward the player.
   This keeps floating-point precision tight, keeps the XR reference
   space stationary (best comfort), and makes cleanup trivial.
   ===================================================================== */

(function () {
    'use strict';

    /* ------------------------------------------------------------------
       CONFIG — one place to tune the whole race
       ------------------------------------------------------------------ */
    const CONFIG = {
        lanes: [-3, 0, 3],
        startLane: 1,
        maxHits: 2,

        forwardSpeed: 5,          // m/s at GO
        maxSpeed: 11,             // ramp ceiling
        speedRamp: 0.14,          // m/s gained per second
        hitSlowdown: 0.45,        // speed multiplier on impact
        hitRecovery: 1.6,         // seconds to recover full speed

        raceDistance: 150,        // metres

        spawnInterval: 2.5,       // seconds between spawns at start
        minSpawnInterval: 1.15,   // floor as speed climbs
        spawnDistance: 40,        // metres ahead
        despawnBehind: 12,        // metres behind player before recycle
        maxBlockedLanes: 2,       // at least one lane ALWAYS open

        laneLerp: 7.5,            // lane interpolation stiffness
        tiltDegrees: 6,           // visual bank angle — kept very subtle
        tiltLerp: 5,

        collisionZ: 1.6,          // half-depth of player hit zone
        collisionX: 1.0,          // half-width of player hit zone

        countdown: ['READY?', '3', '2', '1', 'GO!'],
        countdownStep: 0.9        // seconds per countdown beat
    };

    const STATE = { MENU: 'MENU', COUNTDOWN: 'COUNTDOWN', RACING: 'RACING', FINISHED: 'FINISHED' };

    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

    /* ------------------------------------------------------------------
       AUDIO MANAGER — fully optional, never blocks gameplay
       ------------------------------------------------------------------ */
    const AudioManager = {
        enabled: true,
        _get(id) {
            const el = document.getElementById(id);
            return (el && el.tagName === 'AUDIO') ? el : null;
        },
        play(id, volume) {
            if (!this.enabled) return;
            const el = this._get(id);
            if (!el) return;
            try {
                el.volume = volume === undefined ? 0.7 : volume;
                el.currentTime = 0;
                const p = el.play();
                if (p && p.catch) p.catch(() => { });   // autoplay block = silent no-op
            } catch (e) { /* audio is never fatal */ }
        },
        loop(id, volume) {
            if (!this.enabled) return;
            const el = this._get(id);
            if (!el) return;
            try {
                el.loop = true;
                el.volume = volume === undefined ? 0.35 : volume;
                const p = el.play();
                if (p && p.catch) p.catch(() => { });
            } catch (e) { }
        },
        stop(id) {
            const el = this._get(id);
            if (!el) return;
            try { el.pause(); el.currentTime = 0; } catch (e) { }
        },
        stopAll() { ['snd-ambience', 'snd-chenda'].forEach(id => this.stop(id)); }
    };

    /* ------------------------------------------------------------------
       SCENERY BUILDER — coconut palms + bank vegetation, pooled & scrolling
       ------------------------------------------------------------------ */
    function makePalm(x, z, scale) {
        const palm = document.createElement('a-entity');
        palm.setAttribute('position', { x: x, y: 0, z: z });
        palm.setAttribute('scale', { x: scale, y: scale, z: scale });

        const trunk = document.createElement('a-cylinder');
        trunk.setAttribute('radius', 0.16);
        trunk.setAttribute('height', 5.5);
        trunk.setAttribute('position', '0 2.75 0');
        trunk.setAttribute('rotation', (Math.random() * 8 - 4) + ' 0 ' + (Math.random() * 8 - 4));
        trunk.setAttribute('material', 'color: #7a5c34; roughness: 1');
        palm.appendChild(trunk);

        for (let i = 0; i < 6; i++) {
            const frond = document.createElement('a-cone');
            const ang = (i / 6) * 360;
            frond.setAttribute('radius-bottom', 0.5);
            frond.setAttribute('radius-top', 0.02);
            frond.setAttribute('height', 2.6);
            frond.setAttribute('position', '0 5.4 0');
            frond.setAttribute('rotation', '55 ' + ang + ' 0');
            frond.setAttribute('material', 'color: #2f6b3a; side: double');
            palm.appendChild(frond);
        }

        const nuts = document.createElement('a-sphere');
        nuts.setAttribute('radius', 0.22);
        nuts.setAttribute('position', '0 5.2 0');
        nuts.setAttribute('material', 'color: #4a3a1c');
        palm.appendChild(nuts);

        return palm;
    }

    function makeBush(x, z) {
        const bush = document.createElement('a-sphere');
        bush.setAttribute('radius', 0.7 + Math.random() * 0.7);
        bush.setAttribute('position', { x: x, y: 0.35, z: z });
        bush.setAttribute('scale', '1 0.65 1');
        bush.setAttribute('material', 'color: #35773f; roughness: 1; flatShading: true');
        return bush;
    }

    /* ==================================================================
       COMPONENT: water-surface — cheap animated water (UV scroll, no shader)
       ================================================================== */
    AFRAME.registerComponent('water-surface', {
        init: function () {
            this.t = 0;
            this.speed = 0;
            const mesh = this.el.getObject3D('mesh');
            if (mesh && mesh.material) {
                this.mat = mesh.material;
                this.mat.transparent = true;
            }
            this.el.sceneEl.addEventListener('vk-speed', (e) => { this.speed = e.detail.speed; });
        },
        tick: function (time, delta) {
            const dt = (delta || 16) / 1000;
            this.t += dt;
            // Gentle vertical bob + hue shimmer: no per-pixel cost.
            const obj = this.el.object3D;
            obj.position.y = Math.sin(this.t * 0.8) * 0.02;
            if (this.mat && this.mat.color) {
                const s = 0.5 + Math.sin(this.t * 1.3) * 0.02;
                this.mat.color.setHSL(0.47, 0.6, s * 0.42 + 0.16);
            }
        }
    });

    /* ==================================================================
       COMPONENT: vallam-obstacle — a single floating log
       Pooled: never destroyed during a race, just parked and reused.
       ================================================================== */
    AFRAME.registerComponent('vallam-obstacle', {
        schema: {
            lane: { type: 'int', default: 1 },
            active: { type: 'boolean', default: false }
        },

        init: function () {
            this.el.setAttribute('visible', false);

            const log = document.createElement('a-cylinder');
            log.setAttribute('radius', 0.42);
            log.setAttribute('height', 2.9);
            log.setAttribute('rotation', '0 0 90');
            log.setAttribute('position', '0 0.28 0');
            log.setAttribute('material', 'color: #5a3a1e; roughness: 1; flatShading: true');
            this.el.appendChild(log);
            this.log = log;

            // End caps so it reads as cut timber
            [-1.45, 1.45].forEach((x) => {
                const cap = document.createElement('a-circle');
                cap.setAttribute('radius', 0.42);
                cap.setAttribute('position', x + ' 0.28 0');
                cap.setAttribute('rotation', '0 ' + (x < 0 ? -90 : 90) + ' 0');
                cap.setAttribute('material', 'color: #8a6236; side: double');
                this.el.appendChild(cap);
            });

            // Moss patch — free visual variety
            const moss = document.createElement('a-sphere');
            moss.setAttribute('radius', 0.3);
            moss.setAttribute('position', '0.4 0.55 0.1');
            moss.setAttribute('scale', '1 0.4 1');
            moss.setAttribute('material', 'color: #3f7a3d');
            this.el.appendChild(moss);

            // Debug hitbox
            const box = document.createElement('a-box');
            box.setAttribute('width', 2.9);
            box.setAttribute('height', 1.2);
            box.setAttribute('depth', 1.2);
            box.setAttribute('position', '0 0.4 0');
            box.setAttribute('material', 'color: #ff3355; wireframe: true');
            box.setAttribute('visible', false);
            box.classList.add('hitbox');
            this.el.appendChild(box);
            this.hitbox = box;

            this.bobOffset = Math.random() * Math.PI * 2;
        },

        /** Put this pooled obstacle into play. */
        activate: function (lane, z) {
            this.data.active = true;
            this.data.lane = lane;
            this.el.object3D.position.set(CONFIG.lanes[lane], 0, z);
            this.el.object3D.rotation.y = (Math.random() * 0.5 - 0.25);
            this.el.setAttribute('visible', true);
        },

        /** Park it back in the pool. */
        deactivate: function () {
            this.data.active = false;
            this.el.setAttribute('visible', false);
            this.el.object3D.position.set(0, -50, 0);
        },

        tick: function (time, delta) {
            if (!this.data.active) return;
            const p = this.el.object3D.position;
            p.y = 0.05 + Math.sin(time / 700 + this.bobOffset) * 0.06;
            this.el.object3D.rotation.z = Math.sin(time / 900 + this.bobOffset) * 0.09;
        },

        showHitbox: function (v) { this.hitbox.setAttribute('visible', v); }
    });

    /* ==================================================================
       COMPONENT: boat-controller
       Owns: lane state, smooth lateral interpolation, visual tilt.
       Deliberately modular so a future oar system can drive targetLane /
       targetX instead of the thumbstick (spec §28).
       ================================================================== */
    AFRAME.registerComponent('boat-controller', {
        init: function () {
            this.currentLane = CONFIG.startLane;
            this.targetX = CONFIG.lanes[this.currentLane];
            this.currentX = this.targetX;
            this.tilt = 0;
            this.enabled = false;
            this.shake = 0;
            this.rowingPhase = 0;

            this.visual = document.getElementById('boat-visual');
            this.wake = document.getElementById('wake');

            this._buildRowers();

            // --- Desktop keyboard ---
            this.onKeyDown = (e) => {
                const k = e.key.toLowerCase();
                if (k === 'a' || e.key === 'ArrowLeft') this.moveLane(-1);
                if (k === 'd' || e.key === 'ArrowRight') this.moveLane(1);
            };
            window.addEventListener('keydown', this.onKeyDown);
        },

        _buildRowers: function () {
            const root = document.getElementById('rowers');
            if (!root) return;
            this.rowers = [];
            for (let i = 0; i < 6; i++) {
                const z = -1.4 - i * 1.05;
                const side = (i % 2 === 0) ? -0.38 : 0.38;

                const r = document.createElement('a-entity');
                r.setAttribute('position', { x: side, y: 0.72, z: z });

                const body = document.createElement('a-cylinder');
                body.setAttribute('radius', 0.16);
                body.setAttribute('height', 0.62);
                body.setAttribute('position', '0 0.31 0');
                body.setAttribute('material', 'color: #f2f2ee');   // white mundu
                r.appendChild(body);

                const head = document.createElement('a-sphere');
                head.setAttribute('radius', 0.13);
                head.setAttribute('position', '0 0.74 0');
                head.setAttribute('material', 'color: #6b4a32');
                r.appendChild(head);

                const oar = document.createElement('a-cylinder');
                oar.setAttribute('radius', 0.035);
                oar.setAttribute('height', 1.7);
                oar.setAttribute('position', (side < 0 ? -0.5 : 0.5) + ' 0.3 0');
                oar.setAttribute('rotation', '0 0 ' + (side < 0 ? 45 : -45));
                oar.setAttribute('material', 'color: #8a6236');
                r.appendChild(oar);

                r.dataset.phase = String(i * 0.25);
                r.dataset.side = String(side);
                root.appendChild(r);
                this.rowers.push(r);
            }
        },

        /** dir = -1 (left) | +1 (right). Public so oars/AI can call it later. */
        moveLane: function (dir) {
            if (!this.enabled) return;
            const next = clamp(this.currentLane + dir, 0, CONFIG.lanes.length - 1);
            if (next === this.currentLane) return;
            this.currentLane = next;
            this.targetX = CONFIG.lanes[next];
        },

        setEnabled: function (v) { this.enabled = v; },

        reset: function () {
            this.currentLane = CONFIG.startLane;
            this.targetX = CONFIG.lanes[this.currentLane];
            this.currentX = this.targetX;
            this.tilt = 0;
            this.shake = 0;
            this.el.object3D.position.x = this.currentX;
            if (this.visual) this.visual.object3D.rotation.set(0, 0, 0);
        },

        /** Brief, gentle impact wobble — boat only, never the camera (spec §24). */
        impact: function () { this.shake = 1; },

        tick: function (time, delta) {
            const dt = clamp((delta || 16) / 1000, 0, 0.1);

            // Smooth lane interpolation (never teleport)
            const prevX = this.currentX;
            this.currentX = lerp(this.currentX, this.targetX, clamp(CONFIG.laneLerp * dt, 0, 1));
            this.el.object3D.position.x = this.currentX;

            // Visual bank angle derived from lateral velocity
            const vx = (this.currentX - prevX) / Math.max(dt, 0.0001);
            const targetTilt = clamp(-vx * 0.9, -1, 1) * THREE.MathUtils.degToRad(CONFIG.tiltDegrees);
            this.tilt = lerp(this.tilt, targetTilt, clamp(CONFIG.tiltLerp * dt, 0, 1));

            if (this.visual) {
                const r = this.visual.object3D.rotation;
                r.z = this.tilt;
                r.y = clamp(-vx * 0.05, -0.06, 0.06);

                if (this.shake > 0) {
                    this.shake = Math.max(0, this.shake - dt * 1.8);
                    const s = this.shake * this.shake;
                    r.x = Math.sin(time / 45) * 0.035 * s;
                    r.z += Math.sin(time / 62) * 0.05 * s;
                    this.visual.object3D.position.y = Math.sin(time / 38) * 0.05 * s;
                } else {
                    // Idle swell — very small, comfort-safe
                    r.x = Math.sin(time / 1400) * 0.008;
                    this.visual.object3D.position.y = Math.sin(time / 1100) * 0.02;
                }
            }

            // Rowing animation, speed-linked
            if (this.rowers && this.enabled) {
                const gm = this.el.sceneEl.components['game-manager'];
                const spd = gm ? gm.speed : 0;
                const rate = 0.0018 + spd * 0.00022;
                this.rowingPhase += (delta || 16) * rate;
                this.rowers.forEach((r) => {
                    const ph = parseFloat(r.dataset.phase);
                    const side = parseFloat(r.dataset.side);
                    const swing = Math.sin(this.rowingPhase + ph);
                    r.object3D.rotation.x = swing * 0.28;
                    const oar = r.children[2];
                    if (oar) oar.object3D.rotation.z = (side < 0 ? 0.785 : -0.785) + swing * 0.35;
                });
            }

            // Wake scales with speed
            if (this.wake) {
                const gm = this.el.sceneEl.components['game-manager'];
                const spd = gm ? gm.speed : 0;
                const k = clamp(spd / CONFIG.maxSpeed, 0, 1);
                this.wake.object3D.scale.set(0.7 + k * 0.6, 0.6 + k * 0.9, 1);
                const m = this.wake.getObject3D('mesh');
                if (m && m.material) m.material.opacity = 0.12 + k * 0.28;
            }
        },

        remove: function () {
            window.removeEventListener('keydown', this.onKeyDown);
        }
    });

    /* ==================================================================
       COMPONENT: vr-input — Quest thumbstick steering (edge-triggered)
       ================================================================== */
    AFRAME.registerComponent('vr-input', {
        schema: { hand: { type: 'string', default: 'left' } },

        init: function () {
            this.latched = false;   // prevents lane-spam while stick is held

            this.onAxis = (evt) => {
                const axis = evt.detail.axis || [];
                // Quest maps thumbstick to axes[2]/[3]; fall back to [0] for others.
                const x = (axis.length > 2) ? axis[2] : axis[0];
                if (x === undefined) return;
                this.handleAxis(x);
            };

            this.onThumbstick = (evt) => {
                if (evt.detail && evt.detail.x !== undefined) this.handleAxis(evt.detail.x);
            };

            this.onTrigger = () => {
                const gm = this.el.sceneEl.components['game-manager'];
                if (!gm) return;
                if (gm.state === STATE.MENU) gm.startGame();
                else if (gm.state === STATE.FINISHED) gm.resetGame();
            };

            this.el.addEventListener('axismove', this.onAxis);
            this.el.addEventListener('thumbstickmoved', this.onThumbstick);
            this.el.addEventListener('triggerdown', this.onTrigger);
            this.el.addEventListener('abuttondown', this.onTrigger);
            this.el.addEventListener('xbuttondown', this.onTrigger);
        },

        handleAxis: function (x) {
            const rig = document.getElementById('rig');
            const bc = rig && rig.components['boat-controller'];
            if (!bc) return;

            if (x < -0.3 && !this.latched) { bc.moveLane(-1); this.latched = true; }
            else if (x > 0.3 && !this.latched) { bc.moveLane(1); this.latched = true; }
            else if (Math.abs(x) < 0.15) { this.latched = false; }
        },

        remove: function () {
            this.el.removeEventListener('axismove', this.onAxis);
            this.el.removeEventListener('thumbstickmoved', this.onThumbstick);
            this.el.removeEventListener('triggerdown', this.onTrigger);
            this.el.removeEventListener('abuttondown', this.onTrigger);
            this.el.removeEventListener('xbuttondown', this.onTrigger);
        }
    });

    /* ==================================================================
       COMPONENT: obstacle-spawner — pool + fair-pattern guarantee
       ================================================================== */
    AFRAME.registerComponent('obstacle-spawner', {
        init: function () {
            this.root = document.getElementById('obstacle-root');
            this.pool = [];
            this.timer = 0;
            this.running = false;
            this.lastLanes = [];   // lanes blocked in the previous wave

            const POOL_SIZE = 10;   // plenty; keeps DOM tiny for Quest
            for (let i = 0; i < POOL_SIZE; i++) {
                const el = document.createElement('a-entity');
                el.setAttribute('vallam-obstacle', '');
                el.classList.add('obstacle');
                this.root.appendChild(el);
                this.pool.push(el);
            }
        },

        start: function () { this.running = true; this.timer = 1.2; this.lastLanes = []; },
        stop: function () { this.running = false; },

        clearAll: function () {
            this.pool.forEach((el) => {
                const c = el.components['vallam-obstacle'];
                if (c) c.deactivate();
            });
        },

        getFree: function () {
            for (let i = 0; i < this.pool.length; i++) {
                const c = this.pool[i].components['vallam-obstacle'];
                if (c && !c.data.active) return c;
            }
            return null;
        },

        activeCount: function () {
            return this.pool.filter(el => {
                const c = el.components['vallam-obstacle'];
                return c && c.data.active;
            }).length;
        },

        /**
         * Fairness rule (spec §10): never block more than lanes-1, and never
         * force a two-lane jump between consecutive waves.
         */
        pickLanes: function () {
            const all = [0, 1, 2];
            // How many lanes to block this wave — biased toward 1.
            const count = Math.random() < 0.72 ? 1 : 2;
            const blocked = [];

            const shuffled = all.slice().sort(() => Math.random() - 0.5);
            for (const lane of shuffled) {
                if (blocked.length >= Math.min(count, CONFIG.maxBlockedLanes)) break;
                blocked.push(lane);
            }

            const open = all.filter(l => blocked.indexOf(l) === -1);
            if (open.length === 0) return [blocked[0]];   // safety net

            // If the previous wave forced the player to one lane, make sure an
            // adjacent lane stays open now — no impossible double-shifts.
            if (this.lastLanes.length === 2) {
                const prevOpen = all.filter(l => this.lastLanes.indexOf(l) === -1)[0];
                if (prevOpen !== undefined && open.every(l => Math.abs(l - prevOpen) > 1)) {
                    const rescue = blocked.indexOf(prevOpen);
                    if (rescue !== -1) blocked.splice(rescue, 1);
                }
            }

            this.lastLanes = blocked.slice();
            return blocked;
        },

        spawnWave: function () {
            const lanes = this.pickLanes();
            lanes.forEach((lane, i) => {
                const ob = this.getFree();
                if (!ob) return;
                // Slight z-stagger so a two-lane wave doesn't read as a wall.
                ob.activate(lane, -(CONFIG.spawnDistance + i * 1.5));
            });
        },

        spawnOne: function () {
            const ob = this.getFree();
            if (ob) ob.activate(Math.floor(Math.random() * 3), -CONFIG.spawnDistance);
        },

        tick: function (time, delta) {
            if (!this.running) return;
            const dt = (delta || 16) / 1000;
            const gm = this.el.components['game-manager'];
            if (!gm || gm.state !== STATE.RACING) return;

            // Interval tightens as the boat speeds up, but never below the floor.
            const speedFactor = gm.speed / CONFIG.forwardSpeed;
            const interval = Math.max(CONFIG.minSpawnInterval, CONFIG.spawnInterval / speedFactor);

            this.timer -= dt;
            if (this.timer <= 0) {
                // Don't spawn on top of the finish gate.
                if (gm.distance < CONFIG.raceDistance - CONFIG.spawnDistance - 6) this.spawnWave();
                this.timer = interval;
            }
        },

        remove: function () { this.clearAll(); }
    });

    /* ==================================================================
       COMPONENT: hud-manager — world-space readout
       ================================================================== */
    AFRAME.registerComponent('hud-manager', {
        init: function () {
            this.dist = document.getElementById('hud-dist');
            this.stats = document.getElementById('hud-stats');
            this.acc = 0;
        },
        tick: function (time, delta) {
            this.acc += delta || 16;
            if (this.acc < 100) return;   // 10 Hz text updates — text is expensive
            this.acc = 0;

            const gm = this.el.sceneEl.components['game-manager'];
            if (!gm) return;

            this.dist.setAttribute('value',
                'DISTANCE  ' + Math.floor(gm.distance) + ' / ' + CONFIG.raceDistance + ' m');
            this.stats.setAttribute('value',
                'HITS ' + gm.hits + '        SPEED ' + gm.speed.toFixed(1));
        }
    });

    /* ==================================================================
       COMPONENT: play-again-button
       ================================================================== */
    AFRAME.registerComponent('play-again-button', {
        init: function () {
            this.onClick = () => {
                const gm = this.el.sceneEl.components['game-manager'];
                if (gm) gm.resetGame();
            };
            this.el.addEventListener('click', this.onClick);
        },
        remove: function () { this.el.removeEventListener('click', this.onClick); }
    });

    /* ==================================================================
       COMPONENT: game-manager — state machine, world scroll, collisions
       ================================================================== */
    AFRAME.registerComponent('game-manager', {
        init: function () {
            this.state = STATE.MENU;
            this.speed = 0;
            this.distance = 0;
            this.hits = 0;
            this.elapsed = 0;
            this.slowTimer = 0;
            this.countdownIndex = 0;
            this.countdownTimer = 0;
            this.debug = false;
            this.finishSpawned = false;
            this.speedSamples = 0;
            this.speedSum = 0;
            this.laneChanges = 0;
            this.nearMisses = 0;

            this.rig = document.getElementById('rig');
            this.boat = this.rig.components['boat-controller'];
            this.countdownText = document.getElementById('countdown-text');
            this.hitText = document.getElementById('hit-text');
            this.resultPanel = document.getElementById('result-panel');
            this.resultText = document.getElementById('result-text');
            this.fxRoot = document.getElementById('fx-root');
            this.finishRoot = document.getElementById('finish-root');
            this.laneMarkers = document.getElementById('lane-markers');

            this.el.setAttribute('obstacle-spawner', '');
            this._buildBanks();
            this._buildSplashPool();

            this.hitFlashTimer = 0;

            // Fire once the scene is truly ready (avoids null object3D on Quest).
            if (this.el.hasLoaded) this._ready();
            else this.el.addEventListener('loaded', () => this._ready());
        },

        _ready: function () {
            this.spawner = this.el.components['obstacle-spawner'];
            AudioManager.loop('snd-ambience', 0.3);
            this._bindUI();
        },

        /* ------------------------- WORLD ------------------------------- */

        _buildBanks: function () {
            this.bankSegments = [];
            const SEG_LEN = 20;
            const SEG_COUNT = 12;   // 240 m of looping bank per side

            ['bank-left', 'bank-right'].forEach((id) => {
                const parent = document.getElementById(id);
                const sign = (id === 'bank-left') ? -1 : 1;

                for (let i = 0; i < SEG_COUNT; i++) {
                    const seg = document.createElement('a-entity');
                    const z = -i * SEG_LEN + 20;
                    seg.setAttribute('position', { x: 0, y: 0, z: z });

                    // Earth strip
                    const ground = document.createElement('a-box');
                    ground.setAttribute('width', 22);
                    ground.setAttribute('height', 0.9);
                    ground.setAttribute('depth', SEG_LEN);
                    ground.setAttribute('position', (sign * 9) + ' 0.35 0');
                    ground.setAttribute('material', 'color: #6b5a37; roughness: 1');
                    seg.appendChild(ground);

                    // Green cover
                    const grass = document.createElement('a-box');
                    grass.setAttribute('width', 22);
                    grass.setAttribute('height', 0.25);
                    grass.setAttribute('depth', SEG_LEN);
                    grass.setAttribute('position', (sign * 9) + ' 0.88 0');
                    grass.setAttribute('material', 'color: #3d8248; roughness: 1');
                    seg.appendChild(grass);

                    // 2 palms + 2 bushes per segment — sparse enough for Quest
                    seg.appendChild(makePalm(sign * (2.5 + Math.random() * 3), -4 + Math.random() * 8, 0.85 + Math.random() * 0.5));
                    seg.appendChild(makePalm(sign * (7 + Math.random() * 6), -8 + Math.random() * 14, 0.8 + Math.random() * 0.6));
                    seg.appendChild(makeBush(sign * (1.6 + Math.random() * 2), -6 + Math.random() * 12));
                    seg.appendChild(makeBush(sign * (4 + Math.random() * 5), -6 + Math.random() * 12));

                    parent.appendChild(seg);
                    this.bankSegments.push({ el: seg, len: SEG_LEN, count: SEG_COUNT });
                }
            });
        },

        _buildSplashPool: function () {
            this.splashes = [];
            for (let i = 0; i < 4; i++) {
                const s = document.createElement('a-entity');
                const cone = document.createElement('a-cone');
                cone.setAttribute('radius-bottom', 0.1);
                cone.setAttribute('radius-top', 1.1);
                cone.setAttribute('height', 1.5);
                cone.setAttribute('material', 'color: #dff6ff; opacity: 0.6; transparent: true; side: double; shader: flat');
                s.appendChild(cone);
                s.setAttribute('visible', false);
                s.setAttribute('position', '0 -50 0');
                this.fxRoot.appendChild(s);
                this.splashes.push({ el: s, life: 0 });
            }
        },

        splashAt: function (x, z) {
            const s = this.splashes.find(sp => sp.life <= 0);
            if (!s) return;
            s.life = 0.7;
            s.el.setAttribute('visible', true);
            s.el.object3D.position.set(x, 0.1, z);
            s.el.object3D.scale.set(0.4, 0.4, 0.4);
        },

        _spawnFinishGate: function () {
            if (this.finishSpawned) return;
            this.finishSpawned = true;

            const gate = document.createElement('a-entity');
            gate.setAttribute('finish-line', '');
            gate.setAttribute('position', { x: 0, y: 0, z: -(CONFIG.raceDistance - this.distance) });

            // Posts
            [-5.5, 5.5].forEach((x) => {
                const post = document.createElement('a-cylinder');
                post.setAttribute('radius', 0.28);
                post.setAttribute('height', 7);
                post.setAttribute('position', x + ' 3.5 0');
                post.setAttribute('material', 'color: #b8860b; metalness: 0.4');
                gate.appendChild(post);

                // Onam-style pookalam disc on each post
                const disc = document.createElement('a-circle');
                disc.setAttribute('radius', 0.9);
                disc.setAttribute('position', x + ' 5.6 0.35');
                disc.setAttribute('material', 'color: #ff9c1a; side: double; shader: flat');
                gate.appendChild(disc);

                const inner = document.createElement('a-circle');
                inner.setAttribute('radius', 0.45);
                inner.setAttribute('position', x + ' 5.6 0.4');
                inner.setAttribute('material', 'color: #c8102e; side: double; shader: flat');
                gate.appendChild(inner);
            });

            // Crossbar
            const bar = document.createElement('a-box');
            bar.setAttribute('width', 11.6);
            bar.setAttribute('height', 0.9);
            bar.setAttribute('depth', 0.35);
            bar.setAttribute('position', '0 7 0');
            bar.setAttribute('material', 'color: #c8102e');
            gate.appendChild(bar);

            const label = document.createElement('a-text');
            label.setAttribute('value', '🏁  FINISH  🏁');
            label.setAttribute('align', 'center');
            label.setAttribute('position', '0 7 0.25');
            label.setAttribute('width', 12);
            label.setAttribute('color', '#ffe066');
            gate.appendChild(label);

            // Marigold bunting
            for (let i = -5; i <= 5; i++) {
                const f = document.createElement('a-sphere');
                f.setAttribute('radius', 0.22);
                f.setAttribute('position', (i * 1.0) + ' ' + (6.35 + Math.abs(i) * 0.06) + ' 0.1');
                f.setAttribute('material', 'color: ' + (i % 2 === 0 ? '#ffb703' : '#fb8500'));
                gate.appendChild(f);
            }

            this.finishRoot.appendChild(gate);
            this.finishGate = gate;
        },

        /* ------------------------- STATE ------------------------------- */

        startGame: function () {
            if (this.state !== STATE.MENU) return;
            this.state = STATE.COUNTDOWN;
            this.countdownIndex = 0;
            this.countdownTimer = 0;
            this.boat.reset();
            this._showCountdownWord(CONFIG.countdown[0]);
            AudioManager.play('snd-beep', 0.6);
            this._hideOverlay();
        },

        resetGame: function () {
            this.state = STATE.MENU;
            this.speed = 0;
            this.distance = 0;
            this.hits = 0;
            this.elapsed = 0;
            this.slowTimer = 0;
            this.finishSpawned = false;
            this.speedSum = 0;
            this.speedSamples = 0;
            this.laneChanges = 0;
            this.nearMisses = 0;

            if (this.spawner) { this.spawner.stop(); this.spawner.clearAll(); }
            if (this.finishGate && this.finishGate.parentNode) {
                this.finishGate.parentNode.removeChild(this.finishGate);
                this.finishGate = null;
            }
            this.boat.reset();
            this.boat.setEnabled(false);
            this.resultPanel.setAttribute('visible', false);
            this.countdownText.setAttribute('opacity', 0);
            this.hitText.setAttribute('opacity', 0);
            AudioManager.stop('snd-chenda');

            // Auto-restart straight away — keeps the VR loop tight, no headset removal.
            setTimeout(() => { if (this.state === STATE.MENU) this.startGame(); }, 450);
        },

        beginRace: function () {
            this.state = STATE.RACING;
            this.speed = CONFIG.forwardSpeed;
            this.elapsed = 0;
            this.boat.setEnabled(true);
            if (this.spawner) this.spawner.start();
            AudioManager.play('snd-go', 0.8);
            AudioManager.loop('snd-chenda', 0.22);
        },

        finishRace: function (failed = false) {
            if (this.state === STATE.FINISHED) return;
            this.state = STATE.FINISHED;
            this.speed = 0;
            this.boat.setEnabled(false);
            if (this.spawner) { this.spawner.stop(); this.spawner.clearAll(); }
            AudioManager.stop('snd-chenda');
            AudioManager.play('snd-finish', 0.85);

            const result = this.getResult();
            if (failed) {
                result.success = false;
                result.score = 0;
            }

            this.countdownText.setAttribute('opacity', 0);
            
            if (failed) {
                this.resultText.setAttribute('value',
                    '🛶  GAME OVER\n\n' +
                    'TOO MANY HITS!\n\n' +
                    'Distance: ' + Math.floor(this.distance) + ' m\n' +
                    'Obstacles Hit: ' + result.hits + '\n' +
                    'Time: ' + result.time.toFixed(1) + ' s\n\n' +
                    'PERFORMANCE: FAILED');
            } else {
                this.resultText.setAttribute('value',
                    '🛶  VALLAM KALI COMPLETE!\n\n' +
                    'YOU MADE IT!\n\n' +
                    'Distance: ' + CONFIG.raceDistance + ' m\n' +
                    'Obstacles Hit: ' + result.hits + '\n' +
                    'Time: ' + result.time.toFixed(1) + ' s\n\n' +
                    'PERFORMANCE: ' + result.score + '%');
            }
            this.resultPanel.setAttribute('visible', true);

            // ---- Parent Onam board-game integration (spec §26) ----
            window.dispatchEvent(new CustomEvent('vallamGameComplete', {
                detail: {
                    success: !failed,
                    score: result.score,
                    hits: result.hits,
                    time: result.time
                }
            }));
        },

        /** Payload shape is already Gemma-ready (spec §27) — fixed difficulty for now. */
        getResult: function () {
            const time = this.elapsed;
            const par = CONFIG.raceDistance / ((CONFIG.forwardSpeed + CONFIG.maxSpeed) / 2);
            const timePenalty = clamp((time - par) * 0.8, 0, 30);
            const score = Math.round(clamp(100 - 10 * this.hits - timePenalty, 0, 100));
            const avgSpeed = this.speedSamples ? (this.speedSum / this.speedSamples) : 0;

            return {
                success: this.state === STATE.FINISHED && this.hits < CONFIG.maxHits,
                score: score,
                hits: this.hits,
                time: time,
                distance: Math.min(this.distance, CONFIG.raceDistance),
                // --- future Gemma fields ---
                rhythmAccuracy: 1,                                   // placeholder until oars exist
                steeringAccuracy: clamp(1 - this.hits * 0.12, 0, 1),
                obstaclesHit: this.hits,
                completionTime: time,
                averageSpeed: avgSpeed
            };
        },

        /* ------------------------- COLLISION ---------------------------- */

        checkCollisions: function () {
            if (!this.spawner) return;
            const px = this.rig.object3D.position.x;

            this.spawner.pool.forEach((el) => {
                const c = el.components['vallam-obstacle'];
                if (!c || !c.data.active) return;

                const p = el.object3D.position;
                const dz = Math.abs(p.z);
                const dx = Math.abs(p.x - px);

                if (dz < CONFIG.collisionZ && dx < CONFIG.collisionX + 1.45) {
                    this.onHit(p.x, p.z);
                    c.deactivate();
                } else if (dz < CONFIG.collisionZ && dx < 2.8) {
                    this.nearMisses++;   // steering-quality signal for future Gemma
                }
            });
        },

        onHit: function (x, z) {
            this.hits++;
            this.slowTimer = CONFIG.hitRecovery;
            this.speed *= CONFIG.hitSlowdown;
            this.boat.impact();
            this.splashAt(x, z);
            AudioManager.play('snd-splash', 0.75);

            this.hitText.setAttribute('opacity', 1);
            this.hitFlashTimer = 1.1;

            if (this.hits >= CONFIG.maxHits) {
                this.finishRace(true);
            }
        },

        /* ------------------------- COUNTDOWN ---------------------------- */

        _showCountdownWord: function (word) {
            this.countdownText.setAttribute('value', word);
            this.countdownText.setAttribute('opacity', 1);
            this.countdownText.setAttribute('scale', '1 1 1');
            this.countdownText.setAttribute('color', word === 'GO!' ? '#7dff9b' : '#ffe066');
        },

        _tickCountdown: function (dt) {
            this.countdownTimer += dt;

            // Pop-and-fade without a per-frame animation component
            const t = clamp(this.countdownTimer / CONFIG.countdownStep, 0, 1);
            const s = 1 + (1 - t) * 0.45;
            this.countdownText.setAttribute('scale', s + ' ' + s + ' 1');
            this.countdownText.setAttribute('opacity', 1 - t * 0.35);

            if (this.countdownTimer >= CONFIG.countdownStep) {
                this.countdownTimer = 0;
                this.countdownIndex++;

                if (this.countdownIndex < CONFIG.countdown.length) {
                    const word = CONFIG.countdown[this.countdownIndex];
                    this._showCountdownWord(word);
                    AudioManager.play(word === 'GO!' ? 'snd-go' : 'snd-beep', 0.6);
                    if (word === 'GO!') this.beginRace();
                } else {
                    this.countdownText.setAttribute('opacity', 0);
                }
            }
        },

        /* ------------------------- MAIN LOOP ---------------------------- */

        tick: function (time, delta) {
            const dt = clamp((delta || 16) / 1000, 0, 0.1);

            // Hit-message fade
            if (this.hitFlashTimer > 0) {
                this.hitFlashTimer -= dt;
                this.hitText.setAttribute('opacity', clamp(this.hitFlashTimer, 0, 1));
            }

            // Splash lifetimes
            this.splashes.forEach((s) => {
                if (s.life <= 0) return;
                s.life -= dt;
                const k = 1 - (s.life / 0.7);
                s.el.object3D.scale.set(0.4 + k * 1.5, 0.4 + k * 1.1, 0.4 + k * 1.5);
                const cone = s.el.children[0];
                const m = cone && cone.getObject3D('mesh');
                if (m && m.material) m.material.opacity = 0.6 * (1 - k);
                if (s.life <= 0) {
                    s.el.setAttribute('visible', false);
                    s.el.object3D.position.set(0, -50, 0);
                }
            });

            if (this.state === STATE.COUNTDOWN) { this._tickCountdown(dt); }

            if (this.state === STATE.RACING) {
                this.elapsed += dt;

                // Speed ramp, with post-hit recovery
                if (this.slowTimer > 0) {
                    this.slowTimer -= dt;
                    this.speed = lerp(this.speed, CONFIG.forwardSpeed + CONFIG.speedRamp * this.elapsed, dt * 1.5);
                } else {
                    this.speed = Math.min(CONFIG.maxSpeed, this.speed + CONFIG.speedRamp * dt * 6);
                }
                this.speed = clamp(this.speed, 1, CONFIG.maxSpeed);

                this.speedSum += this.speed;
                this.speedSamples++;

                const step = this.speed * dt;
                this.distance += step;

                this._scrollWorld(step);
                this.checkCollisions();

                this.el.emit('vk-speed', { speed: this.speed }, false);

                if (this.distance >= CONFIG.raceDistance - CONFIG.spawnDistance) this._spawnFinishGate();
                if (this.distance >= CONFIG.raceDistance) this.finishRace();
            }

            if (this.debug) this._updateDebug();
        },

        /** Everything except the rig moves toward the player. */
        _scrollWorld: function (step) {
            // Obstacles
            if (this.spawner) {
                this.spawner.pool.forEach((el) => {
                    const c = el.components['vallam-obstacle'];
                    if (!c || !c.data.active) return;
                    el.object3D.position.z += step;
                    if (el.object3D.position.z > CONFIG.despawnBehind) c.deactivate();
                });
            }

            // Bank segments — wrap around instead of respawning
            this.bankSegments.forEach((s) => {
                s.el.object3D.position.z += step;
                if (s.el.object3D.position.z > 30) {
                    s.el.object3D.position.z -= s.len * s.count;
                }
            });

            // Finish gate
            if (this.finishGate) this.finishGate.object3D.position.z += step;
        },

        /* ------------------------- UI / DEBUG ---------------------------- */

        _hideOverlay: function () {
            const ov = document.getElementById('overlay');
            if (ov) ov.classList.add('hidden');
        },

        _bindUI: function () {
            const startBtn = document.getElementById('btn-start');
            if (startBtn) startBtn.addEventListener('click', () => this.startGame());

            this.onKey = (e) => {
                if (e.key === '`') this.toggleDebug();
                if (e.key.toLowerCase() === 'r') this.resetGame();
                if (e.key === ' ' && this.state === STATE.MENU) this.startGame();
            };
            window.addEventListener('keydown', this.onKey);

            const dbgToggle = document.getElementById('debug-toggle');
            if (dbgToggle) dbgToggle.addEventListener('click', () => this.toggleDebug());

            document.querySelectorAll('#debug-buttons button').forEach((b) => {
                b.addEventListener('click', () => this._debugAction(b.dataset.dbg));
            });

            // Entering VR should not leave a DOM overlay swallowing input.
            this.el.addEventListener('enter-vr', () => this._hideOverlay());
        },

        toggleDebug: function () {
            this.debug = !this.debug;
            document.getElementById('debug-panel').classList.toggle('hidden', !this.debug);
        },

        _debugAction: function (action) {
            switch (action) {
                case 'start': this.startGame(); break;
                case 'reset': this.resetGame(); break;
                case 'spawn': if (this.spawner) this.spawner.spawnOne(); break;
                case 'speedup': this.speed = clamp(this.speed + 2, 0, CONFIG.maxSpeed); break;
                case 'finish': if (this.state === STATE.RACING) { this.distance = CONFIG.raceDistance; } break;
                case 'lanes':
                    this.laneMarkers.setAttribute('visible', !this.laneMarkers.getAttribute('visible'));
                    break;
                case 'boxes':
                    this._showBoxes = !this._showBoxes;
                    if (this.spawner) {
                        this.spawner.pool.forEach((el) => {
                            const c = el.components['vallam-obstacle'];
                            if (c) c.showHitbox(this._showBoxes);
                        });
                    }
                    break;
            }
        },

        _updateDebug: function () {
            const out = document.getElementById('debug-readout');
            if (!out) return;
            out.textContent =
                'state    : ' + this.state + '\n' +
                'speed    : ' + this.speed.toFixed(2) + ' m/s\n' +
                'distance : ' + this.distance.toFixed(1) + ' / ' + CONFIG.raceDistance + '\n' +
                'lane     : ' + this.boat.currentLane + '  (x ' + this.boat.currentX.toFixed(2) + ')\n' +
                'hits     : ' + this.hits + '\n' +
                'obstacles: ' + (this.spawner ? this.spawner.activeCount() : 0) + '\n' +
                'time     : ' + this.elapsed.toFixed(1) + ' s\n' +
                'nearMiss : ' + this.nearMisses;
        },

        remove: function () {
            window.removeEventListener('keydown', this.onKey);
            if (this.spawner) this.spawner.clearAll();
            AudioManager.stopAll();
        }
    });

    /* ==================================================================
       COMPONENT: finish-line — marker only; crossing is distance-driven
       ================================================================== */
    AFRAME.registerComponent('finish-line', {
        tick: function (time) {
            // Gentle bunting sway, no cost
            this.el.object3D.rotation.y = Math.sin(time / 2000) * 0.02;
        }
    });

    /* ==================================================================
       PUBLIC INTEGRATION API (spec §26)
       The parent Onam board game drives everything through this object.
       ================================================================== */
    function gm() {
        const scene = document.getElementById('scene');
        return scene && scene.components ? scene.components['game-manager'] : null;
    }

    window.VallamGame = {
        startGame: function () { const g = gm(); if (g) g.startGame(); },
        resetGame: function () { const g = gm(); if (g) g.resetGame(); },
        getResult: function () { const g = gm(); return g ? g.getResult() : null; },
        isComplete: function () { const g = gm(); return !!g && g.state === STATE.FINISHED; },
        getState: function () { const g = gm(); return g ? g.state : 'LOADING'; },
        setAudioEnabled: function (v) { AudioManager.enabled = !!v; if (!v) AudioManager.stopAll(); },
        config: CONFIG
    };

    // Convenience listener so the integration is demonstrably wired.
    window.addEventListener('vallamGameComplete', (e) => {
        console.log('[VallamKali] Race complete →', e.detail);
    });

})();