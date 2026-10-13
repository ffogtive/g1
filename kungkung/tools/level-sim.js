#!/usr/bin/env node
/**
 * 킁킁! 판 난이도 측정기 — 사람처럼 반응하는 봇으로 "판 매개변수 → 승률"을 실측한다.
 *
 * 가설: 반응만 하는 사람의 승률은 주로 "앙 시간 − 반응 시간 − 이동 시간"의 여유로 정해지고,
 *       예고 길이·패턴 가중치는 2차 손잡이다. 기획서 난이도 숫자는 이 표에서 가져온다.
 *
 * - real.html(실사 v3 시험판)의 공격 실행기를 그대로 옮겼다:
 *   PAT 단계(예고→잠금→앙→문 채→고개 듦), SCHEDULE·pickKind, 잠금 = 칸 중심, 안전 구간 48px(ensureSafe),
 *   판정(무는 순간 쿠키 중심이 빨간 원 안 && 무적 아님), 히트스톱, 물린 뒤 무적 0.9초, 연타 재예고 0.34초, 하트.
 *   real.html은 고치지 않는다(읽기만). 화면은 390×844(iPhone, E2E와 같은 크기)의 resize() 계산값.
 * - 의존성 없음. 시드 고정 난수(mulberry32, real.html과 같은 함수). 판마다 같은 시드를 써서(공통 난수) 비교 잡음을 줄인다.
 *
 * 사용:
 *   node kungkung/tools/level-sim.js --preset all --runs 300        대표 판 표 + 민감도 표
 *   node kungkung/tools/level-sim.js --preset mid --runs 500         대표 판 하나
 *   node kungkung/tools/level-sim.js --preset sens                   민감도 표만
 *   node kungkung/tools/level-sim.js --level '{"lanes":6,"lunge":0.4,"interval":1.2,"weights":{"kung":3,"double":1}}'
 *   node kungkung/tools/level-sim.js --preset all --bot '{"rtMean":0.32}'
 *   --seed N (기본 1) · --json (표 대신 JSON)
 *
 * 판 매개변수 (JSON):
 *   seed, lanes(3|6), interval(공격 끝~다음 공격 시작 쉬는 초, real.html처럼 ×0.75~1.25 흔듦; 숫자 또는 [처음, 끝] 판 안에서 직선),
 *   tell(예고 초; 크게 킁 = tell+0.5, 처음 보는 패턴은 ×1.5 — real.html 그대로), lunge(앙 돌진 초; 숫자 또는 [처음, 끝]),
 *   weights{kung, big, feint, hold, double, triple}, hearts, duration(판 길이 초 — 버티면 승리), mode:'real'(real.html 무한 모드 그대로)
 */
'use strict';

/* ---------------- real.html에서 옮긴 값 ---------------- */
const RULE = { HIT_R: 62, SAFE: 48, BIG_R: 96 };
const RETELL = 0.34, COMBO_BACK = 0.24;
const HS = { kung: 0.06, big: 0.08, combo: 0.05 };          // 히트스톱(초): 게임 시계만 멈추고 끌기는 계속
const SCHEDULE = [['kung', 0], ['big', 10], ['feint', 16], ['hold', 22], ['double', 32], ['triple', 42]];
const FOLLOW = 18;                                          // C.x += (tx - C.x) * dt * 18 (쿠키가 손가락을 따라감)
const INV = 0.9;                                            // 물린 뒤 무적
const DT = 1 / 120;
const KINDS = ['kung', 'big', 'feint', 'hold', 'double', 'triple'];
const KO = { kung: '킁', big: '크게', feint: '가짜', hold: '멈칫', double: '두번', triple: '세번' };

/** real.html resize()를 390×844로 돌린 값 (칸 = 강아지가 무는 자리) */
function layout(Wl = 390, Hl = 844) {
  const cover = Math.max(Wl / 720, Hl / 1280), ov = Math.max(1.06, (Wl + 2 * 46) / (720 * cover));
  const VB = { w: 720 * cover * ov, h: 1280 * cover * ov }; VB.x = (Wl - VB.w) / 2;
  VB.y = Math.max(Hl - VB.h, Math.min(0, Hl - Math.max(66, Hl * 0.09) - VB.h * 0.89));
  const BUDGET = (VB.w - Wl) / 2 - 2;
  const biteX = bx => VB.x + VB.w * bx;
  const out = Math.min(Wl * 0.78, biteX(0.60) + BUDGET);    // SNAP.r2.bite.x = 0.60, SNAP.c = 0.50
  return { Wl, Hl, VB, BUDGET, laneX: [Wl - out, biteX(0.50), out], holdC: biteX(0.50), lo: 46, hi: Wl - 46,
           rowGap: VB.h * (0.895 - 0.845) };                // 실측: 앞줄 무는 높이 y≈0.89~0.90, 뒷줄 y≈0.845 (프레임 비율)
}
const LY = layout();

/* ---------------- 6칸(3열×2줄) 가정 — 뒷줄 클립이 다 나오면 실측으로 바꿀 것 ----------------
 * 가정 1: 뒷줄은 멀어서 칸 가로 간격이 앞줄의 0.8배(가운데 기준으로 좁아짐). (실측 머리 크기 0.7배에서 추정)
 * 가정 2: 앞뒤 줄 화면 간격 = 실측 무는 높이 차 ≈ 0.05 × 영상 높이 ≈ 45px. 쿠키는 손가락을 1:1로 따라 앞뒤로도 움직인다.
 * 가정 3: 판정 타원 세로 반지름 = 앞뒤 간격의 0.6 (원 납작 비율 ≈0.43). 지금 그림(FL 0.28)대로면 두 줄 사이에
 *         어느 원에도 안 걸리는 틈이 생기므로, 줄 사이 빈틈이 없게 둥글게 그린다고 가정.
 * 가정 4: 뒷줄은 판정 타원이 앞줄의 0.8배(가로·세로 모두), 앙이 0.1초 느리다(멀어서 머리가 움직이는 거리가 화면에서 짧고 느려 보임).
 * 가정 5: 6칸에서는 피할 곳 후보가 2→5개라 선택 반응이 길어진다(Hick, 1비트 +40ms 추정). --bot '{"hick":0}'으로 끌 수 있다.
 */
const G6 = { backX: 0.8, backR: 0.8, backLunge: 0.1, kY: 0.6 * LY.rowGap / RULE.HIT_R };
function cellsOf(lanes) {
  const c = LY.holdC, front = LY.laneX.map((x, i) => ({ x, y: 0, row: 0, i }));
  if (lanes !== 6) return front;
  return front.concat(LY.laneX.map((x, i) => ({ x: c + (x - c) * G6.backX, y: -LY.rowGap, row: 1, i: i + 3 })));
}

/* ---------------- 사람 같은 봇 (기본값) ---------------- */
const BOT = {
  rtMean: 0.25, rtSd: 0.06, rtMin: 0.15,   // 빨간 원(잠금)을 본 뒤 반응 시간 (정규분포, 최소 150ms)
  speed: 1800,                             // 손가락 끌기 속도 상한 (화면 px/s, 직선·대각선 모두 화면 거리)
  pMistake: 0.05,                          // 엉뚱한 칸 선택 (모든 칸 중 아무 데나 — 위험한 칸이면 반응 시간 뒤 다시 고침)
  pFooled: 0.15,                           // 가짜(흰 원 돌진)에 속아 피하는 확률
  fooledPenalty: 0.10,                     // 속은 뒤 다음 진짜 잠금 반응이 늦어지는 시간 (추정)
  hick: 0.04,                              // 6칸 선택 반응 추가 (추정)
  aim: 6,                                  // 손가락 놓는 자리 흔들림 σ (px)
  padX: 24, padY: 12,                      // 피할 때 원 가장자리에서 띄우는 여유 (px)
  watchX: 8, watchY: 4                     // "내가 원 안(또는 바로 옆)이다"라고 느끼는 범위
};

/* ---------------- 난수 ---------------- */
function mulberry(a) { return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gaussOf(rng) { return function () { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }; }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function makePAT(L) {
  const T = L.tell;
  return {
    kung:   { steps: [{ k: 'tell', d: T }, { k: 'lunge' }, { k: 'stamp' }, { k: 'back' }] },
    big:    { big: 1, steps: [{ k: 'tell', d: T + 0.5, grow: RULE.BIG_R }, { k: 'lunge' }, { k: 'stamp' }, { k: 'back' }] },
    hold:   { steps: [{ k: 'tell', d: T }, { k: 'hold' }, { k: 'lunge', d: 0.16 }, { k: 'stamp' }, { k: 'back' }] },
    feint:  { steps: [{ k: 'tell', d: T }, { k: 'lunge', d: 0.6, fake: 1 }, { k: 'tilt', d: 1.4 }, { k: 'tell', d: 0.45 }, { k: 'lunge' }, { k: 'stamp' }, { k: 'back' }] },
    double: { reps: 2, steps: [{ k: 'tell', d: T }, { k: 'lunge' }, { k: 'stamp', d: 0.22 }, { k: 'back' }] },
    triple: { reps: 3, steps: [{ k: 'tell', d: T }, { k: 'lunge' }, { k: 'stamp', d: 0.22 }, { k: 'back' }] }
  };
}

/* ---------------- 한 판 ---------------- */
function simulate(L, B, seed) {
  const g = mulberry(seed >>> 0);                                   // 게임 난수 (공격당 4번, real.html과 같은 횟수)
  const br = mulberry((Math.imul(seed, 2654435761) ^ 0x5bd1e995) >>> 0), gauss = gaussOf(br);   // 봇 난수
  const six = L.lanes === 6, cells = cellsOf(L.lanes), PAT = makePAT(L);
  const yLo = six ? -LY.rowGap : 0, yHi = 0;
  const C = { x: LY.Wl / 2, y: 0, inv: 0 };
  const bot = { fx: C.x, fy: C.y, tgt: { x: C.x, y: 0 }, pending: null, fooledPen: 0 };
  const S = { attacks: 0, impacts: 0, bites: 0, dodges: 0, mistakes: 0, fooled: 0, warn: 0, byKind: {}, tEnd: 0 };
  let T = 0, play = 0, hearts = L.hearts, atk = null, nextAtk = 2.0, freeze = 0; const seen = {};

  const ramp = v => Array.isArray(v) ? v[0] + (v[1] - v[0]) * Math.min(1, play / L.duration) : v;
  const lungeNow = () => L.mode === 'real' ? Math.max(0.32, 0.5 - play * 0.003) : ramp(L.lunge);
  const intervalNow = () => L.mode === 'real' ? Math.max(0.8, 1.7 - play * 0.022) : ramp(L.interval);
  function nearestCell(x, y) { let best = cells[0], bd = 1e9; for (const c of cells) { const d = Math.hypot(c.x - x, c.y - y); if (d < bd) { bd = d; best = c; } } return best; }
  function zoneAt(x, y, row, r) { const s = row === 1 ? G6.backR : 1; return { x, y, rx: r * s, ry: r * G6.kY * s }; }
  function inZone(p, z, ex = 0, ey = 0) {
    if (!six) return Math.abs(p.x - z.x) < z.rx + ex;
    const u = (p.x - z.x) / (z.rx + ex), v = (p.y - z.y) / (z.ry + ey); return u * u + v * v < 1;
  }
  function zoneOf(a) { return zoneAt(a.lockX, a.lockY, a.row, a.r); }
  function freeLen(lo0, hi0) {   // real.html freeLen (구간 하나)
    const lo = LY.lo, hi = LY.hi, a = Math.max(lo, lo0), b = Math.min(hi, hi0);
    if (b <= a) return hi - lo; return Math.max(a - lo, hi - b);
  }
  function ensureSafe(a) {       // 3칸: real.html 그대로. 6칸: 원 하나가 덮는 칸은 하나라 늘 다른 칸 2개 이상이 남음(검사 생략)
    if (six) return; const f = freeLen(a.lockX - a.r, a.lockX + a.r);
    if (f < RULE.SAFE) { S.warn++; a.r = Math.max(30, a.r - (RULE.SAFE - f)); }
  }
  function pickKind() {
    const r = g();
    if (L.mode === 'real') {
      const avail = SCHEDULE.filter(e => play >= e[1]).map(e => e[0]);
      for (let i = 1; i < avail.length; i++) if (!seen[avail[i]]) return avail[i];
      const sum = avail.length + 1; let acc = 0;
      for (let i = 0; i < avail.length; i++) { acc += (i === 0 ? 2 : 1) / sum; if (r < acc) return avail[i]; }
      return avail[avail.length - 1];
    }
    const ks = KINDS.filter(k => (L.weights[k] || 0) > 0), tot = ks.reduce((s, k) => s + L.weights[k], 0);
    let acc = 0; for (const k of ks) { acc += L.weights[k] / tot; if (r < acc) return k; } return ks[ks.length - 1];
  }
  function startAttack(kind) {
    const P = PAT[kind];
    const a = { kind, P, i: -1, st: null, t: 0, dur: 0, tx: C.x, ty: C.y, lockX: null, lockY: 0, row: 0, locked: false, r: RULE.HIT_R,
                fake: false, rep: 1, caught: false, retell: false, first: !seen[kind], held: false, fooled: null };
    a.laneRoll = g(); a.holdD = 0.5 + g() * 0.4; a.nextIv = intervalNow() * (0.75 + g() * 0.5);
    seen[kind] = true; atk = a; S.attacks++; nextStep(a);
  }
  function endAttack() { nextAtk = atk ? atk.nextIv : 1.5; atk = null; }
  function nextStep(a) {
    a.i++;
    if (a.i >= a.P.steps.length) {
      if (a.P.reps && a.rep < a.P.reps && !a.caught && hearts > 0) { a.rep++; a.i = 0; a.retell = true; }
      else { endAttack(); return; }
    }
    a.st = a.P.steps[a.i]; a.t = 0; enterStep(a);
  }
  function stepDur(a) {
    const st = a.st; let d = st.d;
    if (st.k === 'lunge' && d == null) d = lungeNow();
    if (st.k === 'hold') d = 0.25 + a.holdD;
    if (st.k === 'stamp') d = a.caught ? 0.45 : (st.d || 0.3);
    if (st.k === 'tell' && a.retell && a.i === 0) d = RETELL;
    else if (st.k === 'tell' && a.first && a.i === 0) d *= 1.5;
    return d;
  }
  function lock(a) { if (a.locked) return; const c = nearestCell(a.tx, a.ty); a.lockX = c.x; a.lockY = c.y; a.row = c.row; a.locked = true; ensureSafe(a); }
  const holdBudget = row => LY.BUDGET * (row === 1 ? G6.backX : 1);
  function enterStep(a) {
    const st = a.st; a.dur = stepDur(a);
    if (st.k === 'tell') {
      a.locked = false; a.fake = false; if (!st.grow) a.r = RULE.HIT_R;
      if (a.retell && a.i === 0) { a.tx = C.x; a.ty = C.y; lock(a); }        // 연타: 지금 쿠키 자리를 바로 잠금
    } else if (st.k === 'lunge') {
      a.fake = !!st.fake;
      if (!a.fake) { lock(a); if (six && a.row === 1) a.dur += G6.backLunge; }
    } else if (st.k === 'hold') {   // 멈칫: 가운데 클립을 영상 밀기 범위 안에서 쿠키 쪽으로
      const c = nearestCell(a.tx, a.ty), bud = holdBudget(c.row);
      a.held = true; a.locked = true; a.row = c.row; a.lockY = c.y; a.lockX = clamp(a.tx, LY.holdC - bud, LY.holdC + bud); ensureSafe(a);
    } else if (st.k === 'back') {
      a.dur = a.caught ? (a.held ? 1.0 : 1.6) : (a.P.reps && a.rep < a.P.reps && hearts > 0) ? COMBO_BACK : a.held ? 0.6 : 0.45;
    }
  }
  function impact(a) {
    const hit = inZone(C, zoneOf(a)) && C.inv <= 0;
    for (let j = a.i; j < a.P.steps.length; j++) if (a.P.steps[j].k === 'stamp') { a.i = j; break; }
    a.st = a.P.steps[a.i]; a.caught = hit; a.t = 0; a.dur = stepDur(a);
    S.impacts++; freeze = a.P.big ? HS.big : a.P.reps ? HS.combo : HS.kung;
    if (hit) { hearts--; C.inv = INV; S.bites++; S.byKind[a.kind] = (S.byKind[a.kind] || 0) + 1; } else S.dodges++;
  }
  function updateAttack(dt) {
    if (!atk) { nextAtk -= dt; if (nextAtk <= 0 && hearts > 0) startAttack(pickKind()); return; }
    const a = atk; a.t += dt; const k = a.st.k, q = Math.min(1, a.t / a.dur);
    if (k === 'tell') {
      if (!a.locked) { const f = Math.min(1, dt * 7); a.tx += (C.x - a.tx) * f; a.ty += (C.y - a.ty) * f; }   // 흰 원이 쿠키를 따라옴
      if (a.st.grow) a.r = RULE.HIT_R + (a.st.grow - RULE.HIT_R) * Math.min(1, q * 1.4);
    } else if (k === 'lunge') {
      if (a.fake) { const f = Math.min(1, dt * 3); a.tx += (C.x - a.tx) * f; a.ty += (C.y - a.ty) * f; }
      if (q >= 1) { if (a.fake) nextStep(a); else impact(a); return; }
    } else if (k === 'hold') {   // 빨간 원이 쿠키 쪽으로 50px/s 슬금슬금 (밀 수 있는 만큼)
      const bud = holdBudget(a.row);
      a.lockX = clamp(a.lockX + clamp(C.x - a.lockX, -50 * dt, 50 * dt), LY.holdC - bud, LY.holdC + bud);
    } else if (k === 'tilt') { const f = Math.min(1, dt * 7); a.tx += (C.x - a.tx) * f; a.ty += (C.y - a.ty) * f; }
    if (atk === a && a.t >= a.dur) nextStep(a);
  }

  /* ---- 봇: 빨간 원만 보고 반응 (흰 원은 무시, 가끔 가짜에 속음) ---- */
  function seenZone() {
    const a = atk; if (!a || !a.st) return null; const k = a.st.k;
    if (a.locked && (k === 'lunge' || k === 'hold' || k === 'tell')) return zoneOf(a);
    if (k === 'lunge' && a.fake) {
      if (a.fooled == null) { a.fooled = br() < B.pFooled; if (a.fooled) S.fooled++; }
      if (a.fooled) { const c = nearestCell(a.tx, a.ty), z = zoneAt(c.x, c.y, c.row, RULE.HIT_R); z.fake = true; return z; }
    }
    return null;
  }
  function reaction(z) {
    let rt = Math.max(B.rtMin, B.rtMean + B.rtSd * gauss()) + (six ? B.hick : 0);
    if (z.fake) bot.fooledPen = B.fooledPenalty;
    else if (bot.fooledPen) { rt += bot.fooledPen; bot.fooledPen = 0; }
    return rt;
  }
  function clampP(p) { return { x: clamp(p.x, LY.lo, LY.hi), y: clamp(p.y, yLo, yHi) }; }
  function choose(z) {
    let t;
    if (br() < B.pMistake) { const c = cells[Math.floor(br() * cells.length)]; t = { x: c.x, y: c.y }; S.mistakes++; }
    else {
      const pts = cells.map(c => ({ x: c.x, y: c.y }));   // 다른 칸 중심, 또는 원 가장자리 바로 밖 (가까운 쪽)
      if (!six) pts.push({ x: z.x - z.rx - B.padX, y: 0 }, { x: z.x + z.rx + B.padX, y: 0 });
      else for (let i = 0; i < 16; i++) { const th = i * Math.PI / 8; pts.push({ x: z.x + (z.rx + B.padX) * Math.cos(th), y: z.y + (z.ry + B.padY) * Math.sin(th) }); }
      let best = null, bd = 1e9;
      for (const p0 of pts) { const p = clampP(p0); if (inZone(p, z, B.padX * 0.5, B.padY * 0.5)) continue; const d = Math.hypot(p.x - C.x, p.y - C.y); if (d < bd) { bd = d; best = p; } }
      if (!best) { for (const c of cells) { const d = -Math.hypot(c.x - z.x, (c.y - z.y) * 2); if (d < bd) { bd = d; best = { x: c.x, y: c.y }; } } }
      t = best;
    }
    bot.tgt = clampP({ x: t.x + B.aim * gauss(), y: t.y + (six ? B.aim * gauss() : 0) });
  }
  function botTick(dt) {
    const z = seenZone();
    if (z && bot.pending == null && inZone(bot.tgt, z, B.watchX, B.watchY)) bot.pending = T + reaction(z);
    if (bot.pending != null && T >= bot.pending) { bot.pending = null; if (z && inZone(bot.tgt, z, B.watchX, B.watchY)) choose(z); }
    const dx = bot.tgt.x - bot.fx, dy = bot.tgt.y - bot.fy, d = Math.hypot(dx, dy), step = B.speed * dt;
    if (d <= step) { bot.fx = bot.tgt.x; bot.fy = bot.tgt.y; } else { bot.fx += dx / d * step; bot.fy += dy / d * step; }
  }

  while (true) {
    T += DT; let gdt = DT;
    if (freeze > 0) { freeze -= DT; gdt = 0; }
    botTick(DT);
    const f = Math.min(1, DT * FOLLOW); C.x = clamp(C.x + (bot.fx - C.x) * f, LY.lo, LY.hi); C.y = clamp(C.y + (bot.fy - C.y) * f, yLo, yHi);
    C.inv = Math.max(0, C.inv - DT);
    play += gdt; updateAttack(gdt);
    if (hearts <= 0) { S.tEnd = play; return { win: false, hearts: 0, ...S }; }
    if (play >= L.duration) { S.tEnd = play; return { win: true, hearts, ...S }; }
  }
}

/* ---------------- 여러 판 ---------------- */
const DEF = { lanes: 3, interval: 1.6, tell: 0.6, lunge: 0.45, weights: { kung: 1 }, hearts: 3, duration: 45 };
function runMany(L0, B, runs, seed0) {
  const L = { ...DEF, ...L0, weights: { ...(L0.weights || DEF.weights) } };
  const A = { runs, wins: 0, hearts: 0, bites: 0, impacts: 0, attacks: 0, mistakes: 0, fooled: 0, warn: 0, tLose: 0, loses: 0, byKind: {} };
  for (let i = 0; i < runs; i++) {
    const r = simulate(L, B, (Math.imul(seed0 + (L.seed || 0), 100003) + i * 7919) >>> 0);
    if (r.win) A.wins++; else { A.loses++; A.tLose += r.tEnd; }
    A.hearts += r.hearts; A.bites += r.bites; A.impacts += r.impacts; A.attacks += r.attacks; A.mistakes += r.mistakes; A.fooled += r.fooled; A.warn += r.warn;
    for (const k in r.byKind) A.byKind[k] = (A.byKind[k] || 0) + r.byKind[k];
  }
  return { L, win: A.wins / runs, hearts: A.hearts / runs, bites: A.bites / runs, impacts: A.impacts / runs, attacks: A.attacks / runs,
           biteRate: A.bites / Math.max(1, A.impacts), tLose: A.loses ? A.tLose / A.loses : null, warn: A.warn, byKind: A.byKind };
}

/* ---------------- 대표 판 ---------------- */
const ALLW = { kung: 3, big: 1, feint: 1, hold: 1, double: 1, triple: 1 };
const PRESETS = [
  { id: 'tutorial', name: '튜토리얼', where: '1~10판', lanes: 3, interval: 2.2, tell: 0.8, lunge: 0.6, weights: { kung: 1 }, hearts: 3, duration: 30 },
  { id: 'early', name: '초반 보통', where: '~100판', lanes: 3, interval: 1.8, tell: 0.7, lunge: 0.5, weights: { kung: 3, big: 1, feint: 1 }, hearts: 3, duration: 40 },
  { id: 'mid', name: '중반 보통', where: '~800판', lanes: 3, interval: 1.4, tell: 0.6, lunge: 0.44, weights: { kung: 3, big: 1, feint: 1, hold: 1, double: 1 }, hearts: 3, duration: 45 },
  { id: 'hard', name: '어려움', where: '~2000판', lanes: 3, interval: 1.2, tell: 0.55, lunge: 0.4, weights: ALLW, hearts: 3, duration: 50 },
  { id: 'vhard', name: '아주 어려움', where: '~3500판+', lanes: 3, interval: 1.0, tell: 0.5, lunge: 0.37, weights: ALLW, hearts: 3, duration: 60 },
  { id: 'six1', name: '6칸 첫 판', where: '6칸 도입', lanes: 6, interval: 2.0, tell: 0.7, lunge: 0.5, weights: { kung: 1 }, hearts: 3, duration: 40 },
  { id: 'six', name: '6칸 보통', where: '6칸 중반', lanes: 6, interval: 1.4, tell: 0.6, lunge: 0.42, weights: { kung: 3, big: 1, feint: 1, hold: 1, double: 1 }, hearts: 3, duration: 45 },
  { id: 'sixhard', name: '6칸 어려움', where: '6칸 후반', lanes: 6, interval: 1.1, tell: 0.55, lunge: 0.36, weights: ALLW, hearts: 3, duration: 60 },
  { id: 'real', name: '지금 시험판(real.html 무한)', where: '참고', lanes: 3, mode: 'real', tell: 0.6, lunge: '0.5→0.32', interval: '1.7→0.8', weights: null, hearts: 3, duration: 60 }
];

/* ---------------- 민감도 (기준 = 중반 보통, 하나씩만 바꿈) ---------------- */
function sensRows() {
  const base = PRESETS.find(p => p.id === 'mid'), R = [];
  R.push({ what: '기준(중반 보통)', val: `앙 ${base.lunge}·간격 ${base.interval}·3칸·반응 250ms`, L: base });
  for (const v of [0.6, 0.5, 0.45, 0.4, 0.35, 0.3]) R.push({ what: '앙 시간', val: v + '초', L: { ...base, lunge: v } });
  for (const v of [2.2, 1.8, 1.0, 0.7]) R.push({ what: '공격 간격', val: v + '초', L: { ...base, interval: v } });
  for (const v of [0.4, 0.9]) R.push({ what: '예고 길이', val: v + '초', L: { ...base, tell: v } });
  R.push({ what: '칸 수', val: '6칸 (Hick +40ms)', L: { ...base, lanes: 6 } });
  R.push({ what: '칸 수', val: '6칸 (Hick 0)', L: { ...base, lanes: 6 }, B: { hick: 0 } });
  for (const v of [0.2, 0.32]) R.push({ what: '반응 시간', val: Math.round(v * 1000) + 'ms', L: base, B: { rtMean: v } });
  for (const v of [1, 5]) R.push({ what: '하트', val: v + '개', L: { ...base, hearts: v } });
  return R;
}

/* ---------------- 출력 ---------------- */
const pct = v => (v * 100).toFixed(1) + '%';
const f2 = v => v.toFixed(2);
function wStr(w) { if (!w) return 'real.html SCHEDULE'; return KINDS.filter(k => w[k]).map(k => KO[k] + w[k]).join('·'); }
function presetTable(rows) {
  const out = ['| 판 | 위치(추정) | 칸 | 앙(초) | 예고 | 간격 | 패턴 가중치 | 하트 | 길이 | **승률** | 남은 하트 | 물림/판 | 판정/판 | 판정당 물림 |',
               '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const { p, r } of rows) out.push(`| ${p.name} | ${p.where} | ${p.lanes} | ${p.lunge} | ${p.tell} | ${p.interval} | ${wStr(p.weights)} | ${p.hearts} | ${p.duration}초 | **${pct(r.win)}** | ${f2(r.hearts)} | ${f2(r.bites)} | ${r.impacts.toFixed(1)} | ${pct(r.biteRate)} |`);
  return out.join('\n');
}
function sensTable(rows) {
  const out = ['| 바꾼 것 | 값 | **승률** | 남은 하트 | 물림/판 | 판정당 물림 |', '|---|---|---|---|---|---|'];
  for (const { s, r } of rows) out.push(`| ${s.what} | ${s.val} | **${pct(r.win)}** | ${f2(r.hearts)} | ${f2(r.bites)} | ${pct(r.biteRate)} |`);
  return out.join('\n');
}

function args() {
  const a = process.argv.slice(2), o = { preset: 'all', runs: 300, seed: 1, bot: {}, level: null, json: false };
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k === '--preset') o.preset = a[++i]; else if (k === '--runs') o.runs = +a[++i]; else if (k === '--seed') o.seed = +a[++i];
    else if (k === '--bot') o.bot = JSON.parse(a[++i]); else if (k === '--level') o.level = JSON.parse(a[++i]); else if (k === '--json') o.json = true;
    else if (k === '-h' || k === '--help') { console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0]); process.exit(0); }
  }
  return o;
}

function main() {
  const o = args(), B = { ...BOT, ...o.bot }, t0 = Date.now(), res = { layout: { laneX: LY.laneX.map(v => +v.toFixed(1)), rowGap: +LY.rowGap.toFixed(1), budget: +LY.BUDGET.toFixed(1) }, bot: B };
  const lines = [];
  if (o.level) {
    const r = runMany(o.level, B, o.runs, o.seed); res.level = r;
    lines.push(presetTable([{ p: { name: '사용자 판', where: '-', lanes: r.L.lanes, lunge: JSON.stringify(r.L.lunge), tell: r.L.tell, interval: JSON.stringify(r.L.interval), weights: r.L.weights, hearts: r.L.hearts, duration: r.L.duration }, r }]));
  } else {
    if (o.preset !== 'sens') {
      const list = o.preset === 'all' ? PRESETS : PRESETS.filter(p => p.id === o.preset);
      if (!list.length) { console.error('모르는 --preset: ' + o.preset + ' (all, sens, ' + PRESETS.map(p => p.id).join(', ') + ')'); process.exit(1); }
      const rows = list.map(p => ({ p, r: runMany(p, B, o.runs, o.seed) })); res.presets = rows.map(x => ({ id: x.p.id, ...x.r, L: undefined }));
      lines.push(`#### 대표 판 (봇 ${o.runs}판씩, 시드 ${o.seed})`, '', presetTable(rows), '');
    }
    if (o.preset === 'all') {   // 패턴별 위험도: 중반 보통 매개변수에서 그 패턴만
      const base = PRESETS.find(p => p.id === 'mid');
      const rows = KINDS.map(k => ({ k, r: runMany({ ...base, weights: { [k]: 1 } }, B, o.runs, o.seed) }));
      res.patterns = rows.map(x => ({ kind: x.k, win: x.r.win, biteRate: x.r.biteRate, perAtk: x.r.impacts / x.r.attacks }));
      lines.push(`#### 패턴별 (중반 보통 매개변수에서 그 패턴만, ${o.runs}판씩)`, '', '| 패턴 | **승률** | 물림/판 | 판정/공격 | 판정당 물림 |', '|---|---|---|---|---|');
      for (const { k, r } of rows) lines.push(`| ${KO[k]} | **${pct(r.win)}** | ${f2(r.bites)} | ${(r.impacts / r.attacks).toFixed(2)} | ${pct(r.biteRate)} |`);
      lines.push('');
    }
    if (o.preset === 'all' || o.preset === 'sens') {
      const rows = sensRows().map(s => ({ s, r: runMany(s.L, { ...B, ...(s.B || {}) }, o.runs, o.seed) })); res.sens = rows.map(x => ({ what: x.s.what, val: x.s.val, win: x.r.win, hearts: x.r.hearts, bites: x.r.bites, biteRate: x.r.biteRate }));
      lines.push(`#### 민감도 (기준 = 중반 보통에서 하나씩만 바꿈, ${o.runs}판씩)`, '', sensTable(rows), '');
    }
  }
  if (o.json) { console.log(JSON.stringify(res, null, 1)); return; }
  console.log(lines.join('\n'));
  console.log(`(화면 390×844: 칸 x = ${res.layout.laneX.join(' / ')}px, 앞뒤 줄 간격 ${res.layout.rowGap}px, 멈칫 밀기 ±${res.layout.budget}px · 봇 반응 ${Math.round(B.rtMean * 1000)}±${Math.round(B.rtSd * 1000)}ms · 끌기 ${B.speed}px/s · ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
}

if (require.main === module) main();
module.exports = { simulate, runMany, PRESETS, BOT, LY, cellsOf };
