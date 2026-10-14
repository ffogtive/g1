// 킁킁! 아이폰 앱: 앱 안 로컬 서버로 웹 게임(real.html)을 띄우는 WKWebView 껍데기.
//
// 가설: 게임 규칙·영상 전환·효과음은 이미 검증된 웹 엔진에 두고, 앱은 파일 묶기·전체 화면·
// 진동(햅틱)·화면 꺼짐 방지만 맡으면 아이폰에서 그대로 돈다.
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:wakelock_plus/wakelock_plus.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import 'local_server.dart';

/// 처음 여는 게임 페이지 (assets/web 기준).
const String startPage = 'real.html';

/// 게임 화면 바탕색 (real.html의 body 색과 같게 해 로딩 중 깜빡임을 없앤다).
const Color gameSky = Color(0xFF5F9FE0);

Future<Uint8List?> loadBundledAsset(String path) async {
  try {
    final data = await rootBundle.load('assets/web/$path');
    return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
  } catch (_) {
    return null;
  }
}

/// 게임 페이지 출처(http://127.0.0.1:<포트>)를 매번 같게: 종 선택·최고 기록(localStorage)이 출처별로 저장되기 때문.
/// 고정 포트를 차례로 시도하고, 모두 쓰이고 있으면 아무 포트나 쓴다(그때만 기록이 따로 남음).
const List<int> stablePorts = <int>[47821, 47822, 47823];

Future<void> startOnStablePort(LocalGameServer server) async {
  for (final port in stablePorts) {
    try {
      await server.start(port: port);
      return;
    } on SocketException {
      // 다음 포트
    }
  }
  await server.start();
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations(<DeviceOrientation>[DeviceOrientation.portraitUp]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  final server = LocalGameServer(loadBundledAsset);
  await startOnStablePort(server);
  runApp(KungkungApp(server: server));
}

class KungkungApp extends StatelessWidget {
  const KungkungApp({super.key, required this.server});

  final LocalGameServer server;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '킁킁!',
      debugShowCheckedModeBanner: false,
      home: GameScreen(server: server),
    );
  }
}

class GameScreen extends StatefulWidget {
  const GameScreen({super.key, required this.server});

  final LocalGameServer server;

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> {
  late final WebViewController _controller;

  @override
  void initState() {
    super.initState();
    WakelockPlus.enable();
    _controller = _buildController();
  }

  WebViewController _buildController() {
    final PlatformWebViewControllerCreationParams params = WebViewPlatform.instance is WebKitWebViewPlatform
        ? WebKitWebViewControllerCreationParams(
            allowsInlineMediaPlayback: true,
            mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
          )
        : const PlatformWebViewControllerCreationParams();
    final controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(gameSky)
      ..setOverScrollMode(WebViewOverScrollMode.never)
      ..addJavaScriptChannel('KungNative', onMessageReceived: _onNativeMessage)
      ..loadRequest(widget.server.url(startPage));
    final platform = controller.platform;
    if (platform is WebKitWebViewController) {
      platform.setAllowsBackForwardNavigationGestures(false);
      platform.setAllowsLinkPreview(false);
      // 개발 빌드에서는 Mac Safari > 개발자 메뉴로 웹 검사기를 붙일 수 있게 한다.
      platform.setInspectable(!kReleaseMode);
    }
    return controller;
  }

  /// 게임이 보내는 신호. `buzz:40,30,60`처럼 진동 패턴(ms)이 오면 길이에 맞는 햅틱으로 바꾼다.
  void _onNativeMessage(JavaScriptMessage message) {
    final text = message.message;
    if (!text.startsWith('buzz:')) return;
    final total = text.substring(5).split(',').map((s) => int.tryParse(s.trim()) ?? 0).fold<int>(0, (a, b) => a + b);
    if (total >= 100) {
      HapticFeedback.heavyImpact();
    } else if (total >= 40) {
      HapticFeedback.mediumImpact();
    } else {
      HapticFeedback.lightImpact();
    }
  }

  @override
  void dispose() {
    WakelockPlus.disable();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: gameSky,
      body: WebViewWidget(controller: _controller),
    );
  }
}
