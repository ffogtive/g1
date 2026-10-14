#!/usr/bin/env node
/*
 * 몽글탑 C "구름착" 계산기 — cloud.html 의 WORLD 블록과 vendor/planck.min.js 를 그대로 실행한다 (게임과 같은 물리).
 * 가설: "위로 튕겨 구름에 착!"이 운빨이 아니라 실력이 되려면, 보통 탑으로 착지에 성공하는 (각도, 세기) 영역이
 *       너무 좁지도(운빨) 넓지도(시시) 않아야 한다. 구름 높이·간격을 이 수치로 맞춘다.
 * 실행: node moakung-v3/tools/cloud-sim.js [grid|verbs|run|all]
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'cloud.html'), 'utf8');
const block = html.match(/\/\*WORLD-START\*\/([\s\S]*?)\/\*WORLD-END\*\//)[1];
const R = vm.createContext({ console, Math });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor', 'planck.min.js'), 'utf8'), R);
vm.runInContext(block, R);
const { PHY, LEVEL } = R;
const NAME = { kwang: '꽝돌', gil: '길쭉', mong: '몽이', puff: '부풀' };
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const run = (W, n) => { for (let i = 0; i < n; i++) R.stepW(W); };
const fallen = (W) => W.friends.filter(b => b.ud.state === 'fell').length;
function place(W, kind, dx) { const x = W.plate.getPosition().x + dx; if (!R.canDrop(W, x)) return null; const b = R.addFriend(W, kind, x, R.landing(W, kind, x)); run(W, 60); return b; }
/** 단계 stage 의 받침으로 옮긴 새 월드 (앞 구름은 이미 밟은 것으로) */
function worldAt(stage) { const W = R.mkWorld(); for (let s = 0; s < stage; s++) { W.stage++; const A = R.anchorOf(W.level, W.stage); W.anchor = A; W.plate.setTransform({ x: A.x, y: A.y }, 0); } run(W, 30); return W; }
/** 쏘기: 당겨서 0.5초 → 놓기 → (tap 이면 정점 근처에서 부풀 톡) → 착지 판정까지 */
function shoot(W, theta, p, tap) {
  R.aimSet(W, p, theta); run(W, 30);
  if (fallen(W)) { R.aimCancel(W); return { fellInPull: true }; }
  if (!R.aimRelease(W)) return { cancel: true };
  let flyT = 0, q = 0, tapped = false, L = null, gerr = 0;
  for (;;) {
    R.stepW(W); flyT += PHY.DT; if (!L) L = W.launch;
    q = R.quiet(W) ? q + PHY.DT : 0;
    if (tap && !tapped && W.launch && W.launch.group.some(b => b.ud.state === 'fly' && !b.ud.dead) && comVy(W) < 1.0 && flyT > 0.2) { W.puffTap = true; tapped = true; }
    if (W.landT >= 0 ? (q >= 0.4 || W.t - W.landT >= PHY.LAND_WAIT) : ((q >= 0.4 && flyT > 0.8) || flyT >= 5)) break;
  }
  if (L) for (let i = 0; i < Math.min(20, L.track.length); i++) gerr = Math.max(gerr, Math.hypot(L.track[i].x - L.guide[i].x, L.track[i].y - L.guide[i].y));
  const res = R.endTurn(W);
  return { ok: res.ok, n: res.stood.length, center: res.center, flyT, gerr, maxTilt: L ? L.maxTilt : 0, launched: L ? L.n : 0 };
}
function comVy(W) { const g = W.launch.group.filter(b => !b.ud.dead && b.ud.state === 'fly'); const c = R.comOf(g); return c ? c.vy : 0; }
const fmtPct = (a, b) => `${Math.round(100 * a / Math.max(1, b))}%`;

/** 격자: 각도 × 세기 → 착지 성공 영역 */
function grid(stage, kinds, tap, opts = {}) {
  const A = R.anchorOf(LEVEL, stage), C = LEVEL.clouds[stage], dir = C.x >= A.x ? 1 : -1;
  const ths = []; for (let t = 50; t <= 90; t += 4) ths.push(dir > 0 ? t : 180 - t);
  let tot = 0, ok = 0, all = 0, best = null, gerr = 0; const rows = [];
  for (const th of ths) { let row = ''; for (let p = 0.4; p <= 1.001; p += 0.04) {
    const W = worldAt(stage); kinds.forEach((k, i) => place(W, k, opts.off ? opts.off[i] || 0 : 0)); run(W, 30);
    if (fallen(W)) { row += 'x'; continue; }
    const r = shoot(W, th, p, tap); if (r.cancel || r.fellInPull) { row += '-'; continue; }
    tot++; gerr = Math.max(gerr, r.gerr); if (r.ok) { ok++; if (r.n === kinds.length) all++; row += r.n === kinds.length ? '●' : '○'; if (!best || r.n > best.n || (r.n === best.n && r.center < best.center)) best = { th, p, n: r.n, center: r.center }; } else row += '·';
  } rows.push(`${String(Math.round(th)).padStart(4)}° ${row}`); }
  return { tot, ok, all, best, gerr, rows };
}
function gridTests() {
  console.log('== 착지 성공 영역 (가로 = 세기 0.40→1.00, ● 전원 섬 · ○ 일부 섬 · · 실패 · - 당기다 무너짐) ==');
  const cases = [[0, ['kwang', 'puff'], false], [0, ['kwang', 'puff'], true], [0, ['kwang'], false], [1, ['kwang', 'puff', 'gil'], false], [1, ['kwang', 'gil', 'puff'], true], [2, ['kwang', 'mong', 'puff'], true], [3, ['kwang', 'gil', 'puff'], true]];
  for (const [st, kinds, tap] of cases) {
    const g = grid(st, kinds, tap);
    console.log(`\n[단계 ${st}→${st + 1}${LEVEL.clouds[st].house ? '(하늘집)' : ''}] ${kinds.map(k => NAME[k]).join('→')}${tap ? ' + 부풀 톡' : ''}: 성공 ${g.ok}/${g.tot} (${fmtPct(g.ok, g.tot)}) · 전원 ${g.all} · 가이드 오차 ${g.gerr.toExponential(1)}m · 최선 ${g.best ? `${Math.round(g.best.th)}° ${g.best.p.toFixed(2)} 섬 ${g.best.n} 가운데서 ${g.best.center.toFixed(2)}m` : '-'}`);
    console.log(g.rows.join('\n'));
  }
}
/** 동사 확인: 오뚝이 켬/끔 비교 · 부풀 톡 체공 비교 · 몽이 통 */
function verbTests() {
  console.log('== 동사 ==');
  // 오뚝이: 꽝돌 바닥 + 일부러 비켜 쌓은 탑 → 비행 중 최대 기울기
  for (const k of [9, 0]) {
    PHY.KWANG_K = k; PHY.KWANG_D = k ? 3 : 0;
    const W = worldAt(0); place(W, 'kwang', 0); place(W, 'puff', 0.3); run(W, 30); const r = shoot(W, 80, 0.85, false);
    console.log(`  오뚝이 ${k ? '켬' : '끔'}: 비행 최대 기울기 ${(r.maxTilt * 180 / Math.PI).toFixed(1)}° · 착지 ${r.ok ? '성공 ' + r.n : '실패'}`);
  }
  PHY.KWANG_K = 9; PHY.KWANG_D = 3;
  for (const tap of [false, true]) { const W = worldAt(0); place(W, 'kwang', 0); place(W, 'puff', 0); run(W, 30); const r = shoot(W, 82, 0.9, tap); console.log(`  부풀 ${tap ? '톡' : '안 톡'}: 체공 ${r.flyT.toFixed(2)}초 · 착지 ${r.ok ? '성공 ' + r.n : '실패'}`); }
  for (const kinds of [['mong', 'puff'], ['puff', 'mong']]) { const W = worldAt(0); kinds.forEach(k => place(W, k, 0)); run(W, 30); const g = R.groupOf(W), c = R.comOf(g); console.log(`  ${kinds.map(k => NAME[k]).join('→')}: 발사 배율 ${R.boostOf(g)} · 최대 속도 ${R.launchSpeed(c.M, 1, R.boostOf(g)).toFixed(1)} m/s`); }
}
module.exports = { R, PHY, LEVEL, run, place, worldAt, shoot, grid, fallen };
if (require.main === module) {
  const mode = process.argv[2] || 'all', T0 = Date.now();
  if (mode === 'grid' || mode === 'all') gridTests();
  if (mode === 'verbs' || mode === 'all') verbTests();
  console.log(`(${((Date.now() - T0) / 1000).toFixed(1)}초)`);
}
