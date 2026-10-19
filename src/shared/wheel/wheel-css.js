export const WHEEL_CSS = `
.ecw {
  --ecw-petal: #fff3ec;
  --ecw-petal-edge: rgba(255, 255, 255, .95);
  --ecw-disc: rgba(255, 255, 255, .30);
  --ecw-disc-edge: rgba(255, 255, 255, .7);
  --ecw-ink: #4a2a20;
  --ecw-ink-soft: #8a6a5f;
  --ecw-hub: radial-gradient(circle at 50% 35%, #fffaf6 0%, #ffece0 100%);
  --ecw-accent: #ff4d2e;
  position: absolute; left: 50%; top: 50%;
  font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--ecw-ink);
  user-select: none; -webkit-user-select: none;
  outline: none;
  opacity: 0; transform: scale(.55) rotate(-24deg);
  transition: opacity .18s ease, transform .42s cubic-bezier(.2, 1.35, .35, 1);
  -webkit-font-smoothing: antialiased;
}
.ecw.ecw-open { opacity: 1; transform: none; }
.ecw.ecw-closing { opacity: 0; transform: scale(.85); transition: opacity .15s ease, transform .17s ease-in; }
.ecw-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible;
  filter: drop-shadow(0 18px 40px rgba(60, 20, 10, .28)) drop-shadow(0 2px 6px rgba(60, 20, 10, .18)); }
.ecw-petals { opacity: .9; }
.ecw-disc { fill: var(--ecw-disc); stroke: var(--ecw-disc-edge); stroke-width: 1; }
.ecw-petal {
  fill: var(--ecw-petal); stroke: var(--ecw-petal); stroke-width: 18; stroke-linejoin: round;
  transition: transform .16s cubic-bezier(.3, 1.5, .5, 1), fill .12s, stroke .12s, opacity .12s;
}
.ecw-petal.ecw-hot { fill: url(#ecw-hot); stroke: url(#ecw-hot); transform: translate(var(--dx), var(--dy)); }
.ecw-petal.ecw-paging { fill: #ffe2d4; stroke: #ffe2d4; }
.ecw-labels { position: absolute; inset: 0; pointer-events: none; }
.ecw-label {
  position: absolute; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  font-size: 12.5px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; white-space: nowrap;
  transition: transform .16s cubic-bezier(.3, 1.5, .5, 1), color .12s;
}
.ecw-label.ecw-has-icon { font-size: 10px; letter-spacing: .07em; }
.ecw-label svg { opacity: .9; }
.ecw-label.ecw-paging { color: var(--ecw-ink-soft); }
.ecw-label.ecw-hot { color: #fff; transform: translate(calc(-50% + var(--dx)), calc(-50% + var(--dy))); }
.ecw-swap .ecw-petal, .ecw-swap .ecw-label { opacity: 0; transition: opacity .1s; }

.ecw-hub {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  border-radius: 50%; background: var(--ecw-hub);
  box-shadow: 0 1px 0 rgba(255,255,255,.9) inset, 0 6px 18px rgba(80, 30, 10, .16);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  text-align: center; padding: 10px; box-sizing: border-box; overflow: hidden;
  transition: box-shadow .15s, transform .15s;
}
.ecw-hub-hover .ecw-hub { box-shadow: 0 1px 0 rgba(255,255,255,.9) inset, 0 0 0 3px rgba(255, 120, 60, .35), 0 6px 18px rgba(80, 30, 10, .16); }
.ecw-kicker { font-size: 9.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--ecw-ink-soft); }
.ecw-title { font-size: 12px; font-weight: 600; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ecw-sub { font-size: 10.5px; color: var(--ecw-ink-soft); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ecw-big { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
.ecw-pill {
  padding: 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
  background: linear-gradient(135deg, #ff9a3c, #ff3b2f); color: #fff; box-shadow: 0 4px 12px rgba(255, 70, 40, .35);
  animation: ecw-pop .2s cubic-bezier(.3, 1.6, .5, 1);
}
@keyframes ecw-pop { from { transform: scale(.7); opacity: 0; } }
.ecw-switch {
  margin-top: 4px; display: inline-flex; align-items: center; gap: 5px; border: 0; cursor: pointer;
  padding: 5px 10px; border-radius: 999px; font: inherit; font-size: 10.5px; font-weight: 650; letter-spacing: .04em;
  color: var(--ecw-ink); background: rgba(255, 255, 255, .8); box-shadow: 0 1px 3px rgba(80, 30, 10, .15);
}
.ecw-switch:hover { background: #fff; }
.ecw-badge { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; color: #fff; animation: ecw-pop .3s cubic-bezier(.3, 1.6, .5, 1); }
.ecw-ok { background: linear-gradient(135deg, #34c759, #1f9d48); box-shadow: 0 4px 12px rgba(40, 160, 80, .35); }
.ecw-err { background: linear-gradient(135deg, #ff6b5a, #e0322a); }
.ecw-err-text { font-size: 10.5px; line-height: 1.3; color: #a3241c; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.ecw-actions { display: flex; gap: 3px; margin-top: 2px; }
.ecw-actions button {
  display: inline-flex; align-items: center; gap: 3px; border: 0; cursor: pointer; font: inherit; font-size: 9.5px; font-weight: 650;
  padding: 3px 7px; border-radius: 999px; background: rgba(255,255,255,.9); color: var(--ecw-ink); box-shadow: 0 1px 3px rgba(80,30,10,.15);
}
.ecw-actions svg { width: 11px; height: 11px; }
.ecw-actions button:hover { background: #fff; color: var(--ecw-accent); }
.ecw-track { fill: none; stroke: transparent; stroke-width: 4; }
.ecw-progress { fill: none; stroke: url(#ecw-hot); stroke-width: 4; stroke-linecap: round; opacity: 0; transition: stroke-dashoffset .3s ease, opacity .2s; }
.ecw[data-state="busy"] .ecw-progress, .ecw[data-state="done"] .ecw-progress { opacity: 1; }
.ecw[data-state="busy"] .ecw-track { stroke: rgba(255, 255, 255, .6); }
.ecw[data-state="done"] .ecw-progress { stroke: #34c759; }
.ecw-progress.ecw-indeterminate { animation: ecw-spin 1s linear infinite; transform-origin: 50% 50%; transform-box: view-box; }
@keyframes ecw-spin { from { rotate: 0deg; } to { rotate: 360deg; } }
.ecw-spinner { display: inline-block; width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid rgba(255, 90, 50, .25); border-top-color: var(--ecw-accent); animation: ecw-spin .8s linear infinite; }
.ecw-picked .ecw-petal:not(.ecw-hot), .ecw-picked .ecw-label:not(.ecw-hot) { opacity: .45; }
.ecw-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

@media (prefers-color-scheme: dark) {
  .ecw {
    --ecw-petal: #332a28;
    --ecw-disc: rgba(30, 24, 22, .35);
    --ecw-disc-edge: rgba(255, 255, 255, .14);
    --ecw-ink: #f6ebe5;
    --ecw-ink-soft: #b8a49b;
    --ecw-hub: radial-gradient(circle at 50% 35%, #3b3230 0%, #2a2321 100%);
  }
  .ecw-hub { box-shadow: 0 1px 0 rgba(255,255,255,.08) inset, 0 6px 18px rgba(0,0,0,.4); }
  .ecw-switch, .ecw-actions button { background: rgba(255,255,255,.1); color: var(--ecw-ink); }
  .ecw-switch:hover, .ecw-actions svg { width: 11px; height: 11px; }
.ecw-actions button:hover { background: rgba(255,255,255,.18); }
  .ecw-petal.ecw-paging { fill: #3e3330; stroke: #3e3330; }
  .ecw-err-text { color: #ff8a80; }
}
@media (prefers-reduced-motion: reduce) {
  .ecw, .ecw-petal, .ecw-label, .ecw-pill { transition: none !important; animation: none !important; }
}
`;
