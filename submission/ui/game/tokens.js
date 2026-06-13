// Design tokens - the single source of truth is the :root block in
// story.html. This module reads those CSS custom properties once at load and
// exports them to every JS-rendered surface (mermaid theme, SVG charts, role
// colors), so the JS can never drift from the CSS. Change a value in :root
// and every diagram, chart, and orb follows.

const _css = getComputedStyle(document.documentElement);
const v = (name, fallback) => {
    const val = _css.getPropertyValue(name).trim();
    return val || fallback;
};

export const T = {
    // surfaces
    bg: v("--bg", "#0a0e1a"),
    bg2: v("--bg-2", "#070a14"),
    // text ramp
    ink: v("--ink", "#e8ecf6"),
    inkDim: v("--ink-dim", "#9aa6c0"),
    inkFaint: v("--ink-faint", "#586079"),
    inkOnAccent: v("--ink-on-accent", "#06101f"),
    // lines
    line: v("--line", "#1d2740"),
    lineBright: v("--line-bright", "#2c3a5e"),
    // brand + seal
    blue: v("--blue", "#5b8cff"),
    blueBright: v("--blue-bright", "#7aa6ff"),
    blueSoft: v("--blue-soft", "#7fb0ff"),
    gold: v("--gold", "#f5c87a"),
    goldDeep: v("--gold-deep", "#d9a34a"),
    goldSoft: v("--gold-soft", "#f4c95d"),
    // roles
    strategist: v("--strategist", "#5b8cff"),
    designer: v("--designer", "#c084fc"),
    designerSoft: v("--designer-soft", "#c9b8ff"),
    marketer: v("--marketer", "#f59e0b"),
    ops: v("--ops", "#2dd4bf"),
    narrator: v("--narrator", "#94a3b8"),
    // semantic
    good: v("--good", "#34d399"),
    goodSoft: v("--good-soft", "#8ee6b8"),
    bad: v("--bad", "#fb7185"),
    // diagram (mermaid nodes + SVG charts)
    diagramNode: v("--diagram-node", "#16233f"),
    diagramNodeBorder: v("--diagram-node-border", "#3a4a72"),
    diagramText: v("--diagram-text", "#eaf0ff"),
    diagramLine: v("--diagram-line", "#4a5f8f"),
    // type
    fontDisplay: v("--font-display", "'Fraunces', serif"),
    fontBody: v("--font-body", "'Inter', system-ui, sans-serif"),
    fontMono: v("--font-mono", "'JetBrains Mono', monospace"),
};

// Worker/agent accent colors, keyed by role id. Single map - the rail orbs,
// org chart strokes, quest map strokes, and chapter graph all share it.
export const ROLE_COLOR = {
    strategist: T.strategist,
    designer: T.designer,
    marketer: T.marketer,
    ops: T.ops,
    narrator: T.narrator,
    orgdesigner: T.designer,
};

// Mermaid "base" theme variables derived from the same tokens.
export function mermaidThemeVariables() {
    return {
        background: "transparent",
        primaryColor: T.diagramNode,
        primaryBorderColor: T.diagramNodeBorder,
        primaryTextColor: T.diagramText,
        lineColor: T.diagramLine,
        secondaryColor: "#16203a",
        tertiaryColor: "#0e1626",
        fontSize: "16px",
    };
}
