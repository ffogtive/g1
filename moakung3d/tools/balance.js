#!/usr/bin/env node
/*
 * 가설: 레벨마다 "딱 맞게 모으기 = ★★★ 가능", "전부 쏟기 = 실패하거나 별이 적음"이 성립하고,
 *       수거가 조금 넘쳐도(+2/+4개) 클리어는 가능하다.
 * 실행: node moakung3d/tools/balance.js   (실패 시 exit 1)
 *
 * 화면과 같은 rules.js 를 쓴다. 플레이어 모델:
 *  - all  : 매번 바닥 재료 전부 (금속 우선)
 *  - fit+k: 매번 "이번 층을 부수는 데 필요한 힘"이 될 때까지 금속부터 모으고 k개 더
 *  - light+k: 금속을 일부러 피하고 가벼운 것부터 (금속 2배를 모르는 플레이어)
 */
'use strict';
const R = require('../js/rules.js');

function simulate(lv, pick) {
  let heavy = lv.heavy, light = lv.light, top = 0, hp = lv.layers[0].hp, drops = lv.drops, score = 0;
  const log = [];
  while (drops > 0 && top < lv.layers.length && heavy + light > 0) {
    const L = lv.layers[top];
    const [a, b] = pick(heavy, light, hp, L.armor);
    if (a + b <= 0) break;
    const P = 2 * a + b;
    const dmg = Math.min(hp, R.damage(P, L.armor));
    score += Math.round(dmg * R.SCORE.perDamage);
    hp -= R.damage(P, L.armor);
    const k = R.lossCount(a + b, lv);
    const lostL = Math.min(k, b), lostH = k - lostL;
    light -= lostL; heavy -= lostH; drops--;
    log.push(`${a}금+${b}가=${P}힘${hp <= R.EPS ? '→부숨' : ''}(-${k})`);
    if (hp <= R.EPS) { top++; hp = top < lv.layers.length ? lv.layers[top].hp : 0; }
  }
  const win = top >= lv.layers.length;
  if (win) score += R.SCORE.clear + R.finaleScore(drops, heavy, light);
  return { win, score, stars: R.starsFor(lv, score, win), log: log.join(' ') };
}
const all = () => (h, l) => [h, l];
const fit = k => (h, l, hp, armor) => {
  const need = R.needPower(hp, armor);
  let a = Math.min(h, Math.floor(need / 2)), b = Math.min(l, need - 2 * a);
  if (2 * a + b < need && a < h) a++;
  let extra = k;
  while (extra > 0 && b < l) { b++; extra--; }
  while (extra > 0 && a < h) { a++; extra--; }
  return [a, b];
};
const lightFirst = k => (h, l, hp, armor) => {
  const need = R.needPower(hp, armor);
  let b = Math.min(l, need), a = Math.min(h, Math.ceil(Math.max(0, need - b) / 2));
  let extra = k;
  while (extra > 0 && b < l) { b++; extra--; }
  return [a, b];
};

let fails = 0;
const expect = (c, m) => { console.log(`   ${c ? '✔' : '✘'} ${m}`); if (!c) fails++; };
for (const lv of R.LEVELS) {
  const layers = lv.layers.map(l => `${l.hp}/${l.armor}`).join(' → ');
  console.log(`\n■ ${lv.id}. ${lv.name} [${R.FEATURES[lv.feature].name}${lv.coat ? ', 젤리코팅' : ''}] 층(hp/단단함) ${layers} · 금속 ${lv.heavy} 가벼움 ${lv.light} · 낙하 ${lv.drops}`);
  console.log(`   별 기준 ★★ ${lv.stars[0]} / ★★★ ${lv.stars[1]} (최적 피날레 ${lv.bestFinale}, 최고 ${R.baseScore(lv) + lv.bestFinale})`);
  const rows = { '전부': simulate(lv, all()), '딱맞게': simulate(lv, fit(0)), '딱+2': simulate(lv, fit(2)), '딱+4': simulate(lv, fit(4)), '가벼운것만+2': simulate(lv, lightFirst(2)) };
  for (const [k, r] of Object.entries(rows)) console.log(`   ${k.padEnd(8)} ${r.win ? '승' : '패'} ${String(r.score).padStart(5)}점 ${'★'.repeat(r.stars).padEnd(3, '☆')}  ${r.log}`);
  expect(lv.bestFinale >= 0, '클리어 가능');
  expect(rows['딱맞게'].win && rows['딱맞게'].stars === 3, '딱 맞게 모으면 ★★★');
  expect(rows['딱+4'].win, '4개씩 넘쳐도 클리어');
  if (lv.id >= 2) expect(!rows['전부'].win || rows['전부'].stars < rows['딱맞게'].stars, '전부 쏟으면 실패하거나 별이 적음');
  if (lv.layers.length > 1) expect(!rows['전부'].win, '여러 층: 전부 쏟으면 넘친 힘이 버려져 실패');
  expect(rows['딱+2'].stars === 3, '2개씩 넘쳐도 ★★★');
  expect(rows['가벼운것만+2'].win, '묵직한 재료를 몰라도(가벼운 것 위주) 클리어');
}
console.log(fails ? `\n✘ 실패 ${fails}건` : '\n✔ 모든 레벨 성질 통과');
process.exit(fails ? 1 : 0);
