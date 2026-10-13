// make-sfx.js — 킁킁! 실사판 효과음을 ElevenLabs 효과음 API로 만들고, 들어 보고 고른다
// 가설: 합성음(잡음 필터)보다 진짜 강아지 킁킁·앙 소리가 "실사" 손맛을 크게 올린다.
//
// 준비: 환경 변수 ELEVENLABS_API_KEY (키 값은 어디에도 쓰지 않는다). 키에 "Sound Effects" 권한이 켜져 있어야 한다.
// 1) 후보 만들기:  node kungkung/tools/make-sfx.js gen [이름당 개수=2] [이름…]
//      → real/sfx/cand/<이름>-<번호>.mp3 (git 제외) + real/sfx/cand/pick.html (들어 보고 고르는 페이지)
// 2) 고르기:       node kungkung/tools/make-sfx.js pick sniff-2 chomp-1 …
//      → 앞 무음을 자르고 소리 크기를 −16 LUFS로 맞춰 real/sfx/<이름>.mp3, real/sfx/manifest.json 갱신
// 게임은 manifest에 있는 소리만 받아 쓰고, 없는 소리는 합성음으로 대신한다.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const DIR = path.resolve(__dirname, '..', 'real', 'sfx'), CAND = path.join(DIR, 'cand'), MAN = path.join(DIR, 'manifest.json');
const PROMPTS = {
  sniff:  ['A small puppy sniffing quickly with its nose close to the microphone: two short rapid nasal sniffs, dry, close-up foley, no barking, no background',
           'Cute little dog snuffling the grass, quick sniff sniff, soft nasal snorts, very close microphone, clean foley, no ambience'],
  inhale: ['A puppy taking one long deep sniff inhale through its nose, building up, close microphone, no background'],
  chomp:  ['A small dog snapping its jaws shut once, quick teeth clack bite, close-up foley, no growl, no background'],
  crunch: ['A puppy biting and crunching a dry dog biscuit once, crisp crunch, close-up foley, no background'],
  grass:  ['A small dog biting a mouthful of grass, soft leafy rustle and teeth snap, close-up foley, no background'],
  chew:   ['A happy puppy chewing a crunchy treat for a second, small crunches and lip smacks, close-up foley, no background'],
  sneeze: ['A tiny cute puppy sneeze, one short nasal achoo, close microphone, no background'],
  pop:    ['A soft cartoon pop bubble sound, short and cute, no background']
};
const man = () => { try { return JSON.parse(fs.readFileSync(MAN, 'utf8')); } catch (e) { return { files: {} }; } };

async function gen(per, names) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) { console.error('ELEVENLABS_API_KEY가 없습니다. 환경 설정에 넣으면 새 세션부터 쓸 수 있습니다.'); process.exit(2); }
  fs.mkdirSync(CAND, { recursive: true });
  const list = [];
  for (const name of names.length ? names : Object.keys(PROMPTS)) {
    const ps = PROMPTS[name]; if (!ps) { console.error('모르는 이름:', name); continue; }
    for (let k = 1; k <= per; k++) {
      // curl을 쓴다: 이 환경의 프록시를 따르고, 키는 명령줄이 아니라 표준입력 설정(-K -)으로만 넘긴다
      const f = path.join(CAND, `${name}-${k}.mp3`), body = JSON.stringify({ text: ps[(k - 1) % ps.length], duration_seconds: name === 'chew' ? 1.4 : name === 'inhale' ? 1.0 : 0.8, prompt_influence: 0.65 });
      const code = execFileSync('curl', ['-sS', '-K', '-', '-X', 'POST', 'https://api.elevenlabs.io/v1/sound-generation', '-H', 'Content-Type: application/json', '-H', 'Accept: audio/mpeg', '--data-binary', body, '-o', f, '-w', '%{http_code}'],
        { input: 'header = "xi-api-key: ' + key + '"\n' }).toString().trim();
      if (code !== '200') {
        const t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').slice(0, 300) : ''; try { fs.unlinkSync(f); } catch (e) { /* 무시 */ }
        if (/missing_permissions|sound_generation/.test(t)) { console.error('이 키에 효과음 권한이 없습니다: elevenlabs.io → Developers → API Keys → 키 Edit → "Sound Effects" Access를 켜세요.'); process.exit(3); }
        console.error(name, k, code, t); continue;
      }
      list.push(path.basename(f)); console.log('만듦', path.basename(f));
    }
  }
  const all = fs.readdirSync(CAND).filter(f => f.endsWith('.mp3')).sort();
  fs.writeFileSync(path.join(CAND, 'pick.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>킁킁 소리 고르기</title><body style="font:16px system-ui;padding:16px">' +
    '<h2>킁킁! 소리 후보</h2>' + all.map(f => `<p><b>${f.replace('.mp3', '')}</b><br><audio controls preload="none" src="${f}"></audio></p>`).join('') + '</body>');
  console.log('후보', list.length, '개 →', path.relative(process.cwd(), path.join(CAND, 'pick.html')));
}
function pick(ids) {
  const M = man(); M.files = M.files || {};
  for (const id of ids) {
    const m = /^([a-z]+)-\d+$/.exec(id), src = path.join(CAND, id + '.mp3'); if (!m || !fs.existsSync(src)) { console.error('없음:', id); continue; }
    const out = path.join(DIR, m[1] + '.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,silenceremove=start_periods=1:start_threshold=-45dB', '-ar', '44100', '-ac', '1', '-b:a', '96k', out]);
    M.files[m[1]] = m[1] + '.mp3'; console.log('골랐음', id, '→', path.relative(process.cwd(), out));
  }
  fs.writeFileSync(MAN, JSON.stringify(M, null, 1) + '\n');
}
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'gen') gen(+(rest[0] || 2), rest.slice(1)).catch(e => { console.error(e); process.exit(1); });
else if (cmd === 'pick') pick(rest);
else { console.log('사용법: node kungkung/tools/make-sfx.js gen [개수] [이름…] | pick <이름-번호>…'); }
