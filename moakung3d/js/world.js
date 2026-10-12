/*
 * 모아쿵! 3D — 장면·물리·케이크·재료·연출 (three.js + cannon-es)
 *
 * 가설: ① 아이소메트릭(45°/34°) 정사영 디오라마 → 높이·공간감
 *       ② 케이크를 고리×부채꼴 조각으로 미리 쪼개고 "맞은 지점에서 가까운 조각부터, 깎인 몸체 비율만큼만" 떼어내면
 *          낙하 위치에 맞는 국소 파괴가 되면서도 연출 = 남은 몸체 수치가 유지된다
 *       ③ 두툼한 금속 부품 + 스튜디오 반사 + 히트스톱·충격파·펀치 → 소재감·속도감·무게감
 *  - 판정은 rules.js, 물리는 움직임만. 잃을 재료는 충돌 순간 확정되어 받침대 밖 허공으로 떨어진다.
 *  - 케이크 모양은 buildCake() 한 곳 (Meshy GLB 는 buildModelCake 가 같은 조각 구조로 분할).
 */
(function (root) {
  'use strict';
  var THREE = root.THREE, CANNON = root.CANNON;

  /* ---------------- 치수 (월드 단위) ---------------- */
  var RT = 13.2;                   // 둥근 케이크 스탠드 접시 안쪽 반지름
  var TW = RT * 2, TD = RT * 2;    // 격자 계산용 바깥 사각형
  var RIM_H = 1.0;                 // 접시 테두리 높이
  var CAKE_X = -1.6, CAKE_Z = -1.6; // 케이크 자리 (조금 안쪽 = 화면 위쪽)
  var GRAVITY = -80;
  var YAW = Math.PI / 4, PITCH = (34 * Math.PI) / 180;
  var VOID_Y = -30;                // 이 아래로 떨어진 조각은 사라짐
  var FALL_Y = -14;                // 쟁반 밖으로 나간 재료가 작아지며 사라지기 시작하는 높이
  var G = { FLOOR: 1, WALL: 2, ITEM: 4, CAKE: 8, CHUNK: 16, TABLE: 32, LOST: 64, CLUMP: 128 };

  /* ================================================================
   * 재료: 두툼한 금속 부품 · 젤리 · 자개 · 단추 · 별
   * ============================================================== */
  // 금속 부품(nut) 변형: 0 육각너트(은) 1 볼트(은) 2 구리 부싱 3 황동 너트
  var NUT_KIND = ['hexnut', 'bolt', 'bushing', 'brassnut'];
  var JELLY = ['#ff5f9e', '#4fd36a', '#ffa23a', '#8f6bff'];
  var BUTTON = ['#7fd8c0', '#ff8f7a', '#b9a3ff', '#ffd36a'];
  var STAR = ['#ffc23a', '#ff8fbf', '#73c2ff'];

  function hexShape(r) {
    var s = new THREE.Shape();
    for (var i = 0; i < 6; i++) {
      var a = (i * Math.PI) / 3 + Math.PI / 6;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    return s;
  }
  function holePath(r, x, y) {
    var h = new THREE.Path();
    h.absarc(x || 0, y || 0, r, 0, Math.PI * 2, true);
    return h;
  }
  function flat(geo, depth) { geo.rotateX(-Math.PI / 2); geo.translate(0, -depth / 2, 0); return geo; }
  function starShape(ro, ri) {
    var s = new THREE.Shape();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? ri : ro, a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    return s;
  }
  function mergeGeos(list) {
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

  var geoCache = {}, matCache = {};
  function itemShapeKey(mat, v) { return mat === 'nut' ? NUT_KIND[v % 4] : mat === 'pearl' ? 'pearl' + (v % 2) : mat; }
  function itemGeometry(mat, v) {
    var key = itemShapeKey(mat, v);
    if (geoCache[key]) return geoCache[key];
    var g, bev = { bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 18 };
    switch (key) {
      case 'steel': g = new THREE.SphereGeometry(0.74, 28, 20); break;
      case 'hexnut':
      case 'brassnut': {
        var s = hexShape(0.86);
        s.holes.push(holePath(0.38));
        g = flat(new THREE.ExtrudeGeometry(s, Object.assign({ depth: 0.5 }, bev)), 0.5);
        break;
      }
      case 'bolt': {
        var head = flat(new THREE.ExtrudeGeometry(hexShape(0.72), Object.assign({ depth: 0.42 }, bev)), 0.42);
        head.translate(0, 0.35, 0);
        var shaft = new THREE.CylinderGeometry(0.32, 0.32, 1.1, 16);
        shaft.translate(0, -0.35, 0);
        var parts = [head, shaft];
        for (var t = 0; t < 4; t++) { var th = new THREE.TorusGeometry(0.33, 0.05, 6, 16); th.rotateX(Math.PI / 2); th.translate(0, -0.1 - t * 0.22, 0); parts.push(th); }
        g = mergeGeos(parts);
        g.rotateZ(Math.PI / 2); // 옆으로 누운 볼트
        break;
      }
      case 'bushing': {
        var bs = new THREE.Shape();
        bs.absarc(0, 0, 0.72, 0, Math.PI * 2, false);
        bs.holes.push(holePath(0.36));
        g = flat(new THREE.ExtrudeGeometry(bs, Object.assign({ depth: 0.8 }, bev)), 0.8);
        break;
      }
      case 'jelly': {
        var parts2 = [];
        var body = new THREE.SphereGeometry(0.6, 16, 12); body.scale(1, 1.15, 0.78); body.translate(0, -0.15, 0); parts2.push(body);
        var hd = new THREE.SphereGeometry(0.44, 14, 10); hd.translate(0, 0.6, 0); parts2.push(hd);
        [[-0.32, 0.95], [0.32, 0.95]].forEach(function (p) { var e = new THREE.SphereGeometry(0.17, 10, 8); e.translate(p[0], p[1], 0); parts2.push(e); });
        [[-0.62, 0.05], [0.62, 0.05], [-0.36, -0.82], [0.36, -0.82]].forEach(function (p) { var e = new THREE.SphereGeometry(0.22, 10, 8); e.scale(1, 1.2, 1); e.translate(p[0], p[1], 0); parts2.push(e); });
        g = mergeGeos(parts2);
        g.rotateX(-Math.PI / 2);
        break;
      }
      case 'star':
        g = flat(new THREE.ExtrudeGeometry(starShape(0.95, 0.42), Object.assign({ depth: 0.34 }, bev)), 0.34);
        break;
      case 'button': {
        var b = new THREE.Shape();
        b.absarc(0, 0, 0.82, 0, Math.PI * 2, false);
        [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]].forEach(function (p) { b.holes.push(holePath(0.09, p[0], p[1])); });
        g = flat(new THREE.ExtrudeGeometry(b, { depth: 0.22, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 3, curveSegments: 24 }), 0.22);
        break;
      }
      default: { // 자개 조각 2종
        var ps = new THREE.Shape();
        var pts = key === 'pearl0'
          ? [[-0.9, -0.2], [-0.35, -0.8], [0.5, -0.72], [0.92, 0.08], [0.38, 0.82], [-0.66, 0.62]]
          : [[-0.85, -0.6], [0.15, -0.95], [0.9, -0.3], [0.7, 0.75], [-0.25, 0.9], [-0.95, 0.25]];
        pts.forEach(function (p, i) { if (i) ps.lineTo(p[0], p[1]); else ps.moveTo(p[0], p[1]); });
        ps.closePath();
        g = flat(new THREE.ExtrudeGeometry(ps, { depth: 0.14, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.05, bevelSegments: 2 }), 0.14);
      }
    }
    g.computeVertexNormals();
    geoCache[key] = g;
    return g;
  }
  function itemMaterial(mat, v) {
    var key = mat + ':' + (mat === 'nut' ? NUT_KIND[v % 4] : v % 4);
    if (matCache[key]) return matCache[key];
    var m;
    switch (mat) {
      case 'steel': m = new THREE.MeshStandardMaterial({ color: v % 2 ? 0xc9d0da : 0xe6ebf2, metalness: 1, roughness: v % 2 ? 0.26 : 0.12, envMapIntensity: 1.3 }); break;
      case 'nut': {
        var k = NUT_KIND[v % 4];
        var col = k === 'bushing' ? 0xd0814e : k === 'brassnut' ? 0xe0bb5e : 0xcfd6df;
        m = new THREE.MeshStandardMaterial({ color: col, metalness: 1, roughness: k === 'bolt' ? 0.3 : 0.22, envMapIntensity: 1.25 });
        break;
      }
      case 'jelly':
        m = new THREE.MeshPhysicalMaterial({ color: JELLY[v % 4], roughness: 0.18, metalness: 0, transparent: true, opacity: 0.86, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), emissive: new THREE.Color(JELLY[v % 4]).multiplyScalar(0.18) });
        break;
      case 'pearl':
        m = new THREE.MeshPhysicalMaterial({ color: 0xfdf7ff, roughness: 0.16, metalness: 0.15, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.45, iridescenceThicknessRange: [150, 650] });
        break;
      case 'button':
        m = new THREE.MeshPhysicalMaterial({ color: BUTTON[v % 4], roughness: 0.38, clearcoat: 0.9, clearcoatRoughness: 0.15 });
        break;
      case 'star':
        m = new THREE.MeshStandardMaterial({ color: STAR[v % 3], metalness: v % 3 === 0 ? 0.9 : 0.55, roughness: 0.22, envMapIntensity: 1.2 });
        break;
    }
    matCache[key] = m;
    return m;
  }
  /** 덩어리 안 자리 잡기용 대략 반지름 */
  var ITEM_R = { steel: 0.74, nut: 0.8, jelly: 0.75, star: 0.85, button: 0.82, pearl: 0.85 };

  /* ================================================================
   * 케이크 스타일 (기본 도형) — 블렌더/Meshy 모델로 교체할 자리
   * ============================================================== */
  var CAKES = {
    pudding:    { r: 5.0, layers: [{ h: 4.6, side: '#ffd264', inside: '#ffe7a6', top: '#a5541b', taper: 0.72, gloss: 0.25 }], toppings: 'cherry' },
    mousse:     { r: 5.2, layers: [{ h: 4.4, side: '#ffe14d', inside: '#fff6c8', top: '#ffe45c', taper: 0.6, gloss: 0.08 }], toppings: 'mint' },
    shortcake:  { r: 5.8, layers: [{ h: 5.0, side: '#fffaf3', inside: '#ffe7a3', top: '#fffdf8', bands: ['#fffaf3', '#ff9fae', '#fffaf3', '#ffe7a3', '#fffaf3'] }], toppings: 'strawberry' },
    choco:      { r: 5.6, layers: [{ h: 5.2, side: '#4b2416', inside: '#7a4428', top: '#2e140b', gloss: 0.15 }], toppings: 'raspberry' },
    macaron:    { r: 4.6, layers: [{ h: 8.0, side: '#ffb3c7', inside: '#fff3e6', top: '#ffd1dc', taper: 0.32, bands: ['#ffb3c7', '#b8f0d8', '#d6c4ff', '#fff0a6', '#ffcfa8', '#ffb3c7', '#b8f0d8', '#d6c4ff'] }], toppings: 'bow' },
    cheesecake: { r: 5.6, layers: [{ h: 4.4, side: '#fbe6bf', inside: '#fff1d6', top: '#99194d', bands: ['#c08a52', '#fbe6bf', '#fbe6bf', '#fbe6bf', '#e0ad5c'] }], toppings: 'blueberry' },
    crepe:      { r: 5.6, layers: [
      { h: 2.7, side: '#ffd6a5', inside: '#ffe2b8', top: '#f7d9a8', bands: ['#ffb3ba', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#bdb2ff'] },
      { h: 2.7, side: '#ffd6a5', inside: '#ffe2b8', top: '#f7d9a8', bands: ['#bdb2ff', '#ffc6ff', '#ffb3ba', '#ffd6a5', '#fdffb6', '#caffbf'] }], toppings: 'berries' },
    tiered:     { r: 6.0, layers: [
      { h: 3.0, side: '#ffffff', inside: '#ffe7a3', top: '#ffffff', rs: 1.0, bands: ['#ffffff', '#ff9fb8', '#ffffff'] },
      { h: 2.8, side: '#ffe0e8', inside: '#ffe7a3', top: '#ffe0e8', rs: 0.76, bands: ['#ffe0e8', '#ffffff', '#ffe0e8'] },
      { h: 2.6, side: '#dff7ee', inside: '#ffe7a3', top: '#ff9dbb', rs: 0.54, bands: ['#dff7ee', '#ffb3c7', '#dff7ee'] }], toppings: 'candles' },
    crown:      { r: 5.9, layers: [
      { h: 2.6, side: '#e9b872', inside: '#4a2414', top: '#2a1209', bands: ['#d99a4e', '#f4cd8d', '#d99a4e'] },
      { h: 3.0, side: '#ffcf3a', inside: '#c98a0c', top: '#ffe27a', rs: 0.42, metal: 0.7, gloss: 0.2 }], toppings: 'jewels' }
  };

  // 조각 격자: 고리 경계(반지름 비율)와 고리별 부채꼴 수
  var RINGS = [0, 0.42, 0.75, 1.0];
  var SECTORS = [5, 9, 13];

  /** 고리 부채꼴 조각 (r0~r1, a0~a1, 높이 h). 겉면/속살/윗면을 정점 색으로 칠한다 */
  function chunkGeometry(r0, r1, a0, a1, h, st, R) {
    var shape = new THREE.Shape();
    var segs = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 64));
    for (var i = 0; i <= segs; i++) {
      var a = a0 + ((a1 - a0) * i) / segs;
      if (i === 0) shape.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); else shape.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    }
    if (r0 > 0.01) {
      for (var j = segs; j >= 0; j--) {
        var b = a0 + ((a1 - a0) * j) / segs;
        shape.lineTo(Math.cos(b) * r0, Math.sin(b) * r0);
      }
    } else shape.lineTo(0, 0);
    shape.closePath();
    var g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 6, steps: st.bands ? st.bands.length : 1 });
    g.rotateX(-Math.PI / 2); // shape (x, y) → 월드 (x, -z), 위로 쌓임
    if (g.index) g = g.toNonIndexed();
    var taper = st.taper == null ? 1 : st.taper;
    var pos = g.attributes.position;
    for (var k = 0; k < pos.count; k++) {
      var s = 1 + (taper - 1) * (pos.getY(k) / h);
      pos.setX(k, pos.getX(k) * s);
      pos.setZ(k, pos.getZ(k) * s);
    }
    g.computeVertexNormals();
    var nor = g.attributes.normal, col = new Float32Array(pos.count * 3);
    var cSide = new THREE.Color(st.side), cIn = new THREE.Color(st.inside), cTop = new THREE.Color(st.top);
    var bands = st.bands ? st.bands.map(function (c) { return new THREE.Color(c); }) : null;
    for (var t = 0; t < pos.count; t += 3) {
      var cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
      for (var q = 0; q < 3; q++) {
        cx += pos.getX(t + q); cy += pos.getY(t + q); cz += pos.getZ(t + q);
        nx += nor.getX(t + q); ny += nor.getY(t + q); nz += nor.getZ(t + q);
      }
      cx /= 3; cy /= 3; cz /= 3;
      var nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      var c;
      var rr = Math.sqrt(cx * cx + cz * cz), rAt = R * (1 + (taper - 1) * (cy / h));
      if (ny > 0.6) c = cTop;
      else if (ny < -0.6) c = cIn;
      else if ((nx * cx + nz * cz) / (rr || 1) > 0.5 && rr > rAt * 0.96) c = bands ? bands[Math.min(bands.length - 1, Math.floor((cy / h) * bands.length))] : cSide;
      else c = cIn;
      for (var p = 0; p < 3; p++) { col[(t + p) * 3] = c.r; col[(t + p) * 3 + 1] = c.g; col[(t + p) * 3 + 2] = c.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }

  /* ================================================================
   * 월드 생성
   * ============================================================== */
  function create(canvas) {
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, root.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    var scene = new THREE.Scene();
    var camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 600);
    var camDir = new THREE.Vector3(Math.sin(YAW) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(YAW) * Math.cos(PITCH)).normalize();
    var camBase = new THREE.Vector3(), camLook = new THREE.Vector3();
    var camRight = new THREE.Vector3(), camUp = new THREE.Vector3();

    // 빛: 왼쪽 위에서 오는 부드러운 햇빛 + 하늘/바닥 반사
    scene.add(new THREE.HemisphereLight(0xfff2f6, 0xc9b0e0, 0.95));
    var sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-18, 40, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -22; sun.shadow.camera.right = 22;
    sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
    sun.shadow.camera.near = 5; sun.shadow.camera.far = 140;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);
    var rim = new THREE.DirectionalLight(0xffd6ec, 0.65);
    rim.position.set(20, 18, -14);
    scene.add(rim);

    // 금속 반사용 스튜디오 환경 (소프트박스 여러 장 + 분홍·보라 그라디언트)
    var pmrem = new THREE.PMREMGenerator(renderer);
    var envScene = new THREE.Scene();
    var envGeo = new THREE.SphereGeometry(60, 24, 12);
    var envCols = new Float32Array(envGeo.attributes.position.count * 3);
    for (var ei = 0; ei < envGeo.attributes.position.count; ei++) {
      var ey = envGeo.attributes.position.getY(ei) / 60;
      var ec = new THREE.Color().setHSL(0.86 - ey * 0.08, 0.45, 0.42 + ey * 0.4);
      envCols[ei * 3] = ec.r; envCols[ei * 3 + 1] = ec.g; envCols[ei * 3 + 2] = ec.b;
    }
    envGeo.setAttribute('color', new THREE.BufferAttribute(envCols, 3));
    envScene.add(new THREE.Mesh(envGeo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
    [[0, 50, 0, 40, 1.6], [-45, 20, 20, 22, 1.2], [40, 25, -25, 18, 0.9], [20, 10, 45, 14, 0.7]].forEach(function (b) {
      var box = new THREE.Mesh(new THREE.PlaneGeometry(b[3], b[3]), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(b[4]), side: THREE.DoubleSide }));
      box.position.set(b[0], b[1], b[2]);
      box.lookAt(0, 0, 0);
      envScene.add(box);
    });
    scene.environment = pmrem.fromScene(envScene, 0.015).texture;

    /* --- 물리 --- */
    var world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
    world.allowSleep = true;
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = 9;
    world.defaultContactMaterial.friction = 0.42;
    world.defaultContactMaterial.restitution = 0.2;
    function staticBox(hx, hy, hz, x, y, z, group, mask) {
      var b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: group, collisionFilterMask: mask });
      b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
      b.position.set(x, y, z);
      world.addBody(b);
      return b;
    }

    /* --- 공중에 뜬 케이크 스탠드: 둥근 접시 + 기둥 + 계단식 사각 받침 (모뉴먼트 밸리식 높이감) --- */
    function std(color, rough) { return new THREE.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.5 : rough }); }
    function addMesh(geo, mat, x, y, z, cast) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(x || 0, y || 0, z || 0);
      m.receiveShadow = true;
      m.castShadow = !!cast;
      scene.add(m);
      return m;
    }
    // 접시 윗면(민트 도자기) · 분홍 테두리 · 아랫면
    addMesh(new THREE.CylinderGeometry(RT + 0.9, RT + 0.6, 0.9, 96), std(0xd2efe4, 0.34), 0, -0.45, 0, true);
    var lip = addMesh(new THREE.TorusGeometry(RT + 0.5, 0.5, 14, 120), std(0xff9fbb, 0.35), 0, 0.5, 0, true);
    lip.rotation.x = Math.PI / 2;
    addMesh(new THREE.CylinderGeometry(RT + 0.6, 3.2, 1.5, 96), std(0xffeef3, 0.45), 0, -1.65, 0, true);
    // 기둥 (가운데가 잘록한 받침대)
    var stemPts = [[0, -2.3], [3.0, -2.3], [2.0, -3.0], [1.6, -4.5], [1.45, -10], [1.6, -14.6], [2.2, -15.9], [3.4, -16.7], [3.9, -17], [0, -17]].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
    addMesh(new THREE.LatheGeometry(stemPts, 40), std(0xd9c6f2, 0.42), 0, 0, 0, true);
    [[-5.6, 0x8fd9c4], [-9.8, 0xff9fbb], [-13.6, 0x8fd9c4]].forEach(function (rg) {
      addMesh(new THREE.TorusGeometry(1.62, 0.32, 10, 32), std(rg[1], 0.4), 0, rg[0], 0, true).rotation.x = Math.PI / 2;
    });
    // 계단식 사각 받침 (아이소 뷰에서 마름모)
    addMesh(new THREE.BoxGeometry(10.4, 1.2, 10.4), std(0xffc9b5, 0.6), 0, -17.6, 0, true);
    addMesh(new THREE.BoxGeometry(10.6, 0.32, 10.6), std(0x8fd9c4, 0.5), 0, -18.32, 0);
    addMesh(new THREE.BoxGeometry(7.8, 2.0, 7.8), std(0xff9f9a, 0.6), 0, -19.48, 0, true);
    addMesh(new THREE.BoxGeometry(4.8, 1.6, 4.8), std(0xd9c6f2, 0.6), 0, -21.28, 0, true);
    addMesh(new THREE.ConeGeometry(2.0, 2.2, 4, 1), std(0xffc9b5, 0.6), 0, -23.18, 0).rotation.set(Math.PI, Math.PI / 4, 0);

    // 물리: 접시 바닥(원기둥) + 테두리 고리(상자 36개) + 남길 재료만 막는 보이지 않는 벽
    var floorBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: G.FLOOR, collisionFilterMask: G.ITEM | G.CHUNK | G.CLUMP });
    floorBody.addShape(new CANNON.Cylinder(RT + 0.9, RT + 0.6, 0.9, 32));
    floorBody.position.set(0, -0.45, 0);
    world.addBody(floorBody);
    var SEG = 36, segHalf = (Math.PI * (RT + 0.5)) / SEG + 0.12;
    for (var si = 0; si < SEG; si++) {
      var a = (si / SEG) * Math.PI * 2, rx = Math.cos(a) * (RT + 0.5), rz = Math.sin(a) * (RT + 0.5);
      [[0.5, 0.6, 0.6, G.FLOOR, G.ITEM | G.CHUNK | G.CLUMP], [0.5, 30, 30, G.WALL, G.ITEM]].forEach(function (w) {
        var b = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: w[3], collisionFilterMask: w[4] });
        b.addShape(new CANNON.Box(new CANNON.Vec3(w[0], w[1], segHalf)));
        b.position.set(rx, w[2], rz);
        b.quaternion.setFromEuler(0, -a, 0);
        world.addBody(b);
      });
    }

    /* --- 붓 링, 과녁, 그림자 --- */
    function flatMesh(geo, color, opacity) {
      var m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      return m;
    }
    var brush = flatMesh(new THREE.RingGeometry(1, 1.1, 48), 0xff5f87, 0.85);
    var brushFill = flatMesh(new THREE.CircleGeometry(1, 48), 0xff8fab, 0.16);
    var blob = flatMesh(new THREE.CircleGeometry(1, 32), 0x4a1f2a, 0.35);
    var reticle = new THREE.Group();
    var retMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false });
    var retRing = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40), retMat);
    var retDot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), retMat);
    var retCross = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 4, 1, Math.PI / 4), retMat);
    [retRing, retDot, retCross].forEach(function (m) { m.rotation.x = -Math.PI / 2; m.renderOrder = 5; reticle.add(m); });
    reticle.visible = false;
    scene.add(reticle);

    var W = {
      THREE: THREE, CANNON: CANNON, renderer: renderer, scene: scene, camera: camera, world: world, G: G,
      TW: TW, TD: TD, TRAY_R: RT, RIM_H: RIM_H, CAKE_X: CAKE_X, CAKE_Z: CAKE_Z, VOID_Y: VOID_Y, TABLE_Y: FALL_Y,
      brush: brush, brushFill: brushFill, blob: blob, reticle: reticle,
      shake: 0, punch: 0, cake: null, fx: [], ITEM_R: ITEM_R,
      raycaster: new THREE.Raycaster(), ndc: new THREE.Vector2()
    };

    /* --- 카메라: 아이소메트릭 정사영, 쟁반 + 머리 위 낙하 공간이 화면에 맞게 --- */
    var fitPts = [];
    for (var fa = 0; fa < 24; fa++) {
      var ca = Math.cos((fa / 24) * Math.PI * 2), sa = Math.sin((fa / 24) * Math.PI * 2);
      fitPts.push(new THREE.Vector3(ca * (RT + 1.0), RIM_H, sa * (RT + 1.0)));
      fitPts.push(new THREE.Vector3(ca * (RT + 0.9), -0.9, sa * (RT + 0.9)));
    }
    fitPts.push(new THREE.Vector3(0, -24.3, 0)); // 받침 맨 아래 끝
    fitPts.push(new THREE.Vector3(CAKE_X, 22, CAKE_Z)); // 덩어리가 올라가는 높이
    W.resize = function (w, h) {
      renderer.setSize(w, h, false);
      var aspect = w / h;
      camLook.set(0, 0, 0);
      camera.position.copy(camLook).addScaledVector(camDir, 200);
      camera.up.set(0, 1, 0);
      camera.lookAt(camLook);
      camera.left = -1; camera.right = 1; camera.top = 1; camera.bottom = -1;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      var inv = camera.matrixWorldInverse;
      var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      fitPts.forEach(function (p) {
        var q = p.clone().applyMatrix4(inv);
        minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x);
        minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y);
      });
      var halfW = (maxX - minX) / 2 + 0.8, halfH = (maxY - minY) / 2 + 1.2;
      if (halfW / halfH > aspect) halfH = halfW / aspect; else halfW = halfH * aspect;
      var cxv = (minX + maxX) / 2, cyv = (minY + maxY) / 2;
      // 세로로 남는 공간은 아래(받침대 쪽)보다 위(낙하 공간)에 조금 더
      var spareY = halfH - ((maxY - minY) / 2 + 1.2);
      cyv -= spareY * 0.25;
      camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      camUp.setFromMatrixColumn(camera.matrixWorld, 1);
      camera.position.addScaledVector(camRight, cxv).addScaledVector(camUp, cyv);
      camera.left = -halfW; camera.right = halfW; camera.top = halfH; camera.bottom = -halfH;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      camBase.copy(camera.position);
      W.pxPerUnit = h / (halfH * 2);
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
      return Math.hypot(x, z) <= RT - pad;
    };

    /* ================= 재료 ================= */
    W.makeItem = function (it) {
      var mesh = new THREE.Mesh(itemGeometry(it.mat, it.v), itemMaterial(it.mat, it.v));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      it.mesh = mesh;
      it.body = null;
      W.addItemBody(it, it.x, 1.0, it.z);
      return it;
    };
    W.itemShape = function (mat, v) {
      var k = itemShapeKey(mat, v);
      if (k === 'steel') return new CANNON.Sphere(0.74);
      if (k === 'jelly') return new CANNON.Sphere(0.72);
      if (k === 'bolt') return new CANNON.Box(new CANNON.Vec3(0.88, 0.62, 0.62));
      if (k === 'bushing') return new CANNON.Cylinder(0.75, 0.75, 0.9, 10);
      if (k === 'hexnut' || k === 'brassnut') return new CANNON.Cylinder(0.86, 0.86, 0.6, 6);
      if (k === 'button') return new CANNON.Cylinder(0.84, 0.84, 0.36, 10);
      if (k === 'star') return new CANNON.Cylinder(0.85, 0.85, 0.42, 10);
      return new CANNON.Cylinder(0.85, 0.85, 0.26, 8);
    };
    W.bouncy = new CANNON.Material('jelly');
    W.metal = new CANNON.Material('metal');
    world.addContactMaterial(new CANNON.ContactMaterial(W.bouncy, world.defaultMaterial, { friction: 0.3, restitution: 0.55 }));
    world.addContactMaterial(new CANNON.ContactMaterial(W.metal, world.defaultMaterial, { friction: 0.32, restitution: 0.3 }));
    W.addItemBody = function (it, x, y, z, lost) {
      if (it.body) world.removeBody(it.body);
      var w = root.MKRules.MATERIALS[it.mat].weight;
      var b = new CANNON.Body({
        mass: it.mat === 'jelly' ? 0.7 : w * 1.2,
        collisionFilterGroup: lost ? G.LOST : G.ITEM,
        collisionFilterMask: lost ? 0 : (G.FLOOR | G.WALL | G.ITEM | G.CAKE | G.CHUNK),
        linearDamping: 0.1, angularDamping: 0.28, allowSleep: true, sleepSpeedLimit: 0.45, sleepTimeLimit: 0.3
      });
      b.addShape(W.itemShape(it.mat, it.v));
      b.position.set(x, y, z);
      b.quaternion.setFromEuler(0, it.rot || 0, 0);
      b.material = it.mat === 'jelly' ? W.bouncy : w > 1 ? W.metal : world.defaultMaterial;
      world.addBody(b);
      it.body = b;
      return b;
    };
    W.removeItemBody = function (it) { if (it.body) { world.removeBody(it.body); it.body = null; } };

    /* ================= 케이크 ================= */
    var cakeMats = [];
    function newCakeMat(opts) { var m = new THREE.MeshStandardMaterial(opts); cakeMats.push(m); return m; }

    W.buildCake = function (level, scale, model) {
      if (W.cake) W.disposeCake();
      if (model) return buildModelCake(level, model);
      var st = CAKES[level.kind];
      var s = scale || 1;
      var group = new THREE.Group();
      group.position.set(CAKE_X, 0, CAKE_Z);
      scene.add(group);
      addDoily(group, st.r * s);
      var n = level.layers.length, layers = [], y = 0.14;
      for (var bi = 0; bi < n; bi++) {
        var ls = st.layers[Math.min(bi, st.layers.length - 1)];
        var dataIdx = n - 1 - bi; // 아래층 = 데이터의 마지막
        var R = st.r * s * (ls.rs || 1), h = ls.h * s;
        var armor = level.layers[dataIdx].armor;
        var mat = newCakeMat({ vertexColors: true, roughness: ls.gloss != null ? ls.gloss : armor >= 10 ? 0.3 : 0.6, metalness: ls.metal || 0 });
        var lg = new THREE.Group();
        lg.position.y = y;
        group.add(lg);
        var chunks = [];
        for (var ri = 0; ri < RINGS.length - 1; ri++) {
          var r0 = RINGS[ri] * R, r1 = RINGS[ri + 1] * R, ns = SECTORS[ri];
          var off = ri * 0.37;
          for (var si = 0; si < ns; si++) {
            var a0 = off + (si / ns) * Math.PI * 2, a1 = off + ((si + 1) / ns) * Math.PI * 2;
            var geo = chunkGeometry(r0, r1, a0, a1, h, ls, R);
            var m = new THREE.Mesh(geo, mat);
            m.castShadow = true;
            m.receiveShadow = true;
            var mid = (a0 + a1) / 2, rm = (r0 + r1) / 2;
            m.userData = { own: true, ring: ri, local: new THREE.Vector3(Math.cos(mid) * rm, h, -Math.sin(mid) * rm), vol: (r1 * r1 - r0 * r0) * (a1 - a0) };
            lg.add(m);
            chunks.push(m);
          }
        }
        var taper = ls.taper == null ? 1 : ls.taper;
        var body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: G.CAKE, collisionFilterMask: G.ITEM | G.CHUNK | G.CLUMP });
        body.addShape(new CANNON.Cylinder(R * (0.5 + taper * 0.5), R, h, 18));
        body.position.set(CAKE_X, y + h / 2, CAKE_Z);
        world.addBody(body);
        layers.unshift(newLayer(lg, chunks, body, R, h, y, taper, ls));
        y += h;
      }
      W.cake = { group: group, layers: layers, style: { r: st.r * s }, coat: null, scale: s, topY: y, model: false };
      addToppings(W.cake, st.toppings);
      if (level.coat) addCoat(W.cake, level.coat);
      makeAim(st.r * s, y);
      return W.cake;
    };
    function newLayer(lg, chunks, body, R, h, y0, taper, style) {
      var total = 0;
      chunks.forEach(function (c) { total += c.userData.vol; });
      return { group: lg, chunks: chunks, body: body, r: R, h: h, y0: y0, taper: taper, style: style, broken: false, gone: 0, total: total, toppings: [] };
    }
    function addDoily(group, R) {
      var mat = newCakeMat({ color: 0xffffff, roughness: 0.75 });
      var d = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.2, R + 1.2, 0.14, 48), mat);
      d.position.y = 0.07;
      d.receiveShadow = true;
      d.userData.own = true;
      group.add(d);
      var scGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.14, 10);
      for (var i = 0; i < 28; i++) {
        var a = (i / 28) * Math.PI * 2;
        var sc = new THREE.Mesh(scGeo, mat);
        sc.position.set(Math.cos(a) * (R + 1.2), 0.07, Math.sin(a) * (R + 1.2));
        sc.receiveShadow = true;
        group.add(sc);
      }
      d.userData.extraGeo = scGeo;
    }

    /* --- Meshy/블렌더 모델 --- */
    var modelCache = {};
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
      out.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      var pos = out.attributes.position, R = 0;
      for (var k = 0; k < pos.count; k++) R = Math.max(R, Math.hypot(pos.getX(k), pos.getZ(k)));
      var mat = mesh.material;
      mat.side = THREE.DoubleSide; // 조각 안쪽(빈 껍질)이 구멍처럼 안 보이게
      return { geo: out, material: mat, radius: R, height: bb.max.y - bb.min.y };
    }
    /** 모델 삼각형을 층(높이) × 고리 × 부채꼴로 나눠 기본 도형 케이크와 같은 조각 구조로 */
    function buildModelCake(level, M) {
      var R = 5.4, s = R / M.radius, Ht = M.height * s;
      var group = new THREE.Group();
      group.position.set(CAKE_X, 0, CAKE_Z);
      scene.add(group);
      addDoily(group, R);
      var n = level.layers.length, base = 0.14, slabH = Ht / n;
      var P = M.geo.attributes.position, N = M.geo.attributes.normal, U = M.geo.attributes.uv;
      var buckets = {};
      for (var t = 0; t < P.count; t += 3) {
        var cx = ((P.getX(t) + P.getX(t + 1) + P.getX(t + 2)) / 3) * s;
        var cy = ((P.getY(t) + P.getY(t + 1) + P.getY(t + 2)) / 3) * s;
        var cz = ((P.getZ(t) + P.getZ(t + 1) + P.getZ(t + 2)) / 3) * s;
        var bi = Math.min(n - 1, Math.max(0, Math.floor((cy / Ht) * n)));
        var rr = Math.hypot(cx, cz) / R, ri = rr < RINGS[1] ? 0 : rr < RINGS[2] ? 1 : 2;
        var a = Math.atan2(-cz, cx) - ri * 0.37;
        while (a < 0) a += Math.PI * 2;
        var si = Math.min(SECTORS[ri] - 1, Math.floor((a / (Math.PI * 2)) * SECTORS[ri]));
        var key = bi + ':' + ri + ':' + si;
        var b = buckets[key] || (buckets[key] = { bi: bi, ri: ri, p: [], n: [], u: [], c: new THREE.Vector3(), cnt: 0 });
        b.c.x += cx; b.c.y += cy - bi * slabH; b.c.z += cz; b.cnt++;
        for (var v = 0; v < 3; v++) {
          b.p.push(P.getX(t + v) * s, P.getY(t + v) * s - bi * slabH, P.getZ(t + v) * s);
          if (N) b.n.push(N.getX(t + v), N.getY(t + v), N.getZ(t + v));
          if (U) b.u.push(U.getX(t + v), U.getY(t + v));
        }
      }
      var style = { side: '#f4b6c2', inside: '#ffe7d6', top: '#fff4f6' };
      var layers = [];
      for (var li = 0; li < n; li++) {
        var lg = new THREE.Group();
        lg.position.y = base + li * slabH;
        group.add(lg);
        var chunks = [];
        Object.keys(buckets).forEach(function (k) {
          var bk = buckets[k];
          if (bk.bi !== li || !bk.p.length) return;
          var geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute(bk.p, 3));
          if (bk.n.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(bk.n, 3));
          if (bk.u.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(bk.u, 2));
          var m = new THREE.Mesh(geo, M.material);
          m.castShadow = true;
          m.receiveShadow = true;
          var c = bk.c.multiplyScalar(1 / bk.cnt);
          m.userData = { own: true, ring: bk.ri, local: new THREE.Vector3(c.x, slabH, c.z), vol: bk.cnt };
          lg.add(m);
          chunks.push(m);
        });
        var body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC, collisionFilterGroup: G.CAKE, collisionFilterMask: G.ITEM | G.CHUNK | G.CLUMP });
        body.addShape(new CANNON.Cylinder(R * 0.92, R * 0.95, slabH, 18));
        body.position.set(CAKE_X, base + li * slabH + slabH / 2, CAKE_Z);
        world.addBody(body);
        layers.unshift(newLayer(lg, chunks, body, R, slabH, base + li * slabH, 1, style));
      }
      W.cake = { group: group, layers: layers, style: { r: R }, coat: null, scale: 1, topY: base + Ht, model: true };
      if (level.coat) addCoat(W.cake, level.coat);
      makeAim(R, base + Ht);
      return W.cake;
    }

    function addToppings(cake, type) {
      var top = cake.layers[0];
      var yTop = top.h, rTop = top.r * top.taper;
      function add(mesh, x, y, z) {
        mesh.position.set(x, yTop + y, z);
        mesh.castShadow = true;
        mesh.userData.own = true;
        top.group.add(mesh);
        top.toppings.push(mesh);
      }
      var red = newCakeMat({ color: 0xe8384f, roughness: 0.22 });
      var cream = newCakeMat({ color: 0xfffaf2, roughness: 0.6 });
      var i, a, n;
      switch (type) {
        case 'cherry':
          add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 18, 12).scale(1, 0.7, 1), cream), 0, 0.5, 0);
          add(new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), red), 0, 1.5, 0);
          break;
        case 'strawberry': case 'raspberry': case 'blueberry': case 'berries':
          n = 8;
          var bm = newCakeMat({ color: type === 'blueberry' ? 0x3b46b8 : type === 'raspberry' ? 0xd61f5a : 0xe8384f, roughness: 0.28 });
          for (i = 0; i < n; i++) {
            a = (i / n) * Math.PI * 2;
            var geo = type === 'strawberry' ? new THREE.ConeGeometry(0.5, 1.0, 12) : new THREE.SphereGeometry(0.45, 14, 10);
            if (type === 'strawberry') geo.rotateX(Math.PI);
            add(new THREE.Mesh(geo, bm), Math.cos(a) * rTop * 0.68, 0.5, Math.sin(a) * rTop * 0.68);
            if (i % 2 === 0) add(new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8).scale(1, 0.8, 1), cream), Math.cos(a + 0.4) * rTop * 0.68, 0.32, Math.sin(a + 0.4) * rTop * 0.68);
          }
          break;
        case 'mint':
          add(new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.2, 20), cream), 0, 0.2, 0);
          add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 6).scale(1.5, 0.3, 0.7), newCakeMat({ color: 0x5cc46a, roughness: 0.4 })), 0.4, 0.4, 0.2);
          break;
        case 'bow':
          add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.2, 10, 18), newCakeMat({ color: 0xff6f9c, roughness: 0.4 })), 0, 0.45, 0);
          break;
        case 'candles':
          var cm = [0x7cc6ff, 0xffd23f, 0xff8fbf, 0x8fdcc5].map(function (c) { return newCakeMat({ color: c, roughness: 0.5 }); });
          var flame = new THREE.MeshBasicMaterial({ color: 0xffc23a });
          cakeMats.push(flame);
          for (i = 0; i < 4; i++) {
            a = (i / 4) * Math.PI * 2 + 0.4;
            var cx = Math.cos(a) * rTop * 0.55, cz = Math.sin(a) * rTop * 0.55;
            add(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 8), cm[i]), cx, 0.8, cz);
            var f = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6).scale(1, 1.6, 1), flame);
            f.userData.flame = true;
            add(f, cx, 1.85, cz);
          }
          break;
        case 'jewels':
          var gold = newCakeMat({ color: 0xffcf3a, metalness: 0.85, roughness: 0.22 });
          for (i = 0; i < 5; i++) {
            a = (i / 5) * Math.PI * 2;
            add(new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.2, 6), gold), Math.cos(a) * rTop * 0.8, 0.55, Math.sin(a) * rTop * 0.8);
          }
          add(new THREE.Mesh(new THREE.OctahedronGeometry(0.55), newCakeMat({ color: 0xe02c55, metalness: 0.3, roughness: 0.1 })), 0, 0.65, 0);
          break;
      }
    }
    function addCoat(cake, color) {
      var c = color === 'mint' ? 0x7be8c4 : 0xff8fbf;
      var r = cake.style.r + 0.6, h = cake.topY + 1.0;
      var mat = new THREE.MeshPhysicalMaterial({ color: c, transparent: true, opacity: 0.3, roughness: 0.04, clearcoat: 1, emissive: new THREE.Color(c).multiplyScalar(0.12), depthWrite: false });
      cakeMats.push(mat);
      var coat = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r, h, 48, 1, true), mat);
      coat.position.set(0, h / 2, 0);
      coat.userData.own = true;
      var cap = new THREE.Mesh(new THREE.SphereGeometry(r * 0.96, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.22, 1), mat);
      cap.position.y = h / 2;
      cap.userData.own = true;
      coat.add(cap);
      cake.group.add(coat);
      cake.coat = coat;
    }

    /* --- 조준 원기둥 + 닿는 바닥 계산 --- */
    var AIM_PAD = 2.0, AIM_TOP = 2.5;
    function makeAim(R, topY) {
      var aim = new THREE.Mesh(new THREE.CylinderGeometry(R + AIM_PAD, R + AIM_PAD, 1, 24), new THREE.MeshBasicMaterial({ visible: false }));
      scene.add(aim);
      W.cake.aim = aim;
      W.cake.aimR = R + AIM_PAD;
      W.setAimTop(topY);
    }
    W.setAimTop = function (topY) {
      var c = W.cake;
      if (!c || !c.aim) return;
      var h = Math.max(1, topY + AIM_TOP + 0.5);
      c.aimH = h;
      c.aim.scale.y = h;
      c.aim.position.set(CAKE_X, h / 2 - 0.5, CAKE_Z);
      c.aim.updateMatrixWorld();
    };
    /** 화면에서 바닥점(x, 0.5, z)을 볼 때 조준 원기둥에 먼저 닿는가 (정사영: 평행 광선) */
    W.aimHitsFloor = function (x, z) {
      var c = W.cake;
      if (!c || !c.aim) return false;
      var O = new THREE.Vector3(x, 0.5, z).addScaledVector(camDir, 300);
      var dx = x - O.x, dy = 0.5 - O.y, dz = z - O.z;
      var ox = O.x - CAKE_X, oz = O.z - CAKE_Z, R = c.aimR, y0 = -0.5, y1 = c.aimH - 0.5;
      var tc = (y1 - O.y) / dy;
      if (tc > 0 && tc < 1) {
        var px = ox + dx * tc, pz = oz + dz * tc;
        if (px * px + pz * pz <= R * R) return true;
      }
      var A = dx * dx + dz * dz, B = 2 * (ox * dx + oz * dz), C = ox * ox + oz * oz - R * R;
      var disc = B * B - 4 * A * C;
      if (disc < 0 || A === 0) return false;
      var sq = Math.sqrt(disc);
      for (var k = 0; k < 2; k++) {
        var t = (-B + (k ? sq : -sq)) / (2 * A);
        if (t > 0 && t < 1) {
          var yy = O.y + dy * t;
          if (yy >= y0 && yy <= y1) return true;
        }
      }
      return false;
    };
    /** 손가락이 가리키는 케이크 윗면 위치 (과녁). 남은 조각을 위에서 레이캐스트 → 패인 곳이면 더 낮게 */
    var downRay = new THREE.Raycaster();
    W.cakeTargetAt = function (cx, cy) {
      var c = W.cake;
      if (!c) return null;
      var ray = W.pointerRay(cx, cy);
      var t = (c.topY - ray.origin.y) / ray.direction.y;
      var p = ray.origin.clone().addScaledVector(ray.direction, t);
      var top = c.layers.filter(function (l) { return !l.broken; })[0];
      var rMax = top ? top.r * top.taper - 0.6 : c.style.r - 0.6;
      var dx = p.x - CAKE_X, dz = p.z - CAKE_Z, d = Math.hypot(dx, dz);
      if (d > rMax) { p.x = CAKE_X + (dx / d) * rMax; p.z = CAKE_Z + (dz / d) * rMax; }
      downRay.set(new THREE.Vector3(p.x, 60, p.z), new THREE.Vector3(0, -1, 0));
      var meshes = [];
      c.layers.forEach(function (l) { if (!l.broken) l.chunks.forEach(function (m) { if (!m.userData.gone) meshes.push(m); }); });
      var hit = downRay.intersectObjects(meshes, false)[0];
      p.y = hit ? hit.point.y : 0.15;
      return p;
    };
    W.setReticle = function (p, r, color) {
      if (!p) { reticle.visible = false; return; }
      reticle.visible = true;
      reticle.position.set(p.x, p.y + 0.06, p.z);
      reticle.scale.setScalar(r);
      retMat.color.set(color || 0xffffff);
    };

    /* --- 맞은 지점 기준 국소 파괴 ---
     * goneFrac: 이 층에서 지금까지 깎인 몸체 비율(1 - hp/maxHp). 그 비율의 부피만큼, 맞은 지점에서 가까운 조각부터 떼어낸다.
     */
    var tmpV = new THREE.Vector3();
    function chunkWorldPos(m) { return m.localToWorld(tmpV.copy(m.userData.local).setY(m.userData.local.y * 0.5)); }
    W.hitCake = function (li, p, goneFrac, broke, strength) {
      var L = W.cake.layers[li];
      if (!L) return;
      L.group.updateMatrixWorld(true);
      var target = broke ? 1 : Math.min(0.9, goneFrac);
      var remain = L.chunks.filter(function (m) { return !m.userData.gone; });
      remain.forEach(function (m) { var w = chunkWorldPos(m); m.userData.d = Math.hypot(w.x - p.x, w.z - p.z); });
      remain.sort(function (a, b) { return a.userData.d - b.userData.d; });
      var lastD = 0, out = { count: 0, x: 0, z: 0 };
      for (var i = 0; i < remain.length; i++) {
        var m = remain[i];
        if (!broke && (L.gone + m.userData.vol) / L.total > target + 0.02) break;
        L.gone += m.userData.vol;
        lastD = m.userData.d;
        var cw = chunkWorldPos(m);
        out.count++; out.x += cw.x; out.z += cw.z;
        detachChunk(m, p, strength, L);
      }
      if (out.count) { out.x /= out.count; out.z /= out.count; }
      // 떼어낸 곳 둘레는 금 가고 찌그러짐 (맞은 쪽에서 밀려나며 기울고 주저앉음)
      var crackR = Math.max(2.2, lastD * 1.7);
      if (!broke) L.chunks.forEach(function (m) {
        if (m.userData.gone) return;
        var w = chunkWorldPos(m), d = Math.hypot(w.x - p.x, w.z - p.z);
        if (d > crackR) return;
        var k = (1 - d / crackR) * (0.35 + strength * 0.5);
        var dir = new THREE.Vector3(w.x - p.x, 0, w.z - p.z).normalize();
        m.position.x += dir.x * k * 0.45;
        m.position.z += dir.z * k * 0.45;
        m.position.y -= k * 0.35;
        m.rotateOnWorldAxis(new THREE.Vector3(-dir.z, 0, dir.x), -k * 0.18);
      });
      // 토핑: 맞은 곳 근처는 날아감
      L.toppings.forEach(function (t) {
        if (!t.parent || t.userData.gone) return;
        var w = new THREE.Vector3();
        t.getWorldPosition(w);
        if (broke || Math.hypot(w.x - p.x, w.z - p.z) < crackR) { t.userData.gone = true; flingMesh(t, 8 + strength * 8, p); }
      });
      if (broke) {
        L.broken = true;
        if (L.body) { world.removeBody(L.body); L.body = null; }
        var below = W.cake.layers[li + 1];
        var topY = below ? below.y0 + below.h : 0.2;
        W.cake.topY = topY;
        W.setAimTop(topY);
        if (!below && W.cake.coat) popCoat();
      }
      W.fx.push({ type: 'squash', layer: L, t: 0, life: 0.5, k: 0.35 + strength * 0.4 });
      if (W.cake.coat) W.fx.push({ type: 'wobble', mesh: W.cake.coat, t: 0, life: 1.0 });
      crumbs(L, p, 6 + Math.round(strength * 18));
      return out;
    };
    function detachChunk(m, p, strength, L) {
      m.userData.gone = true;
      m.updateMatrixWorld(true);
      var geo = m.geometry;
      geo.computeBoundingBox();
      var c = new THREE.Vector3(), size = new THREE.Vector3();
      geo.boundingBox.getCenter(c);
      geo.boundingBox.getSize(size);
      var ng = geo.clone();
      ng.translate(-c.x, -c.y, -c.z);
      geo.dispose();
      m.geometry = ng;
      var wp = c.clone().applyMatrix4(m.matrixWorld);
      var q = new THREE.Quaternion();
      m.getWorldQuaternion(q);
      var sy = L.group.scale.y;
      m.parent.remove(m);
      m.position.copy(wp);
      m.quaternion.copy(q);
      m.scale.set(1, sy, 1);
      scene.add(m);
      var body = new CANNON.Body({ mass: 2, collisionFilterGroup: G.CHUNK, collisionFilterMask: G.FLOOR | G.CHUNK | G.ITEM | G.CAKE, linearDamping: 0.04, angularDamping: 0.08 });
      body.addShape(new CANNON.Box(new CANNON.Vec3(Math.max(0.25, (size.x / 2) * 0.85), Math.max(0.25, ((size.y * sy) / 2) * 0.85), Math.max(0.25, (size.z / 2) * 0.85))));
      body.position.set(wp.x, wp.y, wp.z);
      body.quaternion.set(q.x, q.y, q.z, q.w);
      var dx = wp.x - p.x, dz = wp.z - p.z, d = Math.hypot(dx, dz) || 1;
      var sp = 7 + strength * 12 + Math.random() * 4;
      body.velocity.set((dx / d) * sp, 6 + strength * 12 + Math.random() * 5, (dz / d) * sp);
      body.angularVelocity.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 14);
      world.addBody(body);
      W.fx.push({ type: 'chunk', mesh: m, body: body, t: 0, life: 3.6 });
    }
    function flingMesh(mesh, power, p) {
      var wp = new THREE.Vector3();
      mesh.getWorldPosition(wp);
      var q = new THREE.Quaternion();
      mesh.getWorldQuaternion(q);
      mesh.parent.remove(mesh);
      mesh.position.copy(wp);
      mesh.quaternion.copy(q);
      scene.add(mesh);
      var body = new CANNON.Body({ mass: 0.5, collisionFilterGroup: G.CHUNK, collisionFilterMask: G.FLOOR | G.CHUNK });
      body.addShape(new CANNON.Sphere(0.45));
      body.position.set(wp.x, wp.y, wp.z);
      var a = Math.atan2(wp.z - p.z, wp.x - p.x) + (Math.random() - 0.5);
      body.velocity.set(Math.cos(a) * power, power * (0.8 + Math.random() * 0.6), Math.sin(a) * power);
      body.angularVelocity.set(Math.random() * 9, Math.random() * 9, Math.random() * 9);
      world.addBody(body);
      W.fx.push({ type: 'chunk', mesh: mesh, body: body, t: 0, life: 2.8 });
    }
    var crumbGeo = new THREE.BoxGeometry(0.42, 0.34, 0.42), crumbMats = {};
    function crumbMat(c) { return crumbMats[c] || (crumbMats[c] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })); }
    function crumbs(L, p, count) {
      var cols = [L.style.side, L.style.inside, L.style.top];
      for (var i = 0; i < count; i++) {
        var m = new THREE.Mesh(crumbGeo, crumbMat(cols[i % 3]));
        var s = 0.6 + Math.random() * 1.1;
        m.scale.set(s, s, s);
        m.castShadow = true;
        var a = Math.random() * Math.PI * 2;
        m.position.set(p.x + Math.cos(a) * 0.6, p.y + 0.2, p.z + Math.sin(a) * 0.6);
        scene.add(m);
        var b = new CANNON.Body({ mass: 0.2, collisionFilterGroup: G.CHUNK, collisionFilterMask: G.FLOOR | G.CAKE });
        b.addShape(new CANNON.Box(new CANNON.Vec3(0.21 * s, 0.17 * s, 0.21 * s)));
        b.position.set(m.position.x, m.position.y, m.position.z);
        var sp = 6 + Math.random() * 12;
        b.velocity.set(Math.cos(a) * sp, 8 + Math.random() * 12, Math.sin(a) * sp);
        b.angularVelocity.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
        world.addBody(b);
        W.fx.push({ type: 'chunk', mesh: m, body: b, t: 0, life: 1.6 + Math.random() });
      }
    }
    function popCoat() {
      var coat = W.cake.coat;
      if (!coat) return;
      W.cake.coat = null;
      var col = coat.material.color.clone();
      coat.parent.remove(coat);
      var mat = new THREE.MeshPhysicalMaterial({ color: col, transparent: true, opacity: 0.5, roughness: 0.05, clearcoat: 1 });
      cakeMats.push(mat);
      var bubbleGeo = new THREE.SphereGeometry(0.6, 10, 8);
      for (var i = 0; i < 20; i++) {
        var m = new THREE.Mesh(bubbleGeo, mat);
        m.scale.setScalar(0.6 + Math.random() * 0.9);
        var a = Math.random() * Math.PI * 2;
        m.position.set(CAKE_X + Math.cos(a) * 5, 2 + Math.random() * 5, CAKE_Z + Math.sin(a) * 5);
        scene.add(m);
        var b = new CANNON.Body({ mass: 0.3, collisionFilterGroup: G.CHUNK, collisionFilterMask: G.FLOOR });
        b.addShape(new CANNON.Sphere(0.45));
        b.position.set(m.position.x, m.position.y, m.position.z);
        b.velocity.set(Math.cos(a) * 12, 8 + Math.random() * 8, Math.sin(a) * 12);
        world.addBody(b);
        W.fx.push({ type: 'chunk', mesh: m, body: b, t: 0, life: 1.6 });
      }
    }

    W.disposeCake = function () {
      var c = W.cake;
      if (!c) return;
      c.layers.forEach(function (l) { if (l.body) world.removeBody(l.body); });
      scene.remove(c.group);
      c.group.traverse(function (o) {
        if (!o.isMesh) return;
        if (o.userData.own) o.geometry.dispose();
        if (o.userData.extraGeo) o.userData.extraGeo.dispose();
      });
      cakeMats.forEach(function (m) { m.dispose(); });
      cakeMats = [];
      if (c.aim) { scene.remove(c.aim); c.aim.geometry.dispose(); }
      W.cake = null;
    };

    /* ================= 연출 ================= */
    var softTex = (function () {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      var x = cv.getContext('2d');
      var g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(cv);
    })();
    var streakTex = (function () {
      var cv = document.createElement('canvas');
      cv.width = 16; cv.height = 128;
      var x = cv.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(1, 'rgba(255,255,255,1)');
      x.fillStyle = g;
      x.fillRect(4, 0, 8, 128);
      return new THREE.CanvasTexture(cv);
    })();
    function sprite(tex, color, opacity, additive) {
      var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: color, transparent: true, opacity: opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
      scene.add(s);
      return s;
    }
    W.puff = function (x, y, z, n, color) {
      for (var i = 0; i < n; i++) {
        var sp = sprite(softTex, color || 0xfff6ee, 0.85);
        sp.position.set(x, y, z);
        sp.scale.set(2, 2, 2);
        var a = Math.random() * Math.PI * 2;
        W.fx.push({ type: 'puff', mesh: sp, v: new THREE.Vector3(Math.cos(a) * (5 + Math.random() * 8), 1 + Math.random() * 4, Math.sin(a) * (5 + Math.random() * 8)), t: 0, life: 0.6 + Math.random() * 0.4 });
      }
    };
    W.sparkle = function (x, y, z, color, n) {
      for (var i = 0; i < (n || 6); i++) {
        var sp = sprite(softTex, color || 0xffffff, 1, true);
        sp.position.set(x, y, z);
        sp.scale.set(0.8, 0.8, 0.8);
        var a = Math.random() * Math.PI * 2, e = Math.random();
        W.fx.push({ type: 'puff', mesh: sp, v: new THREE.Vector3(Math.cos(a) * 7, 3 + e * 6, Math.sin(a) * 7), t: 0, life: 0.45 });
      }
    };
    /** 충돌 순간 번쩍임 */
    W.flash = function (p, s) {
      var sp = sprite(softTex, 0xffffff, 1, true);
      sp.position.set(p.x, p.y + 0.6, p.z);
      W.fx.push({ type: 'flash', mesh: sp, t: 0, life: 0.16, size: 6 + s * 10 });
    };
    /** 케이크 윗면과 쟁반 바닥에 퍼지는 충격파 고리 */
    var ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    W.shockwave = function (p, s) {
      var cr = W.cake ? W.cake.style.r : 5;
      [[p.y + 0.08, 1.0, 4 + s * 6, 0.32, p.x, p.z, 0.6], [0.06, 0.8, cr + 4 + s * 6, 0.5, CAKE_X, CAKE_Z, cr]].forEach(function (r, i) {
        var m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: i ? 0xffe2ec : 0xffffff, transparent: true, opacity: r[1], depthWrite: false, side: THREE.DoubleSide }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(r[4], r[0], r[5]);
        m.renderOrder = 4;
        scene.add(m);
        W.fx.push({ type: 'ring', mesh: m, t: 0, life: r[3], from: r[6], to: r[2], a0: r[1] });
      });
    };
    /** 떨어지는 덩어리 위로 남는 속도선 */
    W.speedLines = function (p, r, n) {
      for (var i = 0; i < n; i++) {
        var sp = sprite(streakTex, 0xffffff, 0.9);
        var a = Math.random() * Math.PI * 2, rr = r * (0.4 + Math.random() * 0.9);
        sp.position.set(p.x + Math.cos(a) * rr, p.y + r + Math.random() * 2, p.z + Math.sin(a) * rr);
        sp.scale.set(0.16 + Math.random() * 0.12, 2.5 + Math.random() * 3, 1);
        W.fx.push({ type: 'streak', mesh: sp, t: 0, life: 0.18 + Math.random() * 0.1 });
      }
    };
    /** 무게감: 카메라가 아래로 툭 + 흔들림 */
    W.kick = function (s) { W.punch = Math.max(W.punch, s); W.shake = Math.max(W.shake, s * 0.9); };
    var confGeo = new THREE.PlaneGeometry(0.55, 0.32), confMats = [0xff6f91, 0xffb627, 0x57c4a4, 0x7cc6ff, 0xc3adff].map(function (c) { return new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }); });
    W.confetti = function (n) {
      for (var i = 0; i < n; i++) {
        var m = new THREE.Mesh(confGeo, confMats[i % 5]);
        m.position.set((Math.random() - 0.5) * TW, 18 + Math.random() * 14, (Math.random() - 0.5) * TD);
        scene.add(m);
        W.fx.push({ type: 'conf', mesh: m, v: new THREE.Vector3((Math.random() - 0.5) * 3, -7 - Math.random() * 6, (Math.random() - 0.5) * 3), spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), t: 0, life: 3.5 });
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
          if (f.body.position.y < VOID_Y) k = 1;
          else if (k > 0.75) f.mesh.scale.multiplyScalar(Math.max(0.2, 1 - dt * 6));
        } else if (f.type === 'puff') {
          f.mesh.position.addScaledVector(f.v, dt);
          f.mesh.material.opacity = 0.85 * (1 - k);
          var sc = 2 + k * 3.5;
          f.mesh.scale.set(sc, sc, sc);
        } else if (f.type === 'flash') {
          var fs = f.size * (0.55 + 0.45 * (1 - Math.min(1, k)));
          f.mesh.scale.set(fs, fs, fs);
          f.mesh.material.opacity = 1 - k;
        } else if (f.type === 'ring') {
          var e = 1 - Math.pow(1 - Math.min(1, k), 3);
          f.mesh.scale.setScalar(f.from + (f.to - f.from) * e);
          f.mesh.material.opacity = f.a0 * (1 - k);
        } else if (f.type === 'streak') {
          f.mesh.position.y += dt * 18;
          f.mesh.material.opacity = 0.9 * (1 - k);
        } else if (f.type === 'conf') {
          f.mesh.position.addScaledVector(f.v, dt);
          f.mesh.rotation.x += f.spin.x * dt;
          f.mesh.rotation.y += f.spin.y * dt;
        } else if (f.type === 'squash') {
          var a = Math.exp(-f.t * 9) * Math.cos(f.t * 26);
          f.layer.group.scale.set(1 + 0.14 * a * f.k, 1 - 0.32 * a * f.k, 1 + 0.14 * a * f.k);
          if (k >= 1) f.layer.group.scale.set(1, 1, 1);
        } else if (f.type === 'wobble') {
          var w = Math.exp(-f.t * 5) * Math.sin(f.t * 30) * 0.08;
          f.mesh.scale.set(1 + w, 1 - w, 1 + w);
        }
        if (k >= 1) {
          if (f.body) world.removeBody(f.body);
          if (f.mesh && f.type !== 'squash' && f.type !== 'wobble') {
            scene.remove(f.mesh);
            if (f.mesh.userData.own) f.mesh.geometry.dispose();
            if (f.mesh.isSprite || f.type === 'ring') f.mesh.material.dispose();
          }
          W.fx.splice(i, 1);
        }
      }
      if (W.cake) W.cake.layers.forEach(function (l) {
        l.toppings.forEach(function (t) { if (t.userData.flame) t.scale.y = 1.6 * (1 + Math.sin(performance.now() / 70 + t.id) * 0.12); });
      });
    };
    W.clearFx = function () {
      W.fx.forEach(function (f) {
        if (f.body) world.removeBody(f.body);
        if (f.mesh && f.type !== 'squash' && f.type !== 'wobble') {
          scene.remove(f.mesh);
          if (f.mesh.userData.own) f.mesh.geometry.dispose();
          if (f.mesh.isSprite || f.type === 'ring') f.mesh.material.dispose();
        }
      });
      W.fx = [];
    };

    /** 덩어리 아래 그림자: 높을수록 크고 옅게 */
    W.setBlob = function (pos, r, groundY) {
      if (!pos) { blob.visible = false; return; }
      var tgt = groundY != null ? groundY + 0.06 : W.cake && Math.hypot(pos.x - CAKE_X, pos.z - CAKE_Z) < W.cake.style.r ? W.cake.topY + 0.06 : 0.05;
      var h = Math.max(0, pos.y - r - tgt);
      blob.visible = true;
      blob.position.set(pos.x, tgt, pos.z);
      blob.scale.setScalar(r * (1 + h * 0.035));
      blob.material.opacity = 0.3 / (1 + h * 0.12);
    };

    W.render = function (dt) {
      // 카메라 펀치(아래로 툭) + 흔들림
      W.punch *= Math.exp(-(dt || 0.016) * 10);
      var sh = W.shake;
      camera.position.copy(camBase)
        .addScaledVector(camUp, -W.punch * 0.6 + (Math.random() - 0.5) * sh * 0.5)
        .addScaledVector(camRight, (Math.random() - 0.5) * sh * 0.5);
      renderer.render(scene, camera);
    };

    return W;
  }

  root.MKWorld = { create: create, CAKES: CAKES, ITEM_R: ITEM_R };
})(window);
