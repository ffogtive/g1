/*
 * 모아쿵! 3D — 게임 진행 (입력, 판정, 레벨, 점수·피날레, UI)
 *
 * 가설: 2D에서 검증한 조작(쓸어 담기 · 놓기 · 잡아 옮기기 · 톡 흩기)에 "개수 맞춤"을 더하면
 *       물리 3D에서도 정밀 조작 없이 원하는 만큼 정확히 모을 수 있다.
 *  - 낙하 횟수는 케이크 위에서 손을 뗀 순간에만 준다.
 *  - 잃는 개수는 충돌 순간 rules.pickLost 로 확정, HUD 재료 수는 그 재료가 쟁반 테두리를 넘을 때 줄어든다.
 */
(function () {
  'use strict';
  var R = window.MKRules, S = window.MKAudio, THREE = window.THREE;
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('scene'), wrap = $('stage-wrap'), overlay = $('overlay');
  var W = window.MKWorld.create(canvas);
  var V3 = THREE.Vector3;

  var BRUSH_R = 4.4;       // 수거 범위 (넉넉하게)
  var PICK_Y = 1.7;        // 이 높이보다 낮게 놓인 재료만 쓸어 담는다
  var TAP_PX = 12;         // 이보다 덜 움직이면 '톡'
  var DROP_LIFT = 9;       // 케이크 위로 자동으로 올리는 높이

  /* ---------------- 저장 ---------------- */
  var SAVE_KEY = 'moakung3d.v1';
  function loadSave() {
    var d = { unlocked: 1, best: {}, book: {}, sound: true, seenHelp: false, lock: null, lastLock: 10, meshyAll: false };
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s) for (var k in d) if (s[k] !== undefined) d[k] = s[k];
    } catch (e) { /* 저장소 없음 */ }
    return d;
  }
  function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 무시 */ } }
  var save = loadSave();
  S.setEnabled(save.sound);

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function dXZ(a, bx, bz) { var dx = a.x - bx, dz = a.z - bz; return Math.sqrt(dx * dx + dz * dz); }

  /* ---------------- 덩어리 안 자리 (공 모양으로 쌓임) ---------------- */
  var slotCache = [];
  function slot(i) {
    if (slotCache[i]) return slotCache[i];
    var v;
    if (i === 0) v = new V3(0, 0, 0);
    else {
      var r = 0.6 * Math.cbrt(i + 1);
      var y = 1 - 2 * ((i * 0.618034) % 1);
      var rad = Math.sqrt(Math.max(0, 1 - y * y));
      var th = i * 2.399963;
      v = new V3(Math.cos(th) * rad * r, y * r * 0.85, Math.sin(th) * rad * r);
    }
    slotCache[i] = v;
    return v;
  }
  function clumpR(n) { return 0.6 * Math.cbrt(Math.max(1, n)) + 0.55; }

  /* ---------------- 3D 모델 (Meshy) ---------------- */
  var MODELS = {};

  /* ---------------- 상태 ---------------- */
  var G = null;
  var phase = 'map';
  var hoverPt = null;

  function cakeCenter() { return { x: W.CAKE_X, z: W.CAKE_Z }; }
  function cakeR() { return W.cake ? W.cake.style.r * W.cake.scale : 7; }

  function layoutItems(lv, rand) {
    var heavy = [], light = [];
    for (var m in lv.mats) for (var i = 0; i < lv.mats[m]; i++) (R.MATERIALS[m].weight > 1 ? heavy : light).push(m);
    function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } }
    shuffle(heavy);
    shuffle(light);
    var cR = cakeR();
    function free(x, z, pad) { return W.insideTray(x, z, 1.4) && Math.hypot(x - W.CAKE_X, z - W.CAKE_Z) > cR + (pad || 2.6); }
    var nC = Math.max(4, Math.ceil((heavy.length + light.length) / 5));
    var centers = [], tries = 0;
    while (centers.length < nC && tries++ < 5000) {
      var x = (rand() - 0.5) * (W.TW - 6), z = (rand() - 0.5) * (W.TD - 6);
      if (!free(x, z, 4.5)) continue;
      if (centers.some(function (c) { return Math.hypot(c.x - x, c.z - z) < 6.2; })) continue;
      centers.push({ x: x, z: z });
    }
    var piles = Math.min(lv.piles || 0, centers.length);
    var plan = [];
    heavy.forEach(function (mm, k) {
      var c = piles && rand() < 0.8 ? centers[k % piles] : centers[Math.floor(rand() * centers.length)];
      plan.push({ mat: mm, c: c });
    });
    light.forEach(function (mm, k) { plan.push({ mat: mm, c: centers[(k + piles) % centers.length] }); });
    var items = [];
    plan.forEach(function (p, id) {
      var pos = null;
      for (var t = 0; t < 300 && !pos; t++) {
        var a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (3 + t * 0.02);
        var px = p.c.x + Math.cos(a) * d, pz = p.c.z + Math.sin(a) * d;
        if (!free(px, pz)) continue;
        if (items.some(function (o) { return Math.hypot(o.x - px, o.z - pz) < 1.6; })) continue;
        pos = { x: px, z: pz };
      }
      for (var f = 0; f < 5000 && !pos; f++) {
        var fx = (rand() - 0.5) * (W.TW - 3), fz = (rand() - 0.5) * (W.TD - 3);
        if (free(fx, fz) && !items.some(function (o) { return Math.hypot(o.x - fx, o.z - fz) < 1.25; })) pos = { x: fx, z: fz };
      }
      items.push({ id: id, mat: p.mat, v: Math.floor(rand() * 4), x: pos.x, z: pos.z, rot: rand() * 6.28, state: 'floor', q0: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6, rand() * 6, rand() * 6)) });
    });
    return items;
  }

  function clearLevel() {
    if (!G) return;
    G.items.forEach(function (it) {
      if (it.body) W.world.removeBody(it.body);
      if (it.mesh) W.scene.remove(it.mesh);
    });
    G.clumps.forEach(function (c) { if (c.body) W.world.removeBody(c.body); });
    if (G.drop && G.drop.body) W.world.removeBody(G.drop.body);
    W.clearFx();
    W.disposeCake();
    $('fx-layer').innerHTML = '';
    $('badges').innerHTML = '';
  }

  function newGame(idx) {
    clearLevel();
    var lv = R.LEVELS[idx];
    var rand = R.rng(lv.seed);
    var modelName = lv.model || (save.meshyAll ? 'strawberry' : null);
    W.buildCake(lv, 1, modelName ? MODELS[modelName] : null);
    var items = layoutItems(lv, rand);
    items.forEach(function (it) { W.makeItem(it); });
    for (var i = 0; i < 90; i++) W.world.step(1 / 60); // 재료가 바닥에 자리 잡게
    G = {
      idx: idx, lv: lv, items: items,
      cake: { layers: lv.layers.map(function (l) { return { hp: l.hp, maxHp: l.hp, armor: l.armor }; }), top: 0 },
      dropsLeft: lv.drops, score: 0, lost: 0, history: [], drag: null, drop: null, clumps: [], clumpSeq: 0,
      ended: false, ignoreImpossible: false, rand: R.rng(lv.seed * 31 + 7), dropNo: 0,
      gathered: false, dropped: false, rested: false, finale: null
    };
    syncAll();
    hudCache = {};
  }

  function counts() {
    var heavy = 0, light = 0;
    G.items.forEach(function (it) {
      var s = it.state;
      var alive = s === 'floor' || s === 'attract' || s === 'held' || s === 'clump' || (s === 'fly' && !(it.lost && it.crossed));
      if (!alive) return;
      if (R.weightOf(it.mat) > 1) heavy++; else light++;
    });
    return { heavy: heavy, light: light, total: heavy + light };
  }
  function materials() { return counts().total; }

  /* ---------------- 입력 ---------------- */
  function aimAt(cx, cy) {
    if (!W.cake || G.cake.top >= G.cake.layers.length) return false;
    W.pointerRay(cx, cy);
    return W.raycaster.intersectObject(W.cake.aim, false).length > 0;
  }
  function clumpAt(p) {
    for (var i = G.clumps.length - 1; i >= 0; i--) {
      var c = G.clumps[i];
      if (dXZ(c.body.position, p.x, p.z) <= clumpR(c.items.length) + 1.4) return i;
    }
    return -1;
  }

  canvas.addEventListener('pointerdown', function (e) {
    S.unlock();
    G && (G.lastPointerType = e.pointerType);
    if (phase !== 'play' || !G || G.drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ }
    var fp = W.floorPoint(e.clientX, e.clientY, 0.5);
    if (!fp) return;
    var ci = clumpAt(fp);
    if (ci >= 0) {
      var cl = G.clumps.splice(ci, 1)[0];
      W.world.removeBody(cl.body);
      var c = new V3(cl.body.position.x, cl.body.position.y, cl.body.position.z);
      cl.items.forEach(function (it) { it.state = 'held'; });
      G.carried = true;
      G.drag = { id: e.pointerId, mode: 'carry', cx0: e.clientX, cy0: e.clientY, cx: e.clientX, cy: e.clientY, moved: 0, fp: fp, last: fp.clone(), held: cl.items, pos: c, off: new V3(c.x - fp.x, 0, c.z - fp.z), aim: false, spin: 0 };
      S.gather('click');
      return;
    }
    G.drag = { id: e.pointerId, mode: 'sweep', cx0: e.clientX, cy0: e.clientY, cx: e.clientX, cy: e.clientY, moved: 0, fp: fp, last: fp.clone(), held: [], pos: new V3(fp.x, 1.4, fp.z), off: new V3(), aim: false, spin: 0 };
    sweep(fp, fp);
  });
  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') hoverPt = { x: e.clientX, y: e.clientY };
    if (!G || !G.drag || e.pointerId !== G.drag.id) return;
    var d = G.drag;
    d.moved += Math.hypot(e.clientX - d.cx, e.clientY - d.cy);
    d.cx = e.clientX;
    d.cy = e.clientY;
    var fp = W.floorPoint(e.clientX, e.clientY, 0.5);
    if (!fp) return;
    d.aim = aimAt(e.clientX, e.clientY);
    if (d.mode === 'sweep' && !d.aim) sweep(d.last, fp);
    d.last = fp.clone();
    d.fp = fp;
  });
  canvas.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hoverPt = null; });
  canvas.addEventListener('pointerup', function (e) {
    if (!G || !G.drag || e.pointerId !== G.drag.id) return;
    G.drag.aim = aimAt(e.clientX, e.clientY);
    release();
  });
  function cancelDrag() { if (G && G.drag) restClump(); }
  canvas.addEventListener('pointercancel', function (e) { if (G && G.drag && e.pointerId === G.drag.id) cancelDrag(); });
  canvas.addEventListener('lostpointercapture', function (e) { if (G && G.drag && e.pointerId === G.drag.id) cancelDrag(); });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') cancelDrag(); });
  window.addEventListener('blur', cancelDrag);
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancelDrag(); });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function lockLeft() { return save.lock == null ? Infinity : save.lock - G.drag.held.length; }

  /** 지나간 길 위의 재료를 덩어리에 붙인다. 개수 맞춤에 닿으면 멈춘다. */
  function sweep(a, b) {
    var d = G.drag;
    var len = Math.hypot(b.x - a.x, b.z - a.z);
    var steps = Math.max(1, Math.ceil(len / 0.6));
    var full = false;
    for (var s = 0; s <= steps && !full; s++) {
      var px = a.x + ((b.x - a.x) * s) / steps, pz = a.z + ((b.z - a.z) * s) / steps;
      var cand = [];
      for (var i = 0; i < G.items.length; i++) {
        var it = G.items[i];
        if (it.state !== 'floor' || !it.body || it.body.position.y > PICK_Y) continue;
        var dd = dXZ(it.body.position, px, pz);
        if (dd <= BRUSH_R) cand.push({ it: it, d: dd });
      }
      cand.sort(function (p, q) { return p.d - q.d; });
      for (var k = 0; k < cand.length; k++) {
        if (lockLeft() <= 0) { full = true; break; }
        attach(cand[k].it);
      }
      // 놓아둔 덩어리를 지나가면 통째로 합침 (개수 맞춤 안에서만)
      for (var c = G.clumps.length - 1; c >= 0; c--) {
        var cl = G.clumps[c];
        if (dXZ(cl.body.position, px, pz) > BRUSH_R * 0.8 + clumpR(cl.items.length) * 0.5) continue;
        if (cl.items.length > lockLeft()) continue;
        G.clumps.splice(c, 1);
        W.world.removeBody(cl.body);
        cl.items.forEach(function (it) {
          it.state = 'attract';
          it.att = { t: 0, from: it.mesh.position.clone() };
          d.held.push(it);
        });
        S.gather('metal');
        S.gather('jelly');
      }
    }
    if (full && !d.fullShown) {
      d.fullShown = true;
      S.deny();
      floatAt(d.pos.x, d.pos.y + 2.5, d.pos.z, '딱 ' + save.lock + '개!', '#d94f75', 20, 0.9);
    }
  }
  function attach(it) {
    W.removeItemBody(it);
    it.state = 'attract';
    it.att = { t: 0, from: it.mesh.position.clone() };
    G.drag.held.push(it);
    G.gathered = true;
    S.gather(R.MATERIALS[it.mat].sound);
  }

  function release() {
    var d = G.drag;
    if (d.mode === 'carry' && d.moved < TAP_PX) return scatterHeld();
    if (d.aim && d.held.length > 0) return startDrop();
    restClump();
  }

  /** 케이크 밖에서 놓기/취소: 횟수 차감 없이 그 자리에 덩어리로 둔다 (진짜 물리로 내려앉음) */
  function restClump() {
    var d = G.drag;
    G.drag = null;
    if (!d || !d.held.length) return;
    var n = d.held.length, r = clumpR(n);
    var tx = d.fp.x + d.off.x, tz = d.fp.z + d.off.z;
    tx = clamp(tx, -W.TW / 2 + r + 0.5, W.TW / 2 - r - 0.5);
    tz = clamp(tz, -W.TD / 2 + r + 0.5, W.TD / 2 - r - 0.5);
    var cc = cakeCenter(), dist = Math.hypot(tx - cc.x, tz - cc.z), minD = cakeR() + r + 1.2;
    if (dist < minD && G.cake.top < G.cake.layers.length) {
      var a = Math.atan2(tz - cc.z, tx - cc.x);
      tx = cc.x + Math.cos(a) * minD;
      tz = cc.z + Math.sin(a) * minD;
    }
    d.held.forEach(function (it) { it.state = 'clump'; it.att = null; });
    // 근처 덩어리가 있으면 합친다
    for (var i = 0; i < G.clumps.length; i++) {
      var o = G.clumps[i];
      if (dXZ(o.body.position, tx, tz) < clumpR(o.items.length) + r + 0.5) {
        W.world.removeBody(o.body);
        G.clumps.splice(i, 1);
        d.held = o.items.concat(d.held);
        tx = o.body.position.x;
        tz = o.body.position.z;
        break;
      }
    }
    G.clumps.push(makeRestClump(d.held, d.pos.x, d.pos.y, d.pos.z, tx, tz));
    G.rested = true;
    S.putDown(Math.min(n, 4));
    floatAt(tx, 3, tz, '내려놓기 · 횟수 그대로', '#6b7a8f', 14, 1.1);
  }
  function makeRestClump(items, x, y, z, tx, tz) {
    var CANNON = window.CANNON;
    var body = new CANNON.Body({
      mass: items.length, collisionFilterGroup: W.G.ITEM, collisionFilterMask: W.G.FLOOR | W.G.WALL | W.G.ITEM | W.G.CAKE | W.G.CHUNK,
      linearDamping: 0.5, angularDamping: 0.85, allowSleep: true, sleepSpeedLimit: 0.3
    });
    items.forEach(function (it, i) {
      var s = slot(i);
      body.addShape(new CANNON.Sphere(0.48), new CANNON.Vec3(s.x, s.y, s.z));
    });
    body.position.set(x, Math.max(y, clumpR(items.length) + 0.3), z);
    // 놓은 자리로 살짝 미끄러져 내려앉게
    body.velocity.set((tx - x) * 4, -2, (tz - z) * 4);
    W.world.addBody(body);
    return { id: ++G.clumpSeq, body: body, items: items };
  }

  /** 덩어리를 톡: 흩어서 다시 고르기 (진짜 물리로 퍼짐) */
  function scatterHeld() {
    var d = G.drag;
    G.drag = null;
    if (!d || !d.held.length) return;
    d.held.forEach(function (it) {
      var p = it.mesh.position;
      W.addItemBody(it, p.x, Math.max(0.7, p.y), p.z);
      var a = Math.atan2(p.z - d.pos.z, p.x - d.pos.x) + (G.rand() - 0.5) * 0.8;
      var sp = 4 + G.rand() * 4;
      it.body.velocity.set(Math.cos(a) * sp, 5 + G.rand() * 3, Math.sin(a) * sp);
      it.state = 'floor';
      it.att = null;
    });
    S.putDown(d.held.length);
    floatAt(d.pos.x, 3, d.pos.z, '흩어 놓기 · 다시 골라요', '#6b7a8f', 14, 1.1);
  }

  /* ---------------- 낙하 ---------------- */
  function startDrop() {
    var d = G.drag;
    G.drag = null;
    d.held.forEach(function (it) { if (it.state === 'attract') { it.state = 'held'; it.att = null; } });
    G.dropsLeft -= 1; // 케이크 위에서 손을 뗀 순간에만 차감
    G.dropNo += 1;
    G.dropped = true;
    bump('hud-drops');
    var top = W.cake.topY;
    G.drop = { items: d.held, n: d.held.length, stage: 'lift', t: 0, from: d.pos.clone(), pos: d.pos.clone(), spin: d.spin, to: new V3(W.CAKE_X, top + DROP_LIFT + clumpR(d.held.length), W.CAKE_Z), settle: 0 };
    phase = 'drop';
    S.lift();
  }

  function updateDrop(dt) {
    var D = G.drop;
    D.t += dt;
    if (D.stage === 'lift') {
      var k = ease(clamp(D.t / 0.5, 0, 1));
      D.pos.lerpVectors(D.from, D.to, k);
      D.spin += dt * 4;
      if (D.t >= 0.5) { D.stage = 'hang'; D.t = 0; }
    } else if (D.stage === 'hang') {
      D.pos.y = D.to.y + Math.sin((D.t / 0.14) * Math.PI) * 0.3;
      if (D.t >= 0.14) {
        // 진짜 물리로 떨어뜨린다: 덩어리 전체를 하나의 몸체로
        var CANNON = window.CANNON;
        var body = new CANNON.Body({ mass: D.n, collisionFilterGroup: W.G.CLUMP, collisionFilterMask: W.G.CAKE | W.G.FLOOR, angularDamping: 0.6 });
        D.items.forEach(function (it, i) {
          var s = slot(i);
          body.addShape(new CANNON.Sphere(0.48), new CANNON.Vec3(s.x, s.y, s.z));
        });
        body.position.set(D.pos.x, D.pos.y, D.pos.z);
        body.velocity.set(0, -6, 0);
        body.angularVelocity.set(0.6, 1.5, 0.4);
        body.addEventListener('collide', function () { if (G.drop === D && D.stage === 'fall') D.hit = true; });
        W.world.addBody(body);
        D.body = body;
        D.stage = 'fall';
        D.t = 0;
        S.fall();
      }
    } else if (D.stage === 'fall') {
      var r = clumpR(D.n);
      if (D.hit || D.body.position.y - r * 0.6 <= W.cake.topY || D.t > 1.2) impact();
    } else if (D.stage === 'scatter') {
      updateScatter(dt);
    }
  }

  function impact() {
    var D = G.drop;
    var li = G.cake.top;
    var L = G.cake.layers[li];
    var mats = D.items.map(function (it) { return it.mat; });
    var pv = R.preview(mats, G.cake, G.lv, materials());
    var dmg = R.damage(pv.power, L.armor);
    var before = L.hp;
    L.hp = Math.max(0, L.hp - dmg);
    var broke = L.hp <= R.EPS;
    if (broke) L.hp = 0;
    var gain = Math.round(Math.min(before, dmg) * R.SCORE.perDamage);
    G.score += gain;
    var lostIdx = R.pickLost(mats, G.lv, G.dropNo * 7919);
    var lostSet = {};
    lostIdx.forEach(function (i) { lostSet[i] = true; });
    G.history.push({ layer: li, n: D.n, power: pv.power, need: pv.needPower, broke: broke, kind: pv.kind, lost: lostIdx.length, overflow: pv.overflow, gain: gain });

    var bp = D.body.position;
    var ip = new V3(bp.x, W.cake.topY, bp.z);
    // 덩어리 몸체를 풀고 재료마다 진짜 물리 몸체로
    var q = D.body.quaternion;
    var worldPos = D.items.map(function (it, i) {
      var s = slot(i);
      var v = new window.CANNON.Vec3(s.x, s.y, s.z);
      var w = q.vmult(v);
      return new V3(bp.x + w.x, bp.y + w.y, bp.z + w.z);
    });
    W.world.removeBody(D.body);
    D.body = null;

    if (broke) {
      G.cake.top += 1;
      W.breakLayer(li, ip);
      S.crumble();
      vibrate([40, 30, 70]);
    } else {
      W.crackLayer(li, 1 - L.hp / L.maxHp, ip);
      vibrate([25 + Math.min(40, D.n)]);
    }
    S.impact(D.n, broke);
    W.shake = Math.min(1.8, 0.5 + D.n * 0.05);
    W.puff(ip.x, ip.y + 0.5, ip.z, 10 + Math.min(14, D.n), 0xfff3ea);
    floatAt(ip.x, ip.y + 3, ip.z, D.n >= 20 ? '쿵!!' : '쿵!', '#5b3a3e', 30 + Math.min(14, D.n * 0.4), 0.9);
    var finished = G.cake.top >= G.cake.layers.length;
    if (finished) floatAt(ip.x, ip.y + 6, ip.z, '케이크 와르르!', '#ff4f7b', 30, 1.5);
    else if (broke) floatAt(ip.x, ip.y + 6, ip.z, '와르르! 한 층 끝', '#ff4f7b', 24, 1.3);
    else floatAt(ip.x, ip.y + 6, ip.z, pv.kind === 'scratch' ? '흠집만…' : '쩌억! ' + Math.round((L.hp / L.maxHp) * 100) + '% 남음', pv.kind === 'scratch' ? '#8e8e8e' : '#e67e22', 20, 1.3);
    if (gain) floatAt(ip.x + 3, ip.y + 4, ip.z, '+' + gain, '#ffb627', 18, 1);

    D.items.forEach(function (it, i) { launch(it, worldPos[i], !!lostSet[i]); });
    if (lostIdx.length) {
      var avg = new V3();
      D.items.forEach(function (it, i) { if (lostSet[i]) avg.add(it.target); });
      avg.multiplyScalar(1 / lostIdx.length);
      floatAt(clamp(avg.x, -W.TW / 2 + 4, W.TW / 2 - 4), 2, clamp(avg.z, -W.TD / 2 + 3, W.TD / 2 - 2), '−' + lostIdx.length + ' 쟁반 밖으로!', '#e2445c', 20, 1.9);
    }
    if (finished) collect();
    D.stage = 'scatter';
    D.t = 0;
  }

  /** 남길 재료는 쟁반 안으로, 잃을 재료는 테두리를 넘어 식탁으로 (궤도를 계산해 보장) */
  function launch(it, p, lost) {
    var r = G.rand;
    var cx = W.CAKE_X, cz = W.CAKE_Z;
    if (lost) {
      var a = r() * Math.PI * 2;
      var ex = cx, ez = cz, dx = Math.cos(a), dz = Math.sin(a);
      while (W.insideTray(ex, ez, 0)) { ex += dx * 0.3; ez += dz * 0.3; }
      var tx = ex + dx * (3 + r() * 4), tz = ez + dz * (3 + r() * 4), ty = W.TABLE_Y + 0.5;
      var g = -W.world.gravity.y;
      var apex = Math.max(p.y, W.RIM_H) + 5 + r() * 4;
      var vy = Math.sqrt(2 * g * (apex - p.y));
      var tt = vy / g + Math.sqrt(2 * (apex - ty) / g);
      W.addItemBody(it, p.x, p.y, p.z, true);
      it.body.velocity.set((tx - p.x) / tt, vy, (tz - p.z) / tt);
      it.target = new V3(tx, ty, tz);
      it.lost = true;
      it.crossed = false;
    } else {
      W.addItemBody(it, p.x, p.y, p.z, false);
      var aa = Math.atan2(p.z - cz, p.x - cx) + (r() - 0.5) * 1.2;
      var sp = 9 + r() * 7;
      it.body.velocity.set(Math.cos(aa) * sp, 6 + r() * 6, Math.sin(aa) * sp);
      it.target = new V3(p.x, 0, p.z);
      it.lost = false;
    }
    it.body.angularVelocity.set((r() - 0.5) * 16, (r() - 0.5) * 16, (r() - 0.5) * 16);
    it.state = 'fly';
    it.flyT = 0;
  }

  function updateScatter(dt) {
    var D = G.drop;
    var busy = false;
    var cR = cakeR();
    D.items.forEach(function (it) {
      if (it.state !== 'fly' && it.state !== 'fall') return;
      it.flyT += dt;
      var b = it.body;
      if (it.state === 'fly' && it.lost) {
        busy = true;
        if (!it.crossed && !W.insideTray(b.position.x, b.position.z, -0.3)) {
          it.crossed = true; // 이 순간에만 재료 수가 줄어든다 (연출 = 수치)
          G.lost += 1;
          bump('hud-mats');
          S.lost();
          floatAt(b.position.x, b.position.y + 1, b.position.z, '−1', '#e2445c', 16, 0.8);
          W.sparkle(b.position.x, b.position.y, b.position.z, 0xffffff, 4);
        }
        if (b.position.y < W.TABLE_Y + 1 || it.flyT > 2.6) { it.state = 'fall'; it.fallT = 0; }
      } else if (it.state === 'fly') {
        var v = b.velocity;
        var speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
        // 케이크 윗면에 걸린 재료는 굴러 떨어지게
        if (it.flyT > 0.7 && b.position.y > 1.2 && dXZ(b.position, W.CAKE_X, W.CAKE_Z) < cR + 0.6 && speed < 3) {
          var a = Math.atan2(b.position.z - W.CAKE_Z, b.position.x - W.CAKE_X);
          b.wakeUp();
          b.velocity.set(Math.cos(a) * 9, 4, Math.sin(a) * 9);
        }
        if ((it.flyT > 0.6 && speed < 0.8 && b.position.y < PICK_Y) || it.flyT > 3.2) {
          it.state = 'floor';
          S.land(R.MATERIALS[it.mat].sound);
        } else busy = true;
      } else if (it.state === 'fall') {
        busy = true;
        it.fallT += dt;
        var s = Math.max(0.01, 1 - it.fallT / 0.6);
        it.mesh.scale.setScalar(s);
        if (it.fallT >= 0.6) {
          it.state = 'gone';
          W.removeItemBody(it);
          W.scene.remove(it.mesh);
        }
      }
    });
    if (!busy) D.settle += dt;
    if (D.settle > 0.25 && D.t > 0.9) finishDrop();
  }

  function finishDrop() {
    G.drop = null;
    phase = 'play';
    checkEnd();
  }

  function checkEnd() {
    if (G.ended) return;
    if (G.cake.top >= G.cake.layers.length) return startFinale();
    var c = counts();
    if (G.dropsLeft <= 0) return endFail('drops');
    if (c.total <= 0) return endFail('materials');
    if (!G.ignoreImpossible && !R.canStillWin(G.lv, c.heavy, c.light, G.cake, G.dropsLeft)) return endFail('impossible');
  }

  /* ---------------- 피날레 (캔디크러시식 보너스) ---------------- */
  function startFinale() {
    G.ended = true;
    phase = 'finale';
    G.score += R.SCORE.clear;
    floatAt(W.CAKE_X, 6, W.CAKE_Z, '클리어 +' + R.SCORE.clear, '#ff4f7b', 26, 1.4);
    var queue = [];
    for (var i = 0; i < G.dropsLeft; i++) queue.push({ type: 'drop' });
    var rest = G.items.filter(function (it) { return it.state === 'floor' || it.state === 'clump' || it.state === 'fly'; });
    rest.sort(function (a, b) { return a.mesh.position.x - b.mesh.position.x; });
    rest.forEach(function (it) { queue.push({ type: 'item', it: it }); });
    G.finale = { queue: queue, t: -0.9, every: 0.42 };
    S.win();
  }
  function updateFinale(dt) {
    var F = G.finale;
    F.t += dt;
    if (F.t < 0) return;
    if (!F.queue.length) {
      if (F.t > 0.8 && !F.done) {
        F.done = true;
        W.confetti(70);
        setTimeout(showWin, 700);
      }
      return;
    }
    if (F.t < F.every) return;
    F.t = 0;
    var e = F.queue.shift();
    if (e.type === 'drop') {
      G.dropsLeft -= 1;
      G.score += R.SCORE.perDropLeft;
      bump('hud-drops');
      W.confetti(18);
      W.shake = 0.5;
      S.impact(10, true);
      floatAt(0, 4, 4, '남은 낙하 보너스 +' + R.SCORE.perDropLeft, '#ffb627', 22, 1);
    } else {
      F.every = Math.max(0.05, 1.2 / Math.max(1, F.queue.length + 1));
      var it = e.it;
      var heavy = R.weightOf(it.mat) > 1;
      var p = it.mesh.position;
      var pts = heavy ? R.SCORE.perHeavy : R.SCORE.perLight;
      G.score += pts;
      W.sparkle(p.x, p.y + 0.4, p.z, heavy ? 0xfff2a8 : 0xffffff, 5);
      floatAt(p.x, p.y + 1.5, p.z, '+' + pts, heavy ? '#d98b0e' : '#ff6f91', 15, 0.7);
      S.gather(R.MATERIALS[it.mat].sound);
      it.state = 'gone';
      W.removeItemBody(it);
      W.scene.remove(it.mesh);
    }
    bump('hud-score');
  }

  /* ---------------- 동기화 & 루프 ---------------- */
  var tmpQ = new THREE.Quaternion();
  function syncAll() {
    if (!G) return;
    G.items.forEach(function (it) {
      if (it.body && (it.state === 'floor' || it.state === 'fly' || it.state === 'fall')) {
        it.mesh.position.copy(it.body.position);
        it.mesh.quaternion.copy(it.body.quaternion);
      }
    });
    G.clumps.forEach(function (c) {
      var bq = c.body.quaternion;
      tmpQ.set(bq.x, bq.y, bq.z, bq.w);
      c.items.forEach(function (it, i) {
        var s = slot(i).clone().applyQuaternion(tmpQ);
        it.mesh.position.set(c.body.position.x + s.x, c.body.position.y + s.y, c.body.position.z + s.z);
        it.mesh.quaternion.copy(tmpQ).multiply(it.q0);
      });
    });
  }

  function updateDrag(dt) {
    var d = G.drag;
    if (!d) return;
    var n = d.held.length, r = clumpR(n);
    var target;
    if (d.aim && n) {
      // 조준 중: 덩어리가 케이크 윗면 위에 착 붙어 "여기 떨어진다"를 보여 줌
      target = new V3(W.CAKE_X, W.cake.topY + r + 0.4, W.CAKE_Z);
    } else {
      target = new V3(d.fp.x + d.off.x, r + 0.9, d.fp.z + d.off.z);
    }
    d.pos.lerp(target, 1 - Math.exp(-dt * (d.aim ? 14 : 20)));
    d.spin += dt * 1.2;
    tmpQ.setFromAxisAngle(new V3(0, 1, 0), d.spin);
    d.held.forEach(function (it, i) {
      var s = slot(i).clone().applyQuaternion(tmpQ).add(d.pos);
      if (it.state === 'attract') {
        it.att.t += dt / 0.16;
        var k = clamp(it.att.t, 0, 1);
        it.mesh.position.lerpVectors(it.att.from, s, k);
        it.mesh.position.y += Math.sin(k * Math.PI) * 1.2;
        if (k >= 1) { it.state = 'held'; it.att = null; }
      } else {
        it.mesh.position.copy(s);
      }
    });
  }
  function updateDropClump() {
    var D = G.drop;
    if (!D || D.stage === 'scatter') return;
    if (D.body) {
      var bq = D.body.quaternion;
      tmpQ.set(bq.x, bq.y, bq.z, bq.w);
      D.pos.set(D.body.position.x, D.body.position.y, D.body.position.z);
    } else tmpQ.setFromAxisAngle(new V3(0, 1, 0), D.spin);
    D.items.forEach(function (it, i) {
      it.mesh.position.copy(slot(i).clone().applyQuaternion(tmpQ).add(D.pos));
    });
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (G) {
      W.world.step(1 / 60, dt, 4);
      syncAll();
      updateDrag(dt);
      if (G.drop) updateDrop(dt);
      updateDropClump();
      if (phase === 'finale' && G.finale) updateFinale(dt);
      W.updateFx(dt);
      W.shake *= Math.exp(-dt * 8);
      updateBrush();
      if (G.drag && G.drag.held.length) W.setBlob(G.drag.pos, clumpR(G.drag.held.length));
      else if (G.drop && G.drop.stage !== 'scatter') W.setBlob(G.drop.pos, clumpR(G.drop.n));
      else W.setBlob(null);
      updateUI();
    }
    W.render();
    requestAnimationFrame(frame);
  }

  function updateBrush() {
    var show = false, p = null;
    if (G.drag && G.drag.mode === 'sweep' && !G.drag.aim) { p = G.drag.fp; show = true; }
    else if (!G.drag && phase === 'play' && hoverPt) {
      p = W.floorPoint(hoverPt.x, hoverPt.y, 0.05);
      show = !!p && !aimAt(hoverPt.x, hoverPt.y);
    }
    W.brush.visible = W.brushFill.visible = show;
    if (show && p) {
      W.brush.position.set(p.x, 0.06, p.z);
      W.brushFill.position.set(p.x, 0.05, p.z);
      W.brush.scale.setScalar(BRUSH_R);
      W.brushFill.scale.setScalar(BRUSH_R);
      W.brush.material.opacity = G.drag ? 0.9 : 0.45;
    }
  }

  /* ---------------- 화면 위 UI (HTML) ---------------- */
  var hudCache = {};
  function setText(id, v) {
    v = String(v);
    if (hudCache[id] === v) return;
    hudCache[id] = v;
    $(id).textContent = v;
  }
  function bump(id) {
    var el = $(id).parentNode;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  function dotsHtml(armor) {
    var h = armor >= 14 ? 3 : armor >= 6 ? 2 : armor > 0 ? 1 : 0;
    var s = '<span class="dots">';
    for (var i = 0; i < 3; i++) s += '<i class="' + (i < h ? 'on' : '') + '"></i>';
    return s + '</span>';
  }
  function hardWord(armor) { return armor >= 14 ? '아주 단단' : armor >= 6 ? '단단' : armor > 0 ? '조금 단단' : '말랑'; }

  function updateUI() {
    var lv = G.lv;
    setText('hud-lv', lv.id);
    setText('hud-name', lv.name);
    setText('hud-mats', materials());
    setText('hud-score', G.score);
    var key = G.dropsLeft + '/' + lv.drops;
    if (hudCache.drops !== key) {
      hudCache.drops = key;
      var h = '';
      for (var i = 0; i < lv.drops; i++) h += '<i class="pip' + (i < G.dropsLeft ? '' : ' used') + '"></i>';
      $('hud-drops').innerHTML = h;
    }

    var held = G.drag ? G.drag.held : null;
    var aiming = G.drag && G.drag.aim && held.length;
    var pv = aiming ? R.preview(held.map(function (it) { return it.mat; }), G.cake, lv, materials()) : null;

    // 케이크 층 표시
    var ch = $('cakehud');
    if (W.cake && G.cake.top < G.cake.layers.length && phase !== 'map') {
      var bp = W.project(W.CAKE_X, 0, W.CAKE_Z + cakeR() + 2.6);
      var layersHtml = '';
      G.cake.layers.forEach(function (L, i) {
        var gone = i < G.cake.top, cur = i === G.cake.top;
        var col = L.armor >= 14 ? '#ff6f91' : L.armor >= 6 ? '#ffb347' : '#6fd3a0';
        var ratio = gone ? 0 : L.hp / L.maxHp;
        var prev = cur && pv ? '<em style="left:' + (pv.hpRatioAfter * 100) + '%;width:' + ((ratio - pv.hpRatioAfter) * 100) + '%"></em>' : '';
        layersHtml += '<span class="layer' + (gone ? ' gone' : '') + (cur ? ' cur' : '') + '" style="--lc:' + col + '"><i style="width:' + (ratio * 100) + '%"></i>' + prev + '</span>';
      });
      var curL = G.cake.layers[G.cake.top];
      var label = (G.cake.layers.length > 1 ? (G.cake.top + 1) + '/' + G.cake.layers.length + '층 · ' : '') + hardWord(curL.armor) + ' ' + dotsHtml(curL.armor) + (lv.coat ? ' · 젤리 코팅' : '');
      var html = '<div class="layers">' + layersHtml + '</div><div>' + label + '</div>';
      if (hudCache.cakehud !== html) { hudCache.cakehud = html; ch.innerHTML = html; }
      ch.style.display = '';
      ch.style.left = bp.x - wrap.getBoundingClientRect().left + 'px';
      ch.style.top = bp.y - wrap.getBoundingClientRect().top + 'px';
    } else ch.style.display = 'none';

    // 조준 카드
    var card = $('aimcard');
    if (pv) {
      var color = pv.breaks ? 'var(--good)' : pv.kind === 'crack' ? 'var(--warn)' : '#8e8e8e';
      var main = pv.finishes ? '와르르! 케이크가 다 부서져요' : pv.breaks ? '와르르! 이 층이 부서져요' : pv.kind === 'crack' ? '금이 가요 · 이 층 ' + Math.max(1, Math.round(pv.hpRatioAfter * 100)) + '% 남음' : '흠집만 나요 · 너무 가벼워요';
      var hint = '';
      if (pv.breaks && pv.overflow >= 2) hint = '<div class="hint">힘 ' + pv.needPower + '이면 충분 · 넘친 힘 ' + pv.overflow + '은 버려져요</div>';
      else if (!pv.breaks) hint = '<div class="hint warn">이 층을 한 번에: 힘 ' + pv.needPower + ' 필요</div>';
      var html2 = '<div class="h">' + (G.cake.layers.length > 1 ? (G.cake.top + 1) + '층 · ' : '') + hardWord(G.cake.layers[G.cake.top].armor) + ' ' + dotsHtml(G.cake.layers[G.cake.top].armor) + '</div>' +
        '<div class="m">' + main + '</div>' +
        '<div>덩어리 ' + pv.n + '개 · 힘 ' + pv.power + (pv.heavy ? ' (묵직한 ' + pv.heavy + '개 ×2)' : '') + '</div>' +
        '<div>튀어나갈 재료 −' + pv.loss + '개' + (pv.coat ? ' (젤리 코팅 ½)' : '') + ' → 남는 재료 ' + pv.remainAfter + '개</div>' + hint;
      if (hudCache.card !== html2) { hudCache.card = html2; card.innerHTML = html2; }
      card.style.setProperty('--c', color);
      card.style.display = 'block';
      var tp = W.project(W.CAKE_X, W.cake.topY + clumpR(pv.n) * 2 + 1.8, W.CAKE_Z);
      var wr = wrap.getBoundingClientRect();
      var cw = card.offsetWidth, chh = card.offsetHeight;
      var x = clamp(tp.x - wr.left - cw / 2, 8, wr.width - cw - 8), y = tp.y - wr.top - chh - 6;
      if (y < 48) y = 48;
      card.style.left = x + 'px';
      card.style.top = y + 'px';
    } else card.style.display = 'none';

    // 개수 말풍선 + 놓아둔 덩어리 배지
    var badges = '';
    var wr2 = wrap.getBoundingClientRect();
    if (held && held.length) {
      var p = W.project(G.drag.pos.x, G.drag.pos.y + clumpR(held.length) + 0.6, G.drag.pos.z);
      var pw = R.powerOf(held.map(function (it) { return it.mat; }));
      var full = save.lock != null && held.length >= save.lock;
      badges += '<div class="bubble" style="left:' + (p.x - wr2.left) + 'px;top:' + (p.y - wr2.top) + 'px;' + (full ? 'background:#d94f75' : '') + '">' + held.length + '개<small>힘 ' + pw + '</small></div>';
    }
    G.clumps.forEach(function (c) {
      var q = W.project(c.body.position.x, c.body.position.y + clumpR(c.items.length) + 0.5, c.body.position.z);
      badges += '<div class="bubble rest" style="left:' + (q.x - wr2.left) + 'px;top:' + (q.y - wr2.top) + 'px">' + c.items.length + '개 · 힘 ' + R.powerOf(c.items.map(function (it) { return it.mat; })) + '</div>';
    });
    if (hudCache.badges !== badges) { hudCache.badges = badges; $('badges').innerHTML = badges; }

    // 안내 배너
    var msg = '';
    if (phase === 'play') {
      if (G.drag) {
        if (G.drag.aim && held.length) msg = '';
        else if (!held.length) msg = '재료 위를 쓸어 담아요';
        else if (G.drag.mode === 'carry') msg = '덩어리 옮기는 중 · 더 줍지 않아요';
        else msg = '케이크 위에서 떼면 쿵! · 밖에서 떼면 그 자리에 둬요';
      } else if (!G.gathered) msg = '꾹 누른 채 문질러서 재료를 모아요';
      else if (G.clumps.length && !G.carried) msg = '덩어리를 잡아 케이크로 · 톡 치면 흩어져요';
      else if (!G.dropped) msg = '모은 덩어리를 케이크 위로 옮겨 손을 떼요';
    } else if (phase === 'finale') msg = '와르르 피날레! 남은 낙하·재료가 점수로';
    setText('banner', msg);
    canvas.style.cursor = phase === 'play' ? (G.drag ? 'grabbing' : 'crosshair') : 'default';
  }

  function floatAt(x, y, z, text, color, size, life) {
    var p = W.project(x, y, z);
    var wr = wrap.getBoundingClientRect();
    var el = document.createElement('div');
    el.className = 'ftext';
    el.textContent = text;
    el.style.left = clamp(p.x - wr.left, 40, wr.width - 40) + 'px';
    el.style.top = clamp(p.y - wr.top, 20, wr.height - 20) + 'px';
    el.style.fontSize = (size || 20) + 'px';
    el.style.setProperty('--c', color || '#5b3a3e');
    el.style.setProperty('--d', (life || 1) + 's');
    $('fx-layer').appendChild(el);
    setTimeout(function () { el.remove(); }, (life || 1) * 1000 + 50);
  }
  var toastT = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    $('live').textContent = msg;
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }
  function vibrate(p) { try { if (navigator.vibrate && G && G.lastPointerType !== 'mouse') navigator.vibrate(p); } catch (e) { /* 무시 */ } }

  /* ---------------- 개수 맞춤 ---------------- */
  function syncLock() {
    var el = $('lock-val');
    el.textContent = save.lock == null ? '제한 없음' : save.lock + '개까지';
    el.classList.toggle('on', save.lock != null);
  }
  function stepLock(d) {
    if (save.lock == null) save.lock = save.lastLock || 10;
    else save.lock = clamp(save.lock + d, 1, 60);
    save.lastLock = save.lock;
    writeSave();
    syncLock();
    S.ui();
  }
  function holdRepeat(btn, d) {
    var t1 = null, t2 = null;
    function stop() { clearTimeout(t1); clearInterval(t2); }
    btn.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      S.unlock();
      stepLock(d);
      t1 = setTimeout(function () { t2 = setInterval(function () { stepLock(d); }, 90); }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, stop); });
  }
  holdRepeat($('lock-minus'), -1);
  holdRepeat($('lock-plus'), 1);
  function toggleLock() {
    S.unlock();
    if (save.lock == null) save.lock = save.lastLock || 10;
    else { save.lastLock = save.lock; save.lock = null; }
    writeSave();
    syncLock();
    S.ui();
  }
  $('lock-val').addEventListener('click', toggleLock);
  $('lock-val').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleLock(); } });
  syncLock();

  /* ---------------- 화면 전환 ---------------- */
  function showOverlay(html, id, back) {
    overlay.innerHTML = '<div class="card">' + html + '</div>';
    overlay.classList.add('show');
    overlay.dataset.screen = id;
    overlay.dataset.back = back || '';
  }
  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.innerHTML = '';
    overlay.dataset.screen = '';
  }
  function starsHtml(n) {
    var s = '';
    for (var i = 0; i < 3; i++) s += i < n ? '★' : '<span class="off">★</span>';
    return s;
  }
  function miniCake(lv) {
    var st = window.MKWorld.CAKES[lv.model || (save.meshyAll && MODELS.strawberry) ? 'shortcake' : lv.kind];
    var n = lv.layers.length;
    var svg = '<svg class="mini" viewBox="0 0 60 52" aria-hidden="true">';
    svg += '<ellipse cx="30" cy="47" rx="27" ry="4" fill="#fff"/>';
    var y = 46, h = Math.min(14, 34 / n);
    for (var i = 0; i < n; i++) {
      var ls = st.layers[Math.min(i, st.layers.length - 1)];
      var w = 44 * (ls.rs || 1) * (i === 0 && ls.taper ? 1 : 1);
      var top = ls.taper ? w * ls.taper : w;
      var x0 = 30 - w / 2, x1 = 30 + w / 2, t0 = 30 - top / 2, t1 = 30 + top / 2;
      svg += '<path d="M' + x0 + ' ' + y + ' L' + t0 + ' ' + (y - h) + ' L' + t1 + ' ' + (y - h) + ' L' + x1 + ' ' + y + ' Z" fill="' + (ls.bands ? ls.bands[1] || ls.side : ls.side) + '" stroke="rgba(90,50,40,0.25)"/>';
      svg += '<ellipse cx="30" cy="' + (y - h) + '" rx="' + top / 2 + '" ry="3" fill="' + ls.top + '"/>';
      y -= h;
    }
    if (lv.coat) svg += '<path d="M6 46 Q6 ' + (y - 4) + ' 30 ' + (y - 6) + ' Q54 ' + (y - 4) + ' 54 46 Z" fill="' + (lv.coat === 'mint' ? '#7be8c4' : '#ff8fbf') + '" opacity="0.35"/>';
    return svg + '</svg>';
  }

  function showMap() {
    if (G && G.drag) cancelDrag();
    phase = 'map';
    var nextId = Math.min(save.unlocked, R.LEVELS.length);
    var html = '<div class="logo"><span>모</span><span>아</span><span>쿵</span><span>!</span><sup>3D</sup></div>' +
      '<p class="sub">차르륵 모아, 쿵! 케이크를 와르르~</p><div class="map">';
    R.LEVELS.forEach(function (lv) {
      var best = save.best[lv.id];
      var locked = lv.id > save.unlocked;
      html += '<button class="node' + (lv.id === nextId && !best ? ' next' : '') + '" data-level="' + (lv.id - 1) + '"' + (locked ? ' disabled' : '') + ' aria-label="레벨 ' + lv.id + ' ' + lv.name + '">' +
        '<span class="ball"><span class="num">' + lv.id + '</span>' + miniCake(lv) + '</span>' +
        '<span class="name">' + lv.name + '</span><span class="stars">' + (best ? starsHtml(best.stars) : '') + '</span></button>';
    });
    html += '</div>';
    if (MODELS.strawberry) html += '<div class="btn-row"><button class="btn ghost" data-act="meshy" aria-pressed="' + !!save.meshyAll + '">' + (save.meshyAll ? '✓ ' : '') + '모든 레벨을 Meshy 케이크로</button></div>';
    html += '<div class="btn-row"><button class="btn ghost" data-act="help">조작법</button><button class="btn ghost" data-act="book">도감</button></div>';
    showOverlay(html, 'map');
  }

  function showIntro(idx) {
    newGame(idx);
    phase = 'intro';
    var lv = G.lv;
    var layers = lv.layers.map(function (L, i) {
      return '<span>' + (lv.layers.length > 1 ? (i + 1) + '층 ' : '') + hardWord(L.armor) + ' ' + dotsHtml(L.armor) + '</span>';
    }).join('');
    var tags = '<span class="tag">' + R.FEATURES[lv.feature].name + '</span>' + (lv.coat ? '<span class="tag">젤리 코팅</span>' : '');
    var html = '<p class="sub">레벨 ' + lv.id + '</p><h2>' + lv.name + '</h2>' + tags +
      '<div class="feat">' + miniCake(lv) + '<p>' + lv.intro + '</p></div>' +
      '<div class="layer-list">' + layers + '</div>' +
      '<p class="sub">재료 ' + lv.total + '개 (묵직한 쇠구슬·너트 ' + lv.heavy + '개) · 낙하 ' + lv.drops + '번<br>★★ ' + lv.stars[0] + '점 · ★★★ ' + lv.stars[1] + '점</p>' +
      '<div class="btn-row"><button class="btn" data-act="start">시작!</button></div>';
    showOverlay(html, 'intro');
  }
  function startPlay() {
    hideOverlay();
    phase = 'play';
    if (!save.seenHelp) { save.seenHelp = true; writeSave(); showHelp('play'); }
  }
  function restart() {
    var idx = G ? G.idx : 0;
    newGame(idx);
    hideOverlay();
    phase = 'play';
    toast('다시 시작! 재료 ' + G.lv.total + '개 · 낙하 ' + G.lv.drops + '번');
  }

  function collect() {
    var e = save.book[G.lv.id] || 0;
    save.book[G.lv.id] = e + 1;
    writeSave();
    if (!e) toast('도감에 새 디저트! ' + G.lv.name);
  }

  function logHtml() {
    var html = '<ol class="log">';
    G.history.forEach(function (h, i) {
      var res = h.broke ? '와르르' : h.kind === 'scratch' ? '흠집' : '금';
      html += '<li><span>' + (i + 1) + '. ' + (G.cake.layers.length > 1 ? (h.layer + 1) + '층에 ' : '') + h.n + '개(힘 ' + h.power + ') → ' + res + (h.overflow >= 2 ? ' · 넘침 ' + h.overflow : '') + '</span><em>−' + h.lost + '개</em></li>';
    });
    return html + '</ol>';
  }
  function showWin() {
    if (!G || phase !== 'finale') return;
    phase = 'result';
    var lv = G.lv;
    var stars = R.starsFor(lv, G.score, true);
    var prev = save.best[lv.id];
    var newBest = !prev || G.score > prev.score;
    if (newBest) save.best[lv.id] = { stars: Math.max(stars, prev ? prev.stars : 0), score: G.score };
    else if (stars > prev.stars) save.best[lv.id].stars = stars;
    save.unlocked = Math.max(save.unlocked, Math.min(R.LEVELS.length, lv.id + 1));
    writeSave();
    var next = G.idx + 1 < R.LEVELS.length;
    var html = '<p class="sub">레벨 ' + lv.id + ' · ' + lv.name + '</p><h2>' + (next ? '케이크 와르르! 성공' : '모든 케이크 와르르!') + '</h2>' +
      '<div class="bigstars">' + starsHtml(stars) + '</div><div class="score">' + G.score + '점</div>' +
      '<p class="sub">' + (newBest ? '최고 점수! · ' : '') + '★★ ' + lv.stars[0] + ' · ★★★ ' + lv.stars[1] + '</p>' + logHtml() +
      (stars < 3 ? '<div class="tip">' + winTip() + '</div>' : '') +
      '<div class="btn-row">' + (next ? '<button class="btn" data-act="next">다음 레벨 ▶</button>' : '<button class="btn" data-act="book">도감 보기</button>') +
      '<button class="btn ghost" data-act="restart">다시 하기</button><button class="btn ghost" data-act="map">지도</button></div>';
    showOverlay(html, 'win');
  }
  function winTip() {
    var over = G.history.filter(function (h) { return h.overflow >= 3; })[0];
    if (over) return '넘친 힘은 버려져요. 아래 [− 개수 +]로 딱 맞게 모으면 재료가 남아 점수가 올라가요.';
    return '묵직한 쇠구슬·너트(힘 2배)를 쓰면 같은 힘을 더 적은 개수로 낼 수 있어요.';
  }
  function endFail(reason) {
    G.ended = true;
    phase = 'result';
    S.fail();
    var g = G;
    setTimeout(function () { if (G === g) showFail(reason); }, 800);
  }
  function failTip() {
    var over = G.history.filter(function (h) { return h.overflow >= 4; })[0];
    if (over && G.cake.layers.length > 1) return '층 케이크는 넘친 힘이 아래층으로 가지 않아요. 층마다 딱 맞게 모아 보세요.';
    if (over) return '필요한 것보다 많이 쓰면 그만큼 많이 튀어나가요. 개수 맞춤을 써 보세요.';
    var light = G.history.filter(function (h) { return h.kind === 'scratch'; })[0];
    if (light) return '단단한 층은 작은 덩어리로는 흠집만 나요. 묵직한 재료를 모아 한 번에!';
    if (G.lv.coat) return '젤리 코팅은 떨어뜨린 재료의 절반이 튀어요. 낙하 수를 줄이고 딱 맞게!';
    return '조준 카드의 "힘 N 필요"를 보고 그만큼만 모아 보세요.';
  }
  function showFail(reason) {
    var c = counts();
    var why = reason === 'drops' ? '낙하 횟수를 다 썼어요.' : reason === 'materials' ? '재료가 하나도 안 남았어요.' : '남은 재료 ' + c.total + '개와 낙하 ' + G.dropsLeft + '번으로는 케이크를 다 부술 수 없어요.';
    var html = '<p class="sub">레벨 ' + G.lv.id + ' · ' + G.lv.name + '</p><h2>아쉬워요!</h2><p>' + why + '</p>' + logHtml() +
      '<div class="tip">' + failTip() + '</div><div class="btn-row"><button class="btn" data-act="restart">다시 하기</button>' +
      (reason === 'impossible' ? '<button class="btn ghost" data-act="continue">그래도 계속</button>' : '') +
      '<button class="btn ghost" data-act="map">지도</button></div>';
    showOverlay(html, 'fail');
  }
  function showHelp(back) {
    var html = '<button class="close-x" data-act="close" aria-label="닫기">×</button><h2>조작법</h2><div class="help-steps">' +
      '<div><b>1</b><span>빈 바닥을 <b style="all:unset;color:#ff5f87">꾹 누른 채 문지르면</b> 분홍 원 안의 재료가 덩어리로 붙어요.</span></div>' +
      '<div><b>2</b><span>덩어리를 <b style="all:unset;color:#ff5f87">케이크 위에서 놓으면</b> 자동으로 들어 올려 쿵! (낙하 1번)</span></div>' +
      '<div><b>3</b><span>쓴 재료의 <b style="all:unset;color:#e2445c">약 1/3이 쟁반 밖으로</b> 튀어 사라져요. 젤리 코팅은 절반!</span></div>' +
      '<div><b>#</b><span>아래 <b style="all:unset;color:#d94f75">[− 개수 +]</b>로 정한 개수까지만 붙어요. 가운데를 누르면 켜고 꺼요.</span></div>' +
      '<div><b>!</b><span>케이크 밖에서 놓으면 덩어리가 그 자리에 놓여요(횟수 그대로). 잡아 옮기면 더 줍지 않고, 톡 치면 흩어져요.</span></div>' +
      '<div><b>★</b><span>쇠구슬·너트는 힘 2배. 층 케이크는 넘친 힘이 아래층에 안 가요. 남긴 낙하·재료가 점수가 돼요.</span></div>' +
      '</div><div class="btn-row"><button class="btn" data-act="close">' + (back === 'play' ? '시작!' : '닫기') + '</button></div>';
    showOverlay(html, 'help', back || phase);
  }
  function showBook() {
    var back = phase;
    var got = 0;
    var cells = R.LEVELS.map(function (lv) {
      var n = save.book[lv.id] || 0;
      var best = save.best[lv.id];
      if (n) got++;
      return '<div>' + (n ? miniCake(lv) : '<svg class="mini" viewBox="0 0 60 52"><text x="30" y="34" text-anchor="middle" font-size="24" fill="#cdb9bc">?</text></svg>') +
        (n ? lv.name : '???') + '<small>' + (best ? starsHtml(best.stars) : '') + '</small>' + (n ? '<small style="color:#8a6a6e">와르르 ' + n + '번</small>' : '') + '</div>';
    }).join('');
    var html = '<button class="close-x" data-act="close" aria-label="닫기">×</button><h2>디저트 도감</h2><p class="sub">부순 케이크 ' + got + ' / ' + R.LEVELS.length + '</p><div class="book">' + cells + '</div>' +
      '<div class="btn-row"><button class="btn" data-act="close">닫기</button></div>';
    showOverlay(html, 'book', back);
  }
  function closeModal() {
    var back = overlay.dataset.back;
    if (back === 'map') return showMap();
    if (back === 'intro') return showIntro(G.idx);
    if (back === 'result') return G.cake.top >= G.cake.layers.length ? (phase = 'finale', showWin()) : showFail(G.dropsLeft <= 0 ? 'drops' : 'impossible');
    hideOverlay();
    phase = back === 'drop' ? 'drop' : back === 'finale' ? 'finale' : 'play';
  }

  overlay.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    S.unlock();
    S.ui();
    if (b.dataset.level != null) return showIntro(+b.dataset.level);
    switch (b.dataset.act) {
      case 'start': return startPlay();
      case 'restart': return restart();
      case 'next': return showIntro(G.idx + 1);
      case 'map': return showMap();
      case 'help': return showHelp(phase);
      case 'book': return showBook();
      case 'close': return closeModal();
      case 'meshy':
        save.meshyAll = !save.meshyAll;
        writeSave();
        return showMap();
      case 'continue':
        G.ignoreImpossible = true;
        G.ended = false;
        hideOverlay();
        phase = 'play';
        return;
    }
  });
  var armed = 0;
  $('btn-restart').addEventListener('click', function () {
    S.unlock();
    if (!G || phase === 'map' || phase === 'intro') return;
    var progressed = G.dropNo > 0 || G.drag || G.clumps.length;
    if (progressed && phase !== 'result' && Date.now() - armed > 2500) {
      armed = Date.now();
      var btn = $('btn-restart');
      btn.classList.add('armed');
      btn.querySelector('span').textContent = '한 번 더!';
      setTimeout(function () { btn.classList.remove('armed'); btn.querySelector('span').textContent = '다시하기'; }, 2500);
      return;
    }
    armed = 0;
    $('btn-restart').classList.remove('armed');
    $('btn-restart').querySelector('span').textContent = '다시하기';
    restart();
  });
  $('btn-map').addEventListener('click', function () { S.unlock(); S.ui(); showMap(); });
  $('btn-book').addEventListener('click', function () { S.unlock(); S.ui(); cancelDrag(); if (phase === 'drop' || phase === 'finale') return; showBook(); });
  $('btn-help').addEventListener('click', function () { S.unlock(); S.ui(); cancelDrag(); if (phase === 'drop' || phase === 'finale') return; showHelp(phase); });
  function syncSound() { $('snd-label').textContent = save.sound ? '소리 켬' : '소리 끔'; $('snd-wave').style.display = save.sound ? '' : 'none'; }
  $('btn-sound').addEventListener('click', function () { save.sound = !save.sound; writeSave(); S.setEnabled(save.sound); syncSound(); S.ui(); });
  syncSound();

  /* ---------------- 크기 ---------------- */
  function resize() {
    var w = wrap.clientWidth, h = wrap.clientHeight;
    if (w < 10 || h < 10) return;
    W.resize(w, h);
    hudCache = {};
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(wrap);

  /* ---------------- 읽기 전용 관찰 창 (자동 검증용, 상태 변경 불가) ---------------- */
  window.moakung = {
    snapshot: function () {
      if (!G) return { phase: phase };
      var c = counts();
      var held = G.drag ? G.drag.held : [];
      var aim = !!(G.drag && G.drag.aim && held.length);
      var cp = W.project(W.CAKE_X, (W.cake ? W.cake.topY : 2) * 0.6, W.CAKE_Z);
      return JSON.parse(JSON.stringify({
        phase: phase, screen: overlay.dataset.screen || null, level: G.lv.id, dropsLeft: G.dropsLeft,
        materials: c.total, heavy: c.heavy, light: c.light, score: G.score, lost: G.lost, lock: save.lock,
        held: held.length, mode: G.drag ? G.drag.mode : null, aim: aim,
        preview: aim ? R.preview(held.map(function (it) { return it.mat; }), G.cake, G.lv, c.total) : null,
        layers: G.cake.layers, top: G.cake.top, stars: G.lv.stars,
        items: G.items.filter(function (it) { return it.state === 'floor' && it.body && it.body.position.y < PICK_Y; }).map(function (it) {
          var p = W.project(it.body.position.x, it.body.position.y, it.body.position.z);
          return { id: it.id, mat: it.mat, x: +it.body.position.x.toFixed(2), z: +it.body.position.z.toFixed(2), sx: Math.round(p.x), sy: Math.round(p.y) };
        }),
        clumps: G.clumps.map(function (cl) {
          var p = W.project(cl.body.position.x, cl.body.position.y, cl.body.position.z);
          return { n: cl.items.length, sx: Math.round(p.x), sy: Math.round(p.y) };
        }),
        cakeAim: { sx: Math.round(cp.x), sy: Math.round(cp.y) },
        brushRadius: BRUSH_R, history: G.history, save: save
      }));
    },
    /** 화면 좌표가 조준 영역인지, 바닥 어디인지 (읽기 전용) */
    probe: function (cx, cy) {
      var fp = W.floorPoint(cx, cy, 0.5);
      return { aim: aimAt(cx, cy), x: fp ? +fp.x.toFixed(2) : null, z: fp ? +fp.z.toFixed(2) : null };
    },
    project: function (x, y, z) { return W.project(x, y, z); }
  };

  resize();
  W.loadModel('strawberry').then(function (m) {
    if (m) MODELS.strawberry = m;
    $('loading').remove();
    newGame(Math.min(save.unlocked, R.LEVELS.length) - 1);
    showMap();
    requestAnimationFrame(frame);
  });
})();
