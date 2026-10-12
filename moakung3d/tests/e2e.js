#!/usr/bin/env node
/*
 * 모아쿵! 3D 실제 조작 검증 (Playwright + Chromium, WebGL 소프트웨어 렌더링)
 *
 * 가설: 실제 화면의 수거 범위(BRUSH_R=4.4)와 실제 마우스/터치 입력만으로
 *       ① 수거·놓기·잡아 옮기기·톡 흩기 ② 개수 맞춤 ③ 낙하마다 round(n/3) 감소와 HUD 일치
 *       ④ 필요한 만큼만 = ★★★ ⑤ 여러 층에 전부 쏟기 = 실패 ⑥ 취소·재시작 무차감
 *       ⑦ Meshy 모델 케이크 레벨 동작 ⑧ 진행 저장 이 모두 재현된다.
 *
 * 원칙: 상태를 바꾸는 API 없음. window.moakung 은 읽기 전용(스냅샷, 화면좌표가 조준 영역인지 probe).
 *       봇은 화면에 보이는 정보(재료 위치, 개수 말풍선, 조준 카드)만 보고 포인터를 움직인다.
 * 실행: node moakung3d/tests/e2e.js [시나리오...]   (느림: 소프트웨어 WebGL 이라 낙하 1번 정리에 수십 초)
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

class Bot {
  constructor(page, touch) { this.page = page; this.touch = !!touch; this.down = false; this.pos = null; }
  async init() { if (this.touch) this.cdp = await this.page.context().newCDPSession(this.page); }
  snap() { return this.page.evaluate(() => window.moakung.snapshot()); }
  probe(x, y) { return this.page.evaluate(([x, y]) => window.moakung.probe(x, y), [x, y]); }
  wait(ms) { return this.page.waitForTimeout(ms); }
  async shot(name) { await this.page.screenshot({ path: path.join(SHOTS, name + '.png') }); }
  async press(x, y) {
    if (this.touch) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    else { await this.page.mouse.move(x, y); await this.page.mouse.down(); }
    this.down = true; this.pos = { x, y };
  }
  async moveTo(x, y, stepPx = 7) {
    const f = this.pos || { x, y };
    const n = Math.max(1, Math.ceil(Math.hypot(x - f.x, y - f.y) / stepPx));
    for (let i = 1; i <= n; i++) {
      const px = f.x + ((x - f.x) * i) / n, py = f.y + ((y - f.y) * i) / n;
      if (this.touch && this.down) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py }] });
      else await this.page.mouse.move(px, py);
    }
    this.pos = { x, y };
  }
  async release() {
    if (this.touch) await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await this.page.mouse.up();
    this.down = false;
  }
  async touchCancel() { await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); this.down = false; }
  async openLevel(i, extra) {
    await this.page.evaluate(x => localStorage.setItem('moakung3d.v1', JSON.stringify(Object.assign({ seenHelp: true, sound: false, unlocked: 12 }, x || {}))), extra || {});
    await this.page.reload();
    await this.page.waitForFunction(() => window.moakung && window.moakung.snapshot().phase === 'map', null, { timeout: 30000 });
    await this.page.click(`button[data-level="${i}"]`);
    await this.page.click('button[data-act="start"]');
    await this.wait(400);
    return this.snap();
  }
  async idle(timeout = 150000) {
    const t0 = Date.now();
    for (;;) {
      const s = await this.snap();
      if (s.phase !== 'drop') return s;
      if (Date.now() - t0 > timeout) throw new Error('낙하 정리가 끝나지 않음');
      await this.wait(250);
    }
  }
  async settledResult(timeout = 60000) {
    const t0 = Date.now();
    for (;;) {
      const s = await this.snap();
      if (s.screen === 'win' || s.screen === 'fail') return s;
      if (s.phase === 'play' && Date.now() - t0 > 3000) return s;
      if (Date.now() - t0 > timeout) return s;
      await this.wait(300);
    }
  }
  /** 쓸어 담기: 누른 채 가까운 재료부터 지나간다. until(snap) 이 참이면 멈춘다. prefer: 재질 우선순위 */
  async sweep({ until, prefer } = {}) {
    let s = await this.snap();
    let cur = this.pos || { x: 195, y: 600 };
    const pick = (snap) => {
      let best = null, bd = 1e9;
      for (const it of snap.items) {
        let d = Math.hypot(it.sx - cur.x, it.sy - cur.y);
        if (prefer && prefer.includes(it.mat)) d -= 1000;
        if (d < bd) { bd = d; best = it; }
      }
      return best;
    };
    if (!this.down) {
      const first = pick(s);
      if (!first) return s;
      await this.press(first.sx, first.sy);
      cur = { x: first.sx, y: first.sy };
    }
    for (let g = 0; g < 80; g++) {
      s = await this.snap();
      if (until && until(s)) break;
      const nx = pick(s);
      if (!nx) break;
      const pr = await this.probe(nx.sx, nx.sy);
      if (pr.aim) { s.items = s.items.filter(i => i.id !== nx.id); if (!s.items.length) break; continue; }
      await this.moveTo(nx.sx, nx.sy);
      cur = { x: nx.sx, y: nx.sy };
    }
    return this.snap();
  }
  async aimAndRelease() {
    const s = await this.snap();
    await this.moveTo(s.cakeAim.sx, s.cakeAim.sy);
    await this.wait(250);
    const aim = await this.snap();
    await this.release();
    return aim;
  }
  async carryClumpToCake(i = 0) {
    const s = await this.snap();
    const c = s.clumps[i];
    await this.press(c.sx, c.sy);
    return this.aimAndRelease();
  }
  async setLock(n) {
    let s = await this.snap();
    if (s.lock == null) { await this.page.click('#lock-val'); s = await this.snap(); }
    for (let k = 0; k < 80 && s.lock !== n; k++) {
      await this.page.click(s.lock < n ? '#lock-plus' : '#lock-minus');
      s = await this.snap();
    }
    return s.lock;
  }
  async lockOff() { const s = await this.snap(); if (s.lock != null) await this.page.click('#lock-val'); }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log(`   ${ok ? '✔' : '✘'} ${name}${detail ? ' — ' + detail : ''}`);
}
const lossOf = (n, coat) => Math.round(n * (coat ? 1 / 2 : 1 / 3));

/** 한 번 떨어뜨리고 결과를 검사 */
async function dropCheck(bot, label, coat) {
  const before = await bot.snap();
  const aim = await bot.aimAndRelease();
  const after = await bot.idle();
  const n = aim.held, exp = lossOf(n, coat);
  const hud = +(await bot.page.$eval('#hud-mats', e => e.textContent));
  console.log(`   · ${label}: ${n}개(힘 ${aim.preview && aim.preview.power}) → ${aim.preview && aim.preview.kind} | 재료 ${before.materials}→${after.materials} 낙하 ${before.dropsLeft}→${after.dropsLeft} 잃음 ${after.lost}`);
  check(`${label}: 낙하 1번 사용`, after.dropsLeft === before.dropsLeft - 1 || after.phase === 'finale' || after.screen);
  check(`${label}: 쓴 ${n}개 중 ${exp}개만 사라짐 (미리보기 −${aim.preview && aim.preview.loss})`, before.materials - after.materials === exp && aim.preview.loss === exp, `${before.materials}→${after.materials}`);
  check(`${label}: 화면 재료 수 = 실제`, hud === after.materials || after.phase === 'finale', `HUD ${hud}`);
  const h = after.history[after.history.length - 1];
  check(`${label}: 미리보기 판정 = 실제 판정`, h && h.broke === aim.preview.breaks && h.power === aim.preview.power, h && `${h.kind}/${aim.preview.kind}`);
  return { aim, after };
}

/** 필요한 만큼만: 개수 맞춤 + 놓기 + 합치기 → 덩어리를 잡아(추가 수거 없음) 떨어뜨림 */
async function fitHit(bot, label, coat) {
  let s = await bot.snap();
  const L = s.layers[s.top];
  // 조준 카드의 "힘 N 필요"와 같은 값 (첫 개수 짐작용; 실제 판단은 조준 카드로 확인)
  const pc = Math.ceil(L.hp / 0.2 - 1e-6);
  const need = pc <= L.armor ? Math.max(1, pc) : Math.max(Math.floor(L.armor) + 1, Math.ceil(L.hp + L.armor * 0.8 - 1e-6));
  // 묵직한 재료를 먼저 노린다 (힘 2배). 화면의 개수 말풍선(held)·힘을 보며 멈춘다.
  let lock = Math.max(1, Math.ceil(need / 2));
  await bot.setLock(lock);
  for (let round = 0; round < 8; round++) {
    s = await bot.sweep({ prefer: ['steel', 'nut'], until: sn => sn.held >= lock });
    await bot.release();
    await bot.wait(700);
    s = await bot.snap();
    const c = s.clumps[0];
    if (!c) break;
    // 덩어리를 잡아 케이크 위에서 힘 확인 (조준 카드)
    await bot.press(c.sx, c.sy);
    const sn = await bot.snap();
    await bot.moveTo(sn.cakeAim.sx, sn.cakeAim.sy);
    await bot.wait(250);
    const aim = await bot.snap();
    if (aim.preview && aim.preview.breaks) {
      await bot.release();
      const after = await bot.idle();
      const h = after.history[after.history.length - 1];
      console.log(`   · ${label}: ${aim.held}개(힘 ${aim.preview.power}/필요 ${aim.preview.needPower}) → ${h && h.kind} 넘침 ${aim.preview.overflow} | 재료 ${aim.materials}→${after.materials}`);
      check(`${label}: 미리보기 = 실제`, h && h.broke && h.power === aim.preview.power && aim.materials - after.materials === lossOf(aim.held, coat));
      return after;
    }
    // 부족: 케이크 밖으로 가져가 놓고, 개수를 늘린 뒤 더 쓸어 합친다
    const off = sn.items[0] || { sx: 195, sy: 650 };
    await bot.moveTo(off.sx, off.sy);
    await bot.release();
    await bot.wait(600);
    const deficit = aim.preview ? aim.preview.needPower - aim.preview.power : 2;
    lock = (await bot.snap()).clumps[0].n + Math.max(1, Math.ceil(deficit / 2));
    await bot.setLock(lock);
    s = await bot.snap();
    await bot.press(s.clumps[0].sx + 40, s.clumps[0].sy + 40); // 덩어리 옆 빈 곳에서 쓸기 시작
    await bot.moveTo(s.clumps[0].sx, s.clumps[0].sy);          // 덩어리를 지나가며 합침
  }
  return bot.snap();
}
async function playFit(bot, coat) {
  for (let k = 0; k < 4; k++) {
    const s = await bot.snap();
    if (s.phase !== 'play' || s.top >= s.layers.length) break;
    await fitHit(bot, `${s.top + 1}층 딱 맞게`, coat);
  }
  return bot.settledResult();
}
async function playAllIn(bot, coat) {
  for (let k = 0; k < 4; k++) {
    let s = await bot.snap();
    if (s.phase !== 'play') break;
    await bot.lockOff();
    s = await bot.sweep({ until: sn => sn.items.length === 0 });
    await dropCheck(bot, `전부 ${k + 1}`, coat);
  }
  return bot.settledResult();
}

const SCENARIOS = {
  async gather(bot) {
    console.log('\n■ 수거·놓기·잡아 옮기기·톡 흩기 (레벨 1)');
    let s = await bot.openLevel(0);
    const m0 = s.materials, d0 = s.dropsLeft;
    s = await bot.sweep({ until: sn => sn.held >= 6 });
    check('쓸어 담으면 덩어리로 모임', s.held >= 6, `${s.held}개`);
    await bot.shot('e2e3d-gather');
    await bot.release();
    await bot.wait(800);
    s = await bot.snap();
    check('케이크 밖에서 놓으면 덩어리로 남고 횟수·재료 그대로', s.clumps.length === 1 && s.dropsLeft === d0 && s.materials === m0, `덩어리 ${s.clumps.map(c => c.n)}`);
    const n0 = s.clumps[0].n;
    // 재료 위를 가로지르되 케이크 조준 영역은 피한 먼 지점
    let far = null;
    for (const it of s.items.slice().sort((a, b) => Math.hypot(b.sx - s.clumps[0].sx, b.sy - s.clumps[0].sy) - Math.hypot(a.sx - s.clumps[0].sx, a.sy - s.clumps[0].sy))) {
      if (!(await bot.probe(it.sx, it.sy)).aim) { far = it; break; }
    }
    await bot.press(s.clumps[0].sx, s.clumps[0].sy);
    await bot.moveTo(far.sx, far.sy);
    const mid = await bot.snap();
    check('놓은 덩어리를 잡고 재료 위를 지나가도 더 줍지 않음', mid.mode === 'carry' && mid.held === n0, `${n0} → ${mid.held}`);
    await bot.release();
    await bot.wait(800);
    s = await bot.snap();
    await bot.press(s.clumps[0].sx, s.clumps[0].sy);
    await bot.release();
    await bot.wait(1500);
    s = await bot.snap();
    check('덩어리를 톡 치면 흩어지고 횟수·재료 그대로', s.clumps.length === 0 && s.dropsLeft === d0 && s.materials === m0);
    s = await bot.sweep({ until: sn => sn.held >= 4 });
    const c0 = s.cakeAim;
    await bot.moveTo(c0.sx, c0.sy);
    await bot.wait(250);
    await bot.page.keyboard.press('Escape');
    await bot.wait(200);
    await bot.release();
    await bot.wait(800);
    s = await bot.snap();
    check('케이크 위에서 Esc 취소 → 떨어지지 않음, 횟수 그대로', s.dropsLeft === d0 && s.layers[0].hp === s.layers[0].maxHp && s.materials === m0);
  },

  async lock(bot) {
    console.log('\n■ 개수 맞춤 (레벨 2)');
    await bot.openLevel(1);
    const L = await bot.setLock(7);
    check('[− n +]로 개수를 정할 수 있음', L === 7, `잠금 ${L}`);
    const s = await bot.sweep({ until: sn => sn.items.length === 0 || sn.held >= 7 });
    // 더 문질러도 7개에서 멈추는지
    for (const it of s.items.slice(0, 6)) await bot.moveTo(it.sx, it.sy);
    const s2 = await bot.snap();
    check('재료 위를 계속 문질러도 정확히 7개에서 멈춤', s2.held === 7, `${s2.held}개`);
    await bot.shot('e2e3d-lock');
    await bot.release();
    await bot.lockOff();
  },

  async drops(bot) {
    console.log('\n■ 낙하마다 재료 감소·HUD 일치 (레벨 4 단단한 케이크)');
    await bot.openLevel(3);
    await bot.setLock(6); // 촘촘한 무더기에서도 딱 6개만 (넉넉한 붓 + 개수 맞춤)
    await bot.sweep({ until: sn => sn.held >= 6 });
    const r = await dropCheck(bot, '작은 덩어리 6개');
    check('단단한 케이크에 작은 덩어리는 흠집만', r.aim.preview.kind === 'scratch' && r.after.layers[0].hp > r.after.layers[0].maxHp * 0.6, `${r.after.layers[0].hp.toFixed(1)}/${r.after.layers[0].maxHp}`);
  },

  async fit3(bot) {
    console.log('\n■ 필요한 만큼만 → ★★★ (레벨 2)');
    await bot.openLevel(1);
    const s = await playFit(bot);
    check('개수 맞춤으로 딱 맞게 모으면 ★★★', s.screen === 'win' && s.score >= s.stars[1], `${s.screen} ${s.score}점 (★★★ ${s.stars[1]})`);
    await bot.shot('e2e3d-fit-win');
  },

  async layers(bot) {
    console.log('\n■ 층 케이크: 전부 쏟기 = 실패, 층마다 딱 맞게 = 승리 (레벨 7)');
    await bot.openLevel(6);
    let s = await playAllIn(bot);
    check('여러 층에 매번 전부 쏟으면 실패', s.screen === 'fail', `${s.screen}, 남은 재료 ${s.materials}`);
    await bot.shot('e2e3d-layers-fail');
    await bot.openLevel(6);
    s = await playFit(bot);
    check('층마다 딱 맞게 → 승리', s.screen === 'win', `${s.screen} ${s.score}점`);
    await bot.shot('e2e3d-layers-win');
  },

  async touch(bot) {
    console.log('\n■ 모바일 터치: 쓸기·조준·시스템 취소');
    let s = await bot.openLevel(0);
    const m0 = s.materials;
    s = await bot.sweep({ until: sn => sn.held >= 5 });
    check('터치로 쓸어 담기', s.held >= 5, `${s.held}개`);
    await bot.moveTo(s.cakeAim.sx, s.cakeAim.sy);
    await bot.wait(250);
    s = await bot.snap();
    check('터치 조준 시 미리보기', s.aim && s.preview, s.preview && s.preview.kind);
    await bot.touchCancel();
    await bot.wait(900);
    s = await bot.snap();
    check('조준 중 터치 취소 → 떨어지지 않음', s.dropsLeft === 3 && s.materials === m0 && s.clumps.length === 1 && s.layers[0].hp === s.layers[0].maxHp);
    await bot.carryClumpToCake(0);
    s = await bot.idle();
    check('터치로 덩어리를 옮겨 놓으면 낙하 1번', s.dropsLeft === 2 || s.phase !== 'play');
  },

  async restart(bot) {
    console.log('\n■ 다시하기는 정확히 되돌린다 (레벨 1)');
    let s = await bot.openLevel(0);
    const layout = JSON.stringify(s.items.map(i => [i.id, Math.round(i.x), Math.round(i.z)]));
    const sw = await bot.sweep({ until: sn => sn.held >= 4 });
    let safe = null;
    for (const it of sw.items) if (!(await bot.probe(it.sx, it.sy)).aim) { safe = it; break; }
    await bot.moveTo(safe.sx, safe.sy); // 케이크 밖에서 놓기
    await bot.release();
    await bot.wait(600);
    await bot.page.click('#btn-restart');
    s = await bot.snap();
    check('진행 중 다시하기는 한 번 더 눌러야', s.clumps.length === 1);
    await bot.page.click('#btn-restart');
    await bot.wait(600);
    s = await bot.snap();
    check('다시하기: 낙하 3 · 재료 30 · 잃음 0 · 점수 0 · 덩어리 없음', s.dropsLeft === 3 && s.materials === 30 && s.lost === 0 && s.score === 0 && s.clumps.length === 0);
    check('다시하기: 같은 배치', JSON.stringify(s.items.map(i => [i.id, Math.round(i.x), Math.round(i.z)])) === layout);
  },

  async model(bot) {
    console.log('\n■ Meshy 모델 케이크 (레벨 3)');
    let s = await bot.openLevel(2);
    const name = await bot.page.$eval('#hud-name', e => e.textContent);
    check('레벨 3은 Meshy 딸기 로즈 티 케이크', /딸기 로즈 티/.test(name), name);
    await bot.shot('e2e3d-model');
    s = await bot.sweep({ until: sn => sn.items.length === 0 });
    const r = await dropCheck(bot, '모델 케이크에 전부');
    await bot.shot('e2e3d-model-after');
    check('모델 케이크도 부서지면 레벨이 진행됨', r.after.top >= 1 || r.after.layers[0].hp < r.after.layers[0].maxHp);
  },

  async save(bot) {
    console.log('\n■ 진행·도감 저장 (레벨 1 클리어 후 새로고침)');
    await bot.openLevel(0, { unlocked: 1 });
    await bot.sweep({ until: sn => sn.items.length === 0 });
    await bot.aimAndRelease();
    await bot.idle();
    const s = await bot.settledResult(90000);
    check('레벨 1 클리어', s.screen === 'win', s.screen);
    await bot.page.reload();
    await bot.wait(800);
    const saved = await bot.page.evaluate(() => JSON.parse(localStorage.getItem('moakung3d.v1')));
    check('새로고침 후 별·도감·다음 레벨 해금 유지', saved.best['1'] && saved.book['1'] >= 1 && saved.unlocked >= 2, JSON.stringify({ best: saved.best, book: saved.book, unlocked: saved.unlocked }));
  }
};

module.exports = { Bot, SCENARIOS, playFit, playAllIn, dropCheck };
if (require.main !== module) return;

(async () => {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SCENARIOS);
  const browser = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [];
  for (const name of names) {
    const touch = name === 'touch';
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    await page.goto(URL);
    const bot = new Bot(page, touch);
    await bot.init();
    try { await SCENARIOS[name](bot); } catch (e) { check(`${name} 실행`, false, e.message); }
    await ctx.close();
  }
  await browser.close();
  check('콘솔/페이지 오류 없음', errors.length === 0, errors.slice(0, 4).join(' / '));
  const fails = results.filter(r => !r.ok);
  console.log(`\n${fails.length ? '✘' : '✔'} ${results.length - fails.length}/${results.length} 통과`);
  process.exit(fails.length ? 1 : 0);
})();
