// Layout check for /plan: no horizontal overflow and every tap target >= 44px.
// Usage: MAIO_PLAN=1 npm run start -- --port 3017 & node scripts/check-plan-layout.mjs [baseUrl]
// Needs google-chrome on PATH and Node 22+ (global WebSocket).
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://localhost:3017";
const pages = ["/en/plan?demo=1", "/pt/plan?demo=1&day=1", "/fr/plan?demo=1&day=2"];
const widths = [[390, 844], [1280, 1000]];
const port = 9333;
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "plan-chk-"))}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i += 1) { await sleep(250); target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const waiting = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { id += 1; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

const probe = `(() => {
  const vw = window.innerWidth;
  const overflow = document.documentElement.scrollWidth - vw;
  const small = [...document.querySelectorAll('.plan-main button, .plan-main a, .plan-main input')]
    .filter((el) => el.offsetParent !== null && !el.closest('.plan-chips, .plan-tabs') || (el.closest('.plan-chips, .plan-tabs') && el.getBoundingClientRect().left < vw))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && (r.height < 44 || r.width < 44))
    .map(({ el, r }) => el.textContent.trim().slice(0, 30) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  const cards = document.querySelectorAll('.plan-card').length;
  return JSON.stringify({ overflow, small, cards, rs: document.readyState, href: location.href, css: document.styleSheets.length });
})()`;

let failed = false;
for (const [w, h] of widths) for (const page of pages) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
  await send("Page.navigate", { url: base + page });
  await sleep(6000);
  const res = JSON.parse((await send("Runtime.evaluate", { expression: probe, returnByValue: true })).result.result.value);
  const ok = res.overflow <= 0 && res.small.length === 0 && res.cards > 0;
  if (!ok) failed = true;
  console.log(`${ok ? "PASS" : "FAIL"} ${w}px ${page} overflow=${res.overflow} cards=${res.cards} ${res.rs} ${res.href} css=${res.css} small=${JSON.stringify(res.small)}`);
}
ws.close(); chrome.kill();
process.exit(failed ? 1 : 0);
