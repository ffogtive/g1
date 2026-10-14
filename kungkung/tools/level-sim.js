#!/usr/bin/env node
/**
 * 킁킁! 판 난이도 측정기 — 사람처럼 반응하는 봇으로 "판 매개변수 → 승률"을 실측한다.
 *
 * 가설: 반응만 하는 사람의 승률은 주로 "앙 시간 − 반응 시간 − 이동 시간"의 여유로 정해지고,
 *       예고 길이·패턴 가중치는 2차 손잡이다. 기획서 난이도 숫자는 이 표에서 가져온다.
 *
 * - real.html(실사 3열×2줄 시험판)의 공격 실행기를 그대로 옮겼다:
 *   PAT 단계(예고→잠금→앙→문 채→고개 듦), SCHEDULE·pickKind(가짜·멈칫은 앞줄일 때만), 잠금 = 흰 원 줄의 가장 가까운 칸,
 *   판정(땅 X·줄: 같은 줄 && 빨간 타원 안 && 무적 아님), 크게 킁 십자, 쓸어 물기, 특기, 뒷줄 앙 ×1.25,
 *   안전 구간 S1(ensureSafe), 히트스톱, 물린 뒤 무적 0.9초, 연타 재예고 0.34초, 하트.
 *   쿠키는 땅 X(칸 단위)로 손가락을 따라가고, 줄은 0.12초 폴짝(50% 넘으면 새 줄)으로 바뀐다. 대각선 = 둘이 동시에.
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
 *   weights{kung, big, feint, hold, double, triple, special}, hearts, duration(판 길이 초 — 버티면 승리), mode:'real'(real.html 무한 모드 그대로),
 *   species: 'grey'(특기 앞발 콩콩, 앞줄) | 'ostrich'(특기 발 구르기, 뒷줄)
 */
'use strict';

/* ---------------- real.html(3열×2줄)에서 옮긴 값: 판정은 땅 X(칸 단위, 1칸 = 앞줄 105px)와 줄 ---------------- */
const RULE = { HIT: 0.59, BIG: 1.10, BIG3: 0.91, BIG_OTHER: 0.59, PAW: 0.50, SAFE: 0.46, MIN_R: 0.29, BACK_LUNGE: 1.25 };
const RETELL = 0.34, COMBO_BACK = 0.24, HOP = 0.12, XMAX = 1.42, FW = 105;
const HS = { kung: 0.06, big: 0.08, combo: 0.05, paw: 0.05 };   // 히트스톱(초): 게임 시계만 멈추고 끌기는 계속 (뒷줄 ×0.7)
const SCHEDULE = [['kung', 0], ['big', 10], ['feint', 16], ['hold', 22], ['double', 32], ['triple', 42], ['special', 48]];
const FOLLOW = 18;                                          // C.X += (tX - C.X) * dt * 18 (쿠키가 손가락을 따라감)
const INV = 0.9;                                            // 물린 뒤 무적
const DT = 1 / 120;
const KINDS = ['kung', 'big', 'feint', 'hold', 'double', 'triple', 'special'];
const KO = { kung: '킁', big: '크게', feint: '가짜', hold: '멈칫', double: '두번', triple: '세번', special: '특기' };
/** 특기: 회색이 앞발 콩콩(앞줄 바깥 칸, 0.43·1.14초에 두 번), 타조 발 구르기(뒷줄 바깥 칸, 1.38초에 한 번). 예고 0.5초(처음부터 빨강) */
const SPECIAL = { grey: { row: 0, taps: [0.43, 1.14], dX: [-0.15, 0.15], len: 1.5 }, ostrich: { row: 1, taps: [1.38], dX: [0], len: 2.0 } };

/** real.html resize()를 390×844로 돌린 값: 칸 = 동물이 무는 자리 (두 종 모두 앞줄 90/195/300, 뒷줄 122/195/268) */
function layout(Wl = 390, Hl = 844) {
  const YB = 80, cover = Math.max(Wl / 720, Hl / 1280), ov = Math.max(1.06, (Wl + 2 * 46) / (720 * cover), (Hl + YB) / (1280 * cover));
  const VB = { w: 720 * cover * ov, h: 1280 * cover * ov }; VB.x = (Wl - VB.w) / 2;
  const BUDGET = (VB.w - Wl) / 2 - 2;
  return { Wl, Hl, VB, BUDGET, front: [90, 195, 300], back: [122, 195, 268], holdSpan: BUDGET / FW, rowGap: VB.h * 0.045 };
}
const LY = layout();

/* ---------------- 사람 같은 봇 (기본값) ---------------- */
const BOT = {
  rtMean: 0.25, rtSd: 0.06, rtMin: 0.15,   // 빨간 원(잠금)을 본 뒤 반응 시간 (정규분포, 최소 150ms)
  speed: 1800,                             // 손가락 끌기 속도 상한 (화면 px/s, 직선·대각선 모두 화면 거리)
  pMistake: 0.05,                          // 엉뚱한 칸 선택 (모든 칸 중 아무 데나 — 위험한 칸이면 반응 시간 뒤 다시 고침)
  pFooled: 0.15,                           // 가짜(흰 원 돌진)에 속아 피하는 확률
  fooledPenalty: 0.10,                     // 속은 뒤 다음 진짜 잠금 반응이 늦어지는 시간 (추정)
  hick: 0.04,                              // 6칸 선택 반응 추가 (추정)
  aim: 6,                                  // 손가락 놓는 자리 흔들림 σ (px)
  pad: 0.23,                               // 피할 때 빨간 타원 가장자리에서 띄우는 여유 (칸, 앞줄 24px)
  watch: 0.08,                             // "내가 빨강 안(또는 바로 옆)이다"라고 느끼는 범위 (칸)
  hopDelay: 0.03                           // 쓸기 시작 → 폴짝 발동 (빠른 쓸기 약 20px)
};

/* ---------------- 난수 ---------------- */
function mulberry(a) { return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gaussOf(rng) { return function () { let u = 0; while (u === 0) u = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng()); }; }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function makePAT(L) {
  const T = L.tell;
  return {
    kung:    { steps: [{ k: 'tell', d: T }, { k: 'lunge' }, { k: 'stamp' }, { k: 'back' }] },
    big:     { big: 1, steps: [{ k: 'tell', d: T + 0.5, grow: 1 }, { k: 'lunge', d: L.mode === 'real' ? 0.48 : null }, { k: 'stamp' }, { k: 'back' }] },
    hold:    { steps: [{ k: 'tell', d: T }, { k: 'hold' }, { k: 'lunge', d: 0.16 }, { k: 'stamp' }, { k: 'back' }] },
    feint:   { steps: [{ k: 'tell', d: T }, { k: 'lunge', d: 0.6, fake: 1 }, { k: 'tilt', d: 1.4 }, { k: 'tell', d: 0.45 }, { k: 'lunge' }, { k: 'stamp' }, { k: 'back' }] },
    double:  { reps: 2, steps: [{ k: 'tell', d: T }, { k: 'lunge' }, { k: 'stamp', d: 0.22 }, { k: 'back' }] },
    triple:  { reps: 3, steps: [{ k: 'tell', d: T }, { k: 'lunge' }, { k: 'stamp', d: 0.22 }, { k: 'back' }] },
    special: { special: 1, steps: [{ k: 'tell', d: 0.5 }, { k: 'spec' }, { k: 'back' }] }
  };
}

/* ---------------- 한 판 ---------------- */
function simulate(L, B, seed) {
  const g = mulberry(seed >>> 0);                                   // 게임 난수 (공격당 3번, real.html과 같은 횟수)
  const br = mulberry((Math.imul(seed, 2654435761) ^ 0x5bd1e995) >>> 0), gauss = gaussOf(br);   // 봇 난수
  const six = L.lanes === 6, ROWS = six ? 2 : 1, PAT = makePAT(L), SPC = SPECIAL[L.species || 'grey'];
  const C = { X: 0, row: 0, rowT: 0, inv: 0 };
  const bot = { fX: 0, tgt: { X: 0, row: 0 }, pending: null, fooledPen: 0, hopAt: null };
  const S = { attacks: 0, impacts: 0, bites: 0, dodges: 0, mistakes: 0, fooled: 0, warn: 0, hops: 0, byKind: {}, tEnd: 0 };
  let T = 0, play = 0, hearts = L.hearts, atk = null, nextAtk = 2.0, freeze = 0; const seen = {};

  const ramp = v => Array.isArray(v) ? v[0] + (v[1] - v[0]) * Math.min(1, play / L.duration) : v;
  const lungeNow = () => L.mode === 'real' ? Math.max(0.32, 0.5 - play * 0.003) : ramp(L.lunge);
  const intervalNow = () => L.mode === 'real' ? Math.max(0.8, 1.7 - play * 0.022) : ramp(L.interval);
  const jr = () => ROWS < 2 ? 0 : C.rowT >= 0.5 ? 1 : 0;           // 폴짝이 50%를 넘으면 새 줄
  const nearestCol = X => clamp(Math.round(X) + 1, 0, 2);
  function hitsOf(a) {
    if (!a || !a.st) return []; const k = a.st.k, out = [];
    if (a.taps) { if (k === 'tell' || k === 'spec') a.taps.forEach(tp => { if (!tp.done) out.push({ row: tp.row, a: tp.X - a.r, b: tp.X + a.r }); }); return out; }
    if ((k === 'lunge' || k === 'hold' || k === 'tell') && a.locked) {
      let lo = a.lockX - a.r, hi = a.lockX + a.r;
      if (a.sweepFrom != null) { lo = Math.min(lo, a.sweepFrom - a.r); hi = Math.max(hi, a.sweepFrom + a.r); }
      out.push({ row: a.lockRow, a: lo, b: hi });
      if (a.rOther > 0 && six) out.push({ row: 1 - a.lockRow, a: a.lockX - a.rOther, b: a.lockX + a.rOther });
    }
    return out;
  }
  const inside = (hs, row, X, e = 0) => hs.some(h => h.row === row && X > h.a - e && X < h.b + e);
  function rowFree(hs, row) {
    let c = -XMAX, best = 0;
    hs.filter(h => h.row === row).map(h => [Math.max(-XMAX, h.a), Math.min(XMAX, h.b)]).filter(v => v[1] > v[0]).sort((p, q) => p[0] - q[0])
      .forEach(v => { if (v[0] > c) best = Math.max(best, v[0] - c); c = Math.max(c, v[1]); });
    return Math.max(best, XMAX - c);
  }
  function safeOK(a) {
    const hs = hitsOf(a); let band = false, cell = false;
    for (let r = 0; r < ROWS; r++) if (rowFree(hs, r) >= RULE.SAFE) band = true;
    for (let r = 0; r < ROWS; r++) for (let c = -1; c <= 1; c++) if (!inside(hs, r, c)) cell = true;
    return band && cell;
  }
  function ensureSafe(a) {
    if (safeOK(a)) return; S.warn++;
    if (a.sweepFrom != null) { a.sweepFrom = null; if (safeOK(a)) return; }
    for (let k = 0; k < 30 && !safeOK(a) && a.r > RULE.MIN_R; k++) a.r = Math.max(RULE.MIN_R, a.r - 0.03);
  }
  function eligible(kind) {
    if (kind === 'feint') return jr() === 0;
    if (kind === 'hold') return jr() === 0 && Math.abs(C.X) <= 0.52;
    if (kind === 'special') return six;
    return true;
  }
  function pickKind() {
    const r = g();
    if (L.mode === 'real') {
      const avail = SCHEDULE.filter(e => play >= e[1] && eligible(e[0])).map(e => e[0]);
      for (let i = 1; i < avail.length; i++) if (!seen[avail[i]]) return avail[i];
      const sum = avail.length + 1; let acc = 0;
      for (let i = 0; i < avail.length; i++) { acc += (i === 0 ? 2 : 1) / sum; if (r < acc) return avail[i]; }
      return avail[avail.length - 1];
    }
    const ks = KINDS.filter(k => (L.weights[k] || 0) > 0), tot = ks.reduce((s, k) => s + L.weights[k], 0);
    let acc = 0, pick = ks[ks.length - 1]; for (const k of ks) { acc += L.weights[k] / tot; if (r < acc) { pick = k; break; } }
    return eligible(pick) ? pick : 'kung';   // 가짜·멈칫은 앞줄일 때만 (아니면 그 타는 킁)
  }
  function startAttack(kind) {
    const P = PAT[kind];
    const a = { kind, P, i: -1, st: null, t: 0, dur: 0, tX: C.X, ringRow: jr(), lockX: null, lockRow: 0, locked: false, r: RULE.HIT, rOther: 0,
                fake: false, rep: 1, caught: false, retell: false, first: !seen[kind], held: false, fooled: null, taps: null, sweepFrom: null, prev: null };
    a.laneRoll = g(); a.holdD = 0.5 + g() * 0.4; a.nextIv = intervalNow() * (0.75 + g() * 0.5);
    seen[kind] = true; atk = a; S.attacks++;
    if (P.special) {   // 쿠키 쪽 바깥 칸에 처음부터 빨강
      const col = C.X < 0 ? -1 : 1; a.lockRow = SPC.row; a.r = RULE.PAW; a.locked = true;
      a.taps = SPC.taps.map((t, i) => ({ t, X: col + SPC.dX[i] * col, row: SPC.row, done: false })); a.lockX = a.taps[0].X;
    }
    nextStep(a);
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
    if (st.k === 'spec') d = SPC.len;
    if (st.k === 'tell' && a.retell && a.i === 0) d = RETELL;
    else if (st.k === 'tell' && a.first && a.i === 0) d *= 1.5;
    return d;
  }
  function lock(a) {
    if (a.locked) return;
    const row = ROWS < 2 ? 0 : a.ringRow; a.lockRow = row; a.lockX = nearestCol(a.tX) - 1; a.locked = true;
    a.sweepFrom = six && a.P.reps && a.prev && a.prev.row === row && a.prev.X !== a.lockX ? a.prev.X : null;   // 쓸어 물기
    if (a.P.big) { a.r = six ? RULE.BIG : RULE.BIG3; a.rOther = six ? RULE.BIG_OTHER : 0; }                 // 크게 킁: 십자
    ensureSafe(a);
  }
  function enterStep(a) {
    const st = a.st; a.dur = stepDur(a);
    if (st.k === 'tell') {
      if (a.P.special) return;
      a.locked = false; a.fake = false; a.sweepFrom = null; if (!st.grow) { a.r = RULE.HIT; a.rOther = 0; }
      if (a.retell && a.i === 0) { a.tX = C.X; a.ringRow = jr(); lock(a); }        // 연타: 지금 쿠키 자리를 바로 잠금
    } else if (st.k === 'lunge') {
      a.fake = !!st.fake;
      if (!a.fake) { lock(a); if (!a.held && a.lockRow === 1) a.dur *= RULE.BACK_LUNGE; }   // 뒷줄 앙 ×1.25
    } else if (st.k === 'hold') {   // 멈칫: 앞줄 가운데 클립을 밀기 범위 안에서 쿠키 쪽으로
      a.held = true; a.locked = true; a.lockRow = 0; a.r = RULE.HIT; a.lockX = clamp(a.tX, -LY.holdSpan, LY.holdSpan); a.hold0 = a.lockX; ensureSafe(a);
    } else if (st.k === 'back') {
      if (a.P.special) { a.dur = 0.02; return; }
      a.prev = { row: a.lockRow, X: a.lockX };
      a.dur = a.caught ? (a.held ? 1.0 : 1.6) : (a.P.reps && a.rep < a.P.reps && hearts > 0) ? COMBO_BACK * (a.lockRow ? 1.25 : 1) : a.held ? 0.6 : 0.45;
    }
  }
  function impact(a) {
    const hit = inside(hitsOf(a), jr(), C.X) && C.inv <= 0;
    for (let j = a.i; j < a.P.steps.length; j++) if (a.P.steps[j].k === 'stamp') { a.i = j; break; }
    a.st = a.P.steps[a.i]; a.caught = hit; a.t = 0; a.dur = stepDur(a);
    S.impacts++; freeze = (a.P.big ? HS.big : a.P.reps ? HS.combo : HS.kung) * (a.lockRow ? 0.7 : 1);
    if (hit) { hearts--; C.inv = INV; S.bites++; S.byKind[a.kind] = (S.byKind[a.kind] || 0) + 1; } else S.dodges++;
  }
  function stomp(a, tp) {
    const inn = jr() === tp.row && Math.abs(C.X - tp.X) < a.r;
    S.impacts++; freeze = HS.paw * (tp.row ? 0.7 : 1);
    if (inn && C.inv <= 0) { hearts--; C.inv = INV; S.bites++; a.caught = true; S.byKind[a.kind] = (S.byKind[a.kind] || 0) + 1; } else if (!inn) S.dodges++;
  }
  function updateAttack(dt) {
    if (!atk) { nextAtk -= dt; if (nextAtk <= 0 && hearts > 0) startAttack(pickKind()); return; }
    const a = atk; a.t += dt; const k = a.st.k, q = Math.min(1, a.t / a.dur);
    const follow = f => { a.tX += (C.X - a.tX) * Math.min(1, dt * f); a.ringRow = jr(); };   // 흰 원이 쿠키를 따라옴 (줄은 0.1초, 여기선 바로)
    if (k === 'tell') {
      if (!a.locked && !a.P.special) follow(7);
      if (a.st.grow && !a.locked) a.r = RULE.HIT + ((six ? RULE.BIG : RULE.BIG3) - RULE.HIT) * Math.min(1, q * 1.4);
    } else if (k === 'lunge') {
      if (a.fake) follow(3);
      if (q >= 1) { if (a.fake) nextStep(a); else impact(a); return; }
    } else if (k === 'hold') {   // 빨간 원이 쿠키 쪽으로 50px/s 슬금슬금 (밀 수 있는 만큼). 뒷줄로 가면 따라가지 않음
      if (jr() === 0) a.lockX = clamp(a.lockX + clamp(C.X - a.lockX, -50 / FW * dt, 50 / FW * dt), Math.max(-LY.holdSpan, a.hold0 - 0.34), Math.min(LY.holdSpan, a.hold0 + 0.34));   // 처음 자리 ±0.34칸
    } else if (k === 'tilt') follow(7);
    else if (k === 'spec') a.taps.forEach(tp => { if (!tp.done && a.t >= tp.t) { tp.done = true; stomp(a, tp); } });
    if (atk === a && a.t >= a.dur) nextStep(a);
  }

  /* ---- 봇: 빨간 타원만 보고 반응 (흰 원은 무시, 가끔 가짜에 속음). 가장 빨리 닿는 안전한 (X, 줄)을 고름 ---- */
  function seenHits() {
    const a = atk; if (!a || !a.st) return null; const k = a.st.k, hs = hitsOf(a);
    if (hs.length) return hs;
    if (k === 'lunge' && a.fake) {
      if (a.fooled == null) { a.fooled = br() < B.pFooled; if (a.fooled) S.fooled++; }
      if (a.fooled) { const X = nearestCol(a.tX) - 1, z = [{ row: a.ringRow, a: X - RULE.HIT, b: X + RULE.HIT }]; z.fake = true; return z; }
    }
    return null;
  }
  function reaction(z) {
    let rt = Math.max(B.rtMin, B.rtMean + B.rtSd * gauss()) + (six ? B.hick : 0);
    if (z.fake) bot.fooledPen = B.fooledPenalty;
    else if (bot.fooledPen) { rt += bot.fooledPen; bot.fooledPen = 0; }
    return rt;
  }
  const moveTime = (dX, dRow) => Math.max(Math.abs(dX) * FW / B.speed + 0.13 * Math.min(1, Math.abs(dX) * 3), dRow ? B.hopDelay + HOP * 0.5 : 0);   // 대각선 = 둘 중 긴 쪽
  function choose(z) {
    let t;
    if (br() < B.pMistake) { t = { X: Math.floor(br() * 3) - 1, row: Math.floor(br() * ROWS) }; S.mistakes++; }
    else {
      let best = null, bd = 1e9;
      for (let row = 0; row < ROWS; row++) for (let X = -1.36; X <= 1.3601; X += 0.04) {
        if (inside(z, row, X, B.pad)) continue;
        const d = moveTime(X - C.X, row !== C.row);
        if (d < bd) { bd = d; best = { X, row }; }
      }
      t = best || { X: C.X, row: C.row };
    }
    bot.tgt = { X: clamp(t.X + B.aim / FW * gauss(), -XMAX, XMAX), row: t.row };
    if (bot.tgt.row !== C.row) bot.hopAt = T + B.hopDelay;
  }
  function botTick(dt) {
    const z = seenHits();
    if (z && bot.pending == null && inside(z, bot.tgt.row, bot.tgt.X, B.watch)) bot.pending = T + reaction(z);
    if (bot.pending != null && T >= bot.pending) { bot.pending = null; if (z && inside(z, bot.tgt.row, bot.tgt.X, B.watch)) choose(z); }
    const dX = bot.tgt.X - bot.fX, step = B.speed / FW * dt;
    bot.fX = Math.abs(dX) <= step ? bot.tgt.X : bot.fX + Math.sign(dX) * step;
    if (bot.hopAt != null && T >= bot.hopAt) { bot.hopAt = null; if (C.row !== bot.tgt.row) { C.row = bot.tgt.row; S.hops++; } }
  }

  while (true) {
    T += DT; let gdt = DT;
    if (freeze > 0) { freeze -= DT; gdt = 0; }
    botTick(DT);
    C.X = clamp(C.X + (bot.fX - C.X) * Math.min(1, DT * FOLLOW), -XMAX, XMAX);
    if (C.rowT !== C.row) C.rowT = C.rowT < C.row ? Math.min(C.row, C.rowT + DT / HOP) : Math.max(C.row, C.rowT - DT / HOP);
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
const ALLW = { kung: 3, big: 1, feint: 1, hold: 1, double: 1, triple: 1 }, ALLW6 = { ...ALLW, special: 1 };
const PRESETS = [
  { id: 'tutorial', name: '튜토리얼', where: '1~10판', lanes: 3, interval: 2.2, tell: 0.8, lunge: 0.6, weights: { kung: 1 }, hearts: 3, duration: 30 },
  { id: 'early', name: '초반 보통', where: '~100판', lanes: 3, interval: 1.8, tell: 0.7, lunge: 0.5, weights: { kung: 3, big: 1, feint: 1 }, hearts: 3, duration: 40 },
  { id: 'mid', name: '중반 보통', where: '~800판', lanes: 3, interval: 1.4, tell: 0.6, lunge: 0.44, weights: { kung: 3, big: 1, feint: 1, hold: 1, double: 1 }, hearts: 3, duration: 45 },
  { id: 'hard', name: '어려움', where: '~2000판', lanes: 3, interval: 1.2, tell: 0.55, lunge: 0.4, weights: ALLW, hearts: 3, duration: 50 },
  { id: 'vhard', name: '아주 어려움', where: '~3500판+', lanes: 3, interval: 1.0, tell: 0.5, lunge: 0.37, weights: ALLW, hearts: 3, duration: 60 },
  { id: 'six1', name: '6칸 첫 판', where: '6칸 도입', lanes: 6, interval: 2.0, tell: 0.7, lunge: 0.5, weights: { kung: 1 }, hearts: 3, duration: 40 },
  { id: 'six', name: '6칸 보통', where: '6칸 중반', lanes: 6, interval: 1.4, tell: 0.6, lunge: 0.42, weights: { kung: 3, big: 1, feint: 1, hold: 1, double: 1 }, hearts: 3, duration: 45 },
  { id: 'sixhard', name: '6칸 어려움', where: '6칸 후반', lanes: 6, interval: 1.1, tell: 0.55, lunge: 0.36, weights: ALLW6, hearts: 3, duration: 60 },
  { id: 'sixo', name: '6칸 어려움 (타조)', where: '6칸 후반', lanes: 6, species: 'ostrich', interval: 1.1, tell: 0.55, lunge: 0.36, weights: ALLW6, hearts: 3, duration: 60 },
  { id: 'real6', name: '시험판 6칸(무한)', where: '참고', lanes: 6, mode: 'real', tell: 0.6, lunge: '0.5→0.32', interval: '1.7→0.8', weights: null, hearts: 3, duration: 60 },
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
  const o = args(), B = { ...BOT, ...o.bot }, t0 = Date.now(), res = { layout: { front: LY.front, back: LY.back, rowGap: +LY.rowGap.toFixed(1), budget: +LY.BUDGET.toFixed(1) }, bot: B };
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
      const rows = KINDS.map(k => ({ k, r: runMany({ ...base, lanes: k === 'special' ? 6 : base.lanes, weights: { [k]: 1 } }, B, o.runs, o.seed) }));
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
  console.log(`(화면 390×844: 앞줄 칸 x = ${LY.front.join(' / ')}px, 뒷줄 ${LY.back.join(' / ')}px, 줄 간격 약 ${res.layout.rowGap}px, 멈칫 밀기 ±${res.layout.budget}px · 봇 반응 ${Math.round(B.rtMean * 1000)}±${Math.round(B.rtSd * 1000)}ms · 끌기 ${B.speed}px/s · ${((Date.now() - t0) / 1000).toFixed(1)}초)`);
}

if (require.main === module) main();
module.exports = { simulate, runMany, PRESETS, BOT, LY };
