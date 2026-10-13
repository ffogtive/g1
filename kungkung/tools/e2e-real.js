// 킁킁! 실사 시험판 E2E (Playwright, 390×844, CDP 실제 터치) — 로컬 HTTP로 열어 아티팩트와 같은 조건(같은 출처)
// 가설: 클립 3개가 상태마다 정해진 순서로 바뀌고(sniff → press → press 물러남 | lick → sniff),
//       영상 층을 밀어 쿵 순간 코가 목표 x 위에 오면, 판정·조작은 그림 버전과 똑같이 동작한다.
// 실행: node kungkung/tools/e2e-real.js   (스크린샷: $OUT 또는 /tmp/kungkung-real-e2e)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'kungkung-real-e2e');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg' };
const FY = 790;
const results = [];
const ok = (name, cond, info) => { results.push([cond ? 'PASS' : 'FAIL', name]); console.log(cond ? 'PASS' : 'FAIL', name, info == null ? '' : info); };

/** 영상 구간 탐색(Range)까지 되는 아주 작은 정적 서버 */
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

(async () => {
  const srv = await serve(), URL = `http://127.0.0.1:${srv.address().port}/real.html`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL + '?seed=9');
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const tap = async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd'); };
  const snap = () => page.evaluate(() => window.kung.snapshot());
  const waitFor = (src, to = 15000) => page.evaluate(([src, to]) => new Promise(res => { const f = new Function('q', 'return ' + src); const t0 = performance.now(); (function loop() { const q = window.kung.snapshot(); if (f(q)) return res(q); if (performance.now() - t0 > to) return res(null); requestAnimationFrame(loop); })(); }), [src, to]);
  // 클립 전환 기록 (페이지 안에서 매 프레임)
  await page.evaluate(() => { window.__clips = []; (function loop() { const q = window.kung.snapshot(); const l = window.__clips[window.__clips.length - 1]; if (!l || l[0] !== q.clip) window.__clips.push([q.clip, q.clipT, q.atk ? q.atk.phase : null]); requestAnimationFrame(loop); })(); });

  let q = await waitFor('q.ready === 3', 20000);
  ok('영상 3개 로드', !!q, q && q.vids.join());
  await page.waitForTimeout(500); await page.screenshot({ path: OUT + '/r0-title.png' });
  await tap(195, FY);
  q = await waitFor('q.state === "play"', 3000);
  ok('탭하면 시작 · 평소엔 sniff 반복', q && q.clip === 'sniff' && q.hearts === 3, q && q.clip);
  await touch('touchStart', 195, FY);
  let fx = 195;
  const moveTo = async x => { for (let i = 1; i <= 3; i++) await touch('touchMove', fx + (x - fx) * i / 3, FY); fx = x; };

  // 1) 킁킁 → 돌진: press 클립이 이어서 재생
  q = await waitFor('q.atk && q.atk.phase === "windup" && q.clip === "press"', 8000);
  ok('킁킁 단계: press 클립(돌진 직전 구간)으로 전환', !!q, q && 't=' + q.clipT);
  // 피하기: 빨간 원이 뜨자마자 밖으로
  q = await waitFor('q.atk && q.atk.phase === "lunge"', 4000);
  const tgt = q ? q.atk.stx : 195;
  await moveTo(tgt > 195 ? 60 : 330);
  q = await waitFor('q.atk && q.atk.phase === "impact"', 3000);
  await page.screenshot({ path: OUT + '/r2-pressed.png' });
  ok('쿵 순간 코가 목표 x 위 (±15px)', q && Math.abs(q.nose.sx - q.atk.stx) <= 15, q && 'nose=' + q.nose.sx + ' target=' + q.atk.stx + ' shift=' + q.shift);
  q = await waitFor('q.atk === null', 4000);
  ok('피함 → +점수 · 하트 그대로 → 다시 sniff', q && q.dodges === 1 && q.score > 0 && q.hearts === 3 && q.clip === 'sniff', q && JSON.stringify({ d: q.dodges, s: q.score, clip: q.clip }));

  // 2) 가만히 → 날름 (lick 클립)
  await moveTo(100);   // 가장자리 목표에서도 영상 층이 밀려 코가 쿠키 위로 오는지
  q = await waitFor('q.atk && q.atk.phase === "windup"', 8000);
  const h0 = q.hearts;
  q = await waitFor('q.atk && q.atk.phase === "lunge" && q.clipT > 2.0', 4000);
  if (q) await page.screenshot({ path: OUT + '/r1-approach.png' });
  const qi = await waitFor('q.atk && q.atk.phase === "impact"', 4000);
  ok('왼쪽 목표(x≈100)에서도 쿵 순간 코가 목표 위 (±15px)', qi && Math.abs(qi.nose.sx - qi.atk.stx) <= 15 && qi.atk.stx < 130, qi && 'nose=' + qi.nose.sx + ' target=' + qi.atk.stx + ' shift=' + qi.shift);
  q = await waitFor('q.clip === "lick" && q.clipT > 2.25', 6000);
  if (q) await page.screenshot({ path: OUT + '/r3-lick.png' });
  ok('가만히 있으면 lick 클립 · 하트 −1', q && q.hearts === h0 - 1, q && 'hearts ' + h0 + '→' + q.hearts);
  q = await waitFor('q.atk === null && q.clip === "sniff"', 6000);
  ok('날름 뒤 다시 sniff', !!q);

  // 3) 코 톡: 다가옴 후반에 코를 누름
  q = await waitFor('q.atk && q.atk.phase === "lunge" && q.atk.t > 0.2', 10000);
  if (q) {
    await touch('touchEnd'); const sb = q.score;
    await tap(q.nose.sx, q.nose.sy);
    const qa = await snap();
    ok('돌진 후반 코 톡 → 에취 +30 · press 물러남', qa.boops === 1 && qa.score >= sb + 30 && qa.atk && qa.atk.phase === 'boop', JSON.stringify({ boops: qa.boops, score: sb + '→' + qa.score, phase: qa.atk && qa.atk.phase }));
    await touch('touchStart', fx, FY);
  } else ok('돌진 후반 코 톡 → 에취 +30 · press 물러남', false, '돌진 못 찾음');

  // 4) 끝까지 가만히 → 결과 카드 + 날름 한 컷
  await touch('touchEnd');
  q = await waitFor('q.over', 40000);
  await page.waitForTimeout(400); await page.screenshot({ path: OUT + '/r4-over.png' });
  const img = await page.evaluate(() => { const i = document.querySelector('#card img.shot'); return i ? i.src.length : 0; });
  ok('하트 0 → 결과 카드 · 날름 한 컷(영상 프레임 합성)', q && q.over && img > 5000, 'shot bytes=' + img);
  const clips = await page.evaluate(() => window.__clips);
  const seq = clips.map(c => c[0]).join('>');
  const names = clips.map(c => c[0]), bad = names.filter((c, i) => i > 0 && !({ sniff: ['press'], press: ['sniff', 'lick'], lick: ['sniff'] }[names[i - 1]] || []).includes(c));
  ok('클립 전환 규칙: sniff→press→(sniff|lick)→sniff, 첫 판정(피함)은 lick 없이', names[0] === 'sniff' && bad.length === 0 && names.slice(0, 3).join('>') === 'sniff>press>sniff', seq.slice(0, 120));
  ok('콘솔 오류 0', errs.length === 0, errs.join(' | '));
  console.log('\n' + results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' PASS   스크린샷: ' + OUT);
  await browser.close(); srv.close();
  process.exit(results.every(r => r[0] === 'PASS') ? 0 : 1);
})();
