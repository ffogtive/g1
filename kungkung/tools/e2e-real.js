// 킁킁! 실사 3열×2줄 E2E (Playwright, 390×844, CDP 실제 터치) — 로컬 HTTP로 열어 아티팩트·앱과 같은 조건(같은 출처)
// 가설: 칸마다 클립에서 잰 무는 점에 맞춰 영상을 가로·세로로 밀면, 회색이·타조 모두 6칸 어디서든 "그 자리만 앙"이 되고,
//       상대 끌기 + 폴짝(줄 자석)으로 대각선 회피가 되며, 판정 규칙(같은 줄 + 빨간 타원 안만 아픔)과 끊김 없는 영상 전환이 지켜진다.
// 실행: node kungkung/tools/e2e-real.js   (PAGE=real3wip.html, SPS=grey,ostrich, BASE_URL=앱 서버, 스크린샷: $OUT)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e2) { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); } }
const ROOT = path.resolve(__dirname, '..');
const PAGE = process.env.PAGE || 'real.html';
const SPS = (process.env.SPS || 'grey,ostrich').split(',');
const OUT = process.env.OUT || path.join(os.tmpdir(), 'kungkung-real-e2e');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const results = [];
const ok = (name, cond, info) => { results.push([cond ? 'PASS' : 'FAIL', name]); console.log(cond ? 'PASS' : 'FAIL', name, info == null ? '' : info); };
const CELLS = ['F0', 'F1', 'F2', 'B0', 'B1', 'B2'];
const WANT = { F0: ['fr', 1], F1: ['fc', 0], F2: ['fr', 0], B0: ['bl', 0], B1: ['bc', 0], B2: ['bl', 1] };
const FILES = { grey: 15, ostrich: 14 };

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
/** 빨간 구간 밖에서 가장 가까운 안전한 (X, 줄): 줄을 바꾸는 값 0.35칸 (공정성 봇과 같은 생각) */
function safeXZ(q) {
  const hits = q.atk ? q.atk.hits : [], C = q.cookie;
  const bad = (row, X, pad) => hits.some(h => h[0] === row && X > h[1] - pad && X < h[2] + pad);
  if (!hits.length || !bad(C.jr, C.tX, 0.16)) return null;
  let best = null, bc = 1e9;
  for (let row = 0; row < q.rows; row++) for (let X = -1.36; X <= 1.3601; X += 0.04) {
    if (bad(row, X, 0.24)) continue;
    const c = Math.abs(X - C.tX) + (row !== C.row ? 0.35 : 0);
    if (c < bc) { bc = c; best = { X, row }; }
  }
  return best;
}
/** 스크린샷 PNG의 (x,y) 둘레 패치 평균색 */
async function patch(page, buf, x, y, r = 12) {
  return page.evaluate(async ([b64, x, y, r]) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(x - r, y - r, r * 2, r * 2).data; let R = 0, G = 0, B = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    return [R / n, G / n, B / n].map(Math.round);
  }, [buf.toString('base64'), x, y, r]);
}
const cdiff = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

(async () => {
  /* BASE_URL을 주면 그 서버(예: 앱의 Dart 로컬 서버, app/tool/serve.dart)로 돌린다 */
  const srv = process.env.BASE_URL ? null : await serve(), BASE = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/$/, '') + '/' + PAGE : `http://127.0.0.1:${srv.address().port}/${PAGE}`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const errs = []; let F2 = 0;
  const V = { cuts: [], late: 0, tellCuts: 0, minCover: 1, seekLive: 0, resync: 0, seeks: [] };   // 끊김 지표 (모든 판 합산)
  async function open(q) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning' && /^F2/.test(m.text())) console.log('  경고:', m.text()); });
    await page.goto(BASE + q);
    const cdp = await ctx.newCDPSession(page);
    const T = { ctx, page, fx: 195, fy: 760, down: false, fw: 105,
      touch: (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }] }),
      snap: () => page.evaluate(() => window.kung.snapshot()),
      waitFor: (src, to = 15000) => page.evaluate(([src, to]) => new Promise(res => { const f = new Function('q', 'return ' + src); const t0 = performance.now(); (function loop() { const q = window.kung.snapshot(); if (f(q)) return res(q); if (performance.now() - t0 > to) return res(null); requestAnimationFrame(loop); })(); }), [src, to]) };
    T.tap = async (x, y) => { await T.touch('touchStart', x, y); await T.touch('touchEnd'); };
    T.press = async (x = 195, y = 760) => { if (T.down) await T.touch('touchEnd'); await T.touch('touchStart', x, y); T.fx = x; T.fy = y; T.down = true; };
    T.lift = async () => { if (T.down) await T.touch('touchEnd'); T.down = false; };
    /** 손가락을 (dx, dy)만큼 n번에 나눠 끔 (상대 끌기). 화면 밖으로 나가면 떼고 아래 가운데에 다시 댐 (쿠키는 그대로) */
    T.drag = async (dx, dy, n = 4, gap = 0) => {
      if (!T.down) await T.press();
      if (T.fx + dx < 8 || T.fx + dx > 382 || T.fy + dy < 540 || T.fy + dy > 836) await T.press(Math.max(60, Math.min(330, 195 - dx / 2)), dy < 0 ? 800 : 640);
      for (let i = 1; i <= n; i++) { await T.touch('touchMove', T.fx + dx * i / n, T.fy + dy * i / n); if (gap) await page.waitForTimeout(gap); }
      T.fx += dx; T.fy += dy;
    };
    /** 쿠키를 땅 X·줄로: 가로 끌기 + 필요하면 폴짝 (동시에 = 대각선) */
    T.go = async (X, row) => {   // 엄지처럼: 줄을 바꿀 땐 위·아래로 톡 튕기고(빠른 쓸기) 곧바로 옆으로
      const q = await T.snap(), dx = (X - q.cookie.tX) * T.fw, dy = row == null || row === q.cookie.row ? 0 : row > q.cookie.row ? -60 : 60;
      if (dy) await T.drag(0, dy, 2);
      if (Math.abs(dx) > 0.5) await T.drag(dx, 0, 4);
    };
    T.toCell = async name => { const i = CELLS.indexOf(name); await T.go(i % 3 - 1, i >= 3 ? 1 : 0); return T.waitFor(`Math.abs(q.cookie.X - (${i % 3 - 1})) < 0.03 && q.cookie.rowT === ${i >= 3 ? 1 : 0}`, 2000); };
    T.start = async () => {
      const q0 = await T.waitFor('q.readyAll === q.files', 40000); T.q0 = q0; T.fw = q0 ? q0.fw : 105;
      await T.tap(195, q0 ? q0.cookie.sy : 760); await T.waitFor('q.state === "play"', 3000); await T.press(195, 760);
      return q0;
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
  /** 자동 피하기: 빨간 구간이 쿠키 줄에 걸리면 가장 가까운 안전한 (X, 줄)로 (대각선 허용) */
  async function autoDodge(T, until, maxMs) {
    const t0 = Date.now(); let q;
    while (Date.now() - t0 < maxMs) {
      q = await T.snap(); if (q.state !== 'play' || until(q)) break;
      const s = safeXZ(q); if (s) await T.go(s.X, s.row);
      await T.page.waitForTimeout(12);
    }
    return q;
  }

  for (const SP of SPS) {
    const P = `?sp=${SP}&`, tag = SP === 'grey' ? '회색이' : '타조';
    /* ---------- 1. 소재 + 칸별: 무는 점이 칸 중심(쿠키)에 정확히, 물리면 쿠키가 입 속으로 → 잇자국 달고 다시 ---------- */
    for (const cell of CELLS) {
      const T = await open(P + 'seed=' + (CELLS.indexOf(cell) + 3) + '&pat=kung');
      if (cell === 'F0') { const q0 = await T.waitFor('q.readyAll === q.files', 40000); ok(`${tag} 소재: 대기·앙 6칸·거꾸로·가짜·멈칫·특기·재채기·냠냠 ${FILES[SP]}개(WebM)`, !!q0 && q0.files === FILES[SP] && q0.readyAll === FILES[SP], q0 && q0.readyAll + '/' + q0.files + ' ' + q0.src + ' cells ' + q0.cells.map(c => c.name + '@' + c.sx + ',' + c.sy).join(' ')); }
      await T.start(); await T.toCell(cell);
      const q = await T.waitFor('q.atk && q.atk.step === "stamp"', 12000), a = q && q.atk;
      await T.page.screenshot({ path: `${OUT}/${SP}-bite-${cell}.png` });
      const w = WANT[cell], c = q && q.cells.find(x => x.name === cell);
      const dx = q && q.bite ? Math.abs(q.bite.sx - c.sx) : 99, dy = q && q.bite ? Math.abs(q.bite.sy - c.sy) : 99, cdx = q ? Math.abs(q.cookie.sx - c.sx) : 99;
      ok(`${tag} ${cell}: 클립 ${w[0]}${w[1] ? ' 반전' : ''}, 무는 점이 칸 중심 ±12px·높이 ±14px, 쿠키도 그 칸`, a && a.cell === cell && a.key === w[0] && a.mir === w[1] && dx <= 12 && dy <= 14 && cdx <= 6 && q.zoom <= 1.06,
        a && JSON.stringify({ cell: a.cell, key: a.key, mir: a.mir, cellXY: [c.sx, c.sy], bite: q.bite, cookie: [q.cookie.sx, q.cookie.sy], shift: [q.shift, q.shiftY], budget: q.budget, clip: q.clip }));
      ok(`${tag} ${cell}: 물린 순간 쿠키가 입 속으로`, q && q.hearts === 2 && q.cookie.hidden === 1, q && JSON.stringify({ h: q.hearts, c: q.cookie }));
      const q2 = await T.waitFor('!q.atk && q.cookie.popT >= 1', 7000);
      ok(`${tag} ${cell}: 고개를 들면 잇자국 1개 달고 같은 줄에 퐁`, q2 && q2.cookie.hidden === 0 && q2.cookie.bites === 1 && q2.cookie.row === (cell[0] === 'B' ? 1 : 0), q2 && JSON.stringify(q2.cookie));
      await T.close();
    }
    /* ---------- 2. 픽셀: 무는 순간 그 점에 머리가 와 있음 (대기 장면과 색이 크게 다름) ---------- */
    for (const cell of ['F0', 'B1', 'B2']) {
      const T = await open(P + 'seed=9&pat=kung&hs=500&nocv=1'); await T.start(); await T.toCell(cell);
      const q = await T.waitFor('q.atk && q.atk.step === "tell"', 8000), buf0 = await T.page.screenshot();
      const qs = await T.waitFor('q.atk && q.atk.step === "stamp" && q.freeze === 1', 12000);
      const buf = await T.page.screenshot({ path: `${OUT}/${SP}-pix-${cell}.png` });
      const a0 = qs ? await patch(T.page, buf0, qs.bite.sx, qs.bite.sy - 22) : [0, 0, 0], a1 = qs ? await patch(T.page, buf, qs.bite.sx, qs.bite.sy - 22) : [0, 0, 0];   // 무는 점 바로 위(머리·부리 밑동): 타조 부리 끝은 마른 풀과 색이 비슷
      ok(`${tag} 픽셀 ${cell}: 무는 점에 머리(대기 장면과 색 차 ≥ 40)`, q && qs && cdiff(a0, a1) >= 40, JSON.stringify({ idle: a0, bite: a1, d: cdiff(a0, a1) }));
      await T.close();
    }
    /* ---------- 3. 폴짝·오검출·대각선 (엄지 하나 점검표 4~6) ---------- */
    {
      const T = await open(P + 'seed=11&pat=kung'); await T.start();
      await T.drag(0, -30, 6, 16); await T.page.waitForTimeout(200);
      const q30 = await T.snap();
      await T.drag(0, -16, 3, 16); await T.page.waitForTimeout(200);
      const q46 = await T.snap();
      await T.drag(0, 46, 6, 16); await T.page.waitForTimeout(200);
      const qb = await T.snap();
      ok(`${tag} 폴짝: 위로 30px는 그대로, 44px 넘으면 뒷줄, 아래로 44px면 앞줄`, q30.cookie.row === 0 && q46.cookie.row === 1 && qb.cookie.row === 0 && qb.hops === 2, JSON.stringify([q30.cookie.row, q46.cookie.row, qb.cookie.row, qb.hops]));
      // 가로 120px를 쓸면서 세로로 30px 흔들림 → 줄이 안 바뀜 (두 번 왕복)
      const h0 = (await T.snap()).hops;
      for (let k = 0; k < 2; k++) for (const sx of [1, -1]) {
        for (let i = 1; i <= 12; i++) await T.touch('touchMove', T.fx + sx * 10 * i, T.fy - 30 * Math.sin(Math.PI * i / 12));
        T.fx += sx * 120; await T.page.waitForTimeout(30);
      }
      await T.page.waitForTimeout(150);
      const qw = await T.snap();
      ok(`${tag} 오검출: 가로 120px + 세로 흔들림 30px 쓸기 4번에 폴짝 0회`, qw.hops === h0 && qw.cookie.row === 0, JSON.stringify({ hops: [h0, qw.hops], row: qw.cookie.row }));
      // 대각선: 45° 쓸기(68×65px)를 약 60ms에 → 폴짝과 옆이 동시에, 0.16초 안에 끝
      await T.press(195, 760); const X0 = (await T.snap()).cookie.X;
      await T.page.evaluate(() => { window.__pm = []; document.getElementById('cv').addEventListener('pointermove', () => window.__pm.push(performance.now())); });
      for (let i = 1; i <= 4; i++) { await T.touch('touchMove', 195 + 17 * i, 760 - 16.25 * i); await T.page.waitForTimeout(15); }
      T.fx = 263; T.fy = 695;
      const qd = await T.waitFor(`q.cookie.rowT === 1 && Math.abs(q.cookie.X - q.cookie.tX) < 0.06`, 1500), pm = await T.page.evaluate(() => window.__pm);
      const after = qd ? (qd.now - pm[pm.length - 1]) / 1000 : 9;   // 마지막 손가락 움직임 → 줄도 옆도 도착
      ok(`${tag} 대각선: 45° 쓸기(68×65px)로 폴짝 + 옆 0.65칸이 함께, 쓸기가 끝나고 0.16초 안에 도착`, qd && qd.cookie.row === 1 && qd.cookie.X - X0 > 0.55 && after < 0.16, qd && JSON.stringify({ X: [X0, qd.cookie.X], swipeMs: Math.round(pm[pm.length - 1] - pm[0]), afterMs: Math.round(after * 1000) }));
      await T.close();
    }
    /* ---------- 4. 패턴별: 가만히 → 물림 / 빨간 구간 밖으로 → 다 피함 ---------- */
    for (const pat of ['kung', 'big', 'hold', 'feint', 'double', 'triple', 'special']) {
      let T = await open(P + 'seed=21&pat=' + pat); await T.start();
      if (pat === 'special') await T.toCell(SP === 'grey' ? 'F2' : 'B2');   // 특기는 바깥 칸: 그 칸에 가만히
      let q = await T.waitFor('q.kinds.length >= 2', 30000);
      ok(`${tag} ${pat}: 가만히 → 물림 (하트 −1, 피함 0)`, q && q.hearts === 2 && q.dodges === 0, q && JSON.stringify({ h: q.hearts, d: q.dodges, hit: q.hitKinds, lanes: q.lanes.slice(0, 4) }));
      if (pat === 'special') { const qq = await T.snap(); ok(`${tag} 특기: 물리지 않고 납작(쿠키는 그대로 보임)`, qq.cookie.hidden === 0 && qq.stomps >= 1, JSON.stringify({ c: qq.cookie, stomps: qq.stomps })); }
      await T.close();
      T = await open(P + 'seed=22&pat=' + pat); await T.start();
      q = await autoDodge(T, q => q.kinds.length >= 4, 70000);
      const per = { double: 2, triple: 3, special: SP === 'grey' ? 2 : 1 }[pat] || 1, clips = await T.page.evaluate(() => window.__clips);
      ok(`${tag} ${pat}: 빨간 구간 밖으로 피하면 다 피함 (공격 3번 = 판정 ${3 * per}번)`, q.hearts === 3 && q.dodges >= 3 * per, JSON.stringify({ h: q.hearts, d: q.dodges, hops: q.hops, hit: q.hitKinds, lanes: q.lanes.slice(0, 8) }) + ' clips ' + clips.slice(0, 8).join('>'));
      if (pat === 'kung') { const vs = (await T.snap()).vstat; ok(`${tag} 끊김: 앙 한 번에 전환은 3번 이하`, vs.cuts <= 1 + 3 * q.kinds.length, JSON.stringify({ cuts: vs.cuts, attacks: q.kinds.length })); }
      await T.close();
    }
    /* ---------- 5. 크게 킁 십자: 자기 줄 1.10칸 + 다른 줄 같은 열 0.59칸, 대각선 칸은 안전 ---------- */
    {
      const T = await open(P + 'seed=24&pat=big'); await T.start();
      const q = await T.waitFor('q.atk && q.atk.step === "lunge"', 10000), h = q && q.atk.hits;
      ok(`${tag} 크게 킁: 십자 (자기 줄 ±1.10, 다른 줄 같은 열 ±0.59)`, h && h.length === 2 && h[0][0] === 0 && Math.abs(h[0][2] - h[0][1] - 2.2) < 0.01 && h[1][0] === 1 && Math.abs(h[1][2] - h[1][1] - 1.18) < 0.01,
        h && JSON.stringify(h));
      await T.page.screenshot({ path: `${OUT}/${SP}-big-cross.png` });
      await T.close();
      const T2 = await open(P + 'seed=24&pat=big'); await T2.start();
      await T2.waitFor('q.atk && q.atk.step === "lunge"', 10000); await T2.go(1, 1);   // F1 → B2 대각선
      const q2 = await T2.waitFor('q.atk && q.atk.step === "stamp"', 4000);
      ok(`${tag} 크게 킁: 앙이 오는 중 대각선(F1 → B2)으로 피함`, q2 && q2.hearts === 3 && q2.dodges === 1, q2 && JSON.stringify({ h: q2.hearts, d: q2.dodges, c: q2.cookie }));
      await T2.close();
    }
    /* ---------- 6. 쓸어 물기: 연타를 같은 줄에서 옆으로만 피하면 직전 칸부터 띠 전체가 빨강 ---------- */
    {
      const T = await open(P + 'seed=25&pat=double'); await T.start();
      await T.waitFor('q.atk && q.atk.step === "lunge"', 10000); await T.go(1, 0);
      const q = await T.waitFor('q.atk && q.atk.rep === 2 && q.atk.step === "lunge"', 4000);
      ok(`${tag} 쓸어 물기: 같은 줄 연타는 직전 칸~새 칸 띠가 빨강`, q && q.atk.sweep === 1 && q.atk.hits[0][1] < -0.5 && q.atk.hits[0][2] > 1.5, q && JSON.stringify(q.atk.hits));
      await T.close();
    }
    /* ---------- 7. 가짜: 앞줄 전용 클립 → 진짜 / 뒷줄이면 그냥 킁 ---------- */
    {
      const T = await open(P + 'seed=31&pat=feint'); await T.start();
      let q = await T.waitFor('q.atk && q.atk.phase === "fake" && q.atk.t > 0.06', 10000);
      ok(`${tag} 가짜 돌진: 흰 원, 판정 구간 없음`, q && q.atk.color === 'white' && q.atk.hits.length === 0, q && JSON.stringify({ c: q.atk.color, hits: q.atk.hits, clip: q.clip }));
      q = await T.waitFor('q.atk && q.atk.step === "tell" && q.atk.i === 3', 5000);
      const clips = await T.page.evaluate(() => window.__clips), sp = SP === 'grey' ? 'v3' : 'ostrich';
      ok(`${tag} 가짜: 전용 클립으로 숙였다가 이어서 킁킁·갸웃·듦 → 대기`, !!q && clips.join('>') === `${sp}/idle>${sp}/feint>${sp}/idle`, clips.join('>'));
      q = await T.waitFor('q.atk && q.atk.step === "lunge" && q.atk.phase === "lunge"', 4000);
      ok(`${tag} 가짜 다음 진짜 앙은 빨강`, q && q.atk.color === 'red' && q.atk.hits.length === 1);
      await T.close();
      const T2 = await open(P + 'seed=31&pat=feint'); await T2.start(); await T2.toCell('B1');
      const q2 = await T2.waitFor('q.kinds.length >= 1', 6000);
      ok(`${tag} 가짜: 쿠키가 뒷줄이면 그 타는 킁`, q2 && q2.kinds[0].kind === 'kung', q2 && JSON.stringify(q2.kinds));
      await T2.close();
    }
    /* ---------- 8. 멈칫: 망설이는 동안 빨간 원이 슬금, 뒷줄로 폴짝하면 헛물 ---------- */
    {
      const T = await open(P + 'seed=41&pat=hold'); await T.start();
      let q = await T.waitFor('q.atk && q.atk.step === "hold" && q.atk.t > 0.3', 10000);
      const x0 = q && q.atk.lockSX, c0 = q && q.clipT, clip0 = q && q.clip;
      await T.go(q && q.cookie.X > 0 ? q.cookie.X - 1.1 : 1.1, 0);
      const qm = await T.snap();
      q = await T.waitFor('q.atk && q.atk.step !== "hold"', 3000);
      const q2 = await T.waitFor('q.atk && q.atk.step === "stamp"', 2000), sp = SP === 'grey' ? 'v3' : 'ostrich';
      ok(`${tag} 멈칫: 망설이는 클립이 재생되는 동안 빨간 원이 쿠키 쪽으로 슬금 → 진짜 앙 클립`, q && clip0 === sp + '/hover' && qm.clipT > c0 + 0.05 && Math.abs(q.atk.lockSX - x0) > 3 && Math.abs(q.atk.lockSX - x0) <= q.budget + 1 && q2 && q2.clip === sp + '/hsnap',
        JSON.stringify({ clip: [clip0, q2 && q2.clip], moved: q && Math.abs(q.atk.lockSX - x0), clipT: [c0, qm.clipT] }));
      await T.close();
      const T2 = await open(P + 'seed=41&pat=hold'); await T2.start();
      await T2.waitFor('q.atk && q.atk.step === "hold" && q.atk.t > 0.2', 10000); await T2.go(0, 1);
      const q3 = await T2.waitFor('q.atk && q.atk.step === "stamp"', 3000);
      ok(`${tag} 멈칫: 뒷줄로 폴짝하면 따라오지 않고 헛물`, q3 && q3.hearts === 3 && q3.dodges === 1 && q3.atk.lockRow === 0, q3 && JSON.stringify({ h: q3.hearts, d: q3.dodges, c: q3.cookie }));
      await T2.close();
    }
    /* ---------- 9. 특기 위치: 발이 닿는 점이 그 칸(같은 줄) ---------- */
    {
      const T = await open(P + 'seed=43&pat=special'); await T.start(); await T.toCell(SP === 'grey' ? 'F0' : 'B0');
      const q = await T.waitFor('q.atk && q.atk.step === "spec" && q.taps && q.taps.some(t => t.done) && q.freeze === 1', 12000);
      await T.page.screenshot({ path: `${OUT}/${SP}-special.png` });
      const tp = q && q.taps.find(t => t.done), c = q && q.cells.find(x => x.name === (SP === 'grey' ? 'F0' : 'B0'));
      ok(`${tag} 특기(${SP === 'grey' ? '앞발 콩콩, 앞줄' : '발 구르기, 뒷줄'}): 반전해 왼쪽 칸, 발 닿는 점이 칸 ±0.5칸·높이 ±24px`, tp && tp.row === (SP === 'grey' ? 0 : 1) && q.mir === 1 && Math.abs(tp.fx - c.sx) < 52 && Math.abs(tp.fy - c.sy) <= 24 && q.hearts === 2,
        q && JSON.stringify({ tap: tp, cell: [c.sx, c.sy], h: q.hearts, clip: q.clip }));
      await T.close();
    }
    /* ---------- 9b. 히트스톱: 게임 시계·영상은 멈추고 쿠키 끌기는 됨 / 톡 시간 창 안이라도 쿠키를 누르면 끌기 ---------- */
    {
      const T = await open(P + 'seed=12&pat=kung&hs=400'); await T.start();
      const q = await T.waitFor('q.atk && q.atk.step === "stamp" && q.freeze === 1', 12000);
      await T.drag(60, 0, 3); await T.page.waitForTimeout(120);
      const q2 = await T.snap();
      ok(`${tag} 히트스톱: 무는 순간 게임 시계·영상 정지, 그동안에도 쿠키는 끌림`, q && q2.freeze === 1 && q2.t === q.t && Math.abs(q2.clipT - q.clipT) < 0.05 && q2.cookie.x > q.cookie.x + 30,
        q && JSON.stringify({ t: [q.t, q2.t], clipT: [q.clipT, q2.clipT], cx: [q.cookie.x, q2.cookie.x] }));
      await T.close();
      const T2 = await open(P + 'seed=52&pat=kung'); await T2.start(); await T2.lift();
      const q3 = await T2.waitFor('q.atk && q.atk.step === "lunge" && q.atk.t > q.atk.dur * 0.6', 10000);
      if (q3) await T2.tap(q3.cookie.sx, q3.cookie.sy);
      const q4 = await T2.snap();
      ok(`${tag} 톡 시간 창 안이라도 쿠키를 누르면 끌기 (톡 아님)`, q3 && q4.boops === 0, q3 && JSON.stringify({ cookie: [q3.cookie.sx, q3.cookie.sy], nose: [q3.nose.sx, q3.nose.sy] }));
      await T2.close();
    }
    /* ---------- 10. 코 톡 (앞줄 +30, 크게 +50, 뒷줄 +45) → 그 자리에서 고개 듦 → 재채기 클립 ---------- */
    for (const [pat, cell, pts] of [['kung', 'F1', 30], ['big', 'F1', 50], ['kung', 'B1', 45]]) {
      const T = await open(P + 'seed=51&pat=' + pat); await T.start(); await T.toCell(cell); await T.lift();
      const q = await T.waitFor('q.atk && q.atk.step === "lunge" && q.atk.phase === "lunge" && q.atk.t > q.atk.dur * 0.6', 10000);
      const sb = q ? q.score : 0;
      if (q) await T.tap(q.nose.sx, q.nose.sy);
      const qa = await T.waitFor('q.boops === 1', 800);
      const qz = await T.waitFor('q.clip.indexOf("sneeze") >= 0', 2500);
      await T.page.screenshot({ path: `${OUT}/${SP}-boop-${pat}-${cell}.png` });
      const clips = await T.page.evaluate(() => window.__clips);
      ok(`${tag} ${pat} ${cell}: 앙 후반 코 톡 → +${pts}, 고개 듦 → 재채기 클립`, qa && qa.score === sb + pts && !!qz, qa && JSON.stringify({ score: sb + '→' + qa.score, clip: clips.slice(-3), nose: [q.nose.sx, q.nose.sy, q.nose.r] }));
      await T.close();
    }
    /* ---------- 11. 가림: 앞줄 앙이 뒷줄 쿠키 앞을 지나면 쿠키를 흰 외곽선 + 55% ---------- */
    {
      const T = await open(P + 'seed=52&pat=kung'); await T.start();
      await T.waitFor('q.atk && q.atk.step === "lunge" && q.atk.lockRow === 0', 10000); await T.go(0, 1);
      const q = await T.waitFor('q.atk && q.atk.step === "stamp"', 3000);
      ok(`${tag} 가림: 앞줄 앙 + 뒷줄 같은 열 쿠키 → 흰 외곽선(ghost)`, q && q.cookie.ghost === 1 && q.hearts === 3, q && JSON.stringify(q.cookie));
      await T.close();
    }
    /* ---------- 12. 버릇 시간표 + 자동 피하기로 55초 하트 3 (공정) ---------- */
    {
      const T = await open(P + 'seed=61'); await T.start();
      const q = await autoDodge(T, q => q.t > 55, 160000);
      const firsts = {}; q.kinds.forEach(k => { if (firsts[k.kind] == null) firsts[k.kind] = k.t; });
      const at = { big: 10, feint: 16, hold: 22, double: 32, triple: 42, special: 48 };
      ok(`${tag} 버릇 시간표: 각 패턴이 정해진 시각 뒤에 처음 나옴 (가짜·멈칫은 앞줄일 때만)`, Object.keys(at).every(k => firsts[k] == null || firsts[k] >= at[k]) && ['big', 'double', 'triple', 'special'].every(k => firsts[k] != null), JSON.stringify(firsts));
      ok(`${tag} 자동 피하기(대각선 포함)로 55초 하트 3`, q.hearts === 3, JSON.stringify({ t: q.t, h: q.hearts, d: q.dodges, hops: q.hops, hit: q.hitKinds, lanes: q.lanes.slice(0, 14) }));
      await T.close();
    }
    /* ---------- 13. 결과 카드: 물린 순간 한 컷 + 마지막엔 냠냠(꿀꺽) 클립 ---------- */
    {
      const T = await open(P + 'seed=71&pat=kung'); await T.start(); await T.lift();
      const q = await T.waitFor('q.over', 45000);
      await T.page.waitForTimeout(400); await T.page.screenshot({ path: `${OUT}/${SP}-over.png` });
      const img = await T.page.evaluate(() => { const i = document.querySelector('#card img.shot'); return i ? i.src.length : 0; }), clips = await T.page.evaluate(() => window.__clips);
      ok(`${tag} 하트 0 → 냠냠 클립 → 결과 카드 · 물린 순간 한 컷`, q && q.over && img > 5000 && clips.some(c => /chew|gulp/.test(c)), 'shot bytes=' + img + ' clips ' + clips.slice(-4).join('>'));
      await T.close();
    }
  }
  /* ---------- 14. 시작 화면에서 종 고르기 + 3칸 모드 ---------- */
  {
    const T = await open('?sp=grey&seed=81'); await T.waitFor('q.readyAll === q.files', 40000);
    await T.page.click('#pick [data-sp="ostrich"]');
    const q = await T.waitFor('q.sp === "ostrich" && q.readyAll === q.files && q.clip === "ostrich/idle"', 40000);
    await T.page.screenshot({ path: `${OUT}/pick-ostrich.png` });
    ok('시작 화면: 타조 버튼 → 타조 클립으로 바뀌고 모두 받음', q && q.files === FILES.ostrich, q && JSON.stringify({ sp: q.sp, files: q.files, clip: q.clip }));
    await T.start(); const hid = await T.page.evaluate(() => document.getElementById('pick').hidden && getComputedStyle(document.getElementById('pick')).display === 'none');
    ok('플레이 중에는 종 버튼 숨김', hid);
    await T.close();
    const T3 = await open('?sp=grey&cells=3&seed=82&pat=kung'); await T3.start();
    await T3.drag(0, -60, 6, 16); await T3.page.waitForTimeout(150);
    const q3 = await T3.snap();
    ok('3칸 모드(?cells=3): 앞줄 3칸·클립 10개, 위로 쓸어도 폴짝 없음', q3.cells.length === 3 && q3.files === 10 && q3.hops === 0 && q3.cookie.row === 0, JSON.stringify({ cells: q3.cells.length, files: q3.files, hops: q3.hops }));
    await T3.close();
  }
  /* ---------- 15. 소리: manifest 샘플을 모두 받음 ---------- */
  {
    const T = await open('?sp=ostrich&seed=83'); await T.start();
    await T.page.waitForFunction(() => { const q = window.kung.snapshot(); return q.sfx.loaded + q.sfx.failed >= q.sfx.want && q.sfx.want > 0; }, null, { timeout: 15000 }).catch(() => {});
    const q = await T.snap(), man = JSON.parse(fs.readFileSync(path.join(ROOT, 'real/sfx/manifest.json'), 'utf8')), n = Object.keys(man.files || {}).length;
    ok(`소리: manifest의 ElevenLabs 샘플 ${n}개(타조 콕·꿀꺽·쿵 포함)를 모두 받음`, q.sfx.want === n && q.sfx.loaded === n && q.sfx.failed === 0 && ['peck', 'gulp', 'stomp'].every(k => man.files[k]), JSON.stringify(q.sfx));
    await T.close();
  }
  {
    const bad = V.cuts.filter(e => Math.abs(e.mt - e.from) > 0.07);
    ok('끊김: 전환마다 새 층의 첫 프레임이 목표 시각 ±0.07초', V.cuts.length > 40 && bad.length === 0, `cuts=${V.cuts.length} bad=${JSON.stringify(bad.slice(0, 3))}`);
    ok('끊김: 준비가 늦어 그냥 보여준 전환 0', V.late === 0, 'late=' + V.late);
    ok('끊김: 예고(킁킁) 중 클립 전환 0', V.tellCuts === 0, 'tellCuts=' + V.tellCuts);
    ok('끊김: 페이드 중에도 화면이 늘 덮임', V.minCover >= 0.99, 'minCover=' + V.minCover);
    ok('끊김: 보이는 영상을 그 자리에서 되감거나 다시 맞춘 횟수 0', V.seekLive === 0 && V.resync === 0, `seekLive=${V.seekLive} resync=${V.resync} ` + JSON.stringify(V.seeks.slice(0, 4)));
  }
  ok('공정성: 안전 구간 부족 경고 0', F2 === 0, 'warnF2=' + F2);
  ok('콘솔 오류 0', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log('\n' + results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' PASS   스크린샷: ' + OUT);
  await browser.close(); if (srv) srv.close();
  process.exit(results.every(r => r[0] === 'PASS') ? 0 : 1);
})();
