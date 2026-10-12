/*
 * 모아쿵! — 순수 규칙 모듈 (화면/입력과 무관, Node에서도 require 가능)
 *
 * 가설: "단단함 임계값(armor) + 사용 재료의 1/3 손실" 두 규칙만으로
 *       ① 강한 케이크부터 큰 덩어리 ② 약한 케이크에 조금만 쓰고 아끼기
 *       ③ 전부 모아 아무 순서로 공격 = 실패 가 동시에 성립한다.
 *       (tools/balance.js 가 스테이지별로 이 성질을 전수 검증한다)
 */
(function (root) {
  'use strict';

  // 단단함 미만의 가벼운 덩어리는 흠집(20%)만 낸다.
  var CHIP = 0.2;
  // 낙하에 쓴 재료 중 쟁반 밖으로 튀어 잃는 비율.
  var LOSS_RATE = 1 / 3;
  var DROPS_PER_STAGE = 4;
  var EPS = 1e-6;

  /** 덩어리 n개가 단단함 armor 인 케이크에 주는 피해 */
  function damage(n, armor) {
    if (n <= 0) return 0;
    return n > armor ? (n - armor) + armor * CHIP : n * CHIP;
  }

  /** 낙하 한 번에 n개를 쓰면 잃는 개수 (결정적) */
  function lossOf(n) {
    return Math.round(n * LOSS_RATE);
  }

  /** 남은 몸체 hp 를 한 번에 부수는 데 필요한 최소 개수 */
  function needFor(hp, armor) {
    if (hp <= EPS) return 0;
    // damage 는 n 에 대해 단조 증가 → 구간별 역산
    var nChip = Math.ceil(hp / CHIP - EPS);
    if (nChip <= armor) return Math.max(1, nChip);
    var nOver = Math.floor(armor) + 1;
    var need = Math.ceil(hp + armor - armor * CHIP - EPS);
    return Math.max(nOver, need);
  }

  /** 조준 미리보기: 사용자가 계산하지 않도록 결과를 그대로 알려준다 */
  function preview(n, cake, totalMaterials) {
    var dmg = damage(n, cake.armor);
    var after = Math.max(0, cake.hp - dmg);
    var breaks = after <= EPS;
    var need = needFor(cake.hp, cake.armor);
    var loss = lossOf(n);
    var kind;
    if (breaks) kind = 'break';
    else if (n <= cake.armor) kind = 'scratch';
    else kind = 'crack';
    return {
      n: n,
      kind: kind,
      breaks: breaks,
      damage: dmg,
      hpAfter: after,
      hpRatioAfter: after / cake.maxHp,
      need: need,
      waste: breaks ? Math.max(0, n - need) : 0,
      loss: loss,
      remainAfter: totalMaterials - loss
    };
  }

  /**
   * 남은 재료/횟수로 남은 케이크를 모두 부술 수 있는지 (최적 플레이 기준).
   * 재료의 위치는 결과에 영향이 없으므로 (재료 수, 케이크 hp, 남은 횟수) 상태만으로 정확하다.
   */
  function canStillWin(materials, cakes, dropsLeft) {
    var memo = {};
    function rec(R, hps, d) {
      var alive = false;
      for (var i = 0; i < hps.length; i++) if (hps[i] > EPS) { alive = true; break; }
      if (!alive) return true;
      if (d <= 0 || R <= 0) return false;
      var key = R + '|' + d + '|' + hps.map(function (h) { return h.toFixed(3); }).join(',');
      if (key in memo) return memo[key];
      var ok = false;
      for (var c = 0; c < hps.length && !ok; c++) {
        if (hps[c] <= EPS) continue;
        for (var n = R; n >= 1 && !ok; n--) {
          var h2 = hps.slice();
          h2[c] = Math.max(0, h2[c] - damage(n, cakes[c].armor));
          if (rec(R - lossOf(n), h2, d - 1)) ok = true;
        }
      }
      memo[key] = ok;
      return ok;
    }
    return rec(materials, cakes.map(function (c) { return c.hp; }), dropsLeft);
  }

  /*
   * 재료: 개수 = 힘 (재질은 촉감·소리·튀는 모습만 다름 → 미리보기가 단순해짐)
   * bounce: 높을수록 낙하 때 쟁반 밖으로 튀어나가는 쪽으로 먼저 뽑힌다(개수는 항상 round(n/3)).
   */
  var MATERIALS = {
    steel:  { name: '쇠 구슬',   bounce: 0.75, sound: 'metal' },
    nut:    { name: '작은 너트', bounce: 0.35, sound: 'metal' },
    jelly:  { name: '젤리',      bounce: 0.95, sound: 'jelly' },
    pearl:  { name: '자개 조각', bounce: 0.45, sound: 'glass' },
    button: { name: '단추',      bounce: 0.55, sound: 'click' },
    star:   { name: '별 장식',   bounce: 0.65, sound: 'chime' }
  };
  var MATERIAL_MIX = [
    ['steel', 9], ['nut', 8], ['jelly', 9], ['pearl', 8], ['button', 8], ['star', 8]
  ];

  /*
   * 스테이지: 케이크 위치는 쟁반 바닥 좌표(논리 400×640 화면 기준).
   * hp = 몸체 내구, armor = 단단함 임계값. hardness(1~3) 는 화면 표시용.
   */
  var STAGES = [
    {
      id: 1,
      name: '오후의 티타임',
      hint: '꾹 누른 채 쓸어 모아서, 케이크 위에서 손을 떼요.',
      tip: '단단한 케이크는 큰 덩어리가 아니면 흠집만 나요.',
      seed: 1101,
      materials: 50,
      drops: DROPS_PER_STAGE,
      stars: [24, 14],
      cakes: [
        { kind: 'pudding',    name: '커스터드 푸딩',     hp: 8,  armor: 0,  hardness: 1, x: 112, y: 214, r: 44 },
        { kind: 'shortcake',  name: '딸기 쇼트케이크',   hp: 14, armor: 8,  hardness: 2, x: 292, y: 300, r: 50 },
        { kind: 'choco',      name: '초코 가나슈 케이크', hp: 18, armor: 18, hardness: 3, x: 158, y: 462, r: 54 }
      ]
    },
    {
      id: 2,
      name: '생일 파티',
      hint: '아주 단단한 케이크는 큰 덩어리가 필요해요.',
      tip: '큰 케이크에 먼저 크게 쓰거나, 다른 케이크엔 조금만 써서 아껴 두세요.',
      seed: 2207,
      materials: 50,
      drops: DROPS_PER_STAGE,
      stars: [24, 14],
      cakes: [
        { kind: 'mousse',     name: '레몬 무스',          hp: 6,  armor: 0,  hardness: 1, x: 300, y: 200, r: 42 },
        { kind: 'crepe',      name: '무지개 크레이프',    hp: 12, armor: 6,  hardness: 2, x: 104, y: 260, r: 48 },
        { kind: 'tiered',     name: '3단 생일 케이크',     hp: 20, armor: 22, hardness: 3, x: 230, y: 470, r: 62 }
      ]
    },
    {
      id: 3,
      name: '왕실 디저트',
      hint: '전부 쏟아부으면 모자라요. 필요한 만큼만!',
      tip: '케이크마다 "몇 개면 충분한지" 미리보기를 보고 딱 그만큼만 모아 보세요.',
      seed: 3313,
      materials: 50,
      drops: DROPS_PER_STAGE,
      stars: [20, 13],
      cakes: [
        { kind: 'macaron',    name: '마카롱 탑',          hp: 16, armor: 0,  hardness: 1, x: 112, y: 232, r: 46 },
        { kind: 'cheesecake', name: '베리 치즈케이크',     hp: 24, armor: 12, hardness: 2, x: 292, y: 258, r: 52 },
        { kind: 'crown',      name: '왕관 초코 타르트',    hp: 24, armor: 14, hardness: 3, x: 200, y: 470, r: 56 }
      ]
    }
  ];

  function starsFor(stage, remaining) {
    if (remaining >= stage.stars[0]) return 3;
    if (remaining >= stage.stars[1]) return 2;
    return 1;
  }

  /** 시드 고정 난수 (같은 스테이지 = 같은 배치 → 재시작이 공정하고 재현 가능) */
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

  var api = {
    CHIP: CHIP,
    LOSS_RATE: LOSS_RATE,
    DROPS_PER_STAGE: DROPS_PER_STAGE,
    EPS: EPS,
    damage: damage,
    lossOf: lossOf,
    needFor: needFor,
    preview: preview,
    canStillWin: canStillWin,
    starsFor: starsFor,
    rng: rng,
    MATERIALS: MATERIALS,
    MATERIAL_MIX: MATERIAL_MIX,
    STAGES: STAGES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MKRules = api;
})(typeof window !== 'undefined' ? window : globalThis);
