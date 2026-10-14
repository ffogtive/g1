#!/usr/bin/env node
/*
 * 가설: 스크립트를 한 파일로 묶으면 링크 하나로 휴대폰에서도 바로 열린다.
 * 실행: node moakung3d/tools/build-single.js [출력경로] [--fragment] [--cdn]
 *   --fragment : <!doctype>/<html>/<head>/<body> 없이 내용만 (호스트가 문서 골격을 씌우는 경우)
 *   --cdn      : three.js 는 jsDelivr(npm 미러)에서 불러오고 나머지만 인라인 (파일 크기 절약)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const cdn = args.includes('--cdn');
const out = args.find(a => !a.startsWith('--')) || path.join(ROOT, 'dist', 'moakung3d.html');

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script src="((?:js|vendor|assets)\/[^"]+)"><\/script>/g, (m, src) => {
  if (cdn && src === 'vendor/three.min.js') return '<script src="https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js"></script>';
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  return '<script>\n/* ' + src + ' */\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
});
if (fragment) {
  const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '').replace(/<title>[\s\S]*?<\/title>\s*/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = title + '\n' + head.trim() + '\n' + body.trim() + '\n';
  // 호스트 골격이 :root 에 안전영역 여백을 주므로 100vh 대신 100%
  html = html.replace('height: 100vh; height: 100dvh;', 'height: 100%;');
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024).toFixed(0)} KB${fragment ? ', fragment' : ''}${cdn ? ', three.js CDN' : ''})`);
