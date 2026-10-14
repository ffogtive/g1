// 앱에 넣은 게임 파일 점검: real.html이 부르는 클립(mp4)·기준 사진·소리가 assets/web 안에 모두 있는가.
// tool/sync_web.sh를 돌리기 전(assets/web/real.html이 없을 때)에는 건너뛴다.
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final root = Directory('assets/web');
  final page = File('assets/web/real.html');
  final synced = page.existsSync();

  test('앱 안 real.html이 원본(../real.html)과 같음 — 원본을 고치고 sync를 잊으면 실패', () {
    final src = File('../real.html');
    expect(page.readAsStringSync() == src.readAsStringSync(), isTrue, reason: 'tool/sync_web.sh를 다시 돌린다');
  }, skip: synced && File('../real.html').existsSync() ? false : 'tool/sync_web.sh를 먼저 돌린다');

  test('real.html이 부르는 클립이 모두 mp4로 들어 있음', () {
    final html = page.readAsStringSync();
    final clips = RegExp(r"'((?:v3|ostrich)/[a-z0-9_]+)'").allMatches(html).map((m) => m.group(1)!).toSet();
    expect(clips.length, greaterThanOrEqualTo(25), reason: '종 표에서 클립 이름을 못 찾음');
    final missing = clips.where((c) => !File('${root.path}/real/$c.mp4').existsSync()).toList()..sort();
    expect(missing, isEmpty, reason: '앱에 없는 클립: $missing (tool/sync_web.sh를 다시 돌린다)');
  }, skip: synced ? false : 'tool/sync_web.sh를 먼저 돌린다');

  test('기준 사진·비스킷·소리 manifest의 파일이 모두 있음', () {
    final html = page.readAsStringSync();
    final pics = RegExp(r"'(real/[a-z0-9_/]+\.(?:jpg|webp))'").allMatches(html).map((m) => m.group(1)!).toSet();
    expect(pics, contains('real/biscuit.webp'));
    for (final p in pics) {
      expect(File('${root.path}/$p').existsSync(), isTrue, reason: '$p 없음');
    }
    final man = jsonDecode(File('${root.path}/real/sfx/manifest.json').readAsStringSync()) as Map<String, dynamic>;
    final files = (man['files'] as Map<String, dynamic>).values.cast<String>();
    for (final f in files) {
      expect(File('${root.path}/real/sfx/$f').existsSync(), isTrue, reason: 'real/sfx/$f 없음');
    }
  }, skip: synced ? false : 'tool/sync_web.sh를 먼저 돌린다');

  test('webm·소리 후보는 넣지 않음 (앱 크기)', () {
    final extra = root.listSync(recursive: true).whereType<File>().where((f) => f.path.endsWith('.webm') || f.path.contains('/cand/')).toList();
    expect(extra, isEmpty);
  }, skip: synced ? false : 'tool/sync_web.sh를 먼저 돌린다');
}
