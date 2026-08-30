/* ============================================================
   drum-controller.js
   A-Frame components: drumstick, drum feedback, small decor.
   ============================================================ */

/* ---------------- DRUMSTICK ----------------
   Builds a stick mesh under the controller, puts an invisible
   collision sphere at the tip, and runs the hit state machine:

     OUTSIDE -> ENTER -> REGISTER HIT -> LOCKED -> EXIT -> OUTSIDE
------------------------------------------------------------- */
AFRAME.registerComponent('drumstick', {
    schema: {
        hand: { type: 'string', default: 'L' },
        tipRadius: { type: 'number', default: 0.055 },
        exitPadding: { type: 'number', default: 0.05 }   // must retreat this far to re-arm
    },

    init() {
        const hand = this.data.hand;
        const isL = hand === 'L';

        /* ----- visual stick ----- */
        this.stick = document.createElement('a-entity');
        this.stick.setAttribute('position', '0 0 -0.05');
        this.stick.setAttribute('rotation', '-58 0 0');

        const shaft = document.createElement('a-cylinder');
        shaft.setAttribute('radius', 0.011);
        shaft.setAttribute('height', 0.34);
        shaft.setAttribute('position', '0 -0.17 0');
        shaft.setAttribute('material', 'color:#c98a4b; roughness:0.75');
        this.stick.appendChild(shaft);

        const knob = document.createElement('a-sphere');
        knob.setAttribute('radius', 0.026);
        knob.setAttribute('position', '0 -0.345 0');
        knob.setAttribute('material', 'color:#8a5a2b; roughness:0.7');
        this.stick.appendChild(knob);

        // highlight glow used during demo ("this hand next")
        this.glow = document.createElement('a-sphere');
        this.glow.setAttribute('radius', 0.05);
        this.glow.setAttribute('position', '0 -0.345 0');
        this.glow.setAttribute('material',
            `color:${isL ? '#5ec8ff' : '#ffb45e'}; shader:flat; opacity:0.0; transparent:true`);
        this.stick.appendChild(this.glow);

        // hand tag floating above the grip so you always know which is which
        const tag = document.createElement('a-text');
        tag.setAttribute('value', hand);
        tag.setAttribute('align', 'center');
        tag.setAttribute('width', 0.5);
        tag.setAttribute('position', '0 0.07 0');
        tag.setAttribute('color', isL ? '#5ec8ff' : '#ffb45e');
        tag.setAttribute('look-at', '#head');
        this.stick.appendChild(tag);

        /* ----- invisible tip collider ----- */
        this.tip = document.createElement('a-entity');
        this.tip.setAttribute('position', '0 -0.375 0');
        this.stick.appendChild(this.tip);

        this.el.appendChild(this.stick);

        /* ----- state machine ----- */
        this.state = 'OUTSIDE';   // OUTSIDE | LOCKED
        this.tipWorld = new THREE.Vector3();
        this.zoneWorld = new THREE.Vector3();
        this.zoneEl = document.querySelector('#hitZone');
        this.recoilT = -1;
        this.baseZ = -0.05;

        /* ----- desktop keyboard fallback ----- */
        this.keyCode = isL ? 'KeyA' : 'KeyD';
        this._onKeyDown = (e) => {
            if (e.code !== this.keyCode || e.repeat) return;
            this.fire(true);
        };
        window.addEventListener('keydown', this._onKeyDown);

        /* ----- VR trigger also fires a hit (accessibility / seated play) ----- */
        this.el.addEventListener('triggerdown', () => this.fire(true));
    },

    remove() { window.removeEventListener('keydown', this._onKeyDown); },

    /* register a hit; simulated=true skips the proximity check */
    fire(simulated) {
        if (!simulated && this.state === 'LOCKED') return;
        this.state = 'LOCKED';
        this.recoil();
        if (window.ChendaGameCore) {
            window.ChendaGameCore.onDrumHit(this.data.hand, performance.now());
        }
        if (simulated) {
            // keyboard/trigger has no physical exit — auto re-arm quickly
            clearTimeout(this._rearm);
            this._rearm = setTimeout(() => { this.state = 'OUTSIDE'; }, 110);
        }
    },

    recoil() {
        this.recoilT = 0;
    },

    highlight(on) {
        this.glow.setAttribute('material', 'opacity', on ? 0.75 : 0.0);
    },

    tick(time, dt) {
        /* --- proximity hit detection --- */
        if (this.zoneEl && this.zoneEl.object3D) {
            this.tip.object3D.getWorldPosition(this.tipWorld);
            this.zoneEl.object3D.getWorldPosition(this.zoneWorld);

            const r = this.zoneEl.getAttribute('radius') || 0.34;
            const dist = this.tipWorld.distanceTo(this.zoneWorld);
            const enterR = r + this.data.tipRadius;
            const exitR = enterR + this.data.exitPadding;

            if (this.state === 'OUTSIDE' && dist <= enterR) {
                this.fire(false);
            } else if (this.state === 'LOCKED' && dist > exitR) {
                this.state = 'OUTSIDE';       // must pull back before hitting again
            }
        }

        /* --- recoil animation (kick back, ease home) --- */
        if (this.recoilT >= 0) {
            this.recoilT += dt;
            const T = 180;
            if (this.recoilT >= T) {
                this.recoilT = -1;
                this.stick.object3D.position.z = this.baseZ;
                this.stick.object3D.rotation.x = THREE.MathUtils.degToRad(-58);
            } else {
                const p = this.recoilT / T;
                const k = Math.sin(p * Math.PI);             // 0 -> 1 -> 0
                this.stick.object3D.position.z = this.baseZ + 0.05 * k;
                this.stick.object3D.rotation.x =
                    THREE.MathUtils.degToRad(-58 - 16 * k);
            }
        }
    }
});


/* ---------------- DRUM VISUAL FEEDBACK ---------------- */
AFRAME.registerComponent('drum-feedback', {
    init() {
        this.membrane = document.querySelector('#membrane');
        this.flash = document.querySelector('#hitFlash');
        this.t = -1;
    },

    pulse(color = '#ffcf6b') {
        this.t = 0;
        this.flash.setAttribute('material', 'color', color);
        this.flash.setAttribute('visible', true);
    },

    tick(time, dt) {
        if (this.t < 0) return;
        this.t += dt;
        const T = 260;
        if (this.t >= T) {
            this.t = -1;
            this.membrane.object3D.scale.set(1, 1, 1);
            this.membrane.object3D.position.y = 0.315;
            this.flash.setAttribute('visible', false);
            return;
        }
        const p = this.t / T;
        const k = Math.sin(p * Math.PI);
        // membrane squashes down and spreads out
        this.membrane.object3D.scale.set(1 + 0.05 * k, 1 - 0.45 * k, 1 + 0.05 * k);
        this.membrane.object3D.position.y = 0.315 - 0.012 * k;
        // flash ring expands + fades
        const s = 1 + 1.5 * p;
        this.flash.object3D.scale.set(s, s, s);
        this.flash.setAttribute('material', 'opacity', 0.85 * (1 - p));
    }
});


/* ---------------- CHEAP DECOR ---------------- */
AFRAME.registerComponent('rope-lacing', {
    init() {
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const b = document.createElement('a-box');
            b.setAttribute('width', 0.014);
            b.setAttribute('height', 0.60);
            b.setAttribute('depth', 0.014);
            b.setAttribute('position',
                `${Math.cos(a) * 0.302} 0 ${Math.sin(a) * 0.302}`);
            b.setAttribute('rotation', `0 ${-a * 180 / Math.PI} 6`);
            b.setAttribute('material', 'color:#e8dcc0; roughness:1');
            this.el.appendChild(b);
        }
    }
});

AFRAME.registerComponent('lamp', {
    init() {
        const stand = document.createElement('a-cylinder');
        stand.setAttribute('radius', 0.09);
        stand.setAttribute('height', 0.9);
        stand.setAttribute('position', '0 0.45 0');
        stand.setAttribute('material', 'color:#5a4020; metalness:0.5; roughness:0.5');
        this.el.appendChild(stand);

        const bowl = document.createElement('a-sphere');
        bowl.setAttribute('radius', 0.13);
        bowl.setAttribute('position', '0 0.95 0');
        bowl.setAttribute('material', 'color:#7a5628; metalness:0.6; roughness:0.4');
        this.el.appendChild(bowl);

        this.flame = document.createElement('a-sphere');
        this.flame.setAttribute('radius', 0.05);
        this.flame.setAttribute('position', '0 1.08 0');
        this.flame.setAttribute('material',
            'color:#ffb45e; shader:flat; opacity:0.95; transparent:true');
        this.el.appendChild(this.flame);
        this.seed = Math.random() * 100;
    },

    tick(time) {
        const f = 1 + Math.sin(time * 0.006 + this.seed) * 0.14
            + Math.sin(time * 0.017 + this.seed) * 0.08;
        this.flame.object3D.scale.set(f, f * 1.25, f);
    }
});