#!/usr/bin/env node
/*
 * 가설: 스테이지 수치가 "강한 것부터 크게 / 약한 것엔 조금만 / 전부 아무 순서 = 실패"를 동시에 만족한다.
 * 실행: node moakung/tools/balance.js   (실패 시 exit 1)
 *
 * 화면과 같은 rules.js 를 그대로 써서 전략별 결과를 표로 출력하고, 요구 성질을 검사한다.
 * "+k" 열은 플레이어가 매번 필요량보다 k개 더 모았을 때(수거가 정밀하지 않을 때)의 결과다.
 */
'use strict';
const R = require('../js/rules.js');

function simulate(stage, order, pick) {
  let mats = stage.materials;
  const hp = stage.cakes.map(c => c.hp);
  const log = [];
  for (let d = 0; d < stage.drops; d++) {
    const c = order.find(i => hp[i] > R.EPS);
    if (c === undefined) break;
    const n = Math.min(mats, pick(mats, hp[c], stage.cakes[c]));
    if (n <= 0) break;
    hp[c] = Math.max(0, hp[c] - R.damage(n, stage.cakes[c].armor));
    const lost = R.lossOf(n);
    mats -= lost;
    log.push(`${stage.cakes[c].name} ${n}개(-${lost})`);
  }
  return { win: hp.every(h => h <= R.EPS), left: mats, log };
}
const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
const allIn = () => m => m;
const justEnough = k => (m, hp, cake) => R.needFor(hp, cake.armor) + k;

let failures = 0;
function expect(cond, msg) {
  console.log(`  ${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
}

for (const st of R.STAGES) {
  console.log(`\n■ 스테이지 ${st.id} ${st.name} — 재료 ${st.materials}, 낙하 ${st.drops}`);
  st.cakes.forEach(c => console.log(`   ${c.name}: 몸체 ${c.hp}, 단단함 ${c.armor} → 한 번에 ${R.needFor(c.hp, c.armor)}개`));
  const idx = st.cakes.map((_, i) => i);
  const byHard = [...idx].sort((a, b) => R.needFor(st.cakes[b].hp, st.cakes[b].armor) - R.needFor(st.cakes[a].hp, st.cakes[a].armor));
  const bySoft = [...byHard].reverse();
  const name = o => o.map(i => st.cakes[i].name.split(' ')[0]).join('>');
  const table = [];
  for (const p of perms(idx)) {
    const a = simulate(st, p, allIn());
    const j = [0, 2, 4, 6].map(k => simulate(st, p, justEnough(k)));
    table.push({ order: name(p), allIn: a, j });
    console.log(`   ${name(p).padEnd(16)} 전부: ${a.win ? '승' : '패'}(${String(a.left).padStart(2)})  필요만 +0/+2/+4/+6: ` +
      j.map(x => `${x.win ? '승' : '패'}${String(x.left).padStart(2)}`).join(' '));
  }
  const allInHard = simulate(st, byHard, allIn());
  const allInSoft = simulate(st, bySoft, allIn());
  const saveSoft = simulate(st, bySoft, justEnough(4));
  const hardEnough = simulate(st, byHard, justEnough(4));
  console.log(`   예) 전부·강한순: ${allInHard.log.join(' → ')}`);
  console.log(`   예) 전부·약한순: ${allInSoft.log.join(' → ')}`);
  console.log(`   예) 필요+4·약한순: ${saveSoft.log.join(' → ')}`);

  expect(allInSoft.win === false, '전부 모아 약한 것부터 공격하면 실패한다');
  expect(saveSoft.win, '약한 것부터 조금씩(필요+4개) 아끼면 승리한다');
  expect(hardEnough.win, '강한 것부터 필요한 만큼(+4개) 쓰면 승리한다');
  if (st.id <= 2) expect(allInHard.win, '처음의 큰 덩어리로 강한 것부터 부수면(전부 사용) 승리한다');
  if (st.id === 3) expect(table.every(t => !t.allIn.win), '모든 순서에서 "전부 사용"은 실패한다 (절약 필수)');
  expect(table.every(t => t.j[0].win), '필요한 만큼만 쓰면 어떤 순서로도 승리한다');
  expect(R.canStillWin(st.materials, st.cakes, st.drops), 'canStillWin(초기) = true');
}

// 규칙 함수 자체 점검
console.log('\n■ 규칙 함수');
let needOk = true;
for (let hp = 1; hp <= 30; hp++) for (let a = 0; a <= 26; a++) {
  const n = R.needFor(hp, a);
  if (R.damage(n, a) < hp - R.EPS || (n > 1 && R.damage(n - 1, a) >= hp - R.EPS)) needOk = false;
}
expect(needOk, 'needFor 는 한 번에 부수는 최소 개수다 (hp 1~30, armor 0~26 전수)');
expect(R.lossOf(3) === 1 && R.lossOf(30) === 10 && R.lossOf(50) === 17, 'lossOf = round(n/3)');

console.log(failures ? `\n✘ 실패 ${failures}건` : '\n✔ 모든 밸런스 성질 통과');
process.exit(failures ? 1 : 0);
