#!/usr/bin/env node
/*
 * 가설: 스크립트 4개를 인라인한 단일 HTML 하나면 어디서든(파일 공유, 웹 호스팅, 메신저 첨부) 그대로 열린다.
 * 실행: node moakung/tools/build-single.js [출력경로] [--fragment]
 *   --fragment : <!doctype>/<html>/<head>/<body> 래퍼 없이 내용만 출력 (호스트가 문서 골격을 씌우는 경우)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = args.find(a => !a.startsWith('--')) || path.join(ROOT, 'dist', 'moakung.html');

let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, src) => {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  return '<script>\n/* ' + src + ' */\n' + code.replace(/<\/script/gi, '<\\/script') + '\n</script>';
});

if (fragment) {
  const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1]
    .replace(/<meta charset[^>]*>\s*/, '')
    .replace(/<meta name="viewport"[^>]*>\s*/, '')
    .replace(/<title>[\s\S]*?<\/title>\s*/, '');
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = title + '\n' + head.trim() + '\n' + body.trim() + '\n';
  // 호스트 골격이 :root 에 안전영역 여백을 주므로 화면 높이는 100vh 대신 100% 로 맞춘다
  html = html.replace('height: 100vh; height: 100dvh;', 'height: 100%;');
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out} (${(html.length / 1024).toFixed(1)} KB${fragment ? ', fragment' : ''})`);
