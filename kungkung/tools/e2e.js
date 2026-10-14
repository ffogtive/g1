// 킁킁! 실제 터치 E2E (Playwright, 390×844, CDP Input.dispatchTouchEvent)
// 가설: 판정은 snapshot().atk.hits(빨간 구간) 하나로만 나므로, 그 구간 밖으로 끌면 모든 패턴을 피할 수 있고(공정),
//       가만히 있으면 공격 하나당 정확히 한 번만 맞는다(연타·앞발도 잡히면 나머지 취소).
// 실행: node kungkung/tools/e2e.js   (스크린샷: $OUT 또는 /tmp/kungkung-e2e)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'kungkung-e2e');
fs.mkdirSync(OUT, { recursive: true });
const FY = 780;   // 끌기 손가락 높이 (바닥 구역)
const results = [];
const ok = (name, cond, info) => { results.push([cond ? 'PASS' : 'FAIL', name]); console.log(cond ? 'PASS' : 'FAIL', name, info == null ? '' : info); };

async function open(browser, q, errs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning' && /^F2/.test(m.text())) console.log('  경고:', m.text()); });
  await page.goto(URL + q);
  await page.waitForTimeout(600);
  const cdp = await ctx.newCDPSession(page);
  const T = {
    ctx, page,
    touch: (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }),
    snap: () => page.evaluate(() => window.kung.snapshot()),
    waitFor: (src, to = 15000) => page.evaluate(([src, to]) => new Promise(res => { const f = new Function('q', 'return ' + src); const t0 = performance.now(); (function loop() { const q = window.kung.snapshot(); if (f(q)) return res(q); if (performance.now() - t0 > to) return res(null); requestAnimationFrame(loop); })(); }), [src, to]),
    fx: 195
  };
  T.tap = async (x, y) => { await T.touch('touchStart', x, y); await T.touch('touchEnd'); };
  T.moveTo = async (x) => { for (let i = 1; i <= 3; i++) await T.touch('touchMove', T.fx + (x - T.fx) * i / 3, FY); T.fx = x; };
  T.start = async () => { await T.tap(195, FY); const q = await T.waitFor('q.state === "play"', 3000); await T.touch('touchStart', 195, FY); T.fx = 195; return q; };
  return T;
}
/** 빨간 구간(hits) 밖에서 쿠키에 가장 가까운 안전 지점 */
function safeX(hits, cur, W = 390) {
  const lo = 46, hi = W - 46, pad = 22, segs = [];
  let c = lo;
  hits.map(h => [h[0] - pad, h[1] + pad]).sort((a, b) => a[0] - b[0]).forEach(h => { if (h[0] > c) segs.push([c, h[0]]); c = Math.max(c, h[1]); });
  if (c < hi) segs.push([c, hi]);
  let best = null, bd = 1e9;
  segs.forEach(sg => { const x = Math.max(sg[0], Math.min(sg[1], cur)), d = Math.abs(x - cur); if (d < bd) { bd = d; best = x; } });
  return best == null ? cur : best;
}
/** 자동 피하기: 빨간 구간이 쿠키를 덮으면 가장 가까운 안전 지점으로 끔 */
async function autoDodge(T, until, maxMs = 60000) {
  const t0 = Date.now(); let q;
  while (Date.now() - t0 < maxMs) {
    q = await T.snap();
    if (q.state !== 'play' || until(q)) break;
    const hits = q.atk ? q.atk.hits : [];
    if (hits.length && hits.some(h => q.cookie.x > h[0] - 18 && q.cookie.x < h[1] + 18)) await T.moveTo(safeX(hits, q.cookie.x));
    await T.page.waitForTimeout(12);
  }
  return q;
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errs = [];
  let F2 = 0;

  /* ---------- 1. 기본 (회색이) ---------- */
  {
    const T = await open(browser, '?seed=11&dog=grey', errs);
    let q = await T.snap();
    ok('제목 화면 · 회색이', q.state === 'title' && q.breed === 'grey');
    await T.tap(q.chips[1].sx, q.chips[1].sy);
    q = await T.waitFor('q.breed === "shiba"', 1500);
    ok('견종 칩 → 시바 (시작 안 함)', q && q.state === 'title');
    await T.page.waitForTimeout(300); await T.page.screenshot({ path: OUT + '/title-shiba.png' });
    await T.tap(q.chips[0].sx, q.chips[0].sy);
    q = await T.waitFor('q.breed === "grey"', 1500);
    ok('견종 칩 → 회색이', !!q);
    q = await T.start();
    ok('탭하면 시작 · 하트 3', q && q.hearts === 3);
    for (let x = 195; x >= 50; x -= 15) await T.touch('touchMove', x, FY); T.fx = 50;
    q = await T.waitFor('q.look < -0.6', 1500);
    ok('끌면 쿠키가 따라옴 · 눈이 왼쪽을 봄', q && q.cookie.x < 70 && q.look < -0.6, q && 'x=' + q.cookie.x + ' look=' + q.look);
    for (let x = 50; x <= 340; x += 20) await T.touch('touchMove', x, FY); T.fx = 340;
    q = await T.waitFor('q.look > 0.6', 1500);
    ok('눈이 오른쪽 쿠키를 따라 봄', q && q.look > 0.6);
    // 피하기
    q = await T.waitFor('q.atk && q.atk.step === "lunge" && q.atk.color === "red"', 8000);
    const b0 = q;
    await T.moveTo(q.atk.tx > 195 ? 60 : 330);
    q = await T.waitFor('!q.atk || q.atk.step === "back"', 3000);
    ok('빨간 원 밖으로 피함 → +점수 · 하트 그대로 · 코 도장', q && q.dodges === b0.dodges + 1 && q.score > b0.score && q.hearts === b0.hearts && q.prints >= 1, q && JSON.stringify({ d: q.dodges, s: q.score, h: q.hearts }));
    // 가만히 → 날름
    q = await T.waitFor('q.atk && q.atk.step === "tell"', 8000);
    const h0 = q.hearts;
    q = await T.waitFor('q.atk && q.atk.step === "stamp"', 4000);
    await T.page.waitForTimeout(180); await T.page.screenshot({ path: OUT + '/grey-lick.png' });
    q = await T.snap();
    ok('가만히 있으면 날름 · 하트 −1 · 신난 얼굴', q.hearts === h0 - 1 && q.shot && q.mood === 'yum', 'hearts ' + h0 + '→' + q.hearts + ' mood=' + q.mood);
    // 코 톡
    q = await T.waitFor('q.atk && q.atk.step === "lunge" && q.atk.color === "red" && q.z < 0.3', 8000);
    await T.touch('touchEnd');
    const e0 = await T.snap();
    await T.tap(e0.nose.sx, e0.nose.sy);
    ok('일찍 누른 톡은 무시', (await T.snap()).boops === e0.boops, 'z=' + e0.z);
    q = await T.waitFor('q.atk && (q.atk.step !== "lunge" || q.z > 0.55)', 3000);
    if (q && q.atk && q.atk.step === 'lunge') {
      const sb = q.score;
      await T.tap(q.nose.sx, q.nose.sy);
      const qa = await T.snap();
      ok('돌진 후반 코 톡 → 재채기 +30', qa.boops === q.boops + 1 && qa.score >= sb + 30 && qa.atk && qa.atk.step === 'boop', 'z=' + q.z);
      await T.page.waitForTimeout(90); await T.page.screenshot({ path: OUT + '/grey-sneeze.png' });
    } else ok('돌진 후반 코 톡 → 재채기 +30', false, '창 놓침');
    F2 += (await T.snap()).warnF2;
    await T.ctx.close();
  }

  /* ---------- 2. 패턴이 풀리는 순서 (견종 버릇) + 자동 피하기로 다 피함 ---------- */
  for (const [dog, order] of [['grey', ['big', 'hold', 'double']], ['shiba', ['feint', 'paws', 'triple']]]) {
    const T = await open(browser, '?seed=5&dog=' + dog, errs);
    await T.start();
    let q = await autoDodge(T, q => q.t > 37, 90000);
    const firsts = {}; q.kinds.forEach(k => { if (firsts[k.kind] == null) firsts[k.kind] = k.t; });
    const want = { big: 10, hold: 20, double: 32, feint: 10, paws: 20, triple: 32 };
    ok(`${dog}: 버릇 패턴이 정해진 시각 뒤에 처음 나옴`, order.every(k => firsts[k] != null && firsts[k] >= want[k]), JSON.stringify(firsts));
    ok(`${dog}: 처음 나온 패턴은 first 표시(예고 1.5배)`, q.kinds.filter(k => k.first).map(k => k.kind).join() === ['kung'].concat(order).join(), q.kinds.filter(k => k.first).map(k => k.kind).join());
    ok(`${dog}: 자동 피하기로 37초 동안 하트 안 잃음 (모든 패턴이 피할 수 있음)`, q.hearts === 3, JSON.stringify({ t: q.t, hearts: q.hearts, dodges: q.dodges, attacks: q.kinds.length }));
    F2 += q.warnF2;
    await T.ctx.close();
  }

  /* ---------- 3. 패턴별 ---------- */
  async function patRun(dog, pat, fn) { const T = await open(browser, `?seed=7&dog=${dog}&pat=${pat}`, errs); await T.start(); await fn(T); F2 += (await T.snap()).warnF2; await T.ctx.close(); }
  // 가만히 있으면 공격 하나에 정확히 한 번만 맞는다
  for (const [dog, pat] of [['grey', 'kung'], ['grey', 'big'], ['grey', 'hold'], ['grey', 'double'], ['shiba', 'feint'], ['shiba', 'paws'], ['shiba', 'triple']]) {
    await patRun(dog, pat, async T => {
      const q = await T.waitFor('q.kinds.length >= 2', 20000);   // 첫 공격이 끝나고 다음이 시작될 때까지 가만히
      ok(`${pat}: 가만히 → 한 번만 맞음`, q && q.hearts === 2 && q.dodges === 0, q && JSON.stringify({ h: q.hearts, d: q.dodges, prints: q.prints }));
      if (/double|triple/.test(pat)) ok(`${pat}: 잡히면 남은 연타 취소 (코 쿵 1번)`, q && q.prints === 1, q && 'prints=' + q.prints);
    });
    await patRun(dog, pat, async T => {
      const q = await autoDodge(T, q => q.kinds.length >= 4, 40000);
      const per = { double: 2, triple: 3, paws: 2 }[pat] || 1;
      ok(`${pat}: 빨간 구간 밖으로 피하면 다 피함 (공격 3번 = 판정 ${3 * per}번)`, q.hearts === 3 && q.dodges >= 3 * per, JSON.stringify({ h: q.hearts, d: q.dodges }));
    });
  }
  // 가짜: 흰 원 그대로, 판정 없음, 톡 무시, 메롱
  await patRun('shiba', 'feint', async T => {
    let q = await T.waitFor('q.atk && q.atk.phase === "fake" && q.z > 0.15', 8000);
    ok('가짜 돌진: 원이 흰색이고 판정 구간 없음', q && q.atk.color === 'white' && q.atk.hits.length === 0, q && JSON.stringify(q.atk));
    if (q) { await T.touch('touchEnd'); await T.tap(q.nose.sx, q.nose.sy); await T.touch('touchStart', T.fx, FY); }
    const q2 = await T.snap();
    ok('가짜 돌진 중 톡은 무시', q2.boops === 0);
    q = await T.waitFor('q.atk && q.atk.step === "tilt" && q.atk.t > 0.08', 3000);
    ok('가짜 뒤 갸웃 + 메롱 얼굴', q && q.mood === 'tease', q && 'mood=' + q.mood);
    await T.page.screenshot({ path: OUT + '/shiba-tease.png' });
    q = await T.waitFor('q.atk && q.atk.step === "lunge" && q.atk.phase === "lunge"', 3000);
    ok('그다음 진짜 돌진은 빨강', q && q.atk.color === 'red' && q.atk.hits.length === 1);
  });
  // 크게 킁: 원이 96으로 커지고 톡 창이 넓고 +50
  await patRun('grey', 'big', async T => {
    let q = await T.waitFor('q.atk && q.atk.step === "lunge"', 8000);
    ok('크게 킁: 빨간 원 반경 96', q && q.atk.r === 96, q && 'r=' + q.atk.r);
    await T.touch('touchEnd');
    q = await T.waitFor('q.atk && q.atk.step === "lunge" && q.z >= 0.37', 8000);
    const sb = q ? q.score : 0;
    if (q) await T.tap(q.nose.sx, q.nose.sy);
    const qa = await T.snap();
    ok('크게 킁: z 0.37에서도 톡 → +50', q && qa.boops === 1 && qa.score === sb + 50, q && 'z=' + q.z + ' score ' + sb + '→' + qa.score);
    await T.page.screenshot({ path: OUT + '/grey-big-sneeze.png' });
  });
  // 멈칫: 0.5~0.9초 참다가, 빨간 원이 쿠키 쪽으로 슬금슬금
  await patRun('grey', 'hold', async T => {
    let q = await T.waitFor('q.atk && q.atk.step === "hold"', 8000);
    const x0 = q.atk.tx, t0 = q.t;
    await T.moveTo(q.cookie.x > 195 ? 60 : 330);
    q = await T.waitFor('q.atk && q.atk.step !== "hold"', 3000);
    const held = q.t - t0, moved = Math.abs(q.atk.tx - x0);
    ok('멈칫: 0.5~0.9초 참음, 빨간 원이 쿠키 쪽으로 0~50px 슬금', held > 0.42 && held < 1.0 && moved > 3 && moved <= 50, 'held=' + held.toFixed(2) + ' moved=' + moved);
    q = await T.waitFor('!q.atk || q.atk.step === "back"', 3000);
    ok('멈칫: 멀리 피해 있으면 피함', q && q.hearts === 3 && q.dodges === 1);
  });
  // 앞발: 두 자리, 빨강, 둘 다 피하면 +2
  await patRun('shiba', 'paws', async T => {
    let q = await T.waitFor('q.atk && q.atk.step === "paws"', 8000);
    ok('앞발: 두 자리가 처음부터 빨강', q && q.atk.paws.length === 2 && q.atk.hits.length === 2 && q.atk.color === 'red', q && JSON.stringify(q.atk.paws));
    await T.page.waitForTimeout(300); await T.page.screenshot({ path: OUT + '/shiba-paws.png' });
  });
  // 세 번: 머리 위 ●●● 와 판정 3번
  await patRun('shiba', 'triple', async T => {
    const q = await autoDodge(T, q => q.kinds.length >= 2, 15000);
    ok('세 번 킁: 한 공격에 판정 3번', q.dodges >= 3 && q.hearts === 3, 'dodges=' + q.dodges);
  });

  /* ---------- 4. 끝 ---------- */
  {
    const T = await open(browser, '?seed=11&dog=shiba&pat=kung', errs);
    await T.start(); await T.touch('touchEnd');
    let q = await T.waitFor('q.over', 30000);
    await T.page.waitForTimeout(400); await T.page.screenshot({ path: OUT + '/over.png' });
    ok('하트 0 → 결과 카드 · 날름 한 컷', q && q.over && q.hearts <= 0 && await T.page.evaluate(() => !!document.querySelector('#card img.shot')));
    const btn = await T.page.evaluate(() => { const r = document.querySelector('#card button').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await T.tap(btn.x, btn.y);
    q = await T.waitFor('q.state === "play" && !q.over', 2000);
    ok('다시 → 새 판 (견종 유지)', q && q.hearts === 3 && q.breed === 'shiba');
    await T.ctx.close();
  }

  ok('공정성: 안전 구간 부족 경고 0', F2 === 0, 'warnF2=' + F2);
  ok('콘솔 오류 0', errs.length === 0, errs.join(' | '));
  console.log('\n' + results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' PASS   스크린샷: ' + OUT);
  await browser.close();
  process.exit(results.every(r => r[0] === 'PASS') ? 0 : 1);
})();
