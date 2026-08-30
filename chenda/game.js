/* ============================================================
   game.js — state machine + scoring + integration API
   States: MENU  DEMO  MEMORIZE  PLAYER_TURN  RESULT  COMPLETE
   ============================================================ */

AFRAME.registerComponent('chenda-game', {

    init() {
        UIManager.init();

        this.state = 'MENU';
        this.levelIndex = 0;
        this.score = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.totals = { perfect: 0, good: 0, wrongHand: 0, miss: 0 };
        this.notes = [];
        this.nextNote = 0;
        this.turnEnd = 0;
        this.timers = [];

        // drum feedback lives on the chenda entity
        this.chendaEl = document.querySelector('#chenda');
        this.chendaEl.setAttribute('drum-feedback', '');

        this.leftStick = document.querySelector('#leftHand');
        this.rightStick = document.querySelector('#rightHand');

        /* ---- START button: click (cursor/laser) ---- */
        const btn = document.querySelector('#startBtn');
        btn.addEventListener('click', () => this.onStartPressed());

        /* ---- SPACE = start / continue ---- */
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !e.repeat) {
                e.preventDefault();
                this.onStartPressed();
            }
        });

        /* ---- audio unlock on VR entry ---- */
        this.el.sceneEl.addEventListener('enter-vr', () => {
            document.body.classList.add('in-vr');
            AudioManager.init();
        });
        this.el.sceneEl.addEventListener('exit-vr',
            () => document.body.classList.remove('in-vr'));

        window.ChendaGameCore = this;
        this.showMenu();
    },

    /* ============ TIMER HELPERS (cancellable) ============ */
    after(ms, fn) {
        const id = setTimeout(() => {
            this.timers = this.timers.filter(t => t !== id);
            fn();
        }, ms);
        this.timers.push(id);
        return id;
    },
    clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; },

    /* ============ MENU ============ */
    showMenu() {
        this.clearTimers();
        this.state = 'MENU';
        UIManager.title('🥁 CHENDA MASTER');
        UIManager.sub('Listen. Remember. Play.');
        UIManager.pattern('Use both drumsticks to reproduce the rhythm.', '#c9b48a');
        UIManager.feedback('');
        UIManager.clearHud();
        UIManager.showStart('START');
    },

    onStartPressed() {
        AudioManager.init();                       // user gesture — unlock audio
        if (this.state === 'MENU') this.startRun();
        else if (this.state === 'RESULT') this.nextLevel();
        else if (this.state === 'COMPLETE') { this.resetGame(); this.startRun(); }
    },

    startRun() {
        this.levelIndex = 0;
        this.score = 0; this.combo = 0; this.maxCombo = 0;
        this.totals = { perfect: 0, good: 0, wrongHand: 0, miss: 0 };
        this.startLevel();
    },

    /* ============ LEVEL INTRO -> DEMO ============ */
    startLevel() {
        this.clearTimers();
        const def = PatternManager.get(this.levelIndex);
        this.levelDef = def;
        this.levelStats = { perfect: 0, good: 0, wrongHand: 0, miss: 0, expected: 0 };
        this.levelDef.pattern.forEach(t => { if (t !== 'PAUSE') this.levelStats.expected++; });

        UIManager.hideStart();
        UIManager.title(`LEVEL ${def.level}`, '#e0a03a');
        UIManager.sub('Watch and listen…');
        UIManager.pattern('');
        UIManager.feedback('');
        UIManager.hud(def.level, this.score, this.combo);

        this.after(1000, () => this.runDemo());
    },

    /* ============ DEMO ============ */
    runDemo() {
        this.state = 'DEMO';
        const def = this.levelDef;
        UIManager.sub('DEMONSTRATION');

        def.pattern.forEach((tok, i) => {
            this.after(i * def.interval, () => {
                UIManager.pattern(PatternManager.display(def, i),
                    tok === 'PAUSE' ? '#8a7a5e' : '#ffcf6b');
                if (tok === 'PAUSE') {
                    UIManager.feedback('— pause —', '#8a7a5e', def.interval * 0.8);
                    this.highlight(null);
                    return;
                }
                this.highlight(tok);
                UIManager.feedback(tok === 'L' ? 'LEFT' : 'RIGHT',
                    tok === 'L' ? '#5ec8ff' : '#ffb45e', def.interval * 0.8);
                AudioManager.chenda(tok, 1.0);
                this.chendaEl.components['drum-feedback']
                    .pulse(tok === 'L' ? '#5ec8ff' : '#ffb45e');
            });
        });

        const demoLen = PatternManager.totalMs(def) + def.interval;
        this.after(demoLen, () => this.memorize());
    },

    highlight(hand) {
        const L = this.leftStick.components.drumstick;
        const R = this.rightStick.components.drumstick;
        if (L) L.highlight(hand === 'L');
        if (R) R.highlight(hand === 'R');
    },

    /* ============ MEMORIZE + COUNT-IN ============ */
    memorize() {
        this.state = 'MEMORIZE';
        this.highlight(null);
        UIManager.pattern('');                       // pattern disappears
        UIManager.sub('Remember it…');
        UIManager.feedback('');

        const C = PatternManager.CONFIG;
        this.after(C.memorizeMs, () => {
            UIManager.title('YOUR TURN', '#7ef29a');
            UIManager.sub('');
            // 3-tick count-in at the level tempo so the player locks the pulse
            const step = C.leadInMs / 3;
            for (let i = 0; i < 3; i++) {
                this.after(i * step, () => {
                    UIManager.feedback(String(3 - i), '#ffcf6b', step);
                    AudioManager.countdownTick();
                });
            }
            this.after(C.leadInMs, () => {
                AudioManager.countdownGo();
                UIManager.feedback('GO!', '#7ef29a', 450);
                this.beginPlayerTurn();
            });
        });
    },

    /* ============ PLAYER TURN ============ */
    beginPlayerTurn() {
        this.state = 'PLAYER_TURN';
        const t0 = performance.now();
        this.notes = PatternManager.buildTimeline(this.levelDef, t0);
        this.nextNote = 0;
        this.turnEnd = t0 + PatternManager.totalMs(this.levelDef)
            + PatternManager.CONFIG.tailMs;
    },

    /* Called by drumstick component on every registered hit. */
    onDrumHit(hand, timeMs) {
        // always give the physical feedback, whatever the state
        AudioManager.chenda(hand, 1.0);
        this.chendaEl.components['drum-feedback']
            .pulse(hand === 'L' ? '#5ec8ff' : '#ffb45e');

        if (this.state !== 'PLAYER_TURN') return;

        const C = PatternManager.CONFIG;

        // find the first unresolved note
        const note = this.notes.find(n => !n.resolved);
        if (!note) return;

        const err = timeMs - note.time;

        // way too early — probably a stray tap, ignore rather than punish
        if (err < -(C.goodMs + C.earlyGraceMs)) {
            UIManager.feedback('TOO EARLY', '#c9b48a', 500);
            return;
        }

        note.resolved = true;
        note.error = err;

        if (hand !== note.hand) {
            note.result = 'WRONGHAND';
            this.registerResult(note);
            return;
        }

        note.result = PatternManager.grade(err);
        this.registerResult(note);
    },

    registerResult(note) {
        const r = note.result;

        if (r === 'PERFECT') {
            this.combo++;
            this.totals.perfect++; this.levelStats.perfect++;
            this.score += PatternManager.points(r, this.combo);
            UIManager.feedback('🟢 PERFECT!', '#7ef29a', 650);
            AudioManager.perfect();
        } else if (r === 'GOOD') {
            this.combo++;
            this.totals.good++; this.levelStats.good++;
            this.score += PatternManager.points(r, this.combo);
            UIManager.feedback('🟢 GOOD!', '#b8e986', 650);
            AudioManager.good();
        } else if (r === 'WRONGHAND') {
            this.combo = 0;
            this.totals.wrongHand++; this.levelStats.wrongHand++;
            this.score += PatternManager.points(r, 0);
            UIManager.feedback('🟠 WRONG HAND', '#ffb45e', 700);
            AudioManager.wrongHand();
        } else {                                   // MISS
            this.combo = 0;
            this.totals.miss++; this.levelStats.miss++;
            UIManager.feedback('🔴 MISS', '#ff6a6a', 700);
            AudioManager.miss();
        }

        this.maxCombo = Math.max(this.maxCombo, this.combo);
        this.comboMilestone();
        UIManager.hud(this.levelDef.level, this.score, this.combo);
    },

    comboMilestone() {
        if (this.combo === 0) return;
        if (this.combo === 5) {
            UIManager.feedback('🔥 ONAM BEAT!', '#ffcf6b', 900);
            AudioManager.comboUp(5);
        } else if (this.combo === 10) {
            UIManager.feedback('🥁 CHENDA MASTER!', '#ffcf6b', 900);
            AudioManager.comboUp(10);
        } else if (this.combo >= 2) {
            AudioManager.comboUp(this.combo);
        }
    },

    /* Auto-resolve notes whose window has fully passed. */
    tick() {
        if (this.state !== 'PLAYER_TURN') return;
        const now = performance.now();
        const C = PatternManager.CONFIG;

        this.notes.forEach(n => {
            if (n.resolved) return;
            if (now > n.time + C.missMs) {
                n.resolved = true;
                n.result = 'MISS';
                n.error = C.missMs;
                this.registerResult(n);
            }
        });

        if (now > this.turnEnd || this.notes.every(n => n.resolved)) {
            // small tail so the very last hit still counts
            if (this.notes.every(n => n.resolved) || now > this.turnEnd) {
                this.state = 'RESULT';
                this.after(600, () => this.showLevelResult());
            }
        }
    },

    /* ============ RESULT ============ */
    showLevelResult() {
        this.highlight(null);
        const s = this.levelStats;
        const hit = s.perfect + s.good;
        const acc = s.expected ? Math.round((s.perfect + s.good * 0.7) / s.expected * 100) : 0;

        UIManager.title('🥁 LEVEL COMPLETE!', '#ffcf6b');
        UIManager.sub('');
        UIManager.resultBlock([
            `Accuracy: ${acc}%      Perfect: ${s.perfect}      Good: ${s.good}`,
            `Wrong hand: ${s.wrongHand}      Misses: ${s.miss}`,
            `Max Combo: ${this.maxCombo}      Score: ${this.score.toLocaleString()}`
        ]);
        UIManager.feedback('');
        AudioManager.levelComplete();

        const last = this.levelIndex >= PatternManager.count() - 1;
        UIManager.showStart(last ? 'FINISH' : 'NEXT LEVEL');
        this.lastAccuracy = acc;
    },

    nextLevel() {
        if (this.levelIndex >= PatternManager.count() - 1) { this.complete(); return; }
        this.levelIndex++;
        this.startLevel();
    },

    /* ============ COMPLETE ============ */
    complete() {
        this.clearTimers();
        this.state = 'COMPLETE';
        UIManager.hideStart();

        const res = this.getResult();
        UIManager.title('🥁 CHENDA MASTER!', '#ffcf6b');
        UIManager.sub('ADIPOLI!');
        UIManager.resultBlock([
            `Score: ${res.score.toLocaleString()}      Accuracy: ${Math.round(res.accuracy * 100)}%`,
            `Perfect Hits: ${res.perfectHits}      Good: ${res.goodHits}`,
            `Wrong hand: ${res.wrongHand}      Misses: ${res.misses}`,
            `Max Combo: ${res.maxCombo}`
        ]);
        UIManager.feedback('');
        AudioManager.victory();

        this.after(2600, () => UIManager.showStart('PLAY AGAIN'));

        /* ---- board-game integration signal ---- */
        window.dispatchEvent(new CustomEvent('chendaGameComplete', {
            detail: {
                success: true,
                score: res.score,
                accuracy: res.accuracy,
                level: res.level
            }
        }));
    },

    /* ============ PUBLIC RESULT PAYLOAD (Gemma-ready) ============ */
    getResult() {
        const t = this.totals;
        const attempts = t.perfect + t.good + t.wrongHand + t.miss;
        const accuracy = attempts
            ? +(((t.perfect + t.good * 0.7) / attempts).toFixed(4)) : 0;
        return {
            challenge: 'chenda',
            level: PatternManager.get(this.levelIndex).level,
            score: this.score,
            accuracy: accuracy,
            perfectHits: t.perfect,
            goodHits: t.good,
            wrongHand: t.wrongHand,
            misses: t.miss,
            maxCombo: this.maxCombo
        };
    },

    resetGame() {
        this.clearTimers();
        this.highlight(null);
        this.levelIndex = 0;
        this.score = 0; this.combo = 0; this.maxCombo = 0;
        this.totals = { perfect: 0, good: 0, wrongHand: 0, miss: 0 };
        this.notes = [];
        this.showMenu();
    }
});


/* ============================================================
   PUBLIC API for the Onam board game
   ============================================================ */
window.ChendaGame = {
    startGame() { const c = window.ChendaGameCore; if (c) { AudioManager.init(); c.startRun(); } },
    resetGame() { const c = window.ChendaGameCore; if (c) c.resetGame(); },
    getResult() { const c = window.ChendaGameCore; return c ? c.getResult() : null; },
    isComplete() { const c = window.ChendaGameCore; return !!c && c.state === 'COMPLETE'; }
};