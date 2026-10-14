// 컨테이너·Mac에서 앱과 같은 서버 코드로 assets/web을 띄운다 (E2E·브라우저 확인용).
//   dart run tool/serve.dart [폴더=assets/web] [포트=8790]
import 'dart:io';
import 'dart:typed_data';

import 'package:kungkung_app/local_server.dart';

Future<void> main(List<String> args) async {
  final root = args.isNotEmpty ? args[0] : 'assets/web';
  final port = args.length > 1 ? int.parse(args[1]) : 8790;
  final server = LocalGameServer((String rel) async {
    final f = File('$root/$rel');
    return await f.exists() ? Uint8List.fromList(await f.readAsBytes()) : null;
  });
  await server.start(port: port);
  stdout.writeln('serving $root at http://127.0.0.1:${server.port}/');
}
