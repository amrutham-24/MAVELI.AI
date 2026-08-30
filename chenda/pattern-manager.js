/* ============================================================
   PatternManager
   Add levels by appending to LEVELS. Nothing else needs to change.
   Tokens: "L" | "R" | "PAUSE"
   ============================================================ */
window.PatternManager = {

    LEVELS: [
        { level: 1, pattern: ['L', 'R'], interval: 620 },
        { level: 2, pattern: ['L', 'L', 'R', 'L'], interval: 540 },
        { level: 3, pattern: ['L', 'R', 'L', 'L', 'R', 'R', 'L', 'R'], interval: 450 }
    ],

    /* ---- tunable difficulty knobs ---- */
    CONFIG: {
        perfectMs: 130,   // |error| <= this  -> PERFECT
        goodMs: 270,   // |error| <= this  -> GOOD
        missMs: 480,   // beyond this the expected hit is auto-MISS
        earlyGraceMs: 200,   // hits earlier than this before a note are ignored, not penalised
        memorizeMs: 900,   // "get ready" beat after the demo
        leadInMs: 1100,  // countdown before the player's turn starts
        tailMs: 900,   // grace after the last note before scoring closes
        scorePerfect: 100,
        scoreGood: 70,
        scoreWrongHand: 20,
        comboStep: 0.1,   // +10% score per combo tier
        comboMax: 2.0
    },

    get(levelIndex) { return this.LEVELS[levelIndex]; },
    count() { return this.LEVELS.length; },

    /* Turn a pattern into an absolute timeline of expected hits.
       PAUSE consumes a slot but expects no input. */
    buildTimeline(levelDef, startTime) {
        const notes = [];
        levelDef.pattern.forEach((tok, i) => {
            if (tok === 'PAUSE') return;
            notes.push({
                index: notes.length,
                slot: i,
                hand: tok,
                time: startTime + i * levelDef.interval,
                resolved: false,
                result: null,       // 'PERFECT' | 'GOOD' | 'WRONGHAND' | 'MISS'
                error: null
            });
        });
        return notes;
    },

    totalMs(levelDef) {
        return (levelDef.pattern.length - 1) * levelDef.interval;
    },

    /* Pretty pattern string for the world-space UI, with one token highlighted. */
    display(levelDef, highlightSlot = -1) {
        return levelDef.pattern.map((tok, i) => {
            const glyph = tok === 'PAUSE' ? '—' : tok;
            return i === highlightSlot ? `[${glyph}]` : ` ${glyph} `;
        }).join('');
    },

    grade(errorMs) {
        const a = Math.abs(errorMs);
        if (a <= this.CONFIG.perfectMs) return 'PERFECT';
        if (a <= this.CONFIG.goodMs) return 'GOOD';
        return 'MISS';
    },

    points(result, combo) {
        const C = this.CONFIG;
        let base = 0;
        if (result === 'PERFECT') base = C.scorePerfect;
        else if (result === 'GOOD') base = C.scoreGood;
        else if (result === 'WRONGHAND') base = C.scoreWrongHand;
        const mult = Math.min(1 + Math.floor(combo / 2) * C.comboStep, C.comboMax);
        return Math.round(base * mult);
    }
};