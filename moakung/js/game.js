/*
 * 모아쿵! — 게임 진행 (상태, 입력, 낙하 연출, 판정, UI)
 *
 * 가설: 수치(rules.js)와 연출이 1:1로 묶여 있어야 플레이어가 선택의 결과를 믿는다.
 *  - 낙하 횟수는 "케이크 위에서 손을 뗀 순간"에만 줄어든다.
 *  - 잃는 재료 수는 충돌 순간 round(n/3)개로 확정되고, HUD 숫자는 그 재료가 실제로
 *    쟁반 테두리를 넘어가는 순간에 하나씩 줄어든다.
 */
(function () {
  'use strict';

  var R = window.MKRules, A = window.MKArt, S = window.MKAudio;
  var W = A.W, H = A.H, TAU = A.TAU, FLOOR = A.FLOOR, PERSP = A.PERSP;

  var BRUSH_R = 46;      // 수거 범위 (넉넉하게)
  var AIM_PAD = 28;      // 조준 판정 여유
  var SLOT = 5.9;        // 덩어리 안 재료 간격
  var GAP = 18;          // 바닥 재료끼리 최소 간격
  var TAP_MOVE = 10;     // 이보다 덜 움직이면 '톡' (덩어리 흩기)

  /* ---------------- DOM ---------------- */
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('game');
  var ctx = canvas.getContext('2d');
  var overlay = $('overlay');
  var bg = document.createElement('canvas');
  var decal = document.createElement('canvas');
  var view = { scale: 1, px: 1 };

  /* ---------------- 저장 ---------------- */
  var SAVE_KEY = 'moakung.v1';
  function loadSave() {
    var d = { unlocked: 1, best: {}, book: {}, sound: true, seenHelp: false };
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        for (var k in d) if (s[k] != null) d[k] = s[k];
      }
    } catch (e) { /* 저장소 없음 → 기본값 */ }
    return d;
  }
  function writeSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 무시 */ }
  }
  var save = loadSave();
  S.setEnabled(save.sound);

  /* ---------------- 유틸 ---------------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function dist2(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); n = n ^ (n >>> 15); return (n >>> 0) / 4294967296; }

  function insideFloor(x, y, pad) {
    var L = FLOOR.x + pad, T = FLOOR.y + pad, Rr = FLOOR.x + FLOOR.w - pad, B = FLOOR.y + FLOOR.h - pad;
    if (x < L || x > Rr || y < T || y > B) return false;
    var cr = Math.max(0, FLOOR.r - pad);
    var cx = x < L + cr ? L + cr : x > Rr - cr ? Rr - cr : x;
    var cy = y < T + cr ? T + cr : y > B - cr ? B - cr : y;
    return dist2(x, y, cx, cy) <= cr * cr;
  }
  function blockedByCake(c, x, y, pad) {
    var b = A.cakeBounds(c);
    var rx = c.r + 12 + pad * 0.4, ry = rx * PERSP + 6;
    var dx = (x - c.x) / rx, dy = (y - c.y) / ry;
    if (dx * dx + dy * dy < 1) return true;
    // 케이크 몸체에 가려 안 보이는 영역
    return x > c.x - c.r - 4 && x < c.x + c.r + 4 && y < c.y && y > b.top - 6;
  }
  function isFree(cakes, x, y, pad) {
    if (!insideFloor(x, y, pad)) return false;
    for (var i = 0; i < cakes.length; i++) if (cakes[i].alive && blockedByCake(cakes[i], x, y, pad)) return false;
    return true;
  }

  /* ---------------- 게임 생성 ---------------- */
  var G = null;
  var phase = 'title'; // title | intro | play | drop | result
  var T = 0;           // 전역 시간 (애니메이션)
  var hover = null;    // 마우스 호버 위치 (논리 좌표)

  function makeBites(seed) {
    var r = A.rngFrom(seed * 13 + 1);
    var out = [];
    [0.4, 0.58, 0.76].forEach(function (at, i) {
      var jag = [];
      for (var k = 0; k < 11; k++) jag.push(0.55 + r() * 0.6);
      out.push({ at: at, u: (i === 1 ? 0.45 : -0.35) + (r() - 0.5) * 0.4, size: 9 + r() * 7, jag: jag });
    });
    return out;
  }

  function layoutItems(st, cakes, rand) {
    var mats = [];
    R.MATERIAL_MIX.forEach(function (m) { for (var i = 0; i < m[1]; i++) mats.push(m[0]); });
    for (var i = mats.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = mats[i]; mats[i] = mats[j]; mats[j] = t;
    }
    var centers = [], tries = 0;
    while (centers.length < 9 && tries++ < 4000) {
      var cx = FLOOR.x + 36 + rand() * (FLOOR.w - 72), cy = FLOOR.y + 36 + rand() * (FLOOR.h - 72);
      if (!isFree(cakes, cx, cy, 26)) continue;
      var near = false;
      for (var k = 0; k < centers.length; k++) if (dist2(cx, cy, centers[k].x, centers[k].y) < 82 * 82) near = true;
      if (!near) centers.push({ x: cx, y: cy });
    }
    var items = [];
    for (var n = 0; n < mats.length; n++) {
      var placed = false;
      for (var tr = 0; tr < 400 && !placed; tr++) {
        var c = centers[(n + Math.floor(tr / 50)) % centers.length];
        var a = rand() * TAU, d = 6 + Math.sqrt(rand()) * (36 + tr * 0.06);
        var x = c.x + Math.cos(a) * d, y = c.y + Math.sin(a) * d * 0.85;
        if (!isFree(cakes, x, y, 12) || tooClose(items, x, y, GAP)) continue;
        items.push(makeItem(n, mats[n], x, y, rand));
        placed = true;
      }
      for (var fb = 0; fb < 5000 && !placed; fb++) {
        var fx = FLOOR.x + rand() * FLOOR.w, fy = FLOOR.y + rand() * FLOOR.h;
        if (!isFree(cakes, fx, fy, 12) || tooClose(items, fx, fy, GAP - 2)) continue;
        items.push(makeItem(n, mats[n], fx, fy, rand));
        placed = true;
      }
    }
    return items;
  }
  function tooClose(items, x, y, d) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if ((it.state === 'floor' || it.state === 'settle' || it.state === 'hop' || it.reserved) && dist2(x, y, it.tx != null ? it.tx : it.x, it.ty != null ? it.ty : it.y) < d * d) return true;
    }
    return false;
  }
  function makeItem(id, mat, x, y, rand) {
    return {
      id: id, mat: mat, v: Math.floor(rand() * A.VARIANTS[mat]), x: x, y: y, z: 0,
      rot: (rand() - 0.5) * 2.4, state: 'floor', glint: rand() * 3, t: 0
    };
  }

  function newGame(stageIdx) {
    var st = R.STAGES[stageIdx];
    var rand = R.rng(st.seed);
    var cakes = st.cakes.map(function (c, i) {
      return {
        idx: i, kind: c.kind, name: c.name, hp: c.hp, maxHp: c.hp, armor: c.armor, hardness: c.hardness,
        x: c.x, y: c.y, r: c.r, alive: true, cracks: [], bites: makeBites(st.seed + i), seed: st.seed + i * 17,
        hitT: 9, wob: 0, dentU: 0
      };
    });
    return {
      stageIdx: stageIdx, stage: st, cakes: cakes, items: layoutItems(st, cakes, rand),
      dropsLeft: st.drops, lost: 0, history: [], drag: null, drop: null, clumps: [], clumpSeq: 0,
      fx: [], texts: [], crumbs: [], shake: 0, gatheredOnce: false, droppedOnce: false,
      ignoreImpossible: false, rand: R.rng(st.seed * 31 + 7), dropNo: 0, ended: false
    };
  }

  function materials() {
    var n = 0;
    for (var i = 0; i < G.items.length; i++) {
      var s = G.items[i].state;
      if (s === 'floor' || s === 'attract' || s === 'held' || s === 'clump' || s === 'settle' || s === 'hop' || (s === 'fly' && !G.items[i].crossed)) n++;
    }
    return n;
  }
  function heldItems() { return G.drag ? G.drag.held : []; }

  /* ---------------- 입력 ---------------- */
  function toLogical(e) {
    var r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  canvas.addEventListener('pointerdown', function (e) {
    S.unlock();
    if (phase !== 'play' || G.drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
    var p = toLogical(e);
    var ci = clumpAt(p.x, p.y);
    if (ci >= 0) {
      // 놓아둔 덩어리를 잡기: 옮기는 동안은 더 줍지 않는다
      var cl = G.clumps.splice(ci, 1)[0];
      cl.items.forEach(function (it) { it.state = 'held'; });
      G.carryHintShown = true;
      G.drag = { id: e.pointerId, type: e.pointerType, mode: 'carry', x: p.x, y: p.y, lx: p.x, ly: p.y, cx: cl.x, cy: cl.y, ox: cl.x - p.x, oy: cl.y - p.y, held: cl.items, target: -1, moved: 0 };
      S.gather('click');
      return;
    }
    G.drag = { id: e.pointerId, type: e.pointerType, mode: 'sweep', x: p.x, y: p.y, lx: p.x, ly: p.y, cx: p.x, cy: p.y, ox: 0, oy: 0, held: [], target: -1, moved: 0 };
    sweep(p.x, p.y, p.x, p.y);
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = toLogical(e);
    if (e.pointerType === 'mouse') hover = p;
    if (G && G.drag && e.pointerId === G.drag.id) {
      G.drag.x = p.x;
      G.drag.y = p.y;
      G.drag.moved += Math.sqrt(dist2(G.drag.lx, G.drag.ly, p.x, p.y));
      if (G.drag.mode === 'sweep') sweep(G.drag.lx, G.drag.ly, p.x, p.y);
      G.drag.lx = p.x;
      G.drag.ly = p.y;
    }
  });
  canvas.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hover = null; });
  canvas.addEventListener('pointerup', function (e) {
    if (!G || !G.drag || e.pointerId !== G.drag.id) return;
    var p = toLogical(e);
    G.drag.x = p.x;
    G.drag.y = p.y;
    release();
  });
  function cancelDrag() { if (G && G.drag) restClump(); }
  canvas.addEventListener('pointercancel', function (e) { if (G && G.drag && e.pointerId === G.drag.id) cancelDrag(); });
  canvas.addEventListener('lostpointercapture', function (e) { if (G && G.drag && e.pointerId === G.drag.id) cancelDrag(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') cancelDrag(); });
  window.addEventListener('blur', cancelDrag);
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancelDrag(); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function targetAt(x, y) {
    var best = -1, bestD = 1e9;
    for (var i = 0; i < G.cakes.length; i++) {
      var c = G.cakes[i];
      if (!c.alive) continue;
      var b = A.cakeBounds(c);
      var rx = c.r + AIM_PAD, ry = c.r * PERSP + AIM_PAD;
      var dx = (x - c.x) / rx, dy = (y - c.y) / ry;
      var inside = dx * dx + dy * dy <= 1;
      if (!inside && x >= c.x - c.r - AIM_PAD * 0.6 && x <= c.x + c.r + AIM_PAD * 0.6 && y <= c.y && y >= b.top - AIM_PAD) inside = true;
      if (inside) {
        var d = dist2(x, y, c.x, c.y - (c.y - b.top) * 0.4);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  }

  /** 지나간 경로 위의 재료를 덩어리에 붙인다 (조준 중에는 수거 멈춤 → 미리보기 숫자가 흔들리지 않음) */
  function sweep(x0, y0, x1, y1) {
    var d = G.drag;
    var len = Math.sqrt(dist2(x0, y0, x1, y1));
    var steps = Math.max(1, Math.ceil(len / 7));
    var r2 = (BRUSH_R + 3) * (BRUSH_R + 3);
    for (var s = 0; s <= steps; s++) {
      var px = lerp(x0, x1, s / steps), py = lerp(y0, y1, s / steps);
      if (targetAt(px, py) >= 0) continue;
      for (var i = 0; i < G.items.length; i++) {
        var it = G.items[i];
        if (it.state !== 'floor') continue;
        if (dist2(px, py, it.x, it.y) <= r2) {
          it.state = 'attract';
          it.t = 0;
          it.fx = it.x;
          it.fy = it.y;
          d.held.push(it);
          S.gather(R.MATERIALS[it.mat].sound);
          G.gatheredOnce = true;
        }
      }
      // 놓아둔 덩어리를 쓸고 지나가면 통째로 합쳐진다
      for (var c = G.clumps.length - 1; c >= 0; c--) {
        var cl = G.clumps[c];
        var rr = BRUSH_R + clumpRadius(cl.items.length) * 0.5;
        if (dist2(px, py, cl.x, cl.y) <= rr * rr) {
          G.clumps.splice(c, 1);
          cl.items.forEach(function (it, k) {
            var sp = slotPos(k);
            it.state = 'attract';
            it.t = 0;
            it.fx = cl.x + sp.x;
            it.fy = cl.y + sp.y;
            d.held.push(it);
          });
          S.gather('metal');
          S.gather('jelly');
        }
      }
    }
  }
  function clumpAt(x, y) {
    for (var i = G.clumps.length - 1; i >= 0; i--) {
      var c = G.clumps[i];
      var r = clumpRadius(c.items.length) + 14;
      if (dist2(x, y, c.x, c.y) <= r * r) return i;
    }
    return -1;
  }

  function slotPos(i) {
    var r = SLOT * Math.sqrt(i + 0.5);
    var a = i * 2.39996;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.92, d: r };
  }
  function clumpRadius(n) { return SLOT * Math.sqrt(n + 0.5) + 8; }

  function release() {
    var d = G.drag;
    var tgt = targetAt(d.x, d.y);
    if (d.mode === 'carry' && d.moved < TAP_MOVE) scatterHeld();          // 덩어리를 톡 → 흩어서 다시 고르기
    else if (tgt >= 0 && d.held.length > 0) startDrop(tgt);              // 케이크 위 → 쿵 (낙하 1번)
    else restClump();                                                    // 그 밖 → 그 자리에 덩어리로 놓기
  }

  /** 케이크 밖에서 놓기/취소: 횟수 차감 없이 그 자리에 덩어리로 둔다 */
  function restClump() {
    var d = G.drag;
    G.drag = null;
    if (!d || !d.held.length) return;
    var n = d.held.length;
    var rad = clumpRadius(n);
    d.held.forEach(function (it) { it.state = 'clump'; });
    // 놓는 위치는 손가락(포인터) 기준. 그림은 지금 위치에서 미끄러져 간다.
    var spot = nearestFree(d.x + d.ox, d.y + d.oy, Math.min(26, rad * 0.7 + 4));
    // 다른 덩어리와 겹치면 합친다
    for (var i = 0; i < G.clumps.length; i++) {
      var o = G.clumps[i];
      var rr = clumpRadius(o.items.length) + rad * 0.6;
      if (dist2(spot.x, spot.y, o.x, o.y) < rr * rr) {
        o.items = o.items.concat(d.held);
        S.putDown(Math.min(n, 4));
        return;
      }
    }
    G.clumps.push({ id: ++G.clumpSeq, x: d.cx, y: d.cy, tx: spot.x, ty: spot.y, items: d.held });
    G.restedOnce = true;
    S.putDown(Math.min(n, 4));
    floatText(spot.x, spot.y - rad - 16, '내려놓기 · 횟수 그대로', '#6b7a8f', 13, 1.1);
  }

  /** 덩어리를 흩어 바닥에 펼친다 (다시 고르기) */
  function scatterHeld() {
    var d = G.drag;
    G.drag = null;
    if (!d || !d.held.length) return;
    var items = d.held;
    var c = nearestFree(d.x + d.ox, d.y + d.oy, 16);
    var n = items.length;
    var spread = 10 + 12.5 * Math.sqrt(n);
    var r = G.rand;
    items.forEach(function (it, i) {
      var p = slotPos(i);
      var sx = d.cx + p.x, sy = d.cy + p.y;
      var spot = null;
      for (var k = 0; k < 60 && !spot; k++) {
        var a = r() * TAU, dd = Math.sqrt(r()) * (spread + k * 1.5);
        var x = c.x + Math.cos(a) * dd, y = c.y + Math.sin(a) * dd * 0.8;
        if (isFree(G.cakes, x, y, 12) && !tooClose(G.items, x, y, GAP - 2)) spot = { x: x, y: y };
      }
      if (!spot) spot = randomFree(12);
      it.reserved = true;
      it.state = 'settle';
      it.t = 0;
      it.fx = sx;
      it.fy = sy;
      it.tx = spot.x;
      it.ty = spot.y;
      it.x = sx;
      it.y = sy;
    });
    S.putDown(n);
    floatText(c.x, c.y - 34, '흩어 놓기 · 다시 골라요', '#6b7a8f', 13, 1.1);
  }
  function nearestFree(x, y, pad) {
    if (isFree(G.cakes, x, y, pad)) return { x: x, y: y };
    for (var rr = 8; rr < 400; rr += 8) {
      for (var k = 0; k < 16; k++) {
        var a = (k / 16) * TAU;
        var px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (isFree(G.cakes, px, py, pad)) return { x: px, y: py };
      }
    }
    return { x: W / 2, y: FLOOR.y + FLOOR.h - 40 };
  }
  function randomFree(pad) {
    for (var i = 0; i < 3000; i++) {
      var x = FLOOR.x + G.rand() * FLOOR.w, y = FLOOR.y + G.rand() * FLOOR.h;
      if (isFree(G.cakes, x, y, pad) && !tooClose(G.items, x, y, GAP - 4)) return { x: x, y: y };
    }
    return nearestFree(W / 2, H / 2, pad);
  }

  /* ---------------- 낙하 ---------------- */
  function startDrop(ci) {
    var d = G.drag;
    G.drag = null;
    d.held.forEach(function (it) { it.state = 'held'; });
    var cake = G.cakes[ci];
    var pv = R.preview(d.held.length, cake, materials());
    G.dropsLeft -= 1; // 케이크 위에서 손을 뗀 순간에만 차감
    G.dropNo += 1;
    G.droppedOnce = true;
    bumpHud('hud-drops');
    var b = A.cakeBounds(cake);
    var surf = cake.y - A.cakeGeom(cake).h;
    var topY = Math.max(36, b.top - 70);
    G.drop = {
      ci: ci, items: d.held, n: d.held.length, pv: pv, stage: 'lift', t: 0,
      x0: d.cx, y0: d.cy, x: d.cx, y: d.cy, sc: 1, topY: topY, surf: surf, settleT: 0
    };
    phase = 'drop';
    S.lift();
  }

  function updateDrop(dt) {
    var D = G.drop, cake = G.cakes[D.ci];
    D.t += dt;
    if (D.stage === 'lift') {
      var k = easeInOut(clamp(D.t / 0.5, 0, 1));
      D.x = lerp(D.x0, cake.x, k);
      D.y = lerp(D.y0, D.topY, k);
      D.sc = 1 + 0.4 * k;
      if (D.t >= 0.5) { D.stage = 'hang'; D.t = 0; }
    } else if (D.stage === 'hang') {
      D.y = D.topY - Math.sin((D.t / 0.16) * Math.PI) * 4;
      if (D.t >= 0.16) { D.stage = 'fall'; D.t = 0; S.fall(); }
    } else if (D.stage === 'fall') {
      var f = clamp(D.t / 0.24, 0, 1);
      D.y = lerp(D.topY, D.surf, f * f);
      D.sc = 1.4 - 0.4 * f;
      if (f >= 1) impact();
    } else if (D.stage === 'scatter') {
      var busy = D.items.some(function (it) { return it.state === 'fly' || it.state === 'hop' || it.state === 'fall'; });
      if (!busy) D.settleT += dt;
      if (D.settleT > 0.35 && D.t > 0.9) finishDrop();
    }
  }

  function impact() {
    var D = G.drop, cake = G.cakes[D.ci], n = D.n;
    var before = cake.hp;
    var need = R.needFor(before, cake.armor);
    var dmg = R.damage(n, cake.armor);
    cake.hp = Math.max(0, cake.hp - dmg);
    var broke = cake.hp <= R.EPS;
    if (broke) cake.hp = 0;
    var lostN = R.lossOf(n);
    G.history.push({ ci: D.ci, name: cake.name, n: n, dmg: dmg, broke: broke, need: need, lost: lostN, kind: D.pv.kind, waste: broke ? Math.max(0, n - need) : 0 });

    // 연출: 금, 찌그러짐, 흔들림
    addCracks(cake, dmg / cake.maxHp, n);
    cake.hitT = 0;
    cake.wob = cake.hardness === 1 ? 0.22 : cake.hardness === 2 ? 0.08 : 0.03;
    cake.dentU = (G.rand() - 0.5) * 1.2;
    G.shake = Math.min(18, 5 + n * 0.26);
    S.impact(n, broke);
    vibrate(broke ? [40, 30, 70] : [25 + Math.min(40, n)]);
    var surfY = D.surf;
    dust(cake.x, surfY, 10 + n * 0.4);
    floatText(cake.x, surfY - 18, n >= 30 ? '쿵!!' : '쿵!', '#5b3a3e', 30 + Math.min(14, n * 0.3), 0.9, true);

    // 잃을 재료 확정: 잘 튀는 재질일수록 먼저 (개수는 항상 round(n/3))
    var order = D.items.slice().sort(function (a, b) {
      var sa = R.MATERIALS[a.mat].bounce + hash(a.id * 977 + G.dropNo * 131) * 0.7;
      var sb = R.MATERIALS[b.mat].bounce + hash(b.id * 977 + G.dropNo * 131) * 0.7;
      return sb - sa;
    });
    var lostSet = {};
    for (var i = 0; i < lostN; i++) lostSet[order[i].id] = true;

    if (broke) {
      cake.alive = false;
      S.crumble();
      debris(cake, 46);
      floatText(cake.x, surfY - 64, '와르르!', '#ff4f7b', 32, 1.4, true);
      collect(cake);
    } else {
      debris(cake, 6 + Math.round(dmg));
      var pct = Math.round((cake.hp / cake.maxHp) * 100);
      floatText(cake.x, surfY - 50, D.pv.kind === 'scratch' ? '흠집만…' : '쩌억! ' + pct + '% 남음', D.pv.kind === 'scratch' ? '#8e8e8e' : '#e67e22', 18, 1.3, true);
    }
    var reserved = [];
    D.items.forEach(function (it, idx) { launch(it, !!lostSet[it.id], cake, broke, idx, n, reserved); });
    if (lostN > 0) lostBanner(lostN, D.items.filter(function (it) { return lostSet[it.id]; }));
    D.stage = 'scatter';
    D.t = 0;
  }

  function launch(it, lost, cake, broke, idx, n, reserved) {
    var r = G.rand;
    var h = broke ? 12 : A.cakeGeom(cake).h;
    it.state = 'fly';
    it.lost = lost;
    it.crossed = false;
    it.gx0 = cake.x + (r() - 0.5) * cake.r * 0.5;
    it.gy0 = cake.y + (r() - 0.5) * cake.r * 0.2;
    it.z0 = h + 6;
    var tx, ty;
    if (lost) {
      var a = r() * TAU;
      var ex = exitPoint(it.gx0, it.gy0, a);
      var beyond = 46 + r() * 50;
      tx = ex.x + Math.cos(a) * beyond;
      ty = ex.y + Math.sin(a) * beyond;
      it.hz = 80 + r() * 60;
      it.dur = 0.7 + Math.sqrt(dist2(it.gx0, it.gy0, tx, ty)) / 650 + r() * 0.12;
    } else {
      var minR = broke ? 8 : cake.r + 18;
      var maxR = minR + 26 + 5.5 * Math.sqrt(n);
      var spot = null;
      for (var k = 0; k < 120 && !spot; k++) {
        var aa = r() * TAU, dd = minR + r() * (maxR - minR + k * 0.8);
        var x = cake.x + Math.cos(aa) * dd, y = cake.y + Math.sin(aa) * dd * 0.78;
        if (!isFree(G.cakes, x, y, 11)) continue;
        if (tooClose(G.items, x, y, GAP - 3)) continue;
        var clash = false;
        for (var q = 0; q < reserved.length; q++) if (dist2(x, y, reserved[q].x, reserved[q].y) < (GAP - 3) * (GAP - 3)) { clash = true; break; }
        if (!clash) spot = { x: x, y: y };
      }
      if (!spot) spot = randomFree(12);
      reserved.push(spot);
      tx = spot.x;
      ty = spot.y;
      it.hz = 26 + r() * 38;
      it.dur = 0.48 + Math.sqrt(dist2(it.gx0, it.gy0, tx, ty)) / 700 + r() * 0.12;
    }
    it.gx1 = tx;
    it.gy1 = ty;
    it.x = it.gx0;
    it.y = it.gy0;
    it.z = it.z0;
    it.t = -idx * 0.006;
    it.spin = (r() - 0.5) * 16;
  }
  function exitPoint(x, y, a) {
    var cx = Math.cos(a), cy = Math.sin(a);
    for (var s = 0; s < 800; s += 3) {
      if (!insideFloor(x + cx * s, y + cy * s, 0)) return { x: x + cx * s, y: y + cy * s };
    }
    return { x: x, y: y };
  }

  function updateItems(dt) {
    var r = G.rand;
    for (var i = 0; i < G.items.length; i++) {
      var it = G.items[i];
      switch (it.state) {
        case 'attract':
          it.t += dt / 0.13;
          if (it.t >= 1) it.state = 'held';
          break;
        case 'settle':
          it.t += dt / 0.3;
          var k = easeOut(clamp(it.t, 0, 1));
          it.x = lerp(it.fx, it.tx, k);
          it.y = lerp(it.fy, it.ty, k);
          it.z = Math.sin(k * Math.PI) * 10;
          if (it.t >= 1) { it.state = 'floor'; it.x = it.tx; it.y = it.ty; it.z = 0; it.tx = it.ty = null; it.reserved = false; }
          break;
        case 'fly':
          it.t += dt / it.dur;
          var t = clamp(it.t, 0, 1);
          it.x = lerp(it.gx0, it.gx1, t);
          it.y = lerp(it.gy0, it.gy1, t);
          it.z = it.z0 * (1 - t) + 4 * it.hz * t * (1 - t);
          it.rot += it.spin * dt;
          if (it.lost && !it.crossed && !insideFloor(it.x, it.y, -3)) {
            it.crossed = true; // 이 순간에만 "잃음" +1 (연출과 수치 일치)
            G.lost += 1;
            S.lost();
            bumpHud('hud-lost');
            floatText(it.x, it.y - it.z - 8, '-1', '#e2445c', 15, 0.8);
            sparkle(it.x, it.y - it.z, '#ffffff', 5);
          }
          if (it.t >= 1) {
            if (it.lost) { it.state = 'fall'; it.t = 0; }
            else {
              it.state = 'hop';
              it.t = 0;
              it.fx = it.x;
              it.fy = it.y;
              var a = r() * TAU;
              var hx = it.x + Math.cos(a) * 7, hy = it.y + Math.sin(a) * 5;
              if (!isFree(G.cakes, hx, hy, 11)) { hx = it.x; hy = it.y; }
              it.tx = hx;
              it.ty = hy;
              S.land(R.MATERIALS[it.mat].sound);
            }
          }
          break;
        case 'hop':
          it.t += dt / 0.18;
          var h = clamp(it.t, 0, 1);
          it.x = lerp(it.fx, it.tx, h);
          it.y = lerp(it.fy, it.ty, h);
          it.z = Math.sin(h * Math.PI) * 5;
          if (it.t >= 1) { it.state = 'floor'; it.z = 0; it.tx = it.ty = null; }
          break;
        case 'fall':
          it.t += dt / 0.5;
          if (it.t >= 1) it.state = 'gone';
          break;
      }
    }
  }

  function finishDrop() {
    G.drop = null;
    phase = 'play';
    checkEnd();
  }

  function checkEnd() {
    var alive = G.cakes.filter(function (c) { return c.alive; });
    if (!alive.length) return endStage(true, 'clear');
    var m = materials();
    if (G.dropsLeft <= 0) return endStage(false, 'drops');
    if (m <= 0) return endStage(false, 'materials');
    if (!G.ignoreImpossible && !R.canStillWin(m, alive, G.dropsLeft)) return endStage(false, 'impossible');
  }

  /* ---------------- 연출 보조 ---------------- */
  function addCracks(cake, frac, n) {
    var r = G.rand;
    var count = Math.max(1, Math.round(frac * 7));
    for (var i = 0; i < count; i++) {
      var u = (r() - 0.5) * 1.5, v = 0;
      var pts = [[u, v]];
      var len = 0.25 + frac * 0.9 + r() * 0.3;
      var steps = 5 + Math.floor(r() * 4);
      for (var s = 0; s < steps; s++) {
        u += (r() - 0.5) * 0.22;
        v += len / steps;
        pts.push([u, v]);
      }
      cake.cracks.push({ pts: pts, w: 1.2 + frac * 1.8 });
    }
    if (cake.cracks.length > 26) cake.cracks.splice(0, cake.cracks.length - 26);
  }
  function debris(cake, count) {
    var K = A.KINDS[cake.kind];
    var r = G.rand;
    var g = A.cakeGeom(cake);
    for (var i = 0; i < count; i++) {
      var a = r() * TAU;
      var sp = 60 + r() * 140;
      G.fx.push({
        type: 'chunk', x: cake.x + (r() - 0.5) * cake.r, y: cake.y + (r() - 0.5) * cake.r * 0.3, z: r() * (g.h + 10),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, vz: 120 + r() * 260, s: 2.5 + r() * 4.5,
        c: K.palette[Math.floor(r() * K.palette.length)], rot: r() * TAU, vr: (r() - 0.5) * 12, life: 3
      });
    }
  }
  function dust(x, y, n) {
    for (var i = 0; i < Math.min(26, n); i++) {
      var a = G.rand() * TAU;
      G.fx.push({ type: 'dust', x: x + Math.cos(a) * 10, y: y + Math.sin(a) * 4, vx: Math.cos(a) * (40 + G.rand() * 80), vy: Math.sin(a) * 25 - 10, s: 6 + G.rand() * 8, life: 0.7, t: 0 });
    }
  }
  function sparkle(x, y, c, n) {
    for (var i = 0; i < n; i++) {
      var a = G.rand() * TAU;
      G.fx.push({ type: 'spark', x: x, y: y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, s: 3 + G.rand() * 3, c: c, life: 0.45, t: 0 });
    }
  }
  function confetti() {
    var cols = ['#ff6f91', '#ffb627', '#57c4a4', '#7cc6ff', '#c3adff'];
    for (var i = 0; i < 90; i++) {
      G.fx.push({ type: 'confetti', x: G.rand() * W, y: -10 - G.rand() * 200, vx: (G.rand() - 0.5) * 60, vy: 120 + G.rand() * 120, s: 4 + G.rand() * 4, c: cols[i % 5], rot: G.rand() * TAU, vr: (G.rand() - 0.5) * 10, life: 4, t: 0 });
    }
  }
  function floatText(x, y, str, color, size, life, pop) {
    G.texts.push({ x: x, y: y, s: str, c: color, size: size, life: life || 1, t: 0, pop: !!pop });
  }
  function lostBanner(n, items) {
    // 대부분이 튀어나가는 방향의 테두리 근처에 표시
    var sx = 0, sy = 0;
    items.forEach(function (it) { sx += it.gx1; sy += it.gy1; });
    var x = clamp(sx / items.length, 90, W - 90), y = clamp(sy / items.length, 40, H - 40);
    floatText(x, y, '-' + n + ' 쟁반 밖으로!', '#e2445c', 19, 1.9, true);
  }
  function vibrate(p) {
    try { if (navigator.vibrate && G.lastPointerType !== 'mouse') navigator.vibrate(p); } catch (e) { /* 무시 */ }
  }

  function updateFx(dt) {
    for (var i = G.fx.length - 1; i >= 0; i--) {
      var f = G.fx[i];
      f.life -= dt;
      if (f.type === 'chunk') {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.z += f.vz * dt;
        f.vz -= 900 * dt;
        f.rot += f.vr * dt;
        if (f.z <= 0) {
          if (insideFloor(f.x, f.y, 4)) addCrumb(f.x, f.y, f.c, f.s * 0.8, f.rot);
          G.fx.splice(i, 1);
          continue;
        }
      } else if (f.type === 'confetti') {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rot += f.vr * dt;
      } else {
        f.t += dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
      }
      if (f.life <= 0) G.fx.splice(i, 1);
    }
    for (var j = G.texts.length - 1; j >= 0; j--) {
      var t = G.texts[j];
      t.t += dt;
      if (t.t >= t.life) G.texts.splice(j, 1);
    }
  }
  function addCrumb(x, y, c, s, rot) {
    G.crumbs.push({ x: x, y: y, c: c, s: s, rot: rot });
    if (G.crumbs.length > 260) G.crumbs.shift();
    drawCrumb(decal.getContext('2d'), G.crumbs[G.crumbs.length - 1]);
  }
  function drawCrumb(dc, cr) {
    dc.save();
    dc.setTransform(view.px, 0, 0, view.px, 0, 0);
    dc.translate(cr.x, cr.y);
    dc.rotate(cr.rot);
    dc.fillStyle = cr.c;
    dc.beginPath();
    dc.moveTo(-cr.s, -cr.s * 0.4);
    dc.lineTo(cr.s * 0.2, -cr.s * 0.7);
    dc.lineTo(cr.s, 0.1);
    dc.lineTo(-cr.s * 0.1, cr.s * 0.6);
    dc.closePath();
    dc.fill();
    dc.restore();
  }
  function redrawDecals() {
    decal.width = canvas.width;
    decal.height = canvas.height;
    if (G) G.crumbs.forEach(function (c) { drawCrumb(decal.getContext('2d'), c); });
  }

  /* ---------------- 도감 ---------------- */
  function collect(cake) {
    var e = save.book[cake.kind] || { n: 0 };
    var first = !e.n;
    e.n += 1;
    save.book[cake.kind] = e;
    writeSave();
    if (first) toast('도감에 새 디저트! ' + cake.name);
  }

  /* ---------------- 업데이트 & 그리기 ---------------- */
  function update(dt) {
    T += dt;
    if (!G) return;
    if (G.drag) {
      var d = G.drag;
      var tg = targetAt(d.x, d.y);
      if (tg !== d.target) {
        d.target = tg;
        if (tg >= 0 && d.held.length) S.ui();
      }
      // 조준 중이면 덩어리가 케이크 윗면에 착 붙어 "여기 떨어진다"를 보여 준다
      var tx = d.x + d.ox, ty = d.y + d.oy;
      if (d.target >= 0 && d.held.length) {
        var tc = G.cakes[d.target];
        tx = tc.x;
        ty = tc.y - A.cakeGeom(tc).h - clumpRadius(d.held.length) * 0.55;
      }
      var k = 1 - Math.exp(-dt * (d.target >= 0 ? 16 : 22));
      d.cx += (tx - d.cx) * k;
      d.cy += (ty - d.cy) * k;
    }
    G.clumps.forEach(function (c) {
      var kk = 1 - Math.exp(-dt * 14);
      c.x += (c.tx - c.x) * kk;
      c.y += (c.ty - c.y) * kk;
    });
    updateItems(dt);
    if (G.drop) updateDrop(dt);
    G.cakes.forEach(function (c) {
      c.hitT += dt;
      c.wob *= Math.exp(-dt * 2.2);
    });
    updateFx(dt);
    G.shake *= Math.exp(-dt * 9);
  }

  function heldScreenPos(i) {
    var p = slotPos(i);
    if (G.drop && G.drop.stage !== 'scatter') {
      return { x: G.drop.x + p.x * G.drop.sc, y: G.drop.y + p.y * G.drop.sc };
    }
    return { x: G.drag.cx + p.x, y: G.drag.cy + p.y };
  }

  function text(str, x, y, size, color, align, strokeW) {
    ctx.font = size + 'px ' + A.FONT;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    if (strokeW) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.strokeText(str, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!G) return;
    var sx = 0, sy = 0;
    if (G.shake > 0.4) { sx = (Math.random() - 0.5) * G.shake; sy = (Math.random() - 0.5) * G.shake; }
    ctx.drawImage(bg, sx * view.px, sy * view.px);
    ctx.drawImage(decal, sx * view.px, sy * view.px);
    ctx.setTransform(view.px, 0, 0, view.px, sx * view.px, sy * view.px);

    var aim = G.drag && G.drag.target >= 0 && G.drag.held.length ? G.drag.target : -1;
    var pv = aim >= 0 ? R.preview(G.drag.held.length, G.cakes[aim], materials()) : null;

    // 바닥 재료 + 케이크 (앞뒤 정렬)
    var list = [];
    G.cakes.forEach(function (c) { list.push({ y: c.y, c: c }); });
    G.items.forEach(function (it) { if (it.state === 'floor') list.push({ y: it.y, it: it }); });
    G.clumps.forEach(function (cl) { list.push({ y: cl.y + 4, cl: cl }); });
    list.sort(function (a, b) { return a.y - b.y; });
    list.forEach(function (o) {
      if (o.cl) {
        drawRestingClump(o.cl);
      } else if (o.c) {
        var hl = null;
        if (o.c.idx === aim) hl = pv.breaks ? '#2ecc71' : pv.kind === 'crack' ? '#ff9f43' : '#b0a6a6';
        else if (G.drop && G.drop.ci === o.c.idx && G.drop.stage !== 'scatter') hl = '#ffffff';
        A.drawCake(ctx, o.c, T, { highlight: hl });
      } else {
        var it = o.it;
        A.drawItemShadow(ctx, it.x, it.y, 1);
        A.drawItem(ctx, it.mat, it.v, it.x, it.y, 1, it.rot);
        if ((it.mat === 'pearl' || it.mat === 'star' || it.mat === 'steel') && ((T * 0.9 + it.glint) % 4) < 0.22) {
          A.drawGlint(ctx, it.x + 3, it.y - 4, 5, 0.9);
        }
      }
    });

    drawCakeBars(aim, pv);

    // 내려놓는 중/튕기는 중인 재료
    G.items.forEach(function (it) {
      if (it.state === 'settle' || it.state === 'hop') {
        A.drawItemShadow(ctx, it.x, it.y, 1);
        A.drawItem(ctx, it.mat, it.v, it.x, it.y - it.z, 1, it.rot);
      }
    });

    // 들고 있는 덩어리
    if (G.drag) drawDragClump(aim, pv);
    if (G.drop && G.drop.stage !== 'scatter') drawDropClump();

    // 날아가는 재료 (그림자는 바닥에)
    G.items.forEach(function (it) {
      if (it.state === 'fly') {
        if (insideFloor(it.x, it.y, 0)) A.drawItemShadow(ctx, it.x, it.y, 0.9, 0.8);
        A.drawItem(ctx, it.mat, it.v, it.x, it.y - it.z, 1 + it.z / 260, it.rot);
      } else if (it.state === 'fall') {
        var f = clamp(it.t, 0, 1);
        A.drawItem(ctx, it.mat, it.v, it.x, it.y + f * 26, 1 - f * 0.35, it.rot, 1 - f);
      }
    });

    drawFx();
    drawTexts();
    if (aim >= 0) drawAimCard(aim, pv);
    drawBanner(aim, pv);
    drawBrush(aim);
  }

  function drawDragClump(aim, pv) {
    var d = G.drag;
    var n = d.held.length;
    if (n) {
      var rad = clumpRadius(n);
      ctx.beginPath();
      ctx.ellipse(d.cx + 2, d.cy + rad * 0.75, rad * 0.95, rad * 0.38, 0, 0, TAU);
      ctx.fillStyle = 'rgba(107,63,42,0.22)';
      ctx.fill();
      drawClumpBody(d.cx, d.cy, d.held, 1, function (it, i) {
        if (it.state === 'attract') {
          var p = heldScreenPos(i);
          var k = easeOut(clamp(it.t, 0, 1));
          return { x: lerp(it.fx, p.x, k), y: lerp(it.fy, p.y, k) - Math.sin(k * Math.PI) * 12 };
        }
        return null;
      });
      // 개수 말풍선
      var col = aim >= 0 ? (pv.breaks ? '#1f9d55' : pv.kind === 'crack' ? '#e67e22' : '#8e8e8e') : '#ff5f87';
      var bx = d.cx + rad * 0.7 + 10, by = d.cy - rad * 0.7 - 12;
      ctx.beginPath();
      ctx.arc(bx, by, 15, 0, TAU);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      text(String(n), bx, by + 1, 16, '#fff');
    }
  }

  function drawRestingClump(cl) {
    var n = cl.items.length;
    var rad = clumpRadius(n);
    ctx.beginPath();
    ctx.ellipse(cl.x + 2, cl.y + rad * 0.72, rad * 0.95, rad * 0.36, 0, 0, TAU);
    ctx.fillStyle = 'rgba(107,63,42,0.24)';
    ctx.fill();
    drawClumpBody(cl.x, cl.y, cl.items, 1);
    var hov = !G.drag && hover && dist2(hover.x, hover.y, cl.x, cl.y) <= Math.pow(rad + 14, 2);
    if (hov) {
      ctx.beginPath();
      ctx.arc(cl.x, cl.y, rad + 6, 0, TAU);
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(255,95,135,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    var bx = cl.x + rad * 0.7 + 8, by = cl.y - rad * 0.7 - 8;
    ctx.beginPath();
    ctx.arc(bx, by, 13, 0, TAU);
    ctx.fillStyle = '#ff8fab';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    text(String(n), bx, by + 1, 14, '#fff');
  }

  /** 서로 다른 재질이 한 덩어리로 뭉친 모습 */
  function drawClumpBody(cx, cy, list, sc, override) {
    var n = list.length;
    var rad = clumpRadius(n) * sc;
    var g = ctx.createRadialGradient(cx - rad * 0.3, cy - rad * 0.35, 1, cx, cy, rad * 1.05);
    g.addColorStop(0, 'rgba(255,250,245,0.85)');
    g.addColorStop(0.7, 'rgba(255,225,230,0.55)');
    g.addColorStop(1, 'rgba(255,200,210,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, rad * 1.02, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    var arr = [];
    for (var i = 0; i < n; i++) {
      var it = list[i];
      var p = slotPos(i);
      var o = override ? override(it, i) : null;
      arr.push({ it: it, x: o ? o.x : cx + p.x * sc, y: o ? o.y : cy + p.y * sc, d: p.d, i: i });
    }
    arr.sort(function (a, b) { return b.d - a.d; }); // 바깥 → 안쪽 (가운데가 위로 볼록)
    arr.forEach(function (o) {
      var jig = Math.sin(T * 7 + o.i) * 0.08;
      A.drawItem(ctx, o.it.mat, o.it.v, o.x, o.y, 0.93 * sc, o.it.rot + jig);
    });
    // 둥근 덩어리 음영
    var sh = ctx.createRadialGradient(cx - rad * 0.35, cy - rad * 0.4, rad * 0.2, cx, cy, rad * 1.05);
    sh.addColorStop(0, 'rgba(255,255,255,0.18)');
    sh.addColorStop(0.65, 'rgba(255,255,255,0)');
    sh.addColorStop(1, 'rgba(90,40,40,0.22)');
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, TAU);
    ctx.fillStyle = sh;
    ctx.fill();
  }

  function drawDropClump() {
    var D = G.drop, cake = G.cakes[D.ci];
    // 케이크 윗면에 드리운 그림자 (높을수록 작고 옅게)
    var hgt = clamp((D.surf - D.y) / 200, 0, 1);
    var rad = clumpRadius(D.n);
    ctx.beginPath();
    ctx.ellipse(cake.x, D.surf + 2, rad * (1.1 - hgt * 0.5), rad * 0.4 * (1.1 - hgt * 0.5), 0, 0, TAU);
    ctx.fillStyle = 'rgba(60,30,20,' + (0.32 - hgt * 0.18) + ')';
    ctx.fill();
    if (D.stage === 'hang' || D.stage === 'fall') {
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(D.x, D.y + rad * D.sc);
      ctx.lineTo(cake.x, D.surf);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawClumpBody(D.x, D.y, D.items, D.sc);
  }

  function drawCakeBars(aim, pv) {
    G.cakes.forEach(function (c, i) {
      var y = c.y + (c.r + 11) * PERSP + 15;
      if (!c.alive) {
        ctx.beginPath();
        A.roundRect(ctx, c.x - 30, y - 9, 60, 18, 9);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fill();
        text('와르르 완료', c.x, y + 1, 12, '#1f9d55');
        return;
      }
      var w = 62, h = 8, x = c.x - w / 2;
      ctx.beginPath();
      A.roundRect(ctx, x - 2, y - 2, w + 4, h + 4, 6);
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fill();
      var ratio = c.hp / c.maxHp;
      var col = c.hardness === 1 ? '#6fd3a0' : c.hardness === 2 ? '#ffb347' : '#ff6f91';
      ctx.beginPath();
      A.roundRect(ctx, x, y, Math.max(2, w * ratio), h, 4);
      ctx.fillStyle = col;
      ctx.fill();
      if (i === aim && pv) {
        // 이번 낙하로 깎일 부분 (깜빡임)
        var a = 0.45 + 0.4 * Math.sin(T * 10);
        var from = w * pv.hpRatioAfter, to = w * ratio;
        ctx.beginPath();
        A.roundRect(ctx, x + from, y, Math.max(2, to - from), h, 3);
        ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(90,40,40,0.5)';
        ctx.stroke();
      }
      // 단단함 점
      for (var k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(c.x - 9 + k * 9, y + 16, 3.2, 0, TAU);
        ctx.fillStyle = k < c.hardness ? '#ff6f91' : 'rgba(255,255,255,0.9)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(200,120,140,0.6)';
        ctx.stroke();
      }
    });
  }

  function drawAimCard(ci, pv) {
    var c = G.cakes[ci];
    var b = A.cakeBounds(c);
    var main, color;
    if (pv.breaks) { main = '와르르! 한 번에 부서져요'; color = '#1f9d55'; }
    else if (pv.kind === 'crack') { main = '금이 가요 · 몸체 ' + Math.max(1, Math.round(pv.hpRatioAfter * 100)) + '% 남음'; color = '#e67e22'; }
    else { main = '흠집만 나요 · 너무 가벼워요'; color = '#8e8e8e'; }
    var line2 = '튀어나갈 재료 −' + pv.loss + '개  →  남는 재료 ' + pv.remainAfter + '개';
    var hint = null;
    if (pv.breaks && pv.waste >= 3) hint = pv.need + '개면 충분해요 · 지금 ' + pv.waste + '개 더 써요';
    else if (!pv.breaks) hint = pv.need <= materials() ? '한 번에 부수려면 ' + pv.need + '개' : '지금 재료로는 한 번에 못 부숴요';
    var cw = 262, chh = hint ? 92 : 70;
    var x = clamp(c.x - cw / 2, 6, W - cw - 6);
    var clumpTop = G.drag ? G.drag.cy - clumpRadius(G.drag.held.length) : b.top;
    var y = Math.min(b.top, clumpTop) - chh - 12;
    if (y < 4) y = Math.min(H - chh - 6, c.y + (c.r + 11) * PERSP + 40);
    ctx.save();
    ctx.shadowColor = 'rgba(120,60,60,0.28)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    A.roundRect(ctx, x, y, cw, chh, 14);
    ctx.fillStyle = 'rgba(255,253,250,0.97)';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    A.roundRect(ctx, x, y, 7, chh, 4);
    ctx.fillStyle = color;
    ctx.fill();
    var dots = '';
    for (var k = 0; k < 3; k++) dots += k < c.hardness ? '●' : '○';
    text(c.name + '  단단함 ' + dots, x + 18, y + 15, 12, '#8a6a6e', 'left');
    text(main, x + 18, y + 36, 17, color, 'left');
    text(line2, x + 18, y + 57, 12.5, '#5b3a3e', 'left');
    if (hint) {
      ctx.beginPath();
      A.roundRect(ctx, x + 14, y + 68, cw - 26, 18, 9);
      ctx.fillStyle = pv.breaks ? '#fff3c4' : '#ffe8d6';
      ctx.fill();
      text(hint, x + 22, y + 77.5, 12, pv.breaks ? '#8a6200' : '#a5501b', 'left');
    }
  }

  function drawBanner(aim, pv) {
    if (phase !== 'play' && phase !== 'drop') return;
    var msg = null;
    if (phase === 'drop') msg = null;
    else if (G.drag) {
      var n = G.drag.held.length;
      if (aim >= 0) msg = null; // 조준 카드가 대신 설명
      else if (!n) msg = '재료 위를 쓸어 담아요';
      else if (G.drag.mode === 'carry') msg = '덩어리 옮기는 중 · 더 줍지 않아요';
      else msg = '케이크 위에서 떼면 쿵! · 밖에서 떼면 그 자리에 둬요';
    } else if (!G.gatheredOnce) msg = '꾹 누른 채 문질러서 재료를 모아요';
    else if (G.clumps.length && !G.droppedOnce) msg = '덩어리를 잡아 케이크로 · 톡 치면 흩어져요';
    else if (!G.droppedOnce) msg = '모은 덩어리를 케이크 위로 옮겨 손을 떼요';
    else if (G.clumps.length && !G.carryHintShown) msg = '덩어리를 잡고 옮기면 더 줍지 않아요';
    if (!msg) return;
    ctx.font = '14px ' + A.FONT;
    var w = Math.min(W - 20, ctx.measureText(msg).width + 30);
    ctx.beginPath();
    A.roundRect(ctx, W / 2 - w / 2, 14, w, 30, 15);
    ctx.fillStyle = 'rgba(255,255,255,0.93)';
    ctx.fill();
    text(msg, W / 2, 30, 14, '#5b3a3e');
    // 처음 한 번: 손가락 안내
    if (!G.gatheredOnce && !G.drag && G.stageIdx === 0) {
      var c = tutorialCluster();
      if (c) {
        var k = (T % 2.2) / 2.2;
        var fx = c.x - 60 + k * 120, fy = c.y + Math.sin(k * Math.PI) * -10;
        ctx.globalAlpha = Math.sin(k * Math.PI);
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.moveTo(c.x - 60, c.y);
        ctx.lineTo(fx, fy);
        ctx.strokeStyle = '#ff6f91';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(fx, fy, 16, 0, TAU);
        ctx.fillStyle = 'rgba(255,111,145,0.35)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(fx, fy, 8, 0, TAU);
        ctx.fillStyle = '#ff6f91';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }
  var tutC = null;
  function tutorialCluster() {
    if (tutC && tutC.g === G) return tutC.p;
    var best = null, bestN = 0;
    G.items.forEach(function (it) {
      var n = 0;
      G.items.forEach(function (o) { if (dist2(it.x, it.y, o.x, o.y) < 40 * 40) n++; });
      if (n > bestN) { bestN = n; best = { x: it.x, y: it.y }; }
    });
    tutC = { g: G, p: best };
    return best;
  }

  function drawBrush(aim) {
    var p = G.drag ? { x: G.drag.x, y: G.drag.y } : phase === 'play' ? hover : null;
    if (!p) return;
    if (aim >= 0) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, BRUSH_R, 0, TAU);
    ctx.fillStyle = G.drag ? 'rgba(255,111,145,0.10)' : 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.setLineDash([6, 6]);
    ctx.lineDashOffset = -T * 20;
    ctx.lineWidth = 2;
    ctx.strokeStyle = G.drag ? 'rgba(255,95,135,0.75)' : 'rgba(150,110,110,0.5)';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawFx() {
    G.fx.forEach(function (f) {
      if (f.type === 'chunk') {
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.ellipse(f.x, f.y, f.s, f.s * 0.4, 0, 0, TAU);
        ctx.fillStyle = '#6b3f2a';
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.translate(f.x, f.y - f.z);
        ctx.rotate(f.rot);
        ctx.fillStyle = f.c;
        ctx.beginPath();
        ctx.moveTo(-f.s, -f.s * 0.5);
        ctx.lineTo(f.s * 0.3, -f.s);
        ctx.lineTo(f.s, f.s * 0.2);
        ctx.lineTo(-f.s * 0.2, f.s * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(80,40,25,0.3)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
        ctx.restore();
      } else if (f.type === 'dust') {
        var k = f.t / 0.7;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.s * (1 + k * 1.8), 0, TAU);
        ctx.fillStyle = 'rgba(255,248,240,' + 0.7 * (1 - k) + ')';
        ctx.fill();
      } else if (f.type === 'spark') {
        A.drawGlint(ctx, f.x, f.y, f.s * (1 - f.t / 0.45) + 1, 1 - f.t / 0.45);
      } else if (f.type === 'confetti') {
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(f.rot);
        ctx.fillStyle = f.c;
        ctx.fillRect(-f.s / 2, -f.s / 4, f.s, f.s / 2);
        ctx.restore();
      }
    });
  }
  function drawTexts() {
    G.texts.forEach(function (t) {
      var k = t.t / t.life;
      var sc = t.pop ? (k < 0.15 ? 0.6 + (k / 0.15) * 0.55 : 1.15 - Math.min(0.15, (k - 0.15) * 0.5)) : 1;
      ctx.save();
      ctx.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      ctx.translate(t.x, t.y - k * 24);
      ctx.scale(sc, sc);
      text(t.s, 0, 0, t.size, t.c, 'center', 5);
      ctx.restore();
    });
  }

  /* ---------------- HUD ---------------- */
  var hudCache = {};
  function updateHud() {
    if (!G) return;
    var st = G.stage;
    setText('hud-stage', st.id);
    setText('hud-stage-name', st.name);
    setText('hud-mats', materials());
    setText('hud-lost', G.lost);
    var key = G.dropsLeft + '/' + st.drops;
    if (hudCache.drops !== key) {
      hudCache.drops = key;
      var h = '';
      for (var i = 0; i < st.drops; i++) h += '<i class="pip' + (i < G.dropsLeft ? '' : ' used') + '"></i>';
      $('hud-drops').innerHTML = h;
      $('hud-drops').parentNode.setAttribute('aria-label', '남은 낙하 ' + G.dropsLeft + '번');
    }
    canvas.classList.toggle('idle', phase !== 'play');
  }
  function setText(id, v) {
    v = String(v);
    if (hudCache[id] === v) return;
    hudCache[id] = v;
    $(id).textContent = v;
  }
  function bumpHud(id) {
    var el = $(id);
    var t = el.parentNode;
    t.classList.remove('bump');
    void t.offsetWidth;
    t.classList.add('bump');
  }
  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    $('live').textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  /* ---------------- 화면 전환 ---------------- */
  function showOverlay(html, id) {
    overlay.innerHTML = '<div class="card" data-screen="' + id + '">' + html + '</div>';
    overlay.classList.add('show');
    overlay.dataset.screen = id;
  }
  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.innerHTML = '';
    overlay.dataset.screen = '';
  }
  function starsHtml(n, cls) {
    var s = '';
    for (var i = 0; i < 3; i++) s += i < n ? '★' : '<span class="off">★</span>';
    return '<span class="' + (cls || 'stars') + '">' + s + '</span>';
  }
  function hardHtml(h) {
    var s = '<span class="hard">단단함';
    for (var i = 0; i < 3; i++) s += '<i class="' + (i < h ? 'on' : '') + '"></i>';
    return s + '</span>';
  }

  function showTitle() {
    phase = 'title';
    if (!G) G = newGame(0);
    var html = '<div class="logo"><span>모</span><span>아</span><span>쿵</span><span>!</span></div>' +
      '<p class="sub">차르륵 쓸어 모아, 꾹 뭉쳐서, 쿵! 와르르~</p><div class="stage-list">';
    R.STAGES.forEach(function (st, i) {
      var best = save.best[st.id];
      var locked = st.id > save.unlocked;
      html += '<button class="stage-btn" data-stage="' + i + '"' + (locked ? ' disabled' : '') + '>' +
        '<span class="num">' + st.id + '</span><span class="meta">' + st.name +
        '<small>' + (locked ? '앞 스테이지를 깨면 열려요' : st.cakes.map(function (c) { return c.name; }).join(' · ')) + '</small></span>' +
        (best ? starsHtml(best.stars) : locked ? '' : '<span class="stars"><span class="off">★★★</span></span>') + '</button>';
    });
    html += '</div><div class="btn-row"><button class="btn ghost" data-act="help">조작법</button><button class="btn ghost" data-act="book">도감</button></div>';
    showOverlay(html, 'title');
  }

  function showIntro(stageIdx) {
    G = newGame(stageIdx);
    redrawDecals();
    phase = 'intro';
    var st = G.stage;
    var html = '<p class="sub">스테이지 ' + st.id + '</p><h2>' + st.name + '</h2><p>' + st.hint + '</p><div class="cake-rows">';
    st.cakes.forEach(function (c, i) {
      html += '<div class="cake-row"><canvas data-thumb="' + c.kind + '"></canvas><span class="nm">' + c.name + '</span>' + hardHtml(c.hardness) + '</div>';
    });
    html += '</div><div class="rule-box">재료 ' + st.materials + '개 · 낙하 ' + st.drops + '번<br>낙하에 쓴 재료의 약 1/3은 쟁반 밖으로 튀어 사라져요.<br>쓰지 않은 재료는 그대로 남아요.</div>' +
      '<div class="btn-row"><button class="btn" data-act="start">시작!</button></div>';
    showOverlay(html, 'intro');
    overlay.querySelectorAll('canvas[data-thumb]').forEach(function (cv) { A.drawThumb(cv, cv.dataset.thumb, false); });
  }

  function startPlay() {
    hideOverlay();
    phase = 'play';
    if (!save.seenHelp) {
      save.seenHelp = true;
      writeSave();
      showHelp(true);
    }
  }

  function restart() {
    var idx = G ? G.stageIdx : 0;
    G = newGame(idx);
    redrawDecals();
    hideOverlay();
    phase = 'play';
    hudCache = {};
    toast('다시 시작! 재료 ' + G.stage.materials + '개 · 낙하 ' + G.stage.drops + '번');
  }

  function endStage(win, reason) {
    if (G.ended) return;
    G.ended = true;
    var st = G.stage;
    var left = materials();
    var stageIdx = G.stageIdx;
    var g = G;
    if (win) {
      var stars = R.starsFor(st, left);
      var prev = save.best[st.id];
      if (!prev || stars > prev.stars || (stars === prev.stars && left > prev.left)) save.best[st.id] = { stars: stars, left: left };
      save.unlocked = Math.max(save.unlocked, Math.min(R.STAGES.length, st.id + 1));
      writeSave();
      confetti();
      S.win();
    } else {
      S.fail();
    }
    phase = 'result';
    setTimeout(function () {
      if (G !== g) return; // 그 사이 재시작함
      win ? showWin(stageIdx, left) : showFail(reason, left);
    }, win ? 1100 : 700);
  }

  function logHtml() {
    var html = '<ol class="log">';
    G.history.forEach(function (h, i) {
      var res = h.broke ? '와르르' : h.kind === 'scratch' ? '흠집' : '금';
      html += '<li><span>' + (i + 1) + '. ' + h.name + ' ' + h.n + '개 → ' + res + '</span><em>−' + h.lost + '개</em></li>';
    });
    return html + '</ol>';
  }

  function showWin(stageIdx, left) {
    var st = R.STAGES[stageIdx];
    var stars = R.starsFor(st, left);
    var next = stageIdx + 1 < R.STAGES.length;
    var html = '<p class="sub">스테이지 ' + st.id + ' · ' + st.name + '</p><h2>모두 와르르! 성공</h2>' +
      '<div class="bigstars">' + starsHtml(stars, '') + '</div>' +
      '<p>남은 재료 <b>' + left + '개</b> · 낙하 ' + (st.drops - G.dropsLeft) + '/' + st.drops + '번 사용</p>' +
      '<p class="sub">★★★는 재료 ' + st.stars[0] + '개 이상 남기기</p>' + logHtml() +
      '<div class="btn-row">' + (next ? '<button class="btn" data-act="next">다음 스테이지 ▶</button>' : '<button class="btn" data-act="book">도감 보기</button>') +
      '<button class="btn ghost" data-act="restart">다시 하기</button><button class="btn ghost" data-act="title">메뉴</button></div>';
    if (!next) html = html.replace('<h2>모두 와르르! 성공</h2>', '<h2>모든 디저트 와르르!</h2>');
    showOverlay(html, 'win');
  }

  function failTip() {
    var worst = null;
    G.history.forEach(function (h) { if (h.waste >= 5 && (!worst || h.waste > worst.waste)) worst = h; });
    if (worst) return '‘' + worst.name + '’은(는) ' + worst.need + '개면 부서졌는데 ' + worst.n + '개를 써서 ' + (R.lossOf(worst.n) - R.lossOf(worst.need)) + '개를 더 잃었어요. 부드러운 케이크엔 조금만!';
    var light = G.history.filter(function (h) { return h.kind === 'scratch'; })[0];
    if (light) return '‘' + light.name + '’은(는) 단단해서 작은 덩어리로는 흠집만 나요. 큰 덩어리로 한 번에!';
    return '단단한 케이크부터 큰 덩어리로, 부드러운 케이크엔 필요한 만큼만 써 보세요.';
  }

  function showFail(reason, left) {
    var st = G.stage;
    var why = reason === 'drops' ? '낙하 횟수를 다 썼어요.' : reason === 'materials' ? '재료가 하나도 남지 않았어요.' : '남은 재료 ' + left + '개와 낙하 ' + G.dropsLeft + '번으로는 남은 케이크를 다 부술 수 없어요.';
    var html = '<p class="sub">스테이지 ' + st.id + ' · ' + st.name + '</p><h2>아쉬워요!</h2><p>' + why + '</p>' + logHtml() +
      '<div class="tip">' + failTip() + '</div><div class="btn-row"><button class="btn" data-act="restart">다시 하기</button>' +
      (reason === 'impossible' ? '<button class="btn ghost" data-act="continue">그래도 계속</button>' : '') +
      '<button class="btn ghost" data-act="title">메뉴</button></div>';
    showOverlay(html, 'fail');
  }

  function showHelp(fromStart) {
    var prev = phase;
    var html = '<button class="close-x" data-act="close" aria-label="닫기">×</button><h2>조작법</h2><div class="help-steps">' +
      '<div><b>1</b><span><b style="all:unset;color:#ff5f87">꾹 누른 채 문질러</b> 재료를 쓸어 모아요. 모인 재료는 하나의 덩어리로 뭉쳐요.</span></div>' +
      '<div><b>2</b><span>덩어리를 <b style="all:unset;color:#ff5f87">케이크 위에서 놓으면</b> 자동으로 들어 올려 쿵! 떨어뜨려요. (낙하 1번)</span></div>' +
      '<div><b>3</b><span>쓴 재료의 약 <b style="all:unset;color:#e2445c">1/3은 쟁반 밖으로 튀어 사라져요.</b> 남은 재료는 다시 모아 써요.</span></div>' +
      '<div><b>!</b><span>케이크 밖에서 놓으면 덩어리가 그 자리에 놓여요. <b style="all:unset;color:#1f9d55">횟수는 줄지 않아요.</b> 놓인 덩어리를 잡고 옮기면 더 줍지 않고, 톡 치면 흩어져서 다시 고를 수 있어요.</span></div>' +
      '<div><b>?</b><span>조준하면 한 번에 부서지는지, 몇 개가 튀어나가는지 알려줘요. 단단한 케이크는 작은 덩어리로는 흠집만 나요.</span></div>' +
      '</div><div class="btn-row"><button class="btn" data-act="close">' + (fromStart ? '시작!' : '닫기') + '</button></div>';
    showOverlay(html, 'help');
    overlay.dataset.back = prev;
  }

  function showBook() {
    var prev = phase;
    var total = 0, got = 0;
    var html = '<button class="close-x" data-act="close" aria-label="닫기">×</button><h2>디저트 도감</h2>';
    var body = '';
    R.STAGES.forEach(function (st) {
      var best = save.best[st.id];
      body += '<div class="book-head"><span>' + st.id + '. ' + st.name + '</span>' + (best ? starsHtml(best.stars) : '<span class="sub">미완료</span>') + '</div><div class="book-grid">';
      st.cakes.forEach(function (c) {
        total++;
        var e = save.book[c.kind];
        if (e) got++;
        body += '<div class="book-cell"><canvas data-thumb="' + c.kind + '" data-locked="' + (e ? 0 : 1) + '"></canvas>' +
          (e ? c.name + '<small>와르르 ' + e.n + '번</small>' : '???<small>아직 못 부숨</small>') + '</div>';
      });
      body += '</div>';
    });
    html += '<p class="sub">부순 디저트 ' + got + ' / ' + total + '</p>' + body +
      '<div class="btn-row"><button class="btn" data-act="close">닫기</button></div>';
    showOverlay(html, 'book');
    overlay.dataset.back = prev;
    overlay.querySelectorAll('canvas[data-thumb]').forEach(function (cv) { A.drawThumb(cv, cv.dataset.thumb, cv.dataset.locked === '1'); });
  }

  function closeModal() {
    var back = overlay.dataset.back;
    if (back === 'title') return showTitle();
    if (back === 'result') {
      // 결과 화면으로 복귀
      var alive = G.cakes.filter(function (c) { return c.alive; }).length;
      return alive ? showFail(G.dropsLeft <= 0 ? 'drops' : materials() <= 0 ? 'materials' : 'impossible', materials()) : showWin(G.stageIdx, materials());
    }
    if (back === 'intro') return showIntro(G.stageIdx);
    hideOverlay();
    phase = back === 'drop' ? 'drop' : 'play';
  }

  overlay.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    S.unlock();
    S.ui();
    if (b.dataset.stage != null) return showIntro(+b.dataset.stage);
    switch (b.dataset.act) {
      case 'start': return startPlay();
      case 'restart': return restart();
      case 'next': return showIntro(G.stageIdx + 1);
      case 'title': return showTitle();
      case 'help': return showHelp(false);
      case 'book': return showBook();
      case 'close': return closeModal();
      case 'continue':
        G.ignoreImpossible = true;
        G.ended = false;
        hideOverlay();
        phase = 'play';
        return;
    }
  });

  var restartArmed = 0;
  $('btn-restart').addEventListener('click', function () {
    S.unlock();
    if (phase === 'title' || phase === 'intro') return;
    var progressed = G && (G.dropNo > 0 || G.drag);
    if (progressed && phase !== 'result' && Date.now() - restartArmed > 2500) {
      restartArmed = Date.now();
      var btn = $('btn-restart');
      btn.classList.add('armed');
      btn.querySelector('span').textContent = '한 번 더!';
      setTimeout(function () { btn.classList.remove('armed'); btn.querySelector('span').textContent = '다시하기'; }, 2500);
      return;
    }
    restartArmed = 0;
    $('btn-restart').classList.remove('armed');
    $('btn-restart').querySelector('span').textContent = '다시하기';
    S.ui();
    restart();
  });
  $('btn-menu').addEventListener('click', function () { S.unlock(); S.ui(); cancelDrag(); showTitle(); });
  $('btn-book').addEventListener('click', function () { S.unlock(); S.ui(); cancelDrag(); if (phase === 'drop') return; showBook(); });
  $('btn-help').addEventListener('click', function () { S.unlock(); S.ui(); cancelDrag(); if (phase === 'drop') return; showHelp(false); });
  function syncSound() {
    $('snd-label').textContent = save.sound ? '소리 켬' : '소리 끔';
    $('snd-wave').style.display = save.sound ? '' : 'none';
  }
  $('btn-sound').addEventListener('click', function () {
    save.sound = !save.sound;
    writeSave();
    S.setEnabled(save.sound);
    syncSound();
    S.ui();
  });
  syncSound();
  canvas.addEventListener('pointerdown', function (e) { if (G) G.lastPointerType = e.pointerType; }, true);

  /* ---------------- 크기 ---------------- */
  function resize() {
    var wrap = $('stage-wrap');
    var aw = wrap.clientWidth, ah = wrap.clientHeight;
    var s = Math.min(aw / W, ah / H);
    var cw = Math.max(1, Math.floor(W * s)), ch = Math.max(1, Math.floor(H * s));
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    view.scale = s;
    view.px = canvas.width / W;
    A.setPixelScale(view.px);
    bg.width = canvas.width;
    bg.height = canvas.height;
    var b = bg.getContext('2d');
    b.setTransform(view.px, 0, 0, view.px, 0, 0);
    A.drawBackground(b);
    redrawDecals();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe($('stage-wrap'));

  /* ---------------- 루프 ---------------- */
  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    updateHud();
    requestAnimationFrame(frame);
  }

  /* ---------------- 읽기 전용 관찰 창 (자동 검증용, 상태 변경 불가) ---------------- */
  window.moakung = {
    snapshot: function () {
      var aim = G && G.drag ? G.drag.target : -1;
      var held = G && G.drag ? G.drag.held.length : 0;
      return JSON.parse(JSON.stringify({
        phase: phase,
        screen: overlay.dataset.screen || null,
        stage: G ? G.stage.id : null,
        dropsLeft: G ? G.dropsLeft : null,
        materials: G ? materials() : null,
        lost: G ? G.lost : null,
        held: held,
        mode: G && G.drag ? G.drag.mode : null,
        clumps: G ? G.clumps.map(function (c) { return { x: +c.tx.toFixed(1), y: +c.ty.toFixed(1), n: c.items.length }; }) : [],
        target: aim,
        preview: G && aim >= 0 && held ? R.preview(held, G.cakes[aim], materials()) : null,
        brushRadius: BRUSH_R,
        cakes: G ? G.cakes.map(function (c) { var b = A.cakeBounds(c); return { name: c.name, kind: c.kind, hp: c.hp, maxHp: c.maxHp, armor: c.armor, alive: c.alive, x: c.x, y: c.y, r: c.r, top: b.top, need: R.needFor(c.hp, c.armor) }; }) : [],
        items: G ? G.items.filter(function (it) { return it.state === 'floor'; }).map(function (it) { return { id: it.id, mat: it.mat, x: +it.x.toFixed(1), y: +it.y.toFixed(1) }; }) : [],
        history: G ? G.history : [],
        save: save
      }));
    },
    toClient: function (x, y) {
      var r = canvas.getBoundingClientRect();
      return { x: r.left + (x / W) * r.width, y: r.top + (y / H) * r.height };
    },
    aimPointFor: function (i) {
      var c = G.cakes[i];
      return { x: c.x, y: c.y - 10 };
    }
  };

  resize();
  G = newGame(0);
  showTitle();
  requestAnimationFrame(frame);
})();
