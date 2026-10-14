#!/usr/bin/env node
/*
 * 몽글탑 v0.4 물리 계산기 — tower.html 의 WORLD 블록과 vendor/planck.min.js 를 그대로 실행한다 (게임과 같은 물리).
 * 가설: 진짜 물리는 감으로 맞출 수 없으니, "쌓기가 아슬아슬한가 · 한 마리씩 쏘면 못 이기나 · 대충 해도 이길 만한가"를
 *       표본 실험으로 숫자로 확인하고 맞춘다.
 * 실행: node moakung-v3/tools/sim.js [stack|pull|single|tower|novice|expert|all]
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'tower.html'), 'utf8');
const block = html.match(/\/\*WORLD-START\*\/([\s\S]*?)\/\*WORLD-END\*\//)[1];
const R = vm.createContext({ console, Math });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor', 'planck.min.js'), 'utf8'), R);
vm.runInContext(block, R);
const { PHY, LEVEL } = R;
const NAME = { kwang: '꽝돌', gil: '길쭉', mong: '몽이', puff: '부풀' };

// 결정론 난수 (시드 고정)
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const run = (W, n) => { for (let i = 0; i < n; i++) R.stepW(W); };
/** 친구를 받침 가운데에서 dx 만큼 비켜 내려놓고 1초 기다림 (사람이 다음 친구를 끌어오는 시간) */
function place(W, kind, dx) {
  const x = W.plate.getPosition().x + dx;
  if (!R.canDrop(W, x)) return null;
  const b = R.addFriend(W, kind, x, R.landing(W, kind, x));   // 게임과 같이: 착지점 0.04m 위에서 살짝
  run(W, 60); return b;
}
const fallen = (W) => W.friends.filter(b => b.ud.fell).length;
/** 떨어진 친구는 받침에서 치움 (게임: 어질어질 트레이로 돌아가 이번 발사엔 못 씀) */
const clearFell = (W) => W.friends.filter(b => b.ud.state === 'fell').forEach(b => R.removeFriend(W, b));
const onPlate = (W) => R.stackFriends(W).length;
/** 당기기: tRamp 초 동안 p 0→1, 그다음 hold 초 유지 */
function pull(W, theta, p, tRamp, hold) {
  clearFell(W);
  const n = Math.max(1, Math.round(tRamp / PHY.DT));
  for (let i = 1; i <= n; i++) { R.aimSet(W, p * i / n, theta); R.stepW(W); if (fallen(W)) return false; }
  for (let i = 0; i < Math.round(hold / PHY.DT); i++) { R.stepW(W); if (fallen(W)) return false; }
  return true;
}
/** 발사 → 다 멈출 때까지 (0.4초 고요 또는 4.5초) */
function shoot(W, theta, p) {
  clearFell(W);
  R.aimSet(W, p, theta); run(W, 30);
  if (fallen(W)) { R.aimCancel(W); run(W, 30); clearFell(W); return { fellInPull: true }; }
  const b0 = W.buckets, blocks0 = W.blocks.length, moles0 = W.moles.length;
  if (!R.aimRelease(W)) return { cancel: true };
  let q = 0, t = 0;
  W.kingJmax = 0; W.kingPmax = 0;
  while (t < 270) { R.stepW(W); t++; q = R.quiet(W) && t > 30 ? q + 1 : 0; if (q >= 24) break; }
  const L = W.launch, track = L ? L.track : [], guide = L ? L.guide : [];
  let gerr = 0; for (let i = 0; i < Math.min(20, track.length); i++) gerr = Math.max(gerr, Math.hypot(track[i].x - guide[i].x, track[i].y - guide[i].y));
  const res = { buckets: b0 - W.buckets, broke: blocks0 - W.blocks.length, moles: moles0 - W.moles.length, kingJ: W.kingPmax || 0, steps: t, gerr, M: L && L.M };
  R.endTurn(W); return res;
}
const fmt = (o) => JSON.stringify(o, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v);

function stackTests() {
  console.log('== 쌓기 (받침 가운데 기준 비켜 놓기, m) ==');
  const cases = [
    [['kwang', 0], ['gil', 0]], [['kwang', 0], ['gil', 0.2]], [['kwang', 0], ['gil', 0.3]],
    [['gil', 0], ['gil', 0]], [['gil', 0], ['gil', 0.1]],
    [['mong', 0], ['mong', 0]], [['mong', 0], ['mong', 0.08]], [['mong', 0], ['mong', 0.15]],
    [['kwang', 0], ['mong', 0], ['mong', 0]], [['kwang', 0], ['gil', 0], ['mong', 0]], [['kwang', 0], ['kwang', 0], ['kwang', 0]],
    [['kwang', 0], ['gil', 0], ['kwang', 0]], [['mong', 0], ['kwang', 0]], [['puff', 0], ['mong', 0]],
  ];
  for (const c of cases) { const W = R.mkWorld(); c.forEach(([k, d]) => place(W, k, d)); run(W, 180); console.log(`  ${c.map(([k, d]) => NAME[k] + (d ? `(${d > 0 ? '+' : ''}${d})` : '')).join(' → ')}: ${fallen(W) ? `무너짐 ${fallen(W)}` : '섬'}`); }
  // 초보처럼: 트레이 순서대로 3~4마리, 가운데 ±0.25m 아무 데나
  const r = rng(7); const out = { 3: [0, 0], 4: [0, 0], 5: [0, 0] };
  for (let i = 0; i < 60; i++) for (const n of [3, 4, 5]) {
    const W = R.mkWorld(); const kinds = LEVEL.roster.slice((i * 3) % 6, (i * 3) % 6 + n);
    kinds.forEach(k => place(W, k, (r() * 2 - 1) * 0.25)); run(W, 120); out[n][0]++; if (fallen(W)) out[n][1]++;
  }
  console.log('  초보 쌓기(±0.25m) 무너짐 비율:', Object.entries(out).map(([n, [a, b]]) => `${n}마리 ${Math.round(100 * b / a)}%`).join(', '));
}
function pullTests() {
  console.log('== 당기기 (끝까지, 받침 속도·가속 상한 적용) ==');
  const stacks = [['kwang', 'gil'], ['kwang', 'gil', 'mong'], ['gil', 'gil'], ['kwang', 'mong', 'mong'], ['kwang', 'gil', 'kwang'], ['mong', 'mong']];
  for (const s of stacks) {
    const row = [];
    for (const th of [20, 35, 50, 70]) for (const ramp of [0.05, 0.4]) { const W = R.mkWorld(); s.forEach(k => place(W, k, 0)); run(W, 60); const ok = pull(W, th, 1, ramp, 2.0); row.push(`${th}°${ramp < 0.1 ? '확' : '천천'}:${ok ? 'O' : 'X'}`); }
    console.log(`  ${s.map(k => NAME[k]).join('→')}: ${row.join(' ')}`);
  }
}
function singleTests() {
  console.log('== 혼자 쏘기: 각도 20~75 × 세기 0.15~1 전부 — 양동이를 깨면 안 됨 (왕을 받침에서 떨어뜨리면 1개 예외) ==');
  let maxJ = 0;
  for (const k of ['mong', 'gil', 'kwang', 'puff']) {
    let best = null;
    for (let th = 20; th <= 75; th += 5) for (let p = 0.15; p <= 1.001; p += 0.05) {
      const W = R.mkWorld(); place(W, k, 0); const r = shoot(W, th, p);
      if (r.cancel || r.fellInPull) continue;
      if (!best || r.buckets > best.buckets || (r.buckets === best.buckets && r.kingJ > best.kingJ)) best = Object.assign({ th, p }, r);
    }
    maxJ = Math.max(maxJ, best.kingJ);
    console.log(`  ${NAME[k]}: 최대 양동이 ${best.buckets}, 왕자리 운동량 최대 ${best.kingJ.toFixed(1)} (${best.th}°, ${best.p.toFixed(2)}) · 가이드 오차 ${best.gerr.toExponential(1)}m`);
  }
  console.log(`  → 혼자는 규칙상 양동이 0 (왕 자리에 둘 이상 함께 와야 벗겨짐) · 혼자 최대 운동량 ${maxJ.toFixed(1)} · 1개당 K_P=${PHY.K_P}`);
}
function towerTests() {
  console.log('== 탑 한 발: 각도 × 세기 격자에서 최선 ==');
  for (const s of [['kwang', 'gil', 'mong'], ['kwang', 'mong', 'mong'], ['kwang', 'kwang', 'gil'], ['kwang', 'gil', 'mong', 'mong'], ['mong', 'mong']]) {
    let best = null, n = 0, hit = 0;
    for (let th = 20; th <= 75; th += 5) for (let p = 0.3; p <= 1.001; p += 0.05) {
      const W = R.mkWorld(); s.forEach(k => place(W, k, 0)); run(W, 60); const r = shoot(W, th, p);
      if (r.cancel || r.fellInPull) continue; n++; if (r.buckets) hit++;
      if (!best || r.buckets > best.buckets || (r.buckets === best.buckets && r.broke > best.broke)) best = Object.assign({ th, p }, r);
    }
    console.log(`  ${s.map(k => NAME[k]).join('→')}: 최대 양동이 ${best.buckets} (${best.th}°, ${best.p.toFixed(2)}, 블록 ${best.broke}) · 양동이 깨는 조합 ${hit}/${n}`);
  }
}
/** 초보 정책: 트레이 순서대로 3~4마리를 가운데 ±off m, 각도 35~55°, 세기는 가이드를 보고 왕 근처를 노리되 ±12% 오차.
 *  쌓다 떨어진 친구는 게임처럼 "어질" → 이번 발사만 못 쓰고 트레이 끝으로 돌아옴. */
function aimFor(W, theta, tx, ty) {
  const g = R.groupOf(W), c = R.comOf(g); if (!c) return 0.5;
  const th = theta * Math.PI / 180, dx = tx - c.x, dy = ty - c.y, den = 2 * Math.cos(th) ** 2 * (dx * Math.tan(th) - dy);
  if (den <= 0) return 1;
  const v = Math.sqrt(PHY.G * dx * dx / den); return Math.min(1, v / (PHY.V_MAX * Math.sqrt(PHY.M0 / (PHY.M0 + c.M))));
}
function novice(seed, perShot, off) {
  const r = rng(seed), W = R.mkWorld(); let flags = LEVEL.flags; const tray = LEVEL.roster.slice(), log = [];
  const backToTray = () => W.friends.filter(b => b.ud.state === 'fell').forEach(b => { tray.push(b.ud.kind); R.removeFriend(W, b); });
  let guard = 0;
  while (flags > 0 && W.buckets > 0 && guard++ < 12) {
    const n = Math.min(perShot + (r() < 0.5 ? 1 : 0), tray.length);
    const dizzy = [];
    for (let i = 0; i < n; i++) { place(W, tray.shift(), (r() * 2 - 1) * off); W.friends.filter(b => b.ud.state === 'fell').forEach(b => { dizzy.push(b.ud.kind); R.removeFriend(W, b); }); }
    run(W, 30); W.friends.filter(b => b.ud.state === 'fell').forEach(b => { dizzy.push(b.ud.kind); R.removeFriend(W, b); });
    if (!R.stackFriends(W).length) { tray.push(...dizzy); if (!tray.length) break; continue; }
    const kp = W.king.getPosition(), th = 40 + r() * 25, noise = [0.15, 0.08, 0.05, 0.05][Math.min(3, LEVEL.flags - flags)], p = aimFor(W, th, kp.x, kp.y) * (1 + (r() * 2 - 1) * noise);
    const res = shoot(W, th, Math.min(1, p)); if (!res.cancel && !res.fellInPull) flags--;
    log.push(res); backToTray(); tray.push(...dizzy);
    R.endTurn(W);
    if (!tray.length && !R.stackFriends(W).length) break;
  }
  return W.buckets === 0 ? { win: true, flags, log } : { win: false, left: W.buckets, log };
}
function noviceTests() {
  console.log(`== 초보 정책 (40~65°, 가이드·지난 궤적 보고 왕 근처: 세기 오차 ±15% → 8% → 5%) · 깃발 ${LEVEL.flags} ==`);
  for (const off of [0.12, 0.25]) for (const per of [2, 3]) {
    let w = 0, N = 40, fl = 0, b = 0;
    for (let s = 1; s <= N; s++) { const r = novice(s * 31 + per, per, off); if (r.win) { w++; fl += r.flags; } b += 3 - (r.left || 0); }
    console.log(`  가운데 ±${off}m · 한 번에 ${per}~${per + 1}마리: 승률 ${Math.round(100 * w / N)}% · 평균 깬 양동이 ${(b / N).toFixed(1)} · 이긴 판 남은 깃발 ${(fl / Math.max(1, w)).toFixed(1)}`);
  }
}
module.exports = { clearFell, R, PHY, LEVEL, NAME, rng, run, place, fallen, pull, shoot, aimFor, novice, fmt };
if (require.main === module) {
const mode = process.argv[2] || 'all';
const T0 = Date.now();
if (mode === 'stack' || mode === 'all') stackTests();
if (mode === 'pull' || mode === 'all') pullTests();
if (mode === 'single' || mode === 'all') singleTests();
if (mode === 'tower' || mode === 'all') towerTests();
if (mode === 'novice' || mode === 'all') noviceTests();
console.log(`(${((Date.now() - T0) / 1000).toFixed(1)}초)`);
}
