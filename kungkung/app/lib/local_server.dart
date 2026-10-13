// 앱 안 로컬 웹 서버: 게임 파일(assets/web)을 http://127.0.0.1:<포트>/ 로 내준다.
//
// 가설: WKWebView에서 영상은 구간 요청(Range)으로 받고, 효과음은 fetch로 받으므로
// file:// 대신 Range를 지원하는 HTTP 서버가 있어야 웹 게임이 그대로 돈다.
// flutter 없이 dart:io만 써서, 같은 코드를 tool/serve.dart로 컨테이너 E2E에도 쓴다.
import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

/// 상대 경로(예: `real/v3/idle.mp4`)의 바이트를 돌려준다. 없으면 null.
typedef AssetLoader = Future<Uint8List?> Function(String path);

class LocalGameServer {
  LocalGameServer(this._load, {this.cacheLimitBytes = 96 << 20});

  final AssetLoader _load;
  final int cacheLimitBytes;
  final Map<String, Uint8List> _cache = <String, Uint8List>{};
  int _cachedBytes = 0;
  HttpServer? _server;

  int get port => _server!.port;

  Uri url(String path) => Uri.parse('http://127.0.0.1:$port/$path');

  Future<void> start({int port = 0}) async {
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, port);
    _server!.listen(_handle);
  }

  Future<void> close() async {
    await _server?.close(force: true);
    _server = null;
  }

  static const Map<String, String> _types = <String, String>{
    'html': 'text/html; charset=utf-8',
    'js': 'text/javascript; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'json': 'application/json; charset=utf-8',
    'mp4': 'video/mp4',
    'webm': 'video/webm',
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'ttf': 'font/ttf',
    'woff2': 'font/woff2',
  };

  static String contentTypeFor(String path) {
    final dot = path.lastIndexOf('.');
    final ext = dot < 0 ? '' : path.substring(dot + 1).toLowerCase();
    return _types[ext] ?? 'application/octet-stream';
  }

  /// 요청 경로를 assets/web 안의 상대 경로로 바꾼다. 밖으로 나가려 하면 null.
  static String? safePath(String requestPath) {
    String decoded;
    try {
      decoded = Uri.decodeComponent(requestPath);
    } catch (_) {
      return null;
    }
    final parts = <String>[];
    for (final seg in decoded.split('/')) {
      if (seg.isEmpty || seg == '.') continue;
      if (seg == '..' || seg.contains('\\')) return null;
      parts.add(seg);
    }
    return parts.isEmpty ? 'index.html' : parts.join('/');
  }

  /// `bytes=a-b`, `bytes=a-`, `bytes=-n` 중 첫 구간. 범위 밖이면 (-1, -1), 헤더가 없으면 null.
  static (int, int)? parseRange(String? header, int length) {
    if (header == null) return null;
    final m = RegExp(r'^bytes=(\d*)-(\d*)').firstMatch(header.trim());
    if (m == null) return null;
    final a = m.group(1)!, b = m.group(2)!;
    int start, end;
    if (a.isEmpty) {
      if (b.isEmpty) return null;
      final n = int.parse(b);
      if (n == 0) return (-1, -1);
      start = n >= length ? 0 : length - n;
      end = length - 1;
    } else {
      start = int.parse(a);
      end = b.isEmpty ? length - 1 : int.parse(b);
      if (end >= length) end = length - 1;
    }
    if (length == 0 || start >= length || start > end) return (-1, -1);
    return (start, end);
  }

  Future<Uint8List?> _get(String rel) async {
    final hit = _cache[rel];
    if (hit != null) return hit;
    final data = await _load(rel);
    if (data != null && _cachedBytes + data.length <= cacheLimitBytes) {
      _cache[rel] = data;
      _cachedBytes += data.length;
    }
    return data;
  }

  Future<void> _handle(HttpRequest req) async {
    final res = req.response;
    try {
      if (req.method != 'GET' && req.method != 'HEAD') {
        res.statusCode = HttpStatus.methodNotAllowed;
        await res.close();
        return;
      }
      final rel = safePath(req.uri.path);
      final data = rel == null ? null : await _get(rel);
      if (rel == null || data == null) {
        res.statusCode = HttpStatus.notFound;
        await res.close();
        return;
      }
      res.headers.set(HttpHeaders.contentTypeHeader, contentTypeFor(rel));
      res.headers.set(HttpHeaders.acceptRangesHeader, 'bytes');
      res.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
      final range = parseRange(req.headers.value(HttpHeaders.rangeHeader), data.length);
      final head = req.method == 'HEAD';
      if (range != null && range.$1 < 0) {
        res.statusCode = HttpStatus.requestedRangeNotSatisfiable;
        res.headers.set(HttpHeaders.contentRangeHeader, 'bytes */${data.length}');
        await res.close();
        return;
      }
      if (range != null) {
        final (start, end) = range;
        res.statusCode = HttpStatus.partialContent;
        res.headers.set(HttpHeaders.contentRangeHeader, 'bytes $start-$end/${data.length}');
        res.contentLength = end - start + 1;
        if (!head) res.add(Uint8List.sublistView(data, start, end + 1));
      } else {
        res.statusCode = HttpStatus.ok;
        res.contentLength = data.length;
        if (!head) res.add(data);
      }
      await res.close();
    } catch (_) {
      try {
        res.statusCode = HttpStatus.internalServerError;
        await res.close();
      } catch (_) {
        // 이미 보내기 시작한 응답은 그대로 끊는다.
      }
    }
  }
}
