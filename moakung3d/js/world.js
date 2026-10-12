/*
 * 모아쿵! 3D — 장면·물리·케이크·재료 (three.js + cannon-es)
 *
 * 가설: 물리엔진은 "움직임"만 맡고 판정은 rules.js 가 맡으면,
 *       진짜로 튀고 무너지는 맛을 내면서도 미리보기 = 실제 결과를 지킬 수 있다.
 *  - 잃을 재료는 충돌 순간 규칙으로 정하고, 그 재료만 쟁반 벽을 무시하는 궤도로 날려 보낸다.
 *  - 나머지 재료는 보이지 않는 벽 안에서 진짜 물리로 구르고 멈춘다.
 *
 * 케이크 모양은 buildCake() 한 곳에서만 만든다 → 나중에 블렌더 모델(GLB)로 교체할 자리.
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, CANNON = root.CANNON;

  /* ---------------- 치수 (월드 단위) ---------------- */
  var TW = 26, TD = 44;             // 쟁반 안쪽 가로(x), 세로(z) — 세로 화면 비율에 맞춤
  var RIM_H = 1.1, RIM_T = 1.2;     // 쟁반 테두리
  var TABLE_Y = -3;                 // 식탁 높이 (쟁반은 다리 위에)
  var CAKE_X = 0, CAKE_Z = -7;      // 케이크 자리
  var IS = 1.25;                    // 재료 크기 배율 (보기 좋게)
  var GRAVITY = -80;
  var G = { FLOOR: 1, WALL: 2, ITEM: 4, CAKE: 8, CHUNK: 16, TABLE: 32, LOST: 64, CLUMP: 128 };

  /* ---------------- 재료 모양 ---------------- */
  var MAT_LOOK = {
    steel:  { r: 0.5, colors: ['#d9dee6'], metal: 0.9, rough: 0.18 },
    nut:    { r: 0.5, colors: ['#e9c05a', '#c9d1db'], metal: 0.85, rough: 0.3 },
    jelly:  { r: 0.4, colors: ['#ff6fa8', '#5fd36a', '#ffa63d', '#9b7bff'], metal: 0, rough: 0.15, opacity: 0.82 },
    star:   { r: 0.5, colors: ['#ffc53a', '#ff8fbf', '#7cc6ff'], metal: 0.35, rough: 0.35 },
    button: { r: 0.5, colors: ['#8fdcc5', '#ff9b86', '#c3adff', '#ffd97a'], metal: 0, rough: 0.5 },
    pearl:  { r: 0.5, colors: ['#f6f0ff'], metal: 0.2, rough: 0.12, iris: true }
  };

  function starShape(ro, ri) {
    var s = new THREE.Shape();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? ri : ro, a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    return s;
  }

  var geoCache = {}, matCache = {};
  function itemGeometry(mat) {
    if (geoCache[mat]) return geoCache[mat];
    var g;
    switch (mat) {
      case 'steel': g = new THREE.SphereGeometry(0.52, 20, 14); break;
      case 'nut': {
        var sh = new THREE.Shape();
        for (var i = 0; i < 6; i++) {
          var a = (i * Math.PI) / 3;
          if (i === 0) sh.moveTo(Math.cos(a) * 0.6, Math.sin(a) * 0.6); else sh.lineTo(Math.cos(a) * 0.6, Math.sin(a) * 0.6);
        }
        sh.closePath();
        var hole = new THREE.Path();
        hole.absarc(0, 0, 0.26, 0, Math.PI * 2, true);
        sh.holes.push(hole);
        g = new THREE.ExtrudeGeometry(sh, { depth: 0.34, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
        g.rotateX(-Math.PI / 2);
        g.translate(0, -0.17, 0);
        break;
      }
      case 'jelly': {
        // 젤리 곰 비슷한 말랑한 덩어리 (몸 + 머리 + 귀)
        var parts = [];
        var body = new THREE.SphereGeometry(0.42, 14, 10); body.scale(1, 1.15, 0.8); body.translate(0, -0.1, 0); parts.push(body);
        var head = new THREE.SphereGeometry(0.3, 12, 8); head.translate(0, 0.42, 0); parts.push(head);
        var e1 = new THREE.SphereGeometry(0.12, 8, 6); e1.translate(-0.22, 0.66, 0); parts.push(e1);
        var e2 = new THREE.SphereGeometry(0.12, 8, 6); e2.translate(0.22, 0.66, 0); parts.push(e2);
        g = mergeGeos(parts);
        g.rotateX(-Math.PI / 2);
        g.scale(0.9, 0.9, 0.9);
        break;
      }
      case 'star':
        g = new THREE.ExtrudeGeometry(starShape(0.62, 0.28), { depth: 0.22, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
        g.rotateX(-Math.PI / 2);
        g.translate(0, -0.11, 0);
        break;
      case 'button': {
        var bs = new THREE.Shape();
        bs.absarc(0, 0, 0.56, 0, Math.PI * 2, false);
        [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]].forEach(function (p) {
          var h = new THREE.Path();
          h.absarc(p[0], p[1], 0.07, 0, Math.PI * 2, true);
          bs.holes.push(h);
        });
        g = new THREE.ExtrudeGeometry(bs, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 20 });
        g.rotateX(-Math.PI / 2);
        g.translate(0, -0.08, 0);
        break;
      }
      case 'pearl': {
        var ps = new THREE.Shape();
        var pts = [[-0.6, -0.15], [-0.25, -0.55], [0.35, -0.5], [0.62, 0.05], [0.25, 0.55], [-0.45, 0.42]];
        pts.forEach(function (p, i) { if (i) ps.lineTo(p[0], p[1]); else ps.moveTo(p[0], p[1]); });
        ps.closePath();
        g = new THREE.ExtrudeGeometry(ps, { depth: 0.1, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
        g.rotateX(-Math.PI / 2);
        g.translate(0, -0.05, 0);
        // 자개 무지개빛: 위치에 따라 색이 변하는 정점 색
        var pos = g.attributes.position, col = [];
        for (var k = 0; k < pos.count; k++) {
          var x = pos.getX(k), z = pos.getZ(k);
          var t = (x * 0.8 + z * 0.6 + 1) / 2;
          var c = new THREE.Color().setHSL(0.55 + t * 0.4, 0.6, 0.86);
          col.push(c.r, c.g, c.b);
        }
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        break;
      }
    }
    g.scale(IS, IS, IS);
    geoCache[mat] = g;
    return g;
  }
  function itemMaterial(mat, v) {
    var key = mat + v;
    if (matCache[key]) return matCache[key];
    var L = MAT_LOOK[mat];
    var m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(L.colors[v % L.colors.length]),
      metalness: L.metal, roughness: L.rough,
      transparent: !!L.opacity, opacity: L.opacity || 1,
      vertexColors: !!L.iris
    });
    if (mat === 'jelly') m.emissive = new THREE.Color(L.colors[v % L.colors.length]).multiplyScalar(0.18);
    matCache[key] = m;
    return m;
  }
  function mergeGeos(list) {
    // 위치/법선만 있는 비인덱스 지오메트리 합치기 (BufferGeometryUtils 없이)
    var pos = [], nor = [];
    list.forEach(function (g) {
      var gg = g.index ? g.toNonIndexed() : g;
      pos.push.apply(pos, gg.attributes.position.array);
      nor.push.apply(nor, gg.attributes.normal.array);
    });
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return out;
  }

  /* ---------------- 케이크 모양 (블렌더 모델로 교체할 자리) ---------------- */
  // 층 스타일: side(겉면 색), inside(속살), top(윗면), bands(겉면 줄무늬), taper(위로 갈수록 좁아짐)
  var CAKES = {
    pudding:    { r: 5.6, layers: [{ h: 5.2, side: '#ffd264', inside: '#ffe7a6', top: '#a5541b', taper: 0.7, gloss: 0.25 }], toppings: 'cherry' },
    mousse:     { r: 5.8, layers: [{ h: 5.0, side: '#ffe14d', inside: '#fff6c8', top: '#ffe45c', taper: 0.6, gloss: 0.08 }], toppings: 'mint' },
    shortcake:  { r: 6.5, layers: [{ h: 5.6, side: '#fffaf3', inside: '#ffe7a3', top: '#fffdf8', bands: ['#fffaf3', '#ff9fae', '#fffaf3', '#ffe7a3', '#fffaf3'] }], toppings: 'strawberry' },
    choco:      { r: 6.3, layers: [{ h: 6.0, side: '#4b2416', inside: '#7a4428', top: '#2e140b', gloss: 0.15 }], toppings: 'raspberry' },
    macaron:    { r: 5.0, layers: [{ h: 9.0, side: '#ffb3c7', inside: '#fff3e6', top: '#ffd1dc', taper: 0.3, bands: ['#ffb3c7', '#b8f0d8', '#d6c4ff', '#fff0a6', '#ffcfa8', '#ffb3c7', '#b8f0d8', '#d6c4ff'] }], toppings: 'bow' },
    cheesecake: { r: 6.3, layers: [{ h: 5.0, side: '#fbe6bf', inside: '#fff1d6', top: '#99194d', bands: ['#c08a52', '#fbe6bf', '#fbe6bf', '#fbe6bf', '#e0ad5c'] }], toppings: 'blueberry' },
    crepe:      { r: 6.3, layers: [
      { h: 3.0, side: '#ffd6a5', inside: '#ffe2b8', top: '#f7d9a8', bands: ['#ffb3ba', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff'] },
      { h: 3.0, side: '#ffd6a5', inside: '#ffe2b8', top: '#f7d9a8', bands: ['#bdb2ff', '#ffc6ff', '#ffb3ba', '#ffd6a5', '#fdffb6', '#caffbf'] }], toppings: 'berries' },
    tiered:     { r: 6.8, layers: [
      { h: 3.4, side: '#ffffff', inside: '#ffe7a3', top: '#ffffff', rs: 1.0, bands: ['#ffffff', '#ff9fb8', '#ffffff'] },
      { h: 3.2, side: '#ffe0e8', inside: '#ffe7a3', top: '#ffe0e8', rs: 0.76, bands: ['#ffe0e8', '#ffffff', '#ffe0e8'] },
      { h: 3.0, side: '#dff7ee', inside: '#ffe7a3', top: '#ff9dbb', rs: 0.54, bands: ['#dff7ee', '#ffb3c7', '#dff7ee'] }], toppings: 'candles' },
    crown:      { r: 6.7, layers: [
      { h: 3.0, side: '#e9b872', inside: '#4a2414', top: '#2a1209', bands: ['#d99a4e', '#f4cd8d', '#d99a4e'] },
      { h: 3.4, side: '#ffcf3a', inside: '#c98a0c', top: '#ffe27a', rs: 0.42, metal: 0.7, gloss: 0.2 }], toppings: 'jewels' }
  };

  function cakeStyle(kind) { return CAKES[kind]; }

  /** 부채꼴 조각 지오메트리 (층 하나를 K조각으로 나눈 것 중 하나). 겉면/속살/윗면 색을 정점 색으로 칠한다. */
  function wedgeGeometry(r, h, a0, a1, st) {
    var shape = new THREE.Shape();
    var segs = Math.max(3, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 48));
    shape.moveTo(0, 0);
    for (var i = 0; i <= segs; i++) {
      var a = a0 + ((a1 - a0) * i) / segs;
      shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    shape.closePath();
    var g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 8, steps: st.bands ? st.bands.length * 2 : 1 });
    g.rotateX(-Math.PI / 2); // 위쪽(+y)으로 쌓이게: shape 의 (x, y) → 월드 (x, -z)
    g = g.toNonIndexed();
    var taper = st.taper == null ? 1 : st.taper;
    var pos = g.attributes.position;
    for (var k = 0; k < pos.count; k++) {
      var y = pos.getY(k);
      var s = 1 + (taper - 1) * (y / h);
      pos.setX(k, pos.getX(k) * s);
      pos.setZ(k, pos.getZ(k) * s);
    }
    g.computeVertexNormals();
    // 정점 색: 삼각형마다 법선/위치로 겉면·속살·윗면 구분
    var nor = g.attributes.normal, col = new Float32Array(pos.count * 3);
    var cSide = new THREE.Color(st.side), cIn = new THREE.Color(st.inside), cTop = new THREE.Color(st.top);
    var bands = st.bands ? st.bands.map(function (b) { return new THREE.Color(b); }) : null;
    for (var t = 0; t < pos.count; t += 3) {
      var cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
      for (var j = 0; j < 3; j++) {
        cx += pos.getX(t + j); cy += pos.getY(t + j); cz += pos.getZ(t + j);
        nx += nor.getX(t + j); ny += nor.getY(t + j); nz += nor.getZ(t + j);
      }
      cx /= 3; cy /= 3; cz /= 3;
      var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      var c;
      if (ny > 0.6) c = cTop;
      else if (ny < -0.6) c = cIn;
      else {
        var rl = Math.sqrt(cx * cx + cz * cz) || 1;
        var outward = (nx * cx + nz * cz) / rl;
        if (outward > 0.55) {
          c = bands ? bands[Math.min(bands.length - 1, Math.floor((cy / h) * bands.length))] : cSide;
        } else c = cIn;
      }
      for (var q = 0; q < 3; q++) { col[(t + q) * 3] = c.r; col[(t + q) * 3 + 1] = c.g; col[(t + q) * 3 + 2] = c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }

  /* ---------------- 월드 ---------------- */
  function create(canvas) {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(40, 1, 0.5, 400);
    var camBase = new THREE.Vector3();
    var camLook = new THREE.Vector3(0, 0, 0.5);

    // 빛
    scene.add(new THREE.HemisphereLight(0xfff4f0, 0xd9b8c0, 1.0));
    var sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-14, 40, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
    sun.shadow.camera.near = 5; sun.shadow.camera.far = 90;
    sun.shadow.bias = -0.0008;
    scene.add(sun);
    var fill = new THREE.DirectionalLight(0xffe6ef, 0.5);
    fill.position.set(16, 20, -10);
    scene.add(fill);

    // 금속 반사를 위한 간단한 환경맵
    var pmrem = new THREE.PMREMGenerator(renderer);
    var envScene = new THREE.Scene();
    var envGeo = new THREE.SphereGeometry(50, 16, 8);
    var envCols = new Float32Array(envGeo.attributes.position.count * 3);
    for (var ei = 0; ei < envGeo.attributes.position.count; ei++) {
      var ey = envGeo.attributes.position.getY(ei) / 50;
      var ec = new THREE.Color().setHSL(0.95, 0.5, 0.55 + ey * 0.4);
      envCols[ei * 3] = ec.r; envCols[ei * 3 + 1] = ec.g; envCols[ei * 3 + 2] = ec.b;
    }
    envGeo.setAttribute('color', new THREE.BufferAttribute(envCols, 3));
    envScene.add(new THREE.Mesh(envGeo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
    var envLight = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    envLight.position.set(0, 40, 0);
    envLight.lookAt(0, 0, 0);
    envScene.add(envLight);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;

    // 물리
    var world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
    world.allowSleep = true;
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = 8;
    world.defaultContactMaterial.friction = 0.38;
    world.defaultContactMaterial.restitution = 0.22;

    function staticBox(hx, hy, hz, x, y, z, group, mask) {
      var b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: group, collisionFilterMask: mask });
      b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
      b.position.set(x, y, z);
      world.addBody(b);
      return b;
    }

    // 식탁 (깅엄 무늬)
    var tcan = document.createElement('canvas');
    tcan.width = tcan.height = 128;
    var tctx = tcan.getContext('2d');
    tctx.fillStyle = '#fde6ea';
    tctx.fillRect(0, 0, 128, 128);
    tctx.fillStyle = 'rgba(246,160,185,0.45)';
    tctx.fillRect(0, 0, 64, 128);
    tctx.fillRect(0, 0, 128, 64);
    var ttex = new THREE.CanvasTexture(tcan);
    ttex.wrapS = ttex.wrapT = THREE.RepeatWrapping;
    ttex.repeat.set(18, 18);
    ttex.colorSpace = THREE.SRGBColorSpace;
    var table = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: ttex, roughness: 0.95 }));
    table.rotation.x = -Math.PI / 2;
    table.position.y = TABLE_Y;
    table.receiveShadow = true;
    scene.add(table);
    staticBox(100, 0.5, 100, 0, TABLE_Y - 0.5, 0, G.TABLE, G.ITEM | G.CHUNK | G.LOST);

    // 쟁반: 바닥 + 테두리 + 다리
    var trayMat = new THREE.MeshStandardMaterial({ color: 0xfffaf4, roughness: 0.35, metalness: 0.0 });
    var rimMat = new THREE.MeshStandardMaterial({ color: 0xf6eee8, roughness: 0.3 });
    var floorMesh = new THREE.Mesh(new THREE.BoxGeometry(TW + RIM_T * 2, 0.8, TD + RIM_T * 2), trayMat);
    floorMesh.position.y = -0.4;
    floorMesh.receiveShadow = true;
    floorMesh.castShadow = true;
    scene.add(floorMesh);
    staticBox(TW / 2 + RIM_T, 0.4, TD / 2 + RIM_T, 0, -0.4, 0, G.FLOOR, G.ITEM | G.CHUNK | G.CLUMP);
    var rims = [
      [TW / 2 + RIM_T, RIM_H / 2, RIM_T / 2, 0, RIM_H / 2, -(TD / 2 + RIM_T / 2)],
      [TW / 2 + RIM_T, RIM_H / 2, RIM_T / 2, 0, RIM_H / 2, TD / 2 + RIM_T / 2],
      [RIM_T / 2, RIM_H / 2, TD / 2, -(TW / 2 + RIM_T / 2), RIM_H / 2, 0],
      [RIM_T / 2, RIM_H / 2, TD / 2, TW / 2 + RIM_T / 2, RIM_H / 2, 0]
    ];
    rims.forEach(function (r) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(r[0] * 2, r[1] * 2, r[2] * 2), rimMat);
      m.position.set(r[3], r[4], r[5]);
      m.castShadow = true;
      m.receiveShadow = true;
      scene.add(m);
      staticBox(r[0], r[1], r[2], r[3], r[4], r[5], G.FLOOR, G.ITEM | G.CHUNK | G.CLUMP);
    });
    // 테두리 윗면 민트색 띠 (테두리 위에만)
    var mint = new THREE.MeshStandardMaterial({ color: 0xa9dfd0, roughness: 0.4 });
    rims.forEach(function (r) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(r[0] * 2 + 0.02, 0.12, r[2] * 2 + 0.02), mint);
      m.position.set(r[3], RIM_H + 0.05, r[5]);
      scene.add(m);
    });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
      var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, -TABLE_Y - 0.8, 12), rimMat);
      leg.position.set(p[0] * (TW / 2 - 1), (TABLE_Y - 0.8) / 2, p[1] * (TD / 2 - 1));
      leg.castShadow = true;
      scene.add(leg);
    });
    // 보이지 않는 벽: 남길 재료만 막는다 (잃을 재료는 통과해서 쟁반 밖으로)
    var WH = 30;
    staticBox(TW / 2, WH, 0.5, 0, WH, -(TD / 2 + 0.5), G.WALL, G.ITEM);
    staticBox(TW / 2, WH, 0.5, 0, WH, TD / 2 + 0.5, G.WALL, G.ITEM);
    staticBox(0.5, WH, TD / 2, -(TW / 2 + 0.5), WH, 0, G.WALL, G.ITEM);
    staticBox(0.5, WH, TD / 2, TW / 2 + 0.5, WH, 0, G.WALL, G.ITEM);

    // 붓(수거 범위) 링
    var brush = new THREE.Mesh(new THREE.RingGeometry(1, 1.12, 48), new THREE.MeshBasicMaterial({ color: 0xff5f87, transparent: true, opacity: 0.85, depthWrite: false }));
    brush.rotation.x = -Math.PI / 2;
    brush.position.y = 0.05;
    brush.visible = false;
    scene.add(brush);
    var brushFill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xff8fab, transparent: true, opacity: 0.16, depthWrite: false }));
    brushFill.rotation.x = -Math.PI / 2;
    brushFill.position.y = 0.04;
    brushFill.visible = false;
    scene.add(brushFill);

    // 덩어리 바로 아래 그림자 (높이감)
    var blob = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0x5a2a20, transparent: true, opacity: 0.3, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.visible = false;
    blob.renderOrder = 2;
    scene.add(blob);

    var W = {
      THREE: THREE, CANNON: CANNON, renderer: renderer, scene: scene, camera: camera, world: world, G: G,
      TW: TW, TD: TD, TABLE_Y: TABLE_Y, CAKE_X: CAKE_X, CAKE_Z: CAKE_Z, RIM_H: RIM_H,
      brush: brush, brushFill: brushFill, blob: blob, shake: 0, cake: null, fx: [],
      raycaster: new THREE.Raycaster(), ndc: new THREE.Vector2()
    };

    /* --- 카메라: 화면 비율에 맞춰 쟁반 전체가 보이도록 거리 조절 --- */
    W.resize = function (w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      var dir = new THREE.Vector3(0, 1.0, 0.42).normalize();
      var pts = [];
      [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { pts.push(new THREE.Vector3(sx * (TW / 2 + RIM_T), 0, sz * (TD / 2 + RIM_T))); }); });
      pts.push(new THREE.Vector3(CAKE_X, 12, CAKE_Z - 3));
      var fov = 40;
      camera.fov = fov;
      var d = 30;
      for (var it = 0; it < 80; it++) {
        camera.position.copy(camLook).addScaledVector(dir, d);
        camera.lookAt(camLook);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        var ok = pts.every(function (p) {
          var q = p.clone().project(camera);
          return Math.abs(q.x) < 0.97 && q.y < 0.84 && q.y > -0.97;
        });
        if (ok) break;
        d += 1;
      }
      camBase.copy(camera.position);
    };

    W.pointerRay = function (cx, cy) {
      var r = canvas.getBoundingClientRect();
      W.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      W.raycaster.setFromCamera(W.ndc, camera);
      return W.raycaster.ray;
    };
    W.floorPoint = function (cx, cy, y) {
      var ray = W.pointerRay(cx, cy);
      var t = ((y || 0) - ray.origin.y) / ray.direction.y;
      if (!(t > 0)) return null;
      return ray.origin.clone().addScaledVector(ray.direction, t);
    };
    W.project = function (x, y, z) {
      var v = new THREE.Vector3(x, y, z).project(camera);
      var r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
    W.insideTray = function (x, z, pad) {
      pad = pad || 0;
      return Math.abs(x) <= TW / 2 - pad && Math.abs(z) <= TD / 2 - pad;
    };

    /* --- 재료 --- */
    W.makeItem = function (it) {
      var mesh = new THREE.Mesh(itemGeometry(it.mat), itemMaterial(it.mat, it.v));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.item = it;
      scene.add(mesh);
      it.mesh = mesh;
      it.body = null;
      W.addItemBody(it, it.x, 0.8, it.z);
      return it;
    };
    W.itemShape = function (mat) {
      if (mat === 'steel') return new CANNON.Sphere(0.52 * IS);
      if (mat === 'jelly') return new CANNON.Sphere(0.46 * IS);
      if (mat === 'star' || mat === 'pearl' || mat === 'button' || mat === 'nut') return new CANNON.Cylinder(0.56 * IS, 0.56 * IS, (mat === 'nut' ? 0.42 : 0.26) * IS, 8);
      return new CANNON.Sphere(0.5 * IS);
    };
    W.addItemBody = function (it, x, y, z, lost) {
      if (it.body) world.removeBody(it.body);
      var w = root.MKRules.MATERIALS[it.mat].weight;
      var b = new CANNON.Body({
        mass: it.mat === 'jelly' ? 0.6 : w,
        collisionFilterGroup: lost ? G.LOST : G.ITEM,
        collisionFilterMask: lost ? G.TABLE : (G.FLOOR | G.WALL | G.ITEM | G.CAKE | G.CHUNK),
        linearDamping: 0.12, angularDamping: 0.3, allowSleep: true, sleepSpeedLimit: 0.4, sleepTimeLimit: 0.3
      });
      b.addShape(W.itemShape(it.mat));
      b.position.set(x, y, z);
      b.quaternion.setFromEuler(0, it.rot || 0, 0);
      if (it.mat === 'jelly') b.material = W.bouncy;
      world.addBody(b);
      it.body = b;
      return b;
    };
    W.removeItemBody = function (it) {
      if (it.body) { world.removeBody(it.body); it.body = null; }
    };
    W.bouncy = new CANNON.Material('jelly');
    world.addContactMaterial(new CANNON.ContactMaterial(W.bouncy, world.defaultMaterial, { friction: 0.3, restitution: 0.55 }));

    /* --- 케이크 --- */
    // level.layers 는 위층부터. 아래층부터 쌓는다.
    W.buildCake = function (level, scale, model) {
      if (W.cake) W.disposeCake();
      if (model) return buildModelCake(level, model);
      var st = cakeStyle(level.kind);
      var s = scale || 1;
      var group = new THREE.Group();
      group.position.set(CAKE_X, 0, CAKE_Z);
      scene.add(group);
      // 도일리(받침)
      var doily = new THREE.Mesh(new THREE.CylinderGeometry(st.r * s + 1.4, st.r * s + 1.4, 0.12, 40), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
      doily.position.y = 0.06;
      doily.receiveShadow = true;
      group.add(doily);
      var n = level.layers.length;
      // 스타일 층 수가 레벨 층 수와 다르면 맞춘다
      var styles = [];
      for (var i = 0; i < n; i++) styles.push(st.layers[Math.min(i, st.layers.length - 1)]);
      var layers = [];
      var y = 0.12;
      for (var bi = 0; bi < n; bi++) {
        var ls = styles[bi];
        var dataIdx = n - 1 - bi; // 아래층 = 데이터의 마지막
        var r = st.r * s * (ls.rs || 1);
        var h = ls.h * s * (n === 1 ? 1 : 1);
        var K = r > 5 ? 8 : 6;
        var lg = new THREE.Group();
        lg.position.y = y;
        group.add(lg);
        var wedges = [];
        var mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ls.gloss != null ? ls.gloss : 0.55, metalness: ls.metal || 0 });
        var armor = level.layers[dataIdx].armor;
        if (armor >= 10 && ls.gloss == null) mat.roughness = 0.28; // 단단한 층은 반들반들
        for (var k = 0; k < K; k++) {
          var a0 = (k / K) * Math.PI * 2, a1 = ((k + 1) / K) * Math.PI * 2;
          var geo = wedgeGeometry(r, h, a0, a1, ls);
          var m = new THREE.Mesh(geo, mat);
          m.castShadow = true;
          m.receiveShadow = true;
          var mid = (a0 + a1) / 2;
          // shape 의 (x, y) → 월드 (x, -z) 이므로 방향 보정
          m.userData = { mid: mid, dir: new THREE.Vector3(Math.cos(mid), 0, -Math.sin(mid)), r: r, h: h, a0: a0, a1: a1 };
          lg.add(m);
          wedges.push(m);
        }
        // 그대로일 때 충돌체: 원기둥 하나
        var body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: G.CAKE, collisionFilterMask: G.ITEM | G.CHUNK | G.CLUMP });
        var taper = ls.taper == null ? 1 : ls.taper;
        body.addShape(new CANNON.Cylinder(r * (0.5 + taper * 0.5), r, h, 16));
        body.position.set(CAKE_X, y + h / 2, CAKE_Z);
        world.addBody(body);
        layers.unshift({ group: lg, wedges: wedges, body: body, r: r, h: h, y0: y, taper: taper, style: ls, broken: false, crack: 0, toppings: [] });
        y += h;
      }
      W.cake = { group: group, layers: layers, style: st, coat: null, aim: null, scale: s, topY: y };
      W.addToppings(W.cake, st.toppings);
      if (level.coat) W.addCoat(W.cake, level.coat);
      // 조준 판정용 보이지 않는 원기둥 (넉넉하게)
      var aimR = st.r * s + 3, aimH = y + 6;
      var aim = new THREE.Mesh(new THREE.CylinderGeometry(aimR, aimR, aimH, 24), new THREE.MeshBasicMaterial({ visible: false }));
      aim.position.set(CAKE_X, aimH / 2 - 0.5, CAKE_Z);
      scene.add(aim);
      W.cake.aim = aim;
      W.cake.aimR = aimR;
      return W.cake;
    };

    /* --- Meshy/블렌더 모델 케이크 --- */
    var modelCache = {};
    /** window.MK_MODELS[name] (base64 GLB) 를 읽어 하나의 지오메트리로 정리한다 */
    W.loadModel = function (name) {
      if (modelCache[name]) return modelCache[name];
      var b64 = root.MK_MODELS && root.MK_MODELS[name];
      if (!b64 || !THREE.GLTFLoader) return Promise.resolve(null);
      var bin = atob(b64), buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      modelCache[name] = new Promise(function (resolve) {
        new THREE.GLTFLoader().parse(buf.buffer, '', function (gltf) {
          try { resolve(prepModel(gltf.scene)); } catch (e) { console.warn('model', e); resolve(null); }
        }, function (e) { console.warn('model', e); resolve(null); });
      });
      return modelCache[name];
    };
    function prepModel(obj) {
      obj.updateMatrixWorld(true);
      var mesh = null;
      obj.traverse(function (o) { if (o.isMesh && !mesh) mesh = o; });
      var g = mesh.geometry, out = new THREE.BufferGeometry();
      ['position', 'normal', 'uv'].forEach(function (name) {
        var a = g.attributes[name];
        if (!a) return;
        var arr = new Float32Array(a.count * a.itemSize); // 양자화된 값을 실수로 풀어 둔다
        for (var i = 0; i < a.count; i++) {
          arr[i * a.itemSize] = a.getX(i);
          arr[i * a.itemSize + 1] = a.getY(i);
          if (a.itemSize > 2) arr[i * a.itemSize + 2] = a.getZ(i);
        }
        out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
      });
      if (g.index) out.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1));
      out.applyMatrix4(mesh.matrixWorld);
      out = out.toNonIndexed();
      out.computeBoundingBox();
      var bb = out.boundingBox;
      var cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      out.translate(-cx, -bb.min.y, -cz);
      var pos = out.attributes.position, R = 0;
      for (var k = 0; k < pos.count; k++) R = Math.max(R, Math.hypot(pos.getX(k), pos.getZ(k)));
      var mat = mesh.material;
      mat.side = THREE.DoubleSide; // 조각 안쪽(빈 껍질)이 보여도 구멍처럼 안 보이게
      return { geo: out, material: mat, radius: R, height: bb.max.y - bb.min.y };
    }

    /** 모델을 층(높이 구간) × 부채꼴(각도 구간)으로 잘라, 기본 도형 케이크와 같은 구조로 만든다 */
    function buildModelCake(level, M) {
      var R = 6.3, s = R / M.radius, Ht = M.height * s;
      var group = new THREE.Group();
      group.position.set(CAKE_X, 0, CAKE_Z);
      scene.add(group);
      var doily = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.4, R + 1.4, 0.12, 40), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
      doily.position.y = 0.06;
      doily.receiveShadow = true;
      group.add(doily);
      var n = level.layers.length, K = 10, base = 0.12, slabH = Ht / n;
      var src = M.geo, P = src.attributes.position, N = src.attributes.normal, U = src.attributes.uv;
      var buckets = [];
      for (var t = 0; t < P.count; t += 3) {
        var cx = (P.getX(t) + P.getX(t + 1) + P.getX(t + 2)) / 3 * s;
        var cy = (P.getY(t) + P.getY(t + 1) + P.getY(t + 2)) / 3 * s;
        var cz = (P.getZ(t) + P.getZ(t + 1) + P.getZ(t + 2)) / 3 * s;
        var bi = Math.min(n - 1, Math.max(0, Math.floor((cy / Ht) * n)));
        var a = Math.atan2(-cz, cx);
        if (a < 0) a += Math.PI * 2;
        var k = Math.min(K - 1, Math.floor((a / (Math.PI * 2)) * K));
        var key = bi * K + k;
        var b = buckets[key] || (buckets[key] = { p: [], n: [], u: [] });
        for (var v = 0; v < 3; v++) {
          b.p.push(P.getX(t + v) * s, P.getY(t + v) * s - bi * slabH, P.getZ(t + v) * s);
          if (N) b.n.push(N.getX(t + v), N.getY(t + v), N.getZ(t + v));
          if (U) b.u.push(U.getX(t + v), U.getY(t + v));
        }
      }
      var styleLayer = { side: '#f4b6c2', inside: '#ffe7d6', top: '#fff4f6' };
      var layers = [];
      for (var li = 0; li < n; li++) {
        var lg = new THREE.Group();
        lg.position.y = base + li * slabH;
        group.add(lg);
        var wedges = [];
        for (var kk = 0; kk < K; kk++) {
          var bk = buckets[li * K + kk];
          if (!bk || !bk.p.length) continue;
          var geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(bk.p, 3));
          if (bk.n.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(bk.n, 3));
          if (bk.u.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(bk.u, 2));
          var m = new THREE.Mesh(geo, M.material);
          m.castShadow = true;
          m.receiveShadow = true;
          var a0 = (kk / K) * Math.PI * 2, a1 = ((kk + 1) / K) * Math.PI * 2, mid = (a0 + a1) / 2;
          m.userData = { mid: mid, dir: new THREE.Vector3(Math.cos(mid), 0, -Math.sin(mid)), r: R, h: slabH, a0: a0, a1: a1 };
          lg.add(m);
          wedges.push(m);
        }
        var body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: G.CAKE, collisionFilterMask: G.ITEM | G.CHUNK | G.CLUMP });
        body.addShape(new CANNON.Cylinder(R * 0.92, R * 0.95, slabH, 16));
        body.position.set(CAKE_X, base + li * slabH + slabH / 2, CAKE_Z);
        world.addBody(body);
        layers.unshift({ group: lg, wedges: wedges, body: body, r: R, h: slabH, y0: base + li * slabH, taper: 1, style: styleLayer, broken: false, crack: 0, toppings: [] });
      }
      W.cake = { group: group, layers: layers, style: { r: R, layers: [styleLayer] }, coat: null, aim: null, scale: 1, topY: base + Ht, model: true };
      if (level.coat) W.addCoat(W.cake, level.coat);
      var aimR = R + 3, aimH = base + Ht + 6;
      var aim = new THREE.Mesh(new THREE.CylinderGeometry(aimR, aimR, aimH, 24), new THREE.MeshBasicMaterial({ visible: false }));
      aim.position.set(CAKE_X, aimH / 2 - 0.5, CAKE_Z);
      scene.add(aim);
      W.cake.aim = aim;
      W.cake.aimR = aimR;
      return W.cake;
    }

    W.addToppings = function (cake, type) {
      var top = cake.layers[0];
      var yTop = top.h;
      var rTop = top.r * top.taper;
      function add(mesh, x, y, z) {
        mesh.position.set(x, yTop + y, z);
        mesh.castShadow = true;
        top.group.add(mesh);
        top.toppings.push(mesh);
      }
      var red = new THREE.MeshStandardMaterial({ color: 0xe8384f, roughness: 0.25 });
      var cream = new THREE.MeshStandardMaterial({ color: 0xfffaf2, roughness: 0.6 });
      var i, a, n;
      switch (type) {
        case 'cherry':
          add(new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 10).scale(1, 0.7, 1), cream), 0, 0.6, 0);
          add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), red), 0, 1.7, 0);
          break;
        case 'strawberry':
        case 'raspberry':
        case 'blueberry':
        case 'berries':
          n = 8;
          var col = type === 'blueberry' ? 0x3b46b8 : type === 'raspberry' ? 0xd61f5a : 0xe8384f;
          var bm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.3 });
          for (i = 0; i < n; i++) {
            a = (i / n) * Math.PI * 2;
            var geo = type === 'strawberry' ? new THREE.ConeGeometry(0.55, 1.1, 10) : new THREE.SphereGeometry(0.5, 12, 8);
            if (type === 'strawberry') geo.rotateX(Math.PI);
            add(new THREE.Mesh(geo, bm), Math.cos(a) * rTop * 0.68, 0.55, Math.sin(a) * rTop * 0.68);
            if (i % 2 === 0) add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8).scale(1, 0.8, 1), cream), Math.cos(a + 0.4) * rTop * 0.68, 0.35, Math.sin(a + 0.4) * rTop * 0.68);
          }
          break;
        case 'mint':
          add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.2, 20), cream), 0, 0.2, 0);
          var leaf = new THREE.MeshStandardMaterial({ color: 0x5cc46a, roughness: 0.4 });
          add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 6).scale(1.5, 0.3, 0.7), leaf), 0.4, 0.45, 0.2);
          break;
        case 'bow':
          add(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.22, 8, 16), new THREE.MeshStandardMaterial({ color: 0xff6f9c, roughness: 0.4 })), 0, 0.5, 0);
          break;
        case 'candles':
          var cm = [0x7cc6ff, 0xffd23f, 0xff8fbf, 0x8fdcc5].map(function (c) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }); });
          var flame = new THREE.MeshBasicMaterial({ color: 0xffc23a });
          for (i = 0; i < 4; i++) {
            a = (i / 4) * Math.PI * 2 + 0.4;
            var cx = Math.cos(a) * rTop * 0.55, cz = Math.sin(a) * rTop * 0.55;
            add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.8, 8), cm[i]), cx, 0.9, cz);
            var f = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6).scale(1, 1.6, 1), flame);
            f.userData.flame = true;
            add(f, cx, 2.05, cz);
          }
          break;
        case 'jewels':
          var gold = new THREE.MeshStandardMaterial({ color: 0xffcf3a, metalness: 0.8, roughness: 0.25 });
          for (i = 0; i < 5; i++) {
            a = (i / 5) * Math.PI * 2;
            add(new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 6), gold), Math.cos(a) * rTop * 0.8, 0.6, Math.sin(a) * rTop * 0.8);
          }
          add(new THREE.Mesh(new THREE.OctahedronGeometry(0.6), new THREE.MeshStandardMaterial({ color: 0xe02c55, metalness: 0.3, roughness: 0.1 })), 0, 0.7, 0);
          break;
      }
    };

    W.addCoat = function (cake, color) {
      var c = color === 'mint' ? 0x7be8c4 : 0xff8fbf;
      var r = cake.style.r * cake.scale + 0.7, h = cake.topY + 1.2;
      var coat = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r, h, 40, 1, false), new THREE.MeshStandardMaterial({
        color: c, transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.0, emissive: new THREE.Color(c).multiplyScalar(0.12), depthWrite: false
      }));
      coat.position.set(0, h / 2, 0);
      var cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.96, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25, 1), coat.material);
      cap.position.y = h / 2;
      coat.add(cap);
      cake.group.add(coat);
      cake.coat = coat;
    };

    W.disposeCake = function () {
      var c = W.cake;
      if (!c) return;
      c.layers.forEach(function (l) { if (l.body) world.removeBody(l.body); });
      scene.remove(c.group);
      if (c.aim) scene.remove(c.aim);
      W.cake = null;
    };

    /** 덜 부서진 타격: 조각 사이가 벌어지고(금), 살짝 주저앉고, 부스러기가 튄다 */
    W.crackLayer = function (li, ratio, impact) {
      var L = W.cake.layers[li];
      L.crack = Math.max(L.crack, ratio);
      var k = L.crack;
      L.wedges.forEach(function (m, i) {
        var d = m.userData.dir;
        var jitter = 0.6 + ((i * 37) % 10) / 12;
        m.position.set(d.x * k * 0.9 * jitter, 0, d.z * k * 0.9 * jitter);
        var tangent = new THREE.Vector3(-d.z, 0, d.x);
        m.quaternion.setFromAxisAngle(tangent, -k * 0.22 * jitter);
      });
      L.group.scale.y = 1 - 0.18 * k;
      // 윗면 토핑이 기울거나 떨어짐
      L.toppings.forEach(function (t, i) {
        if (!t.parent) return;
        if (((i * 53) % 100) / 100 < k * 0.7) W.flingMesh(t, 6, impact);
      });
      W.crumbs(li, 6 + Math.round(ratio * 14), impact);
      W.squash(li);
    };

    /** 층이 부서짐: 조각마다 진짜 물리 몸체를 붙여 사방으로 날린다 */
    W.breakLayer = function (li, impact) {
      var L = W.cake.layers[li];
      if (L.broken) return;
      L.broken = true;
      world.removeBody(L.body);
      L.body = null;
      L.group.updateMatrixWorld(true);
      L.wedges.forEach(function (m) {
        var d = m.userData.dir;
        var wp = new THREE.Vector3();
        m.geometry.computeBoundingBox();
        m.geometry.boundingBox.getCenter(wp);
        m.geometry = m.geometry.clone();
        m.geometry.translate(-wp.x, -wp.y, -wp.z);
        var worldPos = wp.clone().applyMatrix4(m.matrixWorld);
        var q = new THREE.Quaternion();
        m.getWorldQuaternion(q);
        L.group.remove(m);
        m.position.copy(worldPos);
        m.quaternion.copy(q);
        m.scale.set(1, L.group.scale.y, 1);
        scene.add(m);
        var r = m.userData.r, h = m.userData.h * L.group.scale.y;
        var w = 2 * r * 0.6 * Math.sin((m.userData.a1 - m.userData.a0) / 2);
        var body = new CANNON.Body({ mass: 3, collisionFilterGroup: G.CHUNK, collisionFilterMask: G.FLOOR | G.CHUNK | G.TABLE | G.ITEM | G.CAKE, linearDamping: 0.05, angularDamping: 0.1 });
        body.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(0.3, w / 2), Math.max(0.3, h / 2), r * 0.42)));
        body.position.set(worldPos.x, worldPos.y, worldPos.z);
        body.quaternion.set(q.x, q.y, q.z, q.w);
        var sp = 10 + Math.random() * 8;
        body.velocity.set(d.x * sp + (impact ? impact.x : 0) * 0, 10 + Math.random() * 10, d.z * sp);
        body.angularVelocity.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 10);
        world.addBody(body);
        W.fx.push({ type: 'chunk', mesh: m, body: body, t: 0, life: 3.2 });
      });
      L.toppings.forEach(function (t) { if (t.parent) W.flingMesh(t, 12, impact); });
      L.wedges = [];
      W.crumbs(li, 20, impact);
      // 위로 남은 층이 없으므로 다음 층이 맨 위. 조준 원기둥 높이도 낮춘다.
      var remain = W.cake.layers.filter(function (l) { return !l.broken; });
      var topY = remain.length ? remain[0].y0 + remain[0].h * remain[0].group.scale.y : 0.2;
      W.cake.topY = topY;
      if (!remain.length && W.cake.coat) W.popCoat();
    };

    W.flingMesh = function (mesh, power, impact) {
      var wp = new THREE.Vector3();
      mesh.getWorldPosition(wp);
      var q = new THREE.Quaternion();
      mesh.getWorldQuaternion(q);
      mesh.parent.remove(mesh);
      mesh.position.copy(wp);
      mesh.quaternion.copy(q);
      scene.add(mesh);
      var body = new CANNON.Body({ mass: 0.5, collisionFilterGroup: G.CHUNK, collisionFilterMask: G.FLOOR | G.CHUNK | G.TABLE });
      body.addShape(new CANNON.Sphere(0.5));
      body.position.set(wp.x, wp.y, wp.z);
      var a = Math.atan2(wp.z - CAKE_Z, wp.x - CAKE_X) + (Math.random() - 0.5);
      body.velocity.set(Math.cos(a) * power * (0.6 + Math.random() * 0.6), power * (0.6 + Math.random() * 0.6), Math.sin(a) * power * (0.6 + Math.random() * 0.6));
      body.angularVelocity.set(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      world.addBody(body);
      W.fx.push({ type: 'chunk', mesh: mesh, body: body, t: 0, life: 2.6 });
    };

    var crumbGeo = new THREE.BoxGeometry(0.5, 0.4, 0.5);
    W.crumbs = function (li, count, impact) {
      var L = W.cake.layers[li];
      var cols = [L.style.side, L.style.inside, L.style.top];
      for (var i = 0; i < count; i++) {
        var m = new THREE.Mesh(crumbGeo, new THREE.MeshStandardMaterial({ color: cols[i % 3], roughness: 0.7 }));
        var s = 0.5 + Math.random() * 0.9;
        m.scale.set(s, s, s);
        m.castShadow = true;
        var a = Math.random() * Math.PI * 2, rr = L.r * (0.3 + Math.random() * 0.7);
        var x = CAKE_X + Math.cos(a) * rr, z = CAKE_Z + Math.sin(a) * rr, y = L.y0 + L.h * L.group.scale.y;
        m.position.set(x, y, z);
        scene.add(m);
        var b = new CANNON.Body({ mass: 0.2, collisionFilterGroup: G.CHUNK, collisionFilterMask: G.FLOOR | G.TABLE | G.CAKE });
        b.addShape(new CANNON.Box(new CANNON.Vec3(0.25 * s, 0.2 * s, 0.25 * s)));
        b.position.set(x, y + 0.3, z);
        var sp = 5 + Math.random() * 9;
        b.velocity.set(Math.cos(a) * sp, 6 + Math.random() * 10, Math.sin(a) * sp);
        b.angularVelocity.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
        world.addBody(b);
        W.fx.push({ type: 'chunk', mesh: m, body: b, t: 0, life: 1.8 + Math.random() });
      }
    };

    W.squash = function (li) {
      W.fx.push({ type: 'squash', layer: W.cake.layers[li], t: 0, life: 0.5 });
      if (W.cake.coat) W.fx.push({ type: 'wobble', mesh: W.cake.coat, t: 0, life: 0.9 });
    };

    W.popCoat = function () {
      var coat = W.cake.coat;
      if (!coat) return;
      W.cake.coat = null;
      var col = coat.material.color.clone();
      coat.parent.remove(coat);
      for (var i = 0; i < 18; i++) {
        var m = new THREE.Mesh(new THREE.SphereGeometry(0.5 + Math.random() * 0.6, 8, 6), new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.55, roughness: 0.05 }));
        var a = Math.random() * Math.PI * 2;
        m.position.set(CAKE_X + Math.cos(a) * 6, 2 + Math.random() * 6, CAKE_Z + Math.sin(a) * 6);
        scene.add(m);
        var b = new CANNON.Body({ mass: 0.3, collisionFilterGroup: G.CHUNK, collisionFilterMask: G.FLOOR | G.TABLE });
        b.addShape(new CANNON.Sphere(0.5));
        b.position.copy(m.position);
        b.velocity.set(Math.cos(a) * 12, 8 + Math.random() * 8, Math.sin(a) * 12);
        world.addBody(b);
        W.fx.push({ type: 'chunk', mesh: m, body: b, t: 0, life: 1.6 });
      }
    };

    /* --- 효과 --- */
    var puffTex = (function () {
      var c = document.createElement('canvas');
      c.width = c.height = 64;
      var x = c.getContext('2d');
      var g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    W.puff = function (x, y, z, n, color) {
      for (var i = 0; i < n; i++) {
        var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: color || 0xfff6ee, transparent: true, opacity: 0.85, depthWrite: false }));
        sp.position.set(x, y, z);
        sp.scale.set(2, 2, 2);
        scene.add(sp);
        var a = Math.random() * Math.PI * 2;
        W.fx.push({ type: 'puff', mesh: sp, v: new THREE.Vector3(Math.cos(a) * (4 + Math.random() * 6), 1 + Math.random() * 3, Math.sin(a) * (4 + Math.random() * 6)), t: 0, life: 0.7 + Math.random() * 0.3 });
      }
    };
    W.sparkle = function (x, y, z, color, n) {
      for (var i = 0; i < (n || 6); i++) {
        var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: color || 0xffffff, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
        sp.position.set(x, y, z);
        sp.scale.set(0.8, 0.8, 0.8);
        scene.add(sp);
        var a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
        W.fx.push({ type: 'puff', mesh: sp, v: new THREE.Vector3(Math.cos(a) * 6, 3 + e * 5, Math.sin(a) * 6), t: 0, life: 0.5 });
      }
    };
    var confGeo = new THREE.PlaneGeometry(0.5, 0.3);
    W.confetti = function (n) {
      var cols = [0xff6f91, 0xffb627, 0x57c4a4, 0x7cc6ff, 0xc3adff];
      for (var i = 0; i < n; i++) {
        var m = new THREE.Mesh(confGeo, new THREE.MeshBasicMaterial({ color: cols[i % 5], side: THREE.DoubleSide }));
        m.position.set((Math.random() - 0.5) * TW, 18 + Math.random() * 14, (Math.random() - 0.5) * TD);
        scene.add(m);
        W.fx.push({ type: 'conf', mesh: m, v: new THREE.Vector3((Math.random() - 0.5) * 3, -6 - Math.random() * 6, (Math.random() - 0.5) * 3), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), t: 0, life: 3.5 });
      }
    };

    W.updateFx = function (dt) {
      for (var i = W.fx.length - 1; i >= 0; i--) {
        var f = W.fx[i];
        f.t += dt;
        var k = f.t / f.life;
        if (f.type === 'chunk') {
          f.mesh.position.copy(f.body.position);
          f.mesh.quaternion.copy(f.body.quaternion);
          if (k > 0.75) {
            var s = Math.max(0.01, 1 - (k - 0.75) / 0.25);
            f.mesh.scale.setScalar(s);
          }
        } else if (f.type === 'puff') {
          f.mesh.position.addScaledVector(f.v, dt);
          f.mesh.material.opacity = 0.85 * (1 - k);
          var sc = 2 + k * 3;
          f.mesh.scale.set(sc, sc, sc);
        } else if (f.type === 'conf') {
          f.mesh.position.addScaledVector(f.v, dt);
          f.mesh.rotation.x += f.spin.x * dt;
          f.mesh.rotation.y += f.spin.y * dt;
        } else if (f.type === 'squash') {
          var a = Math.exp(-f.t * 9) * Math.cos(f.t * 26);
          var base = 1 - 0.18 * f.layer.crack;
          f.layer.group.scale.set(1 + 0.08 * a, base * (1 - 0.18 * a), 1 + 0.08 * a);
          if (k >= 1) f.layer.group.scale.set(1, base, 1);
        } else if (f.type === 'wobble') {
          var w = Math.exp(-f.t * 5) * Math.sin(f.t * 30) * 0.08;
          f.mesh.scale.set(1 + w, 1 - w, 1 + w);
        }
        if (k >= 1) {
          if (f.body) world.removeBody(f.body);
          if (f.mesh && f.type !== 'squash' && f.type !== 'wobble') scene.remove(f.mesh);
          W.fx.splice(i, 1);
        }
      }
      // 촛불 깜빡임
      if (W.cake) W.cake.layers.forEach(function (l) {
        l.toppings.forEach(function (t) { if (t.userData.flame) t.scale.y = 1.6 * (1 + Math.sin(performance.now() / 70 + t.id) * 0.12); });
      });
    };

    W.clearFx = function () {
      W.fx.forEach(function (f) {
        if (f.body) world.removeBody(f.body);
        if (f.mesh && f.type !== 'squash' && f.type !== 'wobble') scene.remove(f.mesh);
      });
      W.fx = [];
    };

    /** 덩어리 아래 그림자: 높을수록 크고 옅게. 케이크 위면 케이크 윗면에 */
    W.setBlob = function (pos, r) {
      if (!pos) { blob.visible = false; return; }
      var onCake = W.cake && Math.hypot(pos.x - CAKE_X, pos.z - CAKE_Z) < W.cake.style.r * W.cake.scale && W.cake.topY > 0.3;
      var gy = onCake ? W.cake.topY + 0.06 : 0.04;
      var h = Math.max(0, pos.y - r - gy);
      blob.visible = true;
      blob.position.set(pos.x, gy, pos.z);
      blob.scale.setScalar(r * (1 + h * 0.04));
      blob.material.opacity = 0.42 / (1 + h * 0.18);
    };

    W.render = function () {
      if (W.shake > 0.02) {
        camera.position.set(camBase.x + (Math.random() - 0.5) * W.shake, camBase.y + (Math.random() - 0.5) * W.shake, camBase.z + (Math.random() - 0.5) * W.shake);
      } else camera.position.copy(camBase);
      renderer.render(scene, camera);
    };

    return W;
  }

  root.MKWorld = { create: create, CAKES: CAKES, MAT_LOOK: MAT_LOOK, IS: IS };
})(window);
