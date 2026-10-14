/*
 * 모아쿵! — 순수 규칙 모듈 (화면/입력과 무관, Node에서도 require 가능)
 *
 * 가설: 케이크가 1개여도 ① 층 케이크(넘친 힘은 아래층으로 안 감) ② 젤리 코팅(절반이 튐)
 *       ③ 단단함(작은 덩어리는 흠집) ④ 묵직한 금속(힘 2배) 이 레벨마다 섞이면
 *       "전부 쏟기 = 실패/별 적음, 딱 맞게 모으기 = 별 3개"가 성립한다.
 *       (tools/balance.js 가 레벨마다 이 성질을 전수 검사한다)
 */
(function (root) {
  'use strict';

  var CHIP = 0.2;          // 단단함 미만 덩어리는 흠집(20%)만
  var LOSS = 1 / 3;        // 낙하에 쓴 재료 중 쟁반 밖으로 튀는 비율
  var LOSS_COAT = 1 / 2;   // 젤리 코팅 케이크는 더 튄다
  var EPS = 1e-6;

  /* 점수 (캔디크러시식 피날레) */
  var SCORE = {
    perDamage: 10,     // 몸체 1 깎을 때마다
    clear: 1000,       // 케이크를 다 부수면
    perDropLeft: 300,  // 피날레: 남은 낙하 1번마다
    perLight: 100,     // 피날레: 남은 가벼운 재료 1개마다
    perHeavy: 200      // 피날레: 남은 묵직한 재료 1개마다 (힘 2배라 점수도 2배)
  };

  /*
   * 재료: 쇠구슬·너트는 묵직해서 힘 2, 나머지는 1.
   * bounce: 같은 무게 안에서 먼저 튀어나가는 순서 (높을수록 먼저). 손실은 항상 가벼운 것부터.
   */
  var MATERIALS = {
    steel:  { name: '쇠 구슬',   weight: 2, bounce: 0.6, sound: 'metal' },
    nut:    { name: '작은 너트', weight: 2, bounce: 0.3, sound: 'metal' },
    jelly:  { name: '젤리',      weight: 1, bounce: 0.95, sound: 'jelly' },
    star:   { name: '별 장식',   weight: 1, bounce: 0.7, sound: 'chime' },
    button: { name: '단추',      weight: 1, bounce: 0.55, sound: 'click' },
    pearl:  { name: '자개 조각', weight: 1, bounce: 0.45, sound: 'glass' }
  };
  var HEAVY = ['steel', 'nut'];
  var LIGHT = ['jelly', 'star', 'button', 'pearl'];

  function weightOf(mat) { return MATERIALS[mat].weight; }
  function powerOf(mats) {
    var p = 0;
    for (var i = 0; i < mats.length; i++) p += weightOf(mats[i]);
    return p;
  }

  /** 힘 P 가 단단함 armor 인 층에 주는 피해 */
  function damage(P, armor) {
    if (P <= 0) return 0;
    return P > armor ? (P - armor) + armor * CHIP : P * CHIP;
  }
  function lossRate(level) { return level.coat ? LOSS_COAT : LOSS; }
  function lossCount(n, level) { return Math.round(n * lossRate(level)); }

  /** 힘 기준: 남은 hp 를 한 번에 부수는 최소 힘 */
  function needPower(hp, armor) {
    if (hp <= EPS) return 0;
    var pChip = Math.ceil(hp / CHIP - EPS);
    if (pChip <= armor) return Math.max(1, pChip);
    return Math.max(Math.floor(armor) + 1, Math.ceil(hp + armor - armor * CHIP - EPS));
  }

  /**
   * 낙하 한 번에 잃을 재료 고르기: 가벼운 것부터, 같은 무게면 잘 튀는 것부터.
   * mats: 재질 이름 배열(덩어리), 반환: 잃을 인덱스 배열
   */
  function pickLost(mats, level, salt) {
    var k = lossCount(mats.length, level);
    var idx = mats.map(function (m, i) { return i; });
    idx.sort(function (a, b) {
      var wa = weightOf(mats[a]), wb = weightOf(mats[b]);
      if (wa !== wb) return wa - wb;
      var ba = MATERIALS[mats[a]].bounce + hash(a * 131 + (salt || 0)) * 0.3;
      var bb = MATERIALS[mats[b]].bounce + hash(b * 131 + (salt || 0)) * 0.3;
      return bb - ba;
    });
    return idx.slice(0, k);
  }
  function hash(n) {
    n = (n ^ 61) ^ (n >>> 16);
    n = n + (n << 3);
    n = n ^ (n >>> 4);
    n = Math.imul(n, 0x27d4eb2d);
    n = n ^ (n >>> 15);
    return (n >>> 0) / 4294967296;
  }

  /**
   * 조준 미리보기 — 사용자가 계산하지 않도록 결과를 그대로 알려준다.
   * held: 덩어리 재질 배열, cake: { layers:[{hp,maxHp,armor}], top }, level, total: 쟁반 위 재료 수
   */
  function preview(held, cake, level, total) {
    var layer = cake.layers[cake.top];
    var n = held.length;
    var P = powerOf(held);
    var heavy = 0;
    for (var i = 0; i < n; i++) if (weightOf(held[i]) > 1) heavy++;
    var dmg = damage(P, layer.armor);
    var after = Math.max(0, layer.hp - dmg);
    var breaks = after <= EPS;
    var need = needPower(layer.hp, layer.armor);
    var layersLeft = cake.layers.length - cake.top - (breaks ? 1 : 0);
    var loss = lossCount(n, level);
    return {
      n: n,
      power: P,
      heavy: heavy,
      kind: breaks ? 'break' : P <= layer.armor ? 'scratch' : 'crack',
      breaks: breaks,
      finishes: breaks && layersLeft === 0,
      layersLeft: layersLeft,
      damage: Math.min(dmg, layer.hp),
      hpAfter: after,
      hpRatioAfter: after / layer.maxHp,
      needPower: need,
      overflow: breaks ? Math.max(0, P - need) : 0,
      loss: loss,
      remainAfter: total - loss,
      coat: !!level.coat
    };
  }

  /*
   * 최적 플레이 탐색 (남은 재료 수와 위치만 다르고 결과는 (금속 수, 가벼운 수, 층, 남은 hp, 남은 낙하)로 정해진다).
   * 반환: 이길 수 있으면 최대 피날레 점수, 아니면 -1
   */
  function solve(level, heavy, light, layers, top, hp, drops, opts) {
    opts = opts || {};
    var memo = {};
    var rate = lossRate(level);
    function rec(m, l, t, h, d) {
      if (t >= layers.length) return d * SCORE.perDropLeft + l * SCORE.perLight + m * SCORE.perHeavy;
      if (d <= 0 || m + l <= 0) return -1;
      var key = m + '|' + l + '|' + t + '|' + h.toFixed(3) + '|' + d;
      if (key in memo) return memo[key];
      var best = -1;
      var A = layers[t].armor;
      for (var a = 0; a <= m; a++) {
        for (var b = 0; b <= l; b++) {
          var n = a + b;
          if (n === 0) continue;
          var P = 2 * a + b;
          var h2 = h - damage(P, A);
          var k = Math.round(n * rate);
          var lostL = Math.min(k, b), lostH = k - lostL;
          var r;
          if (h2 <= EPS) {
            var nt = t + 1;
            r = rec(m - lostH, l - lostL, nt, nt < layers.length ? layers[nt].hp : 0, d - 1);
          } else {
            r = rec(m - lostH, l - lostL, t, h2, d - 1);
          }
          if (r > best) best = r;
          if (opts.feasibleOnly && best >= 0) { memo[key] = best; return best; }
        }
      }
      memo[key] = best;
      return best;
    }
    return rec(heavy, light, top, hp, drops);
  }

  /** 남은 재료/낙하로 이길 수 있는가 (게임 중 조기 실패 판정용) */
  function canStillWin(level, heavy, light, cake, drops) {
    var layers = cake.layers;
    return solve(level, heavy, light, layers, cake.top, layers[cake.top].hp, drops, { feasibleOnly: true }) >= 0;
  }

  function totalHp(level) {
    var s = 0;
    level.layers.forEach(function (l) { s += l.hp; });
    return s;
  }
  function baseScore(level) { return SCORE.clear + SCORE.perDamage * totalHp(level); }
  function finaleScore(dropsLeft, heavyLeft, lightLeft) {
    return dropsLeft * SCORE.perDropLeft + heavyLeft * SCORE.perHeavy + lightLeft * SCORE.perLight;
  }
  function starsFor(level, score, cleared) {
    if (!cleared) return 0;
    if (score >= level.stars[1]) return 3;
    if (score >= level.stars[0]) return 2;
    return 1;
  }

  /*
   * 레벨: 케이크 1개. layers 는 위층부터. feature 는 소개용 태그.
   * heavy/light: 묵직한·가벼운 재료 수. piles: 묵직한 재료를 모아 둔 무더기 수(쓸어 담을 곳 고르는 재미)
   * 수치는 tools/balance.js 로 검증 (층/코팅은 전부 쏟으면 실패, 딱 맞게 = ★★★, 4개 넘쳐도 클리어)
   */
  var LEVELS = [
    { id: 1, kind: 'pudding', name: '커스터드 푸딩', feature: 'soft', drops: 3, heavy: 6, light: 24,
      intro: '꾹 누른 채 문질러 모으고, 케이크 위에서 손을 떼요!',
      layers: [{ hp: 10, armor: 0 }] },
    { id: 2, kind: 'mousse', name: '레몬 무스', feature: 'soft', drops: 3, heavy: 6, light: 24,
      intro: '아래 [− 개수 +]로 모을 개수를 정하면 딱 그만큼만 붙어요. 남긴 재료는 점수가 돼요.',
      layers: [{ hp: 14, armor: 0 }] },
    { id: 3, kind: 'shortcake', model: 'strawberry', name: '딸기 로즈 티 케이크', feature: 'heavy', drops: 3, heavy: 10, light: 25, piles: 2,
      intro: '반짝이는 쇠구슬·너트는 묵직해서 힘이 2배! 같은 힘을 더 적은 개수로 낼 수 있어요.',
      layers: [{ hp: 26, armor: 0 }] },
    { id: 4, kind: 'choco', name: '초코 가나슈 케이크', feature: 'hard', drops: 3, heavy: 10, light: 25,
      intro: '단단한 케이크! 단단함보다 약한 덩어리는 흠집만 나요. 한 번에 크게!',
      layers: [{ hp: 12, armor: 14 }] },
    { id: 5, kind: 'macaron', name: '마카롱 탑', feature: 'hard', drops: 3, heavy: 4, light: 19, piles: 1,
      intro: '껍질이 아주 단단해요. 재료가 적으니 한 방에!',
      layers: [{ hp: 10, armor: 22 }] },
    { id: 6, kind: 'cheesecake', name: '베리 치즈케이크', feature: 'hard', drops: 3, heavy: 4, light: 23,
      intro: '크고 단단해요. 두 번에 나누면 단단함을 두 번 뚫어야 해요.',
      layers: [{ hp: 22, armor: 12 }] },
    { id: 7, kind: 'crepe', name: '무지개 크레이프', feature: 'layer', drops: 3, heavy: 4, light: 10,
      intro: '층 케이크! 위층부터 차례로 부서지고, 넘친 힘은 아래층으로 안 가요. 재료가 적으니 층마다 딱 맞게!',
      layers: [{ hp: 10, armor: 0 }, { hp: 16, armor: 6 }] },
    { id: 8, kind: 'tiered', name: '3단 생일 케이크', feature: 'layer', drops: 4, heavy: 6, light: 24, piles: 2,
      intro: '3층이에요. 위는 말랑, 아래로 갈수록 단단해요.',
      layers: [{ hp: 8, armor: 0 }, { hp: 12, armor: 6 }, { hp: 14, armor: 14 }] },
    { id: 9, kind: 'crown', name: '왕관 초코 타르트', feature: 'layer', drops: 3, heavy: 4, light: 22,
      intro: '왕관은 작지만 단단하고, 타르트는 크고 조금 단단해요. 왕관에 너무 크게 쓰면 넘친 힘이 버려져요.',
      layers: [{ hp: 4, armor: 14 }, { hp: 24, armor: 8 }] },
    { id: 10, kind: 'pudding', name: '젤리 푸딩', feature: 'coat', coat: 'pink', drops: 3, heavy: 6, light: 24,
      intro: '젤리 코팅! 탱글해서 떨어뜨린 재료의 절반이 튀어나가요.',
      layers: [{ hp: 16, armor: 0 }] },
    { id: 11, kind: 'cheesecake', name: '젤리 치즈케이크', feature: 'coat', coat: 'mint', drops: 3, heavy: 8, light: 22, piles: 2,
      intro: '젤리 코팅에 단단하기까지! 재료가 빨리 줄어요.',
      layers: [{ hp: 14, armor: 10 }] },
    { id: 12, kind: 'tiered', name: '젤리 3단 케이크', feature: 'coat', coat: 'pink', drops: 4, heavy: 10, light: 20, piles: 3,
      intro: '마지막! 젤리 코팅 3층 케이크. 층마다 딱 맞게, 아껴서!',
      layers: [{ hp: 8, armor: 0 }, { hp: 10, armor: 6 }, { hp: 12, armor: 10 }] }
  ];

  // 재료 구성: 묵직한 것(쇠구슬·너트)과 가벼운 것(젤리·별·단추·자개)을 고르게 나눈다
  // 별 기준: ★★ = 최적 피날레의 50%, ★★★ = 85% (tools/balance.js 가 "딱 맞게 = ★★★" 등을 검사)
  LEVELS.forEach(function (lv) {
    lv.mats = { steel: Math.ceil(lv.heavy / 2), nut: Math.floor(lv.heavy / 2), jelly: 0, star: 0, button: 0, pearl: 0 };
    for (var i = 0; i < lv.light; i++) lv.mats[LIGHT[i % LIGHT.length]]++;
    lv.total = lv.heavy + lv.light;
    lv.seed = 7919 * lv.id + 101;
    var best = solve(lv, lv.heavy, lv.light, lv.layers, 0, lv.layers[0].hp, lv.drops);
    lv.bestFinale = best;
    lv.stars = [baseScore(lv) + Math.round((best * 0.5) / 10) * 10, baseScore(lv) + Math.round((best * 0.85) / 10) * 10];
  });

  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s += 0x6D2B79F5;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var FEATURES = {
    soft: { name: '말랑', desc: '단단함이 없어요. 모은 힘만큼 그대로 부서져요.' },
    heavy: { name: '묵직한 재료', desc: '쇠구슬·너트는 힘 2배.' },
    hard: { name: '단단', desc: '단단함보다 약한 덩어리는 흠집만 나요.' },
    layer: { name: '층 케이크', desc: '위층부터 차례로. 넘친 힘은 아래층에 안 가요.' },
    coat: { name: '젤리 코팅', desc: '떨어뜨린 재료의 절반이 튀어나가요.' }
  };

  var api = {
    CHIP: CHIP, LOSS: LOSS, LOSS_COAT: LOSS_COAT, EPS: EPS, SCORE: SCORE,
    MATERIALS: MATERIALS, HEAVY: HEAVY, LIGHT: LIGHT, LEVELS: LEVELS, FEATURES: FEATURES,
    weightOf: weightOf, powerOf: powerOf, damage: damage, lossRate: lossRate, lossCount: lossCount,
    needPower: needPower, pickLost: pickLost, preview: preview, solve: solve, canStillWin: canStillWin,
    totalHp: totalHp, baseScore: baseScore, finaleScore: finaleScore, starsFor: starsFor, rng: rng, hash: hash
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MKRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
