#!/usr/bin/env node
/*
 * 몽글탑 판 계산기 — tower.html 의 규칙 블록을 그대로 꺼내 쓴다 (목업과 항상 같은 규칙).
 * 가설: 판 하나가 "막 쌓으면 무너지고, 생각해서 쌓으면 깬다"인지는 감으로 맞출 수 없으니 전수 탐색으로 확인한다.
 * 실행: node moakung-v3/tools/solve.js
 *   - 최선 풀이(남는 친구 최대), 안전 루트(흔들림 빨강 0.8 미만만), 탑 높이별 무너짐 비율, 첫 밀기 선택지
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'tower.html'), 'utf8');
const R = {}; vm.createContext(R); vm.runInContext(html.match(/\/\*RULES-START\*\/([\s\S]*?)\/\*RULES-END\*\//)[1], R);
const KINDS = ['kwang', 'gil', 'mong', 'puff'];
const NAME = { kwang: '꽝돌', gil: '길쭉', mong: '몽이', puff: '부풀' };
const pick = (re) => JSON.parse(html.match(re)[1].replace(/'/g, '"'));
const ROSTER = pick(/var ROSTER = (\[[^\]]*\]);/), BOARD = pick(/var BOARD = (\[\[[\s\S]*?\]\]);/), BUCKETS = +html.match(/var BUCKETS = (\d+);/)[1];
const roster = {}; KINDS.forEach(k => roster[k] = ROSTER.filter(x => x === k).length);
const level = { roster, king: { buckets: BUCKETS, dmg: 0 }, cols: BOARD.map(c => ({ cells: c.map(m => ({ m, hp: R.RULE.HP[m] })), mole: true })) };

function seqs(counts, maxLen) {
  const out = [];
  (function rec(cur, c) { if (cur.length) out.push(cur.slice()); if (cur.length >= maxLen) return; for (const k of KINDS) if (c[k] > 0) { c[k]--; cur.push(k); rec(cur, c); cur.pop(); c[k]++; } })([], Object.assign({}, counts));
  return out;
}
const did = (sim, king) => sim.king.buckets < king.buckets || sim.king.dmg !== king.dmg || sim.ev.some(e => e.hits.some(h => h.dmg.length));
const key = (counts, cols, king) => KINDS.map(k => counts[k]).join('') + '|' + cols.map(c => c.cells.map(x => x.m + x.hp).join('')).join('/') + '|' + king.buckets + ':' + king.dmg;
/** maxR: 이 흔들림을 넘는 탑은 안 쌓음 (1 = 무너지기 직전까지, 0.8 = 빨강 안 가기) */
function makeSolver(maxR) {
  const memo = new Map();
  return function dfs(counts, cols, king) {
    const left = KINDS.reduce((s, k) => s + counts[k], 0);
    if (king.buckets <= 0) return { left, plan: [] };
    if (!left) return null;
    const kk = key(counts, cols, king); if (memo.has(kk)) return memo.get(kk);
    let best = null;
    for (const s of seqs(counts, 6)) {
      const st = R.stability(s); if (st.R > maxR) continue;
      const sim = R.simulate(cols, king, s); if (!did(sim, king)) continue;
      const c2 = Object.assign({}, counts); s.forEach(k => c2[k]--);
      const r = dfs(c2, sim.cols, sim.king);
      if (r && (!best || r.left > best.left || (r.left === best.left && r.plan.length + 1 < best.plan.length))) best = { left: r.left, plan: [{ tower: s, R: st.R, from: king, to: sim.king }].concat(r.plan) };
    }
    memo.set(kk, best); return best;
  };
}
const fmt = (p) => `${p.tower.map(k => NAME[k]).join(' → ')}  (흔들림 ${p.R.toFixed(2)}, 양동이 ${p.from.buckets}개${p.from.dmg ? `·찌그러짐 ${p.from.dmg}` : ''} → ${p.to.buckets}개${p.to.dmg ? `·찌그러짐 ${p.to.dmg}` : ''})`;
const show = (title, r) => console.log(`${title}: ${r ? `남은 친구 ${r.left}` : '불가'}${r ? '\n  ' + r.plan.map((p, i) => `${i + 1}번째 밀기 (아래→위): ${fmt(p)}`).join('\n  ') : ''}`);

console.log('판:', Object.entries(roster).map(([k, v]) => NAME[k] + v).join(' '), '| 양동이', BUCKETS, '× 체력', R.RULE.BUCKET_HP, '| 흔들림 한계', R.RULE.LIMIT);
const full = makeSolver(1), safe = makeSolver(0.8);
show('최선', full(Object.assign({}, roster), level.cols, level.king));
show('안전 루트(빨강 안 감)', safe(Object.assign({}, roster), level.cols, level.king));
const byLen = {};
seqs(roster, 6).forEach(s => { const L = s.length, b = byLen[L] = byLen[L] || { n: 0, c: 0 }; b.n++; if (R.stability(s).R > 1) b.c++; });
console.log('탑 높이별 무너짐:', Object.entries(byLen).map(([L, b]) => `${L}마리 ${Math.round(100 * b.c / b.n)}%`).join(', '));
let tot = 0, ok = 0; const dist = {};
for (const s of seqs(roster, 6)) {
  if (R.stability(s).R > 1) continue;
  const sim = R.simulate(level.cols, level.king, s); if (!did(sim, level.king)) continue;
  tot++; const c2 = Object.assign({}, roster); s.forEach(k => c2[k]--);
  const r = full(c2, sim.cols, sim.king); if (r) { ok++; dist[r.left] = (dist[r.left] || 0) + 1; }
}
console.log(`첫 밀기: 무너지지 않고 뭔가 깎는 ${tot}가지 중 ${ok}가지(${Math.round(100 * ok / tot)}%)가 이길 수 있는 길 · 그 뒤 최선으로 남는 친구 분포 ${JSON.stringify(dist)}`);
