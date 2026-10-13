// 킁킁! 실사 v3 시험 E2E (Playwright, 390×844, CDP 실제 터치) — 로컬 HTTP로 열어 아티팩트와 같은 조건(같은 출처)
// 가설: 잔디 구도에서 강아지가 칸마다 고개를 숙여 쿠키 자리를 "앙" 물면, 일러스트판처럼 그 자리만 찍는 손맛이 산다.
//       무는 점(클립에서 잰 값)이 칸 중심에 정확히 오고, 무는 순간 히트스톱·쿠키 숨김·잇자국이 나오며,
//       판정 규칙(빨간 것만 아픔, 연타는 잡히면 나머지 취소)과 끊김 없는 영상 전환이 그대로 지켜진다.
// 실행: node kungkung/tools/e2e-real.js   (스크린샷: $OUT 또는 /tmp/kungkung-real-e2e)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const ROOT = path.resolve(__dirname, '..');
const PAGE = process.env.PAGE || 'real.html';
const OUT = process.env.OUT || path.join(os.tmpdir(), 'kungkung-real-e2e');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
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
/** 스크린샷 PNG의 (x,y) 둘레 패치 평균색 (Playwright가 주는 PNG를 브라우저에서 해석) */
async function patch(page, buf, x, y, r = 12) {
  return page.evaluate(async ([b64, x, y, r]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(x - r, y - r, r * 2, r * 2).data; let R = 0, G = 0, B = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    return [R / n, G / n, B / n].map(Math.round);
  }, [buf.toString('base64'), x, y, r]);
}
const isGrass = c => c[1] > c[0] * 1.15 && c[1] > c[2] * 1.15;

(async () => {
  const srv = await serve(), BASE = `http://127.0.0.1:${srv.address().port}/${PAGE}`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const errs = []; let F2 = 0;
  const V = { cuts: [], late: 0, tellCuts: 0, minCover: 1, seekLive: 0, resync: 0, seeks: [] };   // 끊김 지표 (모든 판 합산)
  async function open(q) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning' && /^F2/.test(m.text())) console.log('  경고:', m.text()); });
    await page.goto(BASE + q);
    const cdp = await ctx.newCDPSession(page);
    const T = { ctx, page, fx: 195, fy: 768,
      touch: (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] }),
      snap: () => page.evaluate(() => window.kung.snapshot()),
      waitFor: (src, to = 15000) => page.evaluate(([src, to]) => new Promise(res => { const f = new Function('q', 'return ' + src); const t0 = performance.now(); (function loop() { const q = window.kung.snapshot(); if (f(q)) return res(q); if (performance.now() - t0 > to) return res(null); requestAnimationFrame(loop); })(); }), [src, to]) };
    T.tap = async (x, y) => { await T.touch('touchStart', x, y); await T.touch('touchEnd'); };
    T.moveTo = async x => { for (let i = 1; i <= 3; i++) await T.touch('touchMove', T.fx + (x - T.fx) * i / 3, T.fy); T.fx = x; };
    T.start = async () => {
      const q0 = await T.waitFor('q.readyAll === q.files', 40000); T.fy = q0 ? q0.cookie.sy : 768; T.lanes = q0 ? q0.slanesX : [90, 195, 300];
      await T.tap(195, T.fy); await T.waitFor('q.state === "play"', 3000); await T.touch('touchStart', 195, T.fy); T.fx = 195;
    };
    T.close = async () => {
      const q = await T.snap(), vl = await page.evaluate(() => window.kung.vlog());
      F2 += q.warnF2; V.late += q.vstat.late; V.tellCuts += q.vstat.tellCuts; V.minCover = Math.min(V.minCover, q.vstat.minCover); V.seekLive += q.vstat.seekLive; V.resync += q.vstat.resync;
      vl.filter(e => e.k === 'cut').forEach(e => V.cuts.push(e));
      vl.filter(e => e.k === 'seek' || e.k === 'resync').forEach(e => V.seeks.push(Object.assign({ page: page.url().split('?')[1] }, e)));
      await ctx.close();
    };
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

  /* ---------- 1. 소재 + 칸별: 무는 점이 칸 중심(쿠키)에 정확히, 물리면 쿠키가 입 속으로 → 잇자국 달고 다시 ---------- */
  const WANT = [{ key: 'r2', mir: 1 }, { key: 'c', mir: 0 }, { key: 'r2', mir: 0 }];
  for (let li = 0; li < 3; li++) {
    const T = await open('?seed=' + (li + 3) + '&pat=kung');
    if (li === 0) { const q0 = await T.waitFor('q.readyAll === q.files', 40000); ok('소재 로드: 앙 클립·거꾸로·대기 고리 5개(WebM)', !!q0 && q0.files === 5, q0 && q0.readyAll + '/' + q0.files + ' ' + q0.src + ' lanes ' + q0.slanesX); }
    await T.start(); await T.moveTo(T.lanes[li]);
    const q = await T.waitFor('q.atk && q.atk.step === "stamp"', 12000), a = q && q.atk;
    await T.page.screenshot({ path: `${OUT}/bite-${li}.png` });
    const w = WANT[li], dx = q && q.bite ? Math.abs(q.bite.sx - a.stx) : 99, dy = q && q.bite ? Math.abs(q.bite.sy - q.cookie.sy) : 99;
    ok(`칸 ${li}: 클립 ${w.key}${w.mir ? ' 반전' : ''}, 무는 점이 칸 중심 ±12px·쿠키 높이 ±14px, 확대는 펀치뿐(≤1.06)`, a && a.lane === li && a.key === w.key && a.mir === w.mir && dx <= 12 && dy <= 14 && q.zoom <= 1.06,
      a && JSON.stringify({ lane: a.lane, key: a.key, mir: a.mir, lane_x: a.stx, bite: q.bite, cookieY: q.cookie.sy, zoom: q.zoom, shift: q.shift, budget: q.budget }));
    ok(`칸 ${li}: 물린 순간 쿠키가 입 속으로 사라짐`, q && q.hearts === 2 && q.cookie.hidden === 1, q && JSON.stringify(q.cookie));
    const q2 = await T.waitFor('!q.atk && q.cookie.popT >= 1', 6000);
    if (li === 1) await T.page.screenshot({ path: `${OUT}/bitten-cookie.png` });
    ok(`칸 ${li}: 고개를 들면 잇자국 1개 달고 퐁 다시 나옴`, q2 && q2.cookie.hidden === 0 && q2.cookie.bites === 1, q2 && JSON.stringify(q2.cookie));
    await T.close();
  }
  /* ---------- 2. 픽셀: 잰 무는 점이 실제 영상에서 강아지 입(잔디 아님)인지 — 그림 숨기고 히트스톱 늘림 ---------- */
  for (let li = 0; li < 3; li++) {
    const T = await open('?seed=9&pat=kung&hs=500&nocv=1'); await T.start(); await T.moveTo(T.lanes[li]);
    const q = await T.waitFor('q.atk && q.atk.step === "stamp" && q.freeze === 1', 12000);
    const buf = await T.page.screenshot({ path: `${OUT}/pix-${li}.png` });
    const at = q ? await patch(T.page, buf, q.bite.sx, q.bite.sy - 6) : [0, 0, 0];
    const far = li === 1 || !q ? null : await patch(T.page, buf, T.lanes[2 - li], q.cookie.sy);
    ok(`픽셀 칸 ${li}: 무는 점은 강아지(잔디 색 아님)` + (far ? ', 반대쪽 칸은 잔디' : ''), q && !isGrass(at) && (!far || isGrass(far)), JSON.stringify({ at, far }));
    await T.close();
  }
  /* ---------- 3. 히트스톱: 게임 시계·영상은 멈추고 쿠키 끌기는 됨 ---------- */
  {
    const T = await open('?seed=12&pat=kung&hs=400'); await T.start(); await T.moveTo(T.lanes[1]);
    const q = await T.waitFor('q.atk && q.atk.step === "stamp" && q.freeze === 1', 12000);
    await T.moveTo(T.lanes[1] + 60); await T.page.waitForTimeout(120);
    const q2 = await T.snap();
    ok('히트스톱: 무는 순간 게임 시계·영상 정지, 그동안에도 쿠키는 끌림', q && q2.freeze === 1 && q2.t === q.t && Math.abs(q2.clipT - q.clipT) < 0.05 && q2.cookie.x > q.cookie.x + 30,
      q && JSON.stringify({ t: [q.t, q2.t], clipT: [q.clipT, q2.clipT], cx: [q.cookie.x, q2.cookie.x] }));
    await T.close();
  }
  /* ---------- 4. 패턴별: 가만히 → 정확히 한 번 / 빨간 구간 밖으로 → 다 피함 ---------- */
  for (const pat of ['kung', 'big', 'hold', 'feint', 'double', 'triple']) {
    let T = await open('?seed=21&pat=' + pat); await T.start();
    let q = await T.waitFor('q.kinds.length >= 2', 25000);
    ok(`${pat}: 가만히 → 한 번만 물림`, q && q.hearts === 2 && q.dodges === 0, q && JSON.stringify({ h: q.hearts, d: q.dodges, hs: q.hsN }));
    await T.close();
    T = await open('?seed=22&pat=' + pat); await T.start();
    q = await autoDodge(T, q => q.kinds.length >= 4, 60000);
    const per = { double: 2, triple: 3 }[pat] || 1, clips = await T.page.evaluate(() => window.__clips);
    ok(`${pat}: 빨간 구간 밖으로 피하면 다 피함 (공격 3번 = 판정 ${3 * per}번)`, q.hearts === 3 && q.dodges >= 3 * per, JSON.stringify({ h: q.hearts, d: q.dodges, hit: q.hitKinds, lanes: q.lanes.slice(0, 6) }) + ' clips ' + clips.slice(0, 10).join('>'));
    if (/double|triple/.test(pat)) ok(`${pat}: 연타 사이 거꾸로 재생본으로 빠르게 고개 듦`, clips.some(c => /_rev/.test(c)), clips.slice(0, 10).join('>'));
    if (pat === 'kung') { const vs = (await T.snap()).vstat; ok('끊김: 앙 한 번에 전환은 3번 이하 (대기 → 앙 → 고개 듦 → 대기)', vs.cuts <= 1 + 3 * q.kinds.length, JSON.stringify({ cuts: vs.cuts, attacks: q.kinds.length })); }
    await T.close();
  }
  /* ---------- 5. 가짜: 흰 원·판정 없음·톡 무시 → 거꾸로 + 메롱 → 진짜(빨강) ---------- */
  {
    const T = await open('?seed=31&pat=feint'); await T.start();
    let q = await T.waitFor('q.atk && q.atk.phase === "fake" && q.atk.t > 0.06', 10000);
    ok('가짜 돌진: 흰 원, 판정 구간 없음', q && q.atk.color === 'white' && q.atk.hits.length === 0, q && JSON.stringify({ c: q.atk.color, hits: q.atk.hits, clip: q.clip }));
    if (q) { await T.touch('touchEnd'); await T.tap(q.nose.sx, q.nose.sy); await T.touch('touchStart', T.fx, T.fy); }
    ok('가짜 돌진 중 톡은 무시', (await T.snap()).boops === 0);
    q = await T.waitFor('q.atk && q.atk.step === "tilt"', 4000);
    await T.page.waitForTimeout(400);
    const clips = await T.page.evaluate(() => window.__clips);
    ok('가짜 뒤: 반쯤에서 거꾸로(_rev) 고개 듦 → 대기 고리(메롱)', !!q && clips.some(c => /_rev/.test(c)) && /idle/.test(clips[clips.length - 1]), clips.join('>'));
    q = await T.waitFor('q.atk && q.atk.step === "lunge" && q.atk.phase === "lunge"', 4000);
    ok('그다음 진짜 앙은 빨강', q && q.atk.color === 'red' && q.atk.hits.length === 1);
    await T.close();
  }
  /* ---------- 6. 멈칫: 입 벌린 채 쿠키 바로 위에서 영상 정지, 빨간 원이 슬금 ---------- */
  {
    const T = await open('?seed=41&pat=hold'); await T.start();
    let q = await T.waitFor('q.atk && q.atk.step === "hold" && q.atk.t > 0.25', 10000);
    const x0 = q.atk.tx, c0 = q.clipT, t0 = q.t;
    await T.moveTo(q.cookie.x > 195 ? q.cookie.x - 120 : q.cookie.x + 120);
    await T.page.screenshot({ path: OUT + '/hold.png' });
    const qm = await T.snap();
    q = await T.waitFor('q.atk && q.atk.step !== "hold"', 3000);
    ok('멈칫: 0.5~0.9초 영상 정지, 빨간 원이 쿠키 쪽으로 슬금(칸 ±36px 안)', q && Math.abs(q.atk.tx - x0) > 3 && Math.abs(q.atk.tx - x0) <= 37 && q.t - t0 < 1.0 && Math.abs(qm.clipT - c0) < 0.03,
      JSON.stringify({ moved: q && Math.abs(q.atk.tx - x0), clipT: [c0, qm.clipT], held: q && +(q.t - t0).toFixed(2) }));
    await T.close();
  }
  /* ---------- 7. 코 톡 vs 쿠키 끌기 ---------- */
  for (const [pat, pts] of [['kung', 30], ['big', 50]]) {
    const T = await open('?seed=51&pat=' + pat); await T.start(); await T.touch('touchEnd');
    const q = await T.waitFor('q.atk && q.atk.step === "lunge" && q.atk.phase === "lunge" && q.atk.t > q.atk.dur * 0.6', 10000);
    const sb = q ? q.score : 0;
    if (q) await T.tap(q.nose.sx, q.nose.sy);
    const qa = await T.waitFor('q.boops === 1', 800);
    await T.page.waitForTimeout(250); await T.page.screenshot({ path: OUT + `/boop-${pat}.png` });
    const clips = await T.page.evaluate(() => window.__clips);
    ok(`${pat}: 앙 후반 코 톡 → 에취 +${pts}, 그 자리에서 고개 듦`, qa && qa.score === sb + pts && /_rev/.test(clips[clips.length - 1]), qa && JSON.stringify({ score: sb + '→' + qa.score, clip: clips.slice(-2), nose: [q.nose.sx, q.nose.sy] }));
    await T.close();
  }
  {
    const T = await open('?seed=52&pat=kung'); await T.start(); await T.touch('touchEnd');
    const q = await T.waitFor('q.atk && q.atk.step === "lunge" && q.atk.t > q.atk.dur * 0.6', 10000);
    if (q) await T.tap(q.cookie.sx, q.cookie.sy);
    const q2 = await T.snap();
    ok('톡 시간 창 안이라도 쿠키를 누르면 끌기 (톡 아님)', q && q2.boops === 0, q && JSON.stringify({ cookie: [q.cookie.sx, q.cookie.sy], nose: [q.nose.sx, q.nose.sy] }));
    await T.close();
  }
  /* ---------- 8. 버릇 시간표 + 자동 피하기로 52초 하트 3 ---------- */
  {
    const T = await open('?seed=61'); await T.start();
    const q = await autoDodge(T, q => q.t > 52, 140000);
    const firsts = {}; q.kinds.forEach(k => { if (firsts[k.kind] == null) firsts[k.kind] = k.t; });
    const at = { big: 10, feint: 16, hold: 22, double: 32, triple: 42 };
    ok('버릇 시간표: 각 패턴이 정해진 시각 뒤에 처음 나옴', Object.keys(at).every(k => firsts[k] != null && firsts[k] >= at[k]), JSON.stringify(firsts));
    ok('자동 피하기로 52초 하트 3 (공정)', q.hearts === 3, JSON.stringify({ t: q.t, h: q.hearts, d: q.dodges, hit: q.hitKinds, lanes: q.lanes.slice(0, 12) }));
    await T.close();
  }
  /* ---------- 9. 결과 카드: 앙 물린 순간 한 컷 ---------- */
  {
    const T = await open('?seed=71&pat=kung'); await T.start(); await T.touch('touchEnd');
    const q = await T.waitFor('q.over', 40000);
    await T.page.waitForTimeout(400); await T.page.screenshot({ path: OUT + '/over.png' });
    const img = await T.page.evaluate(() => { const i = document.querySelector('#card img.shot'); return i ? i.src.length : 0; });
    ok('하트 0 → 결과 카드 · 앙 물린 순간 한 컷(영상 합성) · 잇자국 2개까지 본 뒤 끝', q && q.over && img > 5000 && q.cookie.hidden === 1, 'shot bytes=' + img);
    await T.close();
  }
  /* ---------- 10. 소리: manifest가 비면 합성음, 있으면 샘플을 받고, 깨진 파일은 그 소리만 합성음 (오류 없이) ---------- */
  {
    let T = await open('?seed=81'); await T.start();
    let q = await T.snap();
    ok('소리: manifest가 비어 있으면 샘플 0개(전부 합성음), 오류 없음', q.sfx.want === 0 && q.sfx.failed === 0, JSON.stringify(q.sfx));
    await T.close();
    const bp = process.env.BEEP || path.join(OUT, 'beep.mp3');
    if (!fs.existsSync(bp)) require('child_process').execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=600:duration=0.3', '-ac', '1', '-b:a', '64k', bp]);
    const beep = fs.readFileSync(bp);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(), e2 = [];
    page.on('pageerror', e => e2.push(String(e))); page.on('console', m => { if (m.type() === 'error') e2.push(m.text()); });
    await page.route('**/real/sfx/manifest.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: { sniff: 'sniff.mp3', chomp: 'chomp.mp3' } }) }));
    await page.route('**/real/sfx/sniff.mp3', r => r.fulfill({ status: 200, contentType: 'audio/mpeg', body: beep }));
    await page.route('**/real/sfx/chomp.mp3', r => r.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from('not an mp3 at all') }));
    await page.goto(BASE + '?seed=82');
    await page.waitForFunction(() => { const q = window.kung.snapshot(); return q.sfx.loaded + q.sfx.failed >= 2; }, null, { timeout: 15000 }).catch(() => {});
    q = await page.evaluate(() => window.kung.snapshot());
    ok('소리: 샘플 파일은 받아 쓰고, 깨진 파일은 그 소리만 합성음 (콘솔 오류 0)', q.sfx.want === 2 && q.sfx.loaded === 1 && q.sfx.failed === 1 && e2.length === 0, JSON.stringify(q.sfx) + ' ' + e2.slice(0, 2).join(' | '));
    await ctx.close();
  }
  {
    const bad = V.cuts.filter(e => Math.abs(e.mt - e.from) > 0.07);
    ok('끊김: 전환마다 새 층의 첫 프레임이 목표 시각 ±0.07초 (옛 프레임이 안 비침)', V.cuts.length > 20 && bad.length === 0, `cuts=${V.cuts.length} bad=${JSON.stringify(bad.slice(0, 3))}`);
    ok('끊김: 준비가 늦어 그냥 보여준 전환 0', V.late === 0, 'late=' + V.late);
    ok('끊김: 예고(킁킁) 중 클립 전환 0', V.tellCuts === 0, 'tellCuts=' + V.tellCuts);
    ok('끊김: 페이드 중에도 화면이 늘 덮임 (배경이 안 비침)', V.minCover >= 0.99, 'minCover=' + V.minCover);
    ok('끊김: 보이는 영상을 그 자리에서 되감거나 다시 맞춘 횟수 0 (이어 재생만)', V.seekLive === 0 && V.resync === 0, `seekLive=${V.seekLive} resync=${V.resync} ` + JSON.stringify(V.seeks.slice(0, 4)));
  }
  ok('공정성: 안전 구간 부족 경고 0', F2 === 0, 'warnF2=' + F2);
  ok('콘솔 오류 0', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log('\n' + results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' PASS   스크린샷: ' + OUT);
  await browser.close(); srv.close();
  process.exit(results.every(r => r[0] === 'PASS') ? 0 : 1);
})();
