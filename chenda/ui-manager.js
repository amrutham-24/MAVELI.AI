/* ============================================================
   UIManager — all world-space (a-text / a-plane). No DOM overlay.
   ============================================================ */
window.UIManager = {

    el: {},
    _fbTimer: null,

    init() {
        this.el.title = document.querySelector('#txtTitle');
        this.el.sub = document.querySelector('#txtSub');
        this.el.pattern = document.querySelector('#txtPattern');
        this.el.feedback = document.querySelector('#txtFeedback');
        this.el.hud = document.querySelector('#txtHud');
        this.el.startBtn = document.querySelector('#startBtn');
        this.el.panel = document.querySelector('#uiPanel');
    },

    title(v, color = '#ffcf6b') {
        this.el.title.setAttribute('value', v);
        this.el.title.setAttribute('color', color);
    },

    sub(v) { this.el.sub.setAttribute('value', v || ''); },

    pattern(v, color = '#ffffff') {
        this.el.pattern.setAttribute('value', v || '');
        this.el.pattern.setAttribute('color', color);
    },

    /* short-lived feedback line: PERFECT! / WRONG HAND / MISS ... */
    feedback(v, color = '#7ef29a', holdMs = 700) {
        clearTimeout(this._fbTimer);
        this.el.feedback.setAttribute('value', v || '');
        this.el.feedback.setAttribute('color', color);
        if (v && holdMs > 0) {
            this._fbTimer = setTimeout(() => {
                this.el.feedback.setAttribute('value', '');
            }, holdMs);
        }
    },

    hud(level, score, combo) {
        let s = `LEVEL ${level}    SCORE ${score.toLocaleString()}`;
        if (combo >= 2) s += `    🔥 COMBO x${combo}`;
        this.el.hud.setAttribute('value', s);
    },

    clearHud() { this.el.hud.setAttribute('value', ''); },

    showStart(label = 'START') {
        this.el.startBtn.setAttribute('visible', true);
        this.el.startBtn.querySelector('a-text').setAttribute('value', label);
    },

    hideStart() { this.el.startBtn.setAttribute('visible', false); },

    panelSize(w, h) {
        this.el.panel.setAttribute('width', w);
        this.el.panel.setAttribute('height', h);
    },

    /* Multi-line results block rendered into the pattern slot. */
    resultBlock(lines) {
        this.pattern(lines.join('\n'), '#f5e6b8');
    }
};