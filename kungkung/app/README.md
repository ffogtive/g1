# 킁킁! 아이폰 앱 (Flutter)

**가설:** 게임은 이미 검증된 웹 엔진(`../real.html`)이 그대로 돌린다. 앱이 맡는 일은 네 가지다.
- 게임 파일을 앱 안에 넣는다.
- 앱 안 로컬 서버(`http://127.0.0.1`)로 게임을 띄운다. 영상 구간 요청(Range)과 효과음 `fetch`를 지원한다.
- 아이폰 WKWebView로 화면 전체에 보여 준다.
- 진동을 햅틱으로 바꾼다.

그래서 웹 쪽을 고친 뒤 `tool/sync_web.sh`만 다시 돌리면 앱에 그대로 들어간다.

## 가장 쉬운 설치·업데이트 (Mac에서 더블클릭)

**가설:** 서명 팀과 아이폰을 Mac이 스스로 찾고, 빌드부터 설치·실행까지 한 번에 하면 업데이트는 `git pull` 뒤 더블클릭 한 번이다.

```bash
cd g1 && git pull           # 받은 뒤
open kungkung/app/tool      # Finder에서 deploy-iphone.command 더블클릭 (또는 Terminal에서 ./kungkung/app/tool/deploy-iphone.command)
```
- 하는 일:
  1. 게임 파일을 복사하고(`sync_web.sh`) Flutter를 설정한다.
  2. 실제 기기용으로 서명해 빌드한다(Release).
  3. 서명과 Bundle ID(`com.ffogtive.kungkung`)를 확인한다.
  4. `devicectl`로 설치하고 실행한다. 기존 앱은 지우지 않고 덮어쓴다.
- **서명 팀**은 Xcode에 로그인한 계정의 Apple Development 인증서에서 찾는다. **아이폰**은 Mac과 페어링된 기기 하나를 찾는다.
  - 팀이나 기기가 여럿이면 `tool/deploy.local`에 `DEPLOY_TEAM=…`, `DEPLOY_DEVICE=…`를 적는다.
  - 이 파일은 깃에 올라가지 않는다. 저장소가 공개라 ID를 저장소에 두지 않는다.
- 로그는 `kungkung/app/.local/deploy-runs/<시각>/`에 남는다. `build.log`, `install.json`, `launch.json`, `exit-code`가 있다.
- SSH로 실행하면 키체인 서명이 실패할 수 있다(`errSecInternalComponent`). 로그인된 Mac에서 더블클릭으로 실행한다.
- 처음 한 번은 아래 1·4절(Xcode 계정 로그인, 아이폰 신뢰·개발자 모드)이 먼저 되어 있어야 한다.
- 클라우드의 Claude 세션은 Mac에 닿지 못한다. 그래서 설치는 이 스크립트를 Mac에서 실행해서 한다.
  - Mac에 GitHub self-hosted runner를 붙이는 방법도 있지만, 이 저장소는 공개라 쓰지 않는다. 공개 저장소에서 runner를 쓰면 남의 코드가 내 Mac에서 돌 수 있다.

## 1. Mac 준비 (처음 한 번)

1. **Xcode**: App Store에서 최신 버전을 설치하고, 한 번 실행해 추가 구성 요소를 받는다.
   ```bash
   sudo xcodebuild -runFirstLaunch
   ```
2. **CocoaPods**: `brew install cocoapods`
3. **Flutter**: 3.47.7 이상(stable)이 필요하다. `brew install --cask flutter` 또는 [공식 설치](https://docs.flutter.dev/get-started/install/macos)로 설치한다.
4. `flutter doctor`를 실행해 Xcode 줄에 체크가 뜨는지 본다.
5. **Xcode에 Apple 계정 추가**: Xcode → Settings → Accounts에 유료 개발자 계정을 추가한다.

## 2. 코드 받기와 게임 파일 넣기

```bash
git clone https://github.com/ffogtive/g1.git
cd g1 && git checkout claude/moakung-game-prototype-jd8esd
cd kungkung/app
./tool/sync_web.sh      # real.html + 영상(mp4)·효과음을 assets/web/ 으로 복사 (약 31MB)
flutter pub get
```

## 3. 서명 (처음 한 번)

```bash
open ios/Runner.xcworkspace
```
1. 왼쪽에서 **Runner** 프로젝트 → **Runner** 타깃 → **Signing & Capabilities**로 간다.
2. **Automatically manage signing**을 켜고, **Team**에서 유료 개발자 계정의 팀을 고른다.
3. 번들 ID는 `com.ffogtive.kungkung`이다. 이미 쓰인 ID라는 오류가 나면 뒤에 글자를 붙여 바꾼다(예: `com.ffogtive.kungkung.dev`).

## 4. 아이폰 준비 (처음 한 번)

1. 아이폰을 USB로 Mac에 연결하고 "이 컴퓨터를 신뢰"를 누른다.
2. 아이폰에서 **설정 → 개인정보 보호 및 보안 → 개발자 모드**를 켠다. 재시동하면 다시 한 번 켤지 묻는다.

## 5. 설치·실행

```bash
flutter devices                       # 아이폰 이름/ID 확인
flutter run --release -d <아이폰 ID>   # 빌드 + 설치 + 실행
```
- 이렇게 설치하면 홈 화면에 **킁킁!** 아이콘이 생긴다. 유료 계정이라 1년 동안 그냥 열린다.
- 케이블 없이 설치하려면: Xcode → Window → Devices and Simulators에서 아이폰의 **Connect via network**를 켠다. 그러면 같은 Wi-Fi에서 `flutter run --release`가 된다.

## 6. 업데이트 받기

```bash
git pull
./tool/sync_web.sh
flutter run --release -d <아이폰 ID>
```

## 문제가 생기면

| 증상 | 해결 |
|---|---|
| `unable to find directory entry in pubspec.yaml: assets/web/...` | `./tool/sync_web.sh`를 먼저 실행한다 |
| 화면이 하늘색만 나오고 게임이 안 뜬다 | 디버그로 실행(`flutter run -d <ID>`)한다. Mac Safari → 설정 → 고급에서 "웹 개발자용 기능 보기"를 켜고, **개발자 메뉴 → 아이폰 → 127.0.0.1** 페이지의 콘솔 오류를 본다(디버그 빌드에서만 연결된다) |
| 소리가 안 난다 | 화면을 한 번 터치해야 소리가 켜진다(웹 오디오 규칙). 앱은 무음 스위치와 상관없이 소리가 나게 해 두었다. 무음 스위치를 따르게 하려면 `ios/Runner/AppDelegate.swift`에서 `.playback`을 `.ambient`로 바꾼다 |
| `Could not locate device support files` | Xcode를 아이폰 iOS 버전에 맞게 업데이트한다 |
| CocoaPods 오류 | `cd ios && pod repo update && pod install && cd ..` |
| 디버그 빌드를 홈 화면에서 열면 바로 꺼진다 | iOS 정책상 디버그 빌드는 Mac에 연결돼 있어야 한다. 평소에는 `--release`로 설치한다 |

## Mac 브라우저로 먼저 확인

앱과 같은 서버 코드로 띄운다.
```bash
dart run tool/serve.dart            # http://127.0.0.1:8790/real.html
```

## 나중에: TestFlight로 다른 사람에게

1. `flutter build ipa`로 만든다.
2. 만들어진 `build/ios/ipa/*.ipa`를 Transporter 앱이나 Xcode Organizer로 App Store Connect에 올린다.
3. TestFlight에서 테스터를 초대한다.

## 구조

| 파일 | 하는 일 |
|---|---|
| `lib/main.dart` | 전체 화면 WKWebView. 인라인 영상 자동 재생, 세로 고정, 화면 꺼짐 방지, `KungNative` 채널(진동 → 햅틱) |
| `lib/local_server.dart` | 127.0.0.1 로컬 서버. GET·HEAD, Range 206·416, MIME, 경로 탈출 차단. flutter 없이 `dart:io`만 쓴다 |
| `tool/sync_web.sh` | `../real.html`, `../real/`(v3·ostrich mp4·jpg, sfx, webp)을 `assets/web/`으로 복사한다. webm은 넣지 않는다 |
| `tool/serve.dart` | 같은 서버를 Mac이나 컨테이너에서 띄운다. 브라우저 확인과 E2E에 쓴다 |
| `tool/deploy-iphone.command` | Mac에서 더블클릭: 게임 파일 복사 → 기기용 서명 빌드 → 설치 → 실행 (팀·기기 자동, 로그 `.local/deploy-runs/`) |
| `test/assets_test.dart` | real.html이 부르는 클립(mp4)·사진·소리가 앱 안에 모두 있는지 (`sync_web.sh` 뒤 `flutter test`) |
| `test/local_server_test.dart` | 서버 단위 테스트 7개 (`flutter test`) |
| `ios/Runner/Info.plist` | 이름 "킁킁!", 세로, 상태 표시줄 숨김, 로컬 서버 허용(`NSAllowsLocalNetworking`) |
| `ios/Runner/AppDelegate.swift` | 오디오 세션(무음 스위치와 무관하게 효과음, 음악과 섞임) |

**검증 (Linux 컨테이너):**
- `flutter analyze` 0건, `flutter test` 7/7
- 같은 서버 코드로 게임 E2E 49/49: `BASE_URL=http://127.0.0.1:8790 node ../tools/e2e-real.js`

실제 아이폰 빌드와 실행은 Mac에서 확인한다.
