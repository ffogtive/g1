#!/usr/bin/env node
/*
 * 모아쿵! 실제 조작 검증 (Playwright + Chromium)
 *
 * 가설: 실제 화면의 수거 범위(BRUSH_R=46)와 실제 포인터 입력만으로
 *       ① 수거/재수거 ② 낙하마다 재료 감소 ③ 강한 것부터 승리 ④ 아껴서 승리
 *       ⑤ 잘못된 순서 전부 사용 = 실패 ⑥ 취소·재시작 무차감 이 모두 재현된다.
 *
 * 원칙
 *  - 게임 상태를 바꾸는 API는 없다. window.moakung 은 읽기 전용 스냅샷만 준다.
 *  - 봇은 화면에 보이는 정보(재료 위치, 개수 말풍선, 조준 미리보기)만 보고 마우스/터치를 움직인다.
 *  - 수거 범위·조준 판정은 게임 그대로다(테스트용 축소 없음).
 *
 * 실행: node moakung/tests/e2e.js [시나리오이름...]   (스크린샷: moakung/docs/screens/)
 */
'use strict';
const path = require('path');
const fs = require('fs');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const ROOT = path.resolve(__dirname, '..');
const URL = 'file://' + path.join(ROOT, 'index.html');
const SHOTS = path.join(ROOT, 'docs', 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const AIM_PAD = 28; // game.js 와 동일 (조준 영역 안에서는 수거가 멈추므로 그 밖에서 쓸어야 함)

class Bot {
  constructor(page, opts = {}) {
    this.page = page;
    this.touch = !!opts.touch;
    this.cdp = null;
    this.down = false;
    this.pos = null;
  }
  async init() {
    if (this.touch) this.cdp = await this.page.context().newCDPSession(this.page);
  }
  snap() { return this.page.evaluate(() => window.moakung.snapshot()); }
  client(x, y) { return this.page.evaluate(([x, y]) => window.moakung.toClient(x, y), [x, y]); }
  async press(x, y) {
    const c = await this.client(x, y);
    if (this.touch) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
    else { await this.page.mouse.move(c.x, c.y); await this.page.mouse.down(); }
    this.down = true;
    this.pos = { x, y };
  }
  async moveTo(x, y, stepPx = 9) {
    const from = this.pos || { x, y };
    const d = Math.hypot(x - from.x, y - from.y);
    const steps = Math.max(1, Math.ceil(d / stepPx));
    for (let i = 1; i <= steps; i++) {
      const px = from.x + ((x - from.x) * i) / steps, py = from.y + ((y - from.y) * i) / steps;
      const c = await this.client(px, py);
      if (this.touch && this.down) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c.x, y: c.y }] });
      else await this.page.mouse.move(c.x, c.y);
    }
    this.pos = { x, y };
  }
  async release() {
    if (this.touch) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await this.page.mouse.up();
    this.down = false;
  }
  async touchCancel() {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    this.down = false;
  }
  async wait(ms) { await this.page.waitForTimeout(ms); }
  async waitIdle(timeout = 8000) {
    const t0 = Date.now();
    for (;;) {
      const s = await this.snap();
      if (s.phase !== 'drop') return s;
      if (Date.now() - t0 > timeout) throw new Error('drop animation did not finish');
      await this.wait(80);
    }
  }
  async shot(name) { await this.page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

  /* ---------- 화면 조작 ---------- */
  async openStage(i) {
    await this.page.evaluate(() => localStorage.setItem('moakung.v1', JSON.stringify({ unlocked: 3, seenHelp: true, sound: false })));
    await this.page.reload();
    await this.wait(250);
    await this.page.click(`button[data-stage="${i}"]`);
    await this.page.click('button[data-act="start"]');
    await this.wait(200);
    return this.snap();
  }

  inAim(s, x, y) {
    return s.cakes.some(c => {
      if (!c.alive) return false;
      const rx = c.r + AIM_PAD, ry = c.r * 0.42 + AIM_PAD;
      const dx = (x - c.x) / rx, dy = (y - c.y) / ry;
      if (dx * dx + dy * dy <= 1) return true;
      return x >= c.x - c.r - AIM_PAD * 0.6 && x <= c.x + c.r + AIM_PAD * 0.6 && y <= c.y && y >= c.top - AIM_PAD;
    });
  }
  /** 재료를 주울 수 있는(조준 영역 밖) 손가락 위치 */
  reachPoint(s, it) {
    for (const r of [0, 12, 24, 34, 42]) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = it.x + Math.cos(a) * r, y = it.y + Math.sin(a) * r;
        if (x < 8 || x > 392 || y < 8 || y > 672) continue;
        if (!this.inAim(s, x, y)) return { x, y };
      }
    }
    return null;
  }

  /**
   * 쓸어 담기: 누른 채 가까운 재료부터 차례로 지나간다.
   * until(held) 가 true 가 되면 멈춘다 (화면의 개수 말풍선을 보며 멈추는 것과 같음).
   */
  async sweep({ until = () => false, start = null, keepPressed = true } = {}) {
    let s = await this.snap();
    let cur = start || this.pos;
    if (!this.down) {
      const first = start || this.nearestReach(s, cur || { x: 200, y: 600 });
      if (!first) return s;
      await this.press(first.x, first.y);
      cur = first;
    }
    for (let guard = 0; guard < 120; guard++) {
      s = await this.snap();
      if (until(s.held, s)) break;
      const nxt = this.nearestReach(s, cur);
      if (!nxt) break;
      await this.moveTo(nxt.x, nxt.y);
      cur = nxt;
    }
    if (!keepPressed) await this.release();
    return this.snap();
  }
  nearestReach(s, from) {
    let best = null, bd = 1e9;
    for (const it of s.items) {
      const p = this.reachPoint(s, it);
      if (!p) continue;
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  /** 쓸어 담은 상태(누른 채)로 케이크 위로 가서 놓는다 → 낙하 */
  async dropOn(ci) {
    const s = await this.snap();
    const c = s.cakes[ci];
    await this.moveTo(c.x, c.y - 12);
    await this.wait(120);
    const aim = await this.snap();
    await this.release();
    return aim; // 놓기 직전 미리보기
  }
  /** 바닥에 놓아둔 덩어리를 잡아(추가 수거 없음) 케이크에 떨어뜨린다 */
  async carryClumpTo(ci, clumpIdx = 0) {
    let s = await this.snap();
    const cl = s.clumps[clumpIdx];
    await this.press(cl.x, cl.y);
    const c = s.cakes[ci];
    await this.moveTo(c.x, c.y - 12);
    await this.wait(120);
    const aim = await this.snap();
    await this.release();
    return aim;
  }
}

/* ---------- 시나리오 ---------- */
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log(`   ${cond ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
}
function idxByName(s, part) { return s.cakes.findIndex(c => c.name.includes(part)); }

/** 손에 든 덩어리 전부를 cake 에 떨어뜨리고 결과 기록 */
async function dropAndLog(bot, ci, label) {
  const before = await bot.snap();
  const aim = await bot.dropOn(ci);
  const after = await bot.waitIdle();
  const n = aim.held;
  const expectLoss = Math.round(n / 3);
  console.log(`   · ${label}: ${aim.cakes[ci].name} ← ${n}개 | 미리보기 ${aim.preview && aim.preview.kind} 손실 ${aim.preview && aim.preview.loss} | 재료 ${before.materials}→${after.materials} 낙하 ${before.dropsLeft}→${after.dropsLeft}`);
  return { aim, before, after, n, expectLoss };
}

/** 필요한 만큼만: 쓸어 담다가 개수가 목표에 닿으면 놓고(덩어리 보관) → 잡아서 옮겨 떨어뜨림 */
async function economicalHit(bot, ci, label, extra = 0) {
  let s = await bot.snap();
  const need = s.cakes[ci].need;
  const goal = Math.min(s.materials, need + extra);
  await bot.sweep({ until: h => h >= goal });
  await bot.release(); // 바닥에 덩어리로 놓기 (횟수 무차감)
  await bot.wait(250);
  s = await bot.snap();
  // 혹시 덜 모였으면 덩어리 근처를 더 쓸어 합친다
  while (s.clumps.length && s.clumps[0].n < goal && s.items.length) {
    await bot.sweep({ until: h => h >= goal - s.clumps[0].n, start: { x: s.clumps[0].x, y: s.clumps[0].y } });
    await bot.release();
    await bot.wait(250);
    s = await bot.snap();
  }
  const mid = s;
  const aim = await bot.carryClumpTo(ci);
  const after = await bot.waitIdle();
  console.log(`   · ${label}: ${aim.cakes[ci].name}(한 번에 ${need}개) ← ${aim.held}개 | 미리보기 ${aim.preview && aim.preview.kind} −${aim.preview && aim.preview.loss} | 재료 ${mid.materials}→${after.materials} 낙하→${after.dropsLeft}`);
  return { aim, after, need };
}

/**
 * 우선순위 순서대로 끝까지 플레이한다 (낙하 4번을 다 쓸 수 있음).
 * mode 'all' = 매번 바닥 재료 전부, 'econ' = 매번 "한 번에 부수려면 N개"만큼
 */
async function playOrder(bot, order, mode, shotFirst) {
  for (let k = 0; k < 4; k++) {
    const s = await bot.snap();
    if (s.screen || s.phase === 'result' || s.dropsLeft <= 0) break;
    const ci = order.find(i => s.cakes[i].alive);
    if (ci === undefined) break;
    if (mode === 'all') {
      await bot.sweep({ until: (h, sn) => sn.items.length === 0 && sn.clumps.length === 0 });
      await dropAndLog(bot, ci, '전부');
    } else {
      await economicalHit(bot, ci, '필요한 만큼');
    }
    if (k === 0 && shotFirst) await bot.shot(shotFirst);
  }
  await bot.wait(1500);
  return bot.snap();
}

const SCENARIOS = {
  async gather_regather(bot) {
    console.log('\n■ 수거·재수거·취소 (스테이지 1)');
    let s = await bot.openStage(0);
    const m0 = s.materials, d0 = s.dropsLeft;
    s = await bot.sweep({ until: h => h >= 8 });
    check('쓸어 담으면 하나의 덩어리로 모인다', s.held >= 8, `들고 있는 재료 ${s.held}개`);
    const mats = new Set();
    await bot.shot('e2e-gather');
    await bot.release();
    await bot.wait(300);
    s = await bot.snap();
    check('케이크 밖에서 놓으면 덩어리로 남고 횟수·재료 그대로', s.clumps.length === 1 && s.dropsLeft === d0 && s.materials === m0, `덩어리 ${s.clumps.map(c => c.n)} · 낙하 ${s.dropsLeft} · 재료 ${s.materials}`);
    // 덩어리를 잡고 재료 위를 가로질러 옮겨도 더 줍지 않는다
    const n0 = s.clumps[0].n;
    const far = s.items.reduce((a, b) => (Math.hypot(b.x - s.clumps[0].x, b.y - s.clumps[0].y) > Math.hypot(a.x - s.clumps[0].x, a.y - s.clumps[0].y) ? b : a));
    await bot.press(s.clumps[0].x, s.clumps[0].y);
    const rp = bot.reachPoint(s, far);
    await bot.moveTo(rp.x, rp.y);
    let mid = await bot.snap();
    check('놓아둔 덩어리를 잡고 옮길 때는 지나가는 재료를 줍지 않는다', mid.held === n0 && mid.mode === 'carry', `잡은 ${n0}개 → 이동 후 ${mid.held}개`);
    await bot.release();
    await bot.wait(300);
    s = await bot.snap();
    // 톡 치면 흩어져서 다시 고른다
    await bot.press(s.clumps[0].x, s.clumps[0].y);
    await bot.release();
    await bot.wait(500);
    s = await bot.snap();
    check('덩어리를 톡 치면 흩어지고 횟수·재료 그대로', s.clumps.length === 0 && s.items.length === m0 && s.dropsLeft === d0, `바닥 재료 ${s.items.length} · 낙하 ${s.dropsLeft}`);
    // 다시 일부만 모으기
    s = await bot.sweep({ until: h => h >= 5 });
    check('흩은 뒤 다시 일부만 쓸어 담을 수 있다', s.held >= 5 && s.held < m0, `${s.held}개`);
    // 쓸던 덩어리가 놓아둔 덩어리를 지나가면 합쳐진다
    await bot.release();
    await bot.wait(300);
    s = await bot.snap();
    const restN = s.clumps[0].n;
    const other = s.items.filter(i => Math.hypot(i.x - s.clumps[0].x, i.y - s.clumps[0].y) > 120)[0];
    const st = bot.reachPoint(s, other);
    await bot.press(st.x, st.y);
    await bot.moveTo(s.clumps[0].x, s.clumps[0].y);
    await bot.wait(200);
    mid = await bot.snap();
    check('쓸면서 놓아둔 덩어리를 지나가면 통째로 합쳐진다', mid.clumps.length === 0 && mid.held >= restN + 1, `놓아둔 ${restN}개 + 새로 → ${mid.held}개`);
    // 케이크 위에서 Esc(취소) → 떨어뜨리지 않음
    const c0 = mid.cakes[0];
    await bot.moveTo(c0.x, c0.y - 12);
    await bot.wait(150);
    await bot.page.keyboard.press('Escape');
    await bot.wait(150);
    await bot.release();
    await bot.wait(300);
    s = await bot.snap();
    check('케이크 위에서 취소(Esc)하면 떨어지지 않고 횟수 그대로', s.dropsLeft === d0 && s.cakes[0].hp === s.cakes[0].maxHp && s.materials === m0, `낙하 ${s.dropsLeft} · 푸딩 ${s.cakes[0].hp}/${s.cakes[0].maxHp}`);
    // 캔버스 밖에서 놓기
    s = await bot.snap();
    await bot.press(s.clumps[0].x, s.clumps[0].y);
    await bot.moveTo(200, 676);
    const c = await bot.client(200, 760);
    await bot.page.mouse.move(c.x, c.y);
    await bot.release();
    await bot.wait(300);
    s = await bot.snap();
    check('화면(캔버스) 밖에서 놓아도 횟수·재료 그대로', s.dropsLeft === d0 && s.materials === m0, `낙하 ${s.dropsLeft} · 재료 ${s.materials}`);
  },

  async touch_cancel(bot) {
    console.log('\n■ 모바일 터치: 수거·낙하·시스템 취소(touchcancel)');
    let s = await bot.openStage(0);
    const m0 = s.materials;
    s = await bot.sweep({ until: h => h >= 6 });
    check('터치로 쓸어 담기', s.held >= 6, `${s.held}개`);
    const c0 = s.cakes[0];
    await bot.moveTo(c0.x, c0.y - 12);
    await bot.wait(120);
    s = await bot.snap();
    check('터치로 케이크 조준 시 미리보기 표시', s.target === 0 && s.preview, s.preview && `${s.preview.kind}, −${s.preview.loss}`);
    await bot.touchCancel();
    await bot.wait(350);
    s = await bot.snap();
    check('조준 중 터치가 시스템에 의해 취소되면(touchcancel) 떨어뜨리지 않음', s.dropsLeft === 4 && s.materials === m0 && s.cakes[0].hp === s.cakes[0].maxHp && s.clumps.length === 1, `낙하 ${s.dropsLeft} · 덩어리 ${s.clumps.map(c => c.n)}`);
    const aim = await bot.carryClumpTo(0);
    s = await bot.waitIdle();
    check('터치로 덩어리를 옮겨 놓으면 낙하 1번 사용', s.dropsLeft === 3 && s.materials === m0 - Math.round(aim.held / 3), `${aim.held}개 사용 → 재료 ${s.materials}, 낙하 ${s.dropsLeft}`);
    await bot.shot('e2e-touch');
  },

  async drops_reduce(bot) {
    console.log('\n■ 낙하마다 재료가 실제로 줄어든다 (스테이지 1)');
    let s = await bot.openStage(0);
    const choco = idxByName(s, '초코');
    let prev = s.materials;
    for (let k = 0; k < 2; k++) {
      await bot.sweep({ until: h => h >= 12 });
      const r = await dropAndLog(bot, choco, `낙하 ${k + 1}`);
      const hud = await bot.page.$eval('#hud-mats', e => +e.textContent);
      const lostHud = await bot.page.$eval('#hud-lost', e => +e.textContent);
      check(`낙하 ${k + 1}: 쓴 ${r.n}개 중 round(n/3)=${r.expectLoss}개가 사라짐`, r.after.materials === prev - r.expectLoss, `${prev} → ${r.after.materials}`);
      check(`낙하 ${k + 1}: 화면 숫자(재료·잃음)와 실제가 일치`, hud === r.after.materials && lostHud === r.after.lost && r.aim.preview.loss === r.expectLoss, `HUD 재료 ${hud}, 잃음 ${lostHud}, 미리보기 −${r.aim.preview.loss}`);
      check(`낙하 ${k + 1}: 쓰지 않은 재료는 그대로 바닥에 남음`, r.after.items.length + r.after.clumps.reduce((a, c) => a + c.n, 0) === r.after.materials, `바닥 ${r.after.items.length}개`);
      prev = r.after.materials;
    }
    const cs = (await bot.snap()).cakes[choco];
    check('단단한 케이크에 작은 덩어리(12개)는 흠집만 냄', cs.alive && cs.hp > cs.maxHp * 0.5, `초코 몸체 ${cs.hp.toFixed(1)}/${cs.maxHp}`);
  },

  async strong_first_win(bot) {
    console.log('\n■ 전략 A: 처음의 큰 덩어리로 단단한 케이크부터 (스테이지 1, 매번 전부 사용)');
    let s = await bot.openStage(0);
    s = await playOrder(bot, [idxByName(s, '초코'), idxByName(s, '딸기'), idxByName(s, '푸딩')], 'all', 'e2e-strong-first');
    check('강한 케이크부터 전부 쏟아부으면 승리', s.screen === 'win', `결과 화면 ${s.screen}, 남은 재료 ${s.materials}`);
    await bot.shot('e2e-strong-first-win');
  },

  async save_win(bot) {
    console.log('\n■ 전략 B: 부드러운 케이크에 조금만 쓰고 아껴서 단단한 케이크에 (스테이지 1)');
    let s = await bot.openStage(0);
    s = await playOrder(bot, [idxByName(s, '푸딩'), idxByName(s, '딸기'), idxByName(s, '초코')], 'econ', 'e2e-save-first');
    check('필요한 만큼만 모아 약한 것부터 부숴도 승리', s.screen === 'win', `결과 ${s.screen}, 남은 재료 ${s.materials}`);
    await bot.shot('e2e-save-win');
  },

  async wrong_order_fail(bot) {
    console.log('\n■ 실패 경로: 전부 모아 부드러운 케이크부터 (스테이지 1)');
    let s = await bot.openStage(0);
    const order = [idxByName(s, '푸딩'), idxByName(s, '딸기'), idxByName(s, '초코')];
    await bot.sweep({ until: (h, sn) => sn.items.length === 0 });
    const c0 = (await bot.snap()).cakes[order[0]];
    await bot.moveTo(c0.x, c0.y - 12);
    await bot.wait(250);
    const aim = await bot.snap();
    check('넘치게 쓰면 조준 카드가 "N개면 충분"을 알려 줌', aim.preview && aim.preview.waste > 0, aim.preview && `필요 ${aim.preview.need}개, ${aim.preview.waste}개 더 씀`);
    await bot.shot('e2e-wrong-overkill');
    s = await playOrder(bot, order, 'all');
    check('전부 모아 약한 순서로 공격하면 실패', s.screen === 'fail', `결과 ${s.screen}, 남은 재료 ${s.materials}, 남은 낙하 ${s.dropsLeft}`);
    await bot.shot('e2e-wrong-fail');
  },

  async restart_reset(bot) {
    console.log('\n■ 재시작은 자원·횟수를 정확히 되돌린다');
    let s = await bot.openStage(0);
    const layout0 = JSON.stringify(s.items.map(i => [i.id, i.x, i.y]));
    await bot.sweep({ until: h => h >= 15 });
    await dropAndLog(bot, idxByName(s, '딸기'), '낙하');
    await bot.sweep({ until: h => h >= 4 });
    await bot.release();
    await bot.wait(300);
    await bot.page.click('#btn-restart');
    s = await bot.snap();
    check('진행 중 재시작은 한 번 더 눌러야 실행 (실수 방지)', s.dropsLeft === 3, `첫 탭 후 낙하 ${s.dropsLeft}`);
    await bot.page.click('#btn-restart');
    await bot.wait(300);
    s = await bot.snap();
    check('재시작: 낙하 4 · 재료 50 · 잃음 0 · 케이크 원상태', s.dropsLeft === 4 && s.materials === 50 && s.lost === 0 && s.cakes.every(c => c.alive && c.hp === c.maxHp) && s.clumps.length === 0, `낙하 ${s.dropsLeft} 재료 ${s.materials} 잃음 ${s.lost}`);
    check('재시작: 같은 배치로 돌아감', JSON.stringify(s.items.map(i => [i.id, i.x, i.y])) === layout0);
    // 결과 화면에서 다시하기
    await playOrder(bot, [idxByName(s, '푸딩'), idxByName(s, '딸기'), idxByName(s, '초코')], 'all');
    await bot.page.click('.card button[data-act="restart"]');
    await bot.wait(300);
    s = await bot.snap();
    check('실패 화면의 다시하기도 낙하·재료를 정확히 되돌림', s.phase === 'play' && s.dropsLeft === 4 && s.materials === 50 && s.lost === 0, `낙하 ${s.dropsLeft} 재료 ${s.materials}`);
  },

  async stage2_paths(bot) {
    console.log('\n■ 스테이지 2: 아주 단단한 3단 케이크');
    let s = await bot.openStage(1);
    const big = idxByName(s, '3단'), soft = idxByName(s, '레몬'), mid = idxByName(s, '크레이프');
    s = await playOrder(bot, [big, mid, soft], 'all');
    check('스테이지 2: 3단 케이크부터 전부 → 승리', s.screen === 'win', `${s.screen}, 남은 ${s.materials}`);
    s = await bot.openStage(1);
    s = await playOrder(bot, [soft, mid, big], 'all');
    check('스테이지 2: 약한 것부터 전부 → 실패', s.screen === 'fail', s.screen);
    s = await bot.openStage(1);
    s = await playOrder(bot, [soft, mid, big], 'econ');
    check('스테이지 2: 약한 것부터 필요한 만큼만 → 승리', s.screen === 'win', `${s.screen}, 남은 ${s.materials}`);
  },

  async stage3_paths(bot) {
    console.log('\n■ 스테이지 3: 전부 쏟아부으면 모자라는 판');
    let s = await bot.openStage(2);
    const crown = idxByName(s, '왕관'), cheese = idxByName(s, '치즈'), mac = idxByName(s, '마카롱');
    s = await playOrder(bot, [crown, cheese, mac], 'all');
    check('스테이지 3: 가장 단단한 것부터라도 전부 쓰면 실패', s.screen === 'fail', `${s.screen}`);
    await bot.shot('e2e-stage3-fail');
    s = await bot.openStage(2);
    s = await playOrder(bot, [crown, cheese, mac], 'econ');
    check('스테이지 3: 단단한 것부터 필요한 만큼만 → 승리', s.screen === 'win', `${s.screen}, 남은 ${s.materials}`);
    await bot.shot('e2e-stage3-win');
    s = await bot.openStage(2);
    s = await playOrder(bot, [mac, cheese, crown], 'econ');
    check('스테이지 3: 약한 것부터 필요한 만큼만 → 승리', s.screen === 'win', `${s.screen}, 남은 ${s.materials}`);
  },

  async book_saved(bot) {
    console.log('\n■ 도감 로컬 저장');
    let s = await bot.openStage(0);
    await playOrder(bot, [idxByName(s, '초코'), idxByName(s, '딸기'), idxByName(s, '푸딩')], 'all');
    await bot.page.reload();
    await bot.wait(300);
    const saved = await bot.page.evaluate(() => JSON.parse(localStorage.getItem('moakung.v1')));
    check('새로고침 후에도 도감·별·해금이 남아 있음', saved.book.pudding && saved.book.choco && saved.book.shortcake && saved.best['1'] && saved.unlocked >= 2, JSON.stringify({ book: Object.keys(saved.book), best: saved.best }));
    await bot.page.click('button[data-act="book"]');
    await bot.wait(300);
    await bot.shot('e2e-book');
  }
};

module.exports = { Bot, URL, SHOTS, playOrder, economicalHit, dropAndLog, playwright };
if (require.main !== module) return;

(async () => {
  const pick = process.argv.slice(2);
  const names = pick.length ? pick : Object.keys(SCENARIOS);
  const browser = await playwright.chromium.launch();
  const errors = [];
  for (const name of names) {
    const touch = name === 'touch_cancel';
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    await page.goto(URL);
    const bot = new Bot(page, { touch });
    await bot.init();
    try {
      await SCENARIOS[name](bot);
    } catch (e) {
      check(`${name} 실행`, false, e.stack.split('\n').slice(0, 3).join(' | '));
    }
    await ctx.close();
  }
  await browser.close();
  check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 5).join(' / '));
  const fails = results.filter(r => !r.ok);
  console.log(`\n${fails.length ? '✘' : '✔'} ${results.length - fails.length}/${results.length} 통과`);
  process.exit(fails.length ? 1 : 0);
})();
