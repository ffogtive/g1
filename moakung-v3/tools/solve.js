#!/usr/bin/env node
/*
 * 몽글탑 판 계산기 — tower.html 의 규칙 블록을 그대로 꺼내 쓴다 (목업과 항상 같은 규칙).
 * 가설: 판 하나가 "막 쌓으면 무너지고, 생각해서 쌓으면 깬다"인지는 감으로 맞출 수 없으니 전수 탐색으로 확인한다.
 * 실행: node moakung-v3/tools/solve.js            (현재 판: 최선 풀이, 탑 높이별 무너짐 비율, 첫 밀기 선택지)
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'tower.html'), 'utf8');
const R = {}; vm.createContext(R); vm.runInContext(html.match(/\/\*RULES-START\*\/([\s\S]*?)\/\*RULES-END\*\//)[1], R);
const KINDS = ['kwang', 'gil', 'mong', 'puff'];
const pick = (re) => JSON.parse(html.match(re)[1].replace(/'/g, '"'));
const ROSTER = pick(/var ROSTER = (\[[^\]]*\]);/), BOARD = pick(/var BOARD = (\[\[[\s\S]*?\]\]);/), BUCKETS = +html.match(/var BUCKETS = (\d+);/)[1];
const roster = {}; KINDS.forEach(k => roster[k] = ROSTER.filter(x => x === k).length);
const level = { roster, buckets: BUCKETS, cols: BOARD.map(c => ({ cells: c, mole: true })) };

function seqs(counts, maxLen) {
  const out = [];
  (function rec(cur, c) { if (cur.length) out.push(cur.slice()); if (cur.length >= maxLen) return; for (const k of KINDS) if (c[k] > 0) { c[k]--; cur.push(k); rec(cur, c); cur.pop(); c[k]++; } })([], Object.assign({}, counts));
  return out;
}
const useful = (sim, bk) => sim.buckets < bk || sim.ev.some(e => e.hits.some(h => h.broke.length));
function solve(lv) {
  const memo = new Map();
  function dfs(counts, cols, bk) {
    const left = KINDS.reduce((s, k) => s + counts[k], 0);
    if (bk <= 0) return { left, plan: [] };
    if (!left) return null;
    const key = KINDS.map(k => counts[k]).join('') + '|' + cols.map(c => c.cells.join('')).join('/') + '|' + bk;
    if (memo.has(key)) return memo.get(key);
    let best = null;
    for (const s of seqs(counts, 6)) {
      const st = R.stability(s); if (st.R > 1) continue;
      const sim = R.simulate(cols, bk, s); if (!useful(sim, bk)) continue;
      const c2 = Object.assign({}, counts); s.forEach(k => c2[k]--);
      const r = dfs(c2, sim.cols, sim.buckets);
      if (r && (!best || r.left > best.left || (r.left === best.left && r.plan.length + 1 < best.plan.length))) best = { left: r.left, plan: [`${s.join('-')} (흔들림 ${st.R.toFixed(2)}, 양동이 ${bk}→${sim.buckets})`].concat(r.plan) };
    }
    memo.set(key, best);
    return best;
  }
  return dfs(Object.assign({}, lv.roster), lv.cols, lv.buckets);
}
const best = solve(level);
console.log('판:', JSON.stringify(roster), '양동이', BUCKETS, '흔들림 한계', R.RULE.LIMIT);
console.log('최선: 남은 친구', best ? best.left : '불가', best ? '\n  ' + best.plan.join('\n  → ') : '');
const byLen = {};
seqs(level.roster, 6).forEach(s => { const L = s.length, b = byLen[L] = byLen[L] || { n: 0, c: 0 }; b.n++; if (R.stability(s).R > 1) b.c++; });
console.log('탑 높이별 무너짐:', Object.entries(byLen).map(([L, b]) => `${L}마리 ${Math.round(100 * b.c / b.n)}%`).join(', '));
let tot = 0, ok = 0;
for (const s of seqs(level.roster, 6)) {
  if (R.stability(s).R > 1) continue;
  const sim = R.simulate(level.cols, level.buckets, s); if (!useful(sim, level.buckets)) continue;
  tot++; const c2 = Object.assign({}, level.roster); s.forEach(k => c2[k]--);
  if (solve({ roster: c2, buckets: sim.buckets, cols: sim.cols })) ok++;
}
console.log(`첫 밀기: 무너지지 않고 뭔가 깨는 ${tot}가지 중 ${ok}가지(${Math.round(100 * ok / tot)}%)가 이길 수 있는 길`);
