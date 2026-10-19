export const EDITOR_CSS = `
.ece {
  --ink: #3b2620; --ink-soft: #8d6c60; --line: rgba(120, 60, 40, .14); --card: rgba(255, 248, 243, .94);
  --chip: rgba(255, 255, 255, .75); --accent: #ff4d2e; --accent2: #ff9a3c;
  position: absolute; inset: 0; display: flex; flex-direction: column;
  font: 13px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif; color: var(--ink);
  background: var(--card); border-radius: 18px; overflow: hidden;
  box-shadow: 0 0 0 1px rgba(255,255,255,.7) inset, 0 24px 60px rgba(70, 25, 10, .28);
  -webkit-font-smoothing: antialiased;
}
.ece-desktop { inset: 10px; }
.ece button { font: inherit; color: inherit; cursor: pointer; }
.ece button:disabled { opacity: .45; cursor: default; }
.ece-bar { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; height: 44px; padding: 0 10px; flex: none; -webkit-app-region: drag; }
.ece-bar button { -webkit-app-region: no-drag; }
.ece-close { width: 22px; height: 22px; border-radius: 50%; border: 0; display: grid; place-items: center; background: rgba(120, 60, 40, .12); color: var(--ink-soft); }
.ece-close:hover { background: #ff5f57; color: #fff; }
.ece-title { text-align: center; font-weight: 650; font-size: 13.5px; letter-spacing: .01em; }
.ece-tabs { display: flex; gap: 4px; justify-content: center; padding: 0 12px 10px; flex: none; flex-wrap: wrap; }
.ece-tabs:empty { display: none; }
.ece-tab { display: inline-flex; align-items: center; gap: 6px; border: 0; padding: 6px 11px; border-radius: 999px; background: transparent; color: var(--ink-soft); font-weight: 600; font-size: 12px; }
.ece-tab:hover { background: var(--chip); color: var(--ink); }
.ece-tab.ece-on { background: linear-gradient(135deg, var(--accent2), var(--accent)); color: #fff; box-shadow: 0 3px 10px rgba(255, 77, 46, .3); }
.ece-stage { position: relative; flex: 1 1 auto; min-height: 160px; margin: 0 14px; border-radius: 12px; background: rgba(120, 60, 40, .06); overflow: hidden; }
.ece-view { position: absolute; inset: 0; touch-action: none; }
.ece[data-mode="info"] .ece-stage { display: none; }
.ece[data-mode="info"] .ece-panel { flex: 1; overflow: auto; }
.ece-panel { flex: none; padding: 12px 18px 4px; display: flex; flex-direction: column; gap: 9px; max-height: 42%; overflow: auto; }
.ece-row { display: grid; grid-template-columns: 86px 1fr auto; align-items: center; gap: 10px; min-height: 28px; }
.ece-row > :nth-child(2):last-child { grid-column: 2 / 4; }
.ece-label { color: var(--ink-soft); font-size: 12px; font-weight: 600; }
.ece-val { font-variant-numeric: tabular-nums; color: var(--ink-soft); font-size: 12px; min-width: 52px; text-align: right; }
.ece-hint { color: var(--ink-soft); font-size: 12px; }
.ece-note { line-height: 1.45; }
.ece-warn { color: #b3261e; font-weight: 600; }
.ece-chips, .ece-inline { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ece-chip { border: 0; padding: 5px 11px; border-radius: 8px; background: var(--chip); font-size: 12px; font-weight: 600; box-shadow: 0 1px 2px rgba(80, 30, 10, .1); }
.ece-chip:hover { background: #fff; }
.ece-chip.ece-on { background: linear-gradient(135deg, var(--accent2), var(--accent)); color: #fff; }
.ece-icon { padding: 6px 8px; display: inline-grid; place-items: center; }
.ece-range { width: 100%; -webkit-appearance: none; appearance: none; height: 18px; background: transparent; cursor: pointer; }
.ece-range::-webkit-slider-runnable-track { height: 4px; border-radius: 4px; background: rgba(120, 60, 40, .18); }
.ece-range::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; margin-top: -6px; border-radius: 50%;
  background: linear-gradient(135deg, var(--accent2), var(--accent)); box-shadow: 0 0 0 3px #fff, 0 2px 6px rgba(80, 30, 10, .35); }
.ece-num { width: 76px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 7px; background: #fff; font: inherit; color: inherit; }
.ece-x { color: var(--ink-soft); }
.ece-swatches { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ece-sw { width: 26px; height: 26px; border-radius: 7px; border: 0; padding: 0; box-shadow: 0 0 0 1px rgba(0,0,0,.1) inset; }
.ece-sw.ece-dot { border-radius: 50%; width: 22px; height: 22px; }
.ece-sw.ece-on { box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--accent); }
.ece-bgs .ece-sw { width: 30px; height: 30px; }
.ece-checker { background: repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 10px 10px; }
.ece-color { width: 30px; height: 30px; border: 0; padding: 0; background: none; border-radius: 7px; cursor: pointer; }
.ece-footer { flex: none; display: flex; justify-content: space-between; align-items: center; padding: 10px 16px 14px; gap: 8px; }
.ece-ghost { border: 0; padding: 7px 14px; border-radius: 9px; background: var(--chip); font-weight: 600; box-shadow: 0 1px 2px rgba(80,30,10,.1); }
.ece-ghost:hover:not(:disabled) { background: #fff; }
.ece-primary { border: 0; padding: 8px 18px; border-radius: 10px; font-weight: 650; color: #fff !important;
  background: linear-gradient(135deg, var(--accent2), var(--accent)); box-shadow: 0 4px 14px rgba(255, 77, 46, .35); }
.ece-primary:hover:not(:disabled) { filter: brightness(1.05); }
.ece-meta { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; background: rgba(255,255,255,.6); border-radius: 12px; padding: 14px 16px; }
.ece-mk { color: var(--ink-soft); font-weight: 600; font-size: 12px; }
.ece-mv { word-break: break-word; user-select: text; }
.ece-textin { position: absolute; transform: translateY(-4px); min-width: 140px; border: 1.5px dashed var(--accent); background: rgba(255,255,255,.85);
  border-radius: 6px; font-weight: 700; padding: 2px 6px; outline: none; resize: none; font-family: "Segoe UI", system-ui, sans-serif; }
.ece-toast { position: absolute; left: 50%; bottom: 70px; transform: translateX(-50%); background: #3b2620; color: #fff; padding: 8px 14px; border-radius: 10px; font-size: 12px; max-width: 80%; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
.ece :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

@media (prefers-color-scheme: dark) {
  .ece { --ink: #f4e9e3; --ink-soft: #b7a097; --line: rgba(255,255,255,.12); --card: rgba(38, 31, 29, .96); --chip: rgba(255,255,255,.08);
    box-shadow: 0 0 0 1px rgba(255,255,255,.08) inset, 0 24px 60px rgba(0,0,0,.5); }
  .ece-stage { background: rgba(0,0,0,.25); }
  .ece-chip:hover, .ece-ghost:hover:not(:disabled) { background: rgba(255,255,255,.16); }
  .ece-num { background: rgba(255,255,255,.06); }
  .ece-meta { background: rgba(255,255,255,.05); }
  .ece-close { background: rgba(255,255,255,.1); }
  .ece-textin { background: rgba(30,24,22,.85); }
  .ece-warn { color: #ff8a80; }
  .ece-range::-webkit-slider-runnable-track { background: rgba(255, 255, 255, .16); }
  .ece-range::-webkit-slider-thumb { box-shadow: 0 0 0 3px #2b2321, 0 2px 6px rgba(0, 0, 0, .5); }
}
`;
