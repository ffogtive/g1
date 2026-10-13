// 로컬 서버 단위 테스트: 영상 구간 요청(Range)·HEAD·404·경로 탈출·MIME.
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:kungkung_app/local_server.dart';

void main() {
  final files = <String, Uint8List>{
    'real.html': Uint8List.fromList(utf8.encode('<p>킁킁</p>')),
    'real/v3/idle.mp4': Uint8List.fromList(List<int>.generate(1000, (i) => i % 256)),
  };
  late LocalGameServer server;
  late HttpClient client;

  setUp(() async {
    server = LocalGameServer((p) async => files[p]);
    await server.start();
    client = HttpClient();
  });

  tearDown(() async {
    client.close(force: true);
    await server.close();
  });

  Future<(HttpClientResponse, List<int>)> send(String path, {String method = 'GET', String? range}) async {
    final req = await client.openUrl(method, Uri.parse('http://127.0.0.1:${server.port}$path'));
    if (range != null) req.headers.set(HttpHeaders.rangeHeader, range);
    final res = await req.close();
    final body = await res.fold<List<int>>(<int>[], (a, b) => a..addAll(b));
    return (res, body);
  }

  test('전체 파일은 200 + 길이 + MIME', () async {
    final (res, body) = await send('/real/v3/idle.mp4');
    expect(res.statusCode, 200);
    expect(body.length, 1000);
    expect(res.headers.contentType!.mimeType, 'video/mp4');
    expect(res.headers.value('accept-ranges'), 'bytes');
  });

  test('구간 요청은 206 + Content-Range + 그 구간 바이트', () async {
    final (res, body) = await send('/real/v3/idle.mp4', range: 'bytes=100-199');
    expect(res.statusCode, 206);
    expect(res.headers.value('content-range'), 'bytes 100-199/1000');
    expect(body, files['real/v3/idle.mp4']!.sublist(100, 200));
  });

  test('열린 구간·끝 구간·처음 2바이트(Safari 탐색 요청)', () async {
    final (a, ab) = await send('/real/v3/idle.mp4', range: 'bytes=990-');
    expect(a.statusCode, 206);
    expect(ab.length, 10);
    final (b, bb) = await send('/real/v3/idle.mp4', range: 'bytes=-5');
    expect(b.headers.value('content-range'), 'bytes 995-999/1000');
    expect(bb.length, 5);
    final (c, cb) = await send('/real/v3/idle.mp4', range: 'bytes=0-1');
    expect(c.statusCode, 206);
    expect(cb, <int>[0, 1]);
  });

  test('범위 밖 구간은 416', () async {
    final (res, _) = await send('/real/v3/idle.mp4', range: 'bytes=5000-');
    expect(res.statusCode, 416);
    expect(res.headers.value('content-range'), 'bytes */1000');
  });

  test('HEAD는 본문 없이 길이만', () async {
    final (res, body) = await send('/real.html', method: 'HEAD');
    expect(res.statusCode, 200);
    expect(res.contentLength, utf8.encode('<p>킁킁</p>').length);
    expect(body, isEmpty);
    expect(res.headers.contentType!.charset, 'utf-8');
  });

  test('없는 파일·경로 탈출은 404, POST는 405', () async {
    expect((await send('/nope.mp4')).$1.statusCode, 404);
    expect(LocalGameServer.safePath('/real/../../etc/passwd'), isNull);
    expect(LocalGameServer.safePath('/real/%2e%2e/x'), isNull);
    // %2e%2e는 URL 정규화로 /real.html이 된다: 폴더 밖으로는 못 나간다.
    final (norm, normBody) = await send('/real/%2e%2e/real.html');
    expect(norm.statusCode, 200);
    expect(utf8.decode(normBody), '<p>킁킁</p>');
    expect((await send('/real/%2e%2e/%2e%2e/etc/passwd')).$1.statusCode, 404);
    expect((await send('/real.html', method: 'POST')).$1.statusCode, 405);
  });

  test('쿼리는 무시하고 같은 파일', () async {
    final (res, body) = await send('/real.html?hs=80&nocv=1');
    expect(res.statusCode, 200);
    expect(utf8.decode(body), '<p>킁킁</p>');
  });
}
