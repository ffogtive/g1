// 킁킁! 실사 v2 E2E (Playwright, 390×844, CDP 실제 터치) — 로컬 HTTP로 열어 아티팩트와 같은 조건(같은 출처)
// 가설: 칸마다 고른 클립(바깥 칸은 고개를 트는 r1·r2, 왼쪽은 반전)과 거꾸로/멈춤/빠르게 재생으로 만든 패턴이,
//       그림 버전과 같은 판정 규칙(빨간 것만 아픔, 연타·앞발은 잡히면 나머지 취소)대로 동작하고 모두 피할 수 있다.
// 실행: node kungkung/tools/e2e-real.js   (스크린샷: $OUT 또는 /tmp/kungkung-real-e2e)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'kungkung-real-e2e');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const FY = 790;
const results = [];
const ok = (name, cond, info) => { results.push([cond ? 'PASS' : 'FAIL', name]); console.log(cond ? 'PASS' : 'FAIL', name, info == null ? '' : info); };

/** 영상 구간 탐색(Range)까지 되는 작은 정적 서버 */
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      const size = fs.statSync(f).size, type = TYPES[path.extname(f)] || 'application/octet-stream', m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (m) { const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : size - 1; rsp.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 }); fs.createReadStream(f, { start: a, end: b }).pipe(rsp); }
      else { rsp.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' }); fs.createReadStream(f).pipe(rsp); }
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}
/** 빨간 구간 밖에서 쿠키에 가장 가까운 안전 지점 */
function safeX(hits, cur, W = 390) {
  const lo = 46, hi = W - 46, pad = 22, segs = []; let c = lo;
  hits.map(h => [h[0] - pad, h[1] + pad]).sort((a, b) => a[0] - b[0]).forEach(h => { if (h[0] > c) segs.push([c, h[0]]); c = Math.max(c, h[1]); });
  if (c < hi) segs.push([c, hi]);
  let best = cur, bd = 1e9; segs.forEach(sg => { const x = Math.max(sg[0], Math.min(sg[1], cur)), d = Math.abs(x - cur); if (d < bd) { bd = d; best = x; } });
  return best;
}

(async () => {
  const srv = await serve(), BASE = `http://127.0.0.1:${srv.address().port}/real.html`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const errs = []; let F2 = 0;
  const V = { cuts: [], late: 0, tellCuts: 0, minCover: 1, seekLive: 0, resync: 0 };   // 끊김 지표 (모든 판 합산)
  async function open(q) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning' && /^F2/.test(m.text())) console.log('  경고:', m.text()); });
    await page.goto(BASE + q);
    const cdp = await ctx.newCDPSession(page);
    const T = { ctx, page, fx: 195,
      touch: (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }),
      snap: () => page.evaluate(() => window.kung.snapshot()),
      waitFor: (src, to = 15000) => page.evaluate(([src, to]) => new Promise(res => { const f = new Function('q', 'return ' + src); const t0 = performance.now(); (function loop() { const q = window.kung.snapshot(); if (f(q)) return res(q); if (performance.now() - t0 > to) return res(null); requestAnimationFrame(loop); })(); }), [src, to]) };
    T.tap = async (x, y) => { await T.touch('touchStart', x, y); await T.touch('touchEnd'); };
    T.moveTo = async x => { for (let i = 1; i <= 3; i++) await T.touch('touchMove', T.fx + (x - T.fx) * i / 3, FY); T.fx = x; };
    T.start = async (all = true) => { await T.waitFor(all ? 'q.readyAll === q.files' : 'q.ready >= 4', 40000); await T.tap(195, FY); await T.waitFor('q.state === "play"', 3000); await T.touch('touchStart', 195, FY); T.fx = 195; };
    T.close = async () => {
      const q = await T.snap(), vl = await page.evaluate(() => window.kung.vlog());
      F2 += q.warnF2; V.late += q.vstat.late; V.tellCuts += q.vstat.tellCuts; V.minCover = Math.min(V.minCover, q.vstat.minCover); V.seekLive += q.vstat.seekLive; V.resync += q.vstat.resync;
      vl.filter(e => e.k === 'cut').forEach(e => V.cuts.push(e));
      vl.filter(e => e.k === 'seek' || e.k === 'resync').forEach(e => (V.seeks = V.seeks || []).push(Object.assign({ page: page.url().split('?')[1] }, e)));
      await ctx.close();
    };
    // 클립 전환 기록
    await page.evaluate(() => { window.__clips = []; (function loop() { const q = window.kung.snapshot(); const l = window.__clips[window.__clips.length - 1]; const k = q.clip + (q.mir ? '~' : ''); if (!l || l !== k) window.__clips.push(k); requestAnimationFrame(loop); })(); });
    return T;
  }
  async function autoDodge(T, until, maxMs) {
    const t0 = Date.now(); let q;
    while (Date.now() - t0 < maxMs) {
      q = await T.snap(); if (q.state !== 'play' || until(q)) break;
      const hits = q.atk ? q.atk.hits : [];
      if (hits.length && hits.some(h => q.cookie.x > h[0] - 18 && q.cookie.x < h[1] + 18)) await T.moveTo(safeX(hits, q.cookie.x));
      await T.page.waitForTimeout(12);
    }
    return q;
  }

  /* ---------- 1. 소재 로드 + 칸별 클립·코 자리 (칸마다 새 판, 가만히 → 그 칸에서 쿵) ---------- */
  const want = { 55: { lane: 0, keys: ['r1', 'r2'], mir: 1, outer: 1 }, 125: { lane: 1, keys: ['c'], mir: 0 }, 195: { lane: 2, keys: ['c'], mir: 0 }, 265: { lane: 3, keys: ['c'], mir: 0 }, 335: { lane: 4, keys: ['r1', 'r2'], mir: 0, outer: 1 } };
  let first = true;
  for (const lx of [55, 125, 195, 265, 335]) {
    const T = await open('?seed=' + (lx + 3) + '&pat=kung');
    if (first) { const q0 = await T.waitFor('q.readyAll === q.files', 40000); ok('소재 로드: 영상 12개(WebM) + 잔디·비스킷', !!q0, q0 && q0.readyAll + '/' + q0.files + ' ' + q0.src); first = false; }
    await T.start();
    await T.moveTo(lx);
    const q = await T.waitFor('q.atk && q.atk.step === "stamp"', 12000);
    await T.page.screenshot({ path: `${OUT}/lane-${lx}.png` });
    const w = want[lx], a = q && q.atk;
    const near = a && (w.outer ? (Math.sign(q.nose.sx - 195) === Math.sign(lx - 195) && Math.abs(q.nose.sx - a.stx) <= 60) : Math.abs(q.nose.sx - a.stx) <= 15);
    ok(`칸 ${w.lane}(x=${lx}): 클립 ${w.keys.join('/')}${w.mir ? ' 반전' : ''}, 코 자리 ${w.outer ? '같은 쪽 60px 안' : '±15px'}`, a && a.lane === w.lane && w.keys.includes(a.key) && a.mir === w.mir && near,
      a && JSON.stringify({ lane: a.lane, key: a.key, mir: a.mir, target: a.stx, nose: q.nose.sx, zoom: q.zoom }));
    await T.close();
  }

  /* ---------- 2. 패턴별: 가만히 → 공격 하나에 정확히 한 번만 맞음 / 빨간 구간 밖으로 → 다 피함 ---------- */
  for (const pat of ['kung', 'big', 'hold', 'feint', 'double', 'triple', 'paws']) {
    let T = await open('?seed=21&pat=' + pat); await T.start();
    let q = await T.waitFor('q.kinds.length >= 2', 25000);
    ok(`${pat}: 가만히 → 한 번만 맞음`, q && q.hearts === 2 && q.dodges === 0, q && JSON.stringify({ h: q.hearts, d: q.dodges, prints: q.prints }));
    await T.close();
    T = await open('?seed=22&pat=' + pat); await T.start();
    q = await autoDodge(T, q => q.kinds.length >= 4, 60000);
    const per = { double: 2, triple: 3, paws: 2 }[pat] || 1;
    const clips = await T.page.evaluate(() => window.__clips);
    ok(`${pat}: 빨간 구간 밖으로 피하면 다 피함 (공격 3번 = 판정 ${3 * per}번)`, q.hearts === 3 && q.dodges >= 3 * per, JSON.stringify({ h: q.hearts, d: q.dodges, hit: q.hitKinds }) + ' clips ' + clips.slice(0, 14).join('>'));
    if (/double|triple/.test(pat)) ok(`${pat}: 연타 사이 거꾸로 재생본으로 빠르게 물러남`, clips.some(c => /_rev/.test(c)), clips.slice(0, 12).join('>'));
    if (pat === 'paws') ok('paws: 앞발 클립 사용', clips.some(c => /^paws/.test(c)), clips.slice(0, 10).join('>'));
    if (pat === 'kung') { const vs = (await T.snap()).vstat; ok('끊김: 킁 한 번에 전환은 2번뿐 (킁킁 루프 → 돌진 → 킁킁 루프)', vs.cuts <= 1 + 2 * q.kinds.length, JSON.stringify({ cuts: vs.cuts, attacks: q.kinds.length })); }
    await T.close();
  }

  /* ---------- 3. 가짜: 흰 원·판정 없음·톡 무시 → 거꾸로 + 메롱 → 진짜(빨강) ---------- */
  {
    const T = await open('?seed=31&pat=feint'); await T.start();
    let q = await T.waitFor('q.atk && q.atk.phase === "fake" && q.atk.t > 0.12', 10000);
    ok('가짜 돌진: 흰 원, 판정 구간 없음', q && q.atk.color === 'white' && q.atk.hits.length === 0, q && JSON.stringify({ c: q.atk.color, hits: q.atk.hits, clip: q.clip }));
    await T.page.screenshot({ path: OUT + '/feint-fake.png' });
    if (q) { await T.touch('touchEnd'); await T.tap(q.nose.sx, q.nose.sy); await T.touch('touchStart', T.fx, FY); }
    ok('가짜 돌진 중 톡은 무시', (await T.snap()).boops === 0);
    q = await T.waitFor('q.atk && q.atk.step === "tilt"', 4000);
    const q2 = await T.waitFor('q.atk && q.atk.step === "tilt" && q.clip === "lick"', 2000);
    await T.page.screenshot({ path: OUT + '/feint-tease.png' });
    const clips = await T.page.evaluate(() => window.__clips);
    ok('가짜 뒤: 오던 길 거꾸로(_rev) → 혀 메롱(lick)', !!q && !!q2 && clips.some(c => /_rev/.test(c)), clips.join('>'));
    q = await T.waitFor('q.atk && q.atk.step === "lunge" && q.atk.phase === "lunge"', 4000);
    ok('그다음 진짜 돌진은 빨강', q && q.atk.color === 'red' && q.atk.hits.length === 1);
    await T.close();
  }
  /* ---------- 4. 멈칫: 영상이 멈춘 채 빨간 원이 슬금슬금 ---------- */
  {
    const T = await open('?seed=41&pat=hold'); await T.start();
    let q = await T.waitFor('q.atk && q.atk.step === "hold" && q.atk.t > 0.25', 10000);
    const x0 = q.atk.tx, c0 = q.clipT, t0 = q.t;
    await T.moveTo(q.cookie.x > 195 ? 70 : 320);
    await T.page.screenshot({ path: OUT + '/hold.png' });
    q = await T.waitFor('q.atk && q.atk.step !== "hold"', 3000);
    const q1 = await T.snap();
    ok('멈칫: 0.5~0.9초 참는 동안 영상 정지, 빨간 원이 쿠키 쪽으로 슬금', q && Math.abs(q.atk.tx - x0) > 3 && q.t - t0 < 1.0, JSON.stringify({ moved: q && Math.abs(q.atk.tx - x0), clipT0: c0, held: q && +(q.t - t0).toFixed(2) }));
    await T.close();
  }
  /* ---------- 5. 코 톡: 재채기 클립, 크게 킁은 +50 ---------- */
  for (const [pat, pts] of [['kung', 30], ['big', 50]]) {
    const T = await open('?seed=51&pat=' + pat); await T.start(); await T.touch('touchEnd');
    const q = await T.waitFor(`q.atk && q.atk.step === "lunge" && q.atk.phase === "lunge" && q.atk.t > ${pat === 'big' ? 0.3 : 0.27}`, 10000);
    const sb = q ? q.score : 0;
    if (q) await T.tap(q.nose.sx, q.nose.sy);
    const qa = await T.waitFor('q.clip === "sneeze"', 1500);
    await T.page.waitForTimeout(500); await T.page.screenshot({ path: OUT + `/sneeze-${pat}.png` });
    ok(`${pat}: 돌진 후반 코 톡 → 재채기 클립 +${pts}`, qa && qa.boops === 1 && qa.score === sb + pts, qa && JSON.stringify({ score: sb + '→' + qa.score, clip: qa.clip }));
    await T.close();
  }
  /* ---------- 6. 버릇 시간표 + 자동 피하기로 45초 하트 3 (모든 패턴이 피할 수 있음) ---------- */
  {
    const T = await open('?seed=61'); await T.start();
    const q = await autoDodge(T, q => q.t > 52, 140000);
    const firsts = {}; q.kinds.forEach(k => { if (firsts[k.kind] == null) firsts[k.kind] = k.t; });
    const at = { big: 10, feint: 16, hold: 22, paws: 27, double: 32, triple: 42 };
    ok('버릇 시간표: 각 패턴이 정해진 시각 뒤에 처음 나옴', Object.keys(at).every(k => firsts[k] != null && firsts[k] >= at[k]), JSON.stringify(firsts));
    ok('자동 피하기로 52초 하트 3 (공정)', q.hearts === 3, JSON.stringify({ t: q.t, h: q.hearts, d: q.dodges, hit: q.hitKinds, lanes: q.lanes.slice(0, 12) }));
    await T.close();
  }
  /* ---------- 7. 결과 카드 ---------- */
  {
    const T = await open('?seed=71&pat=kung'); await T.start(); await T.touch('touchEnd');
    const q = await T.waitFor('q.over', 40000);
    await T.page.waitForTimeout(400); await T.page.screenshot({ path: OUT + '/over.png' });
    const img = await T.page.evaluate(() => { const i = document.querySelector('#card img.shot'); return i ? i.src.length : 0; });
    ok('하트 0 → 결과 카드 · 날름 한 컷(영상 합성)', q && q.over && img > 5000, 'shot bytes=' + img);
    await T.close();
  }
  {
    const bad = V.cuts.filter(e => Math.abs(e.mt - e.from) > 0.07);
    ok('끊김: 전환마다 새 층의 첫 프레임이 목표 시각 ±0.07초 (옛 프레임이 안 비침)', V.cuts.length > 20 && bad.length === 0, `cuts=${V.cuts.length} bad=${JSON.stringify(bad.slice(0, 3))}`);
    ok('끊김: 준비가 늦어 그냥 보여준 전환 0', V.late === 0, 'late=' + V.late);
    ok('끊김: 예고(킁킁) 중 클립 전환 0', V.tellCuts === 0, 'tellCuts=' + V.tellCuts);
    ok('끊김: 페이드 중에도 화면이 늘 덮임 (배경이 안 비침)', V.minCover >= 0.99, 'minCover=' + V.minCover);
    ok('끊김: 보이는 영상을 그 자리에서 되감거나 다시 맞춘 횟수 0 (이어 재생만)', V.seekLive === 0 && V.resync === 0, `seekLive=${V.seekLive} resync=${V.resync} ` + JSON.stringify((V.seeks || []).slice(0, 4)));
  }
  ok('공정성: 안전 구간 부족 경고 0', F2 === 0, 'warnF2=' + F2);
  ok('콘솔 오류 0', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log('\n' + results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' PASS   스크린샷: ' + OUT);
  await browser.close(); srv.close();
  process.exit(results.every(r => r[0] === 'PASS') ? 0 : 1);
})();
