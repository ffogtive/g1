#!/bin/bash
# 킁킁! 아이폰 개발 설치 — Mac 터미널에 README의 한 줄을 붙여 넣으면 이 파일이 돈다 (Finder 더블클릭도 됨)
#
# 가설: 비개발자가 같은 한 줄로 처음 설치와 업데이트를 하려면, 이 스크립트가 스스로 고정 버전 Flutter를 받고,
#       서명 팀과 아이폰을 찾고, 어느 단계에서도 숨은 질문으로 멈추거나 이유 없이 끝나지 않아야 한다.
#
# - 플러그인은 Swift Package Manager로 들어간다(CocoaPods 필요 없음, ios/Podfile 없음).
# - Flutter는 ~/.kungkung/flutter 에 3.47.7을 따로 둔다. 다른 Flutter와 섞이지 않고 pubspec.lock이 그대로다.
# - 저장소가 공개라 팀 ID·기기 ID는 저장소에 두지 않는다. 자동으로 찾고, 여럿이면 번호로 묻는다.
#   직접 정하려면 tool/deploy.local(깃에 안 올라감)에 DEPLOY_TEAM=… / DEPLOY_DEVICE=… / KUNG_FLUTTER_SDK=… 를 적는다.
# - SSH 세션에서는 키체인 서명이 실패할 수 있다(errSecInternalComponent). 로그인된 Mac의 터미널에서 실행한다.
# - 기존 앱을 지우지 않고 같은 Bundle ID로 덮어 설치한다.
# - macOS 기본 /bin/bash(3.2)로 돈다: 연관 배열·mapfile·$( ) 안 heredoc을 쓰지 않는다.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
BUNDLE='com.ffogtive.kungkung'
FLUTTER_PIN='3.47.7'
FLUTTER_SHA_ARM64='dd9da574c3168460550117eb0e8dd0313ae934fabf64a82a6d557fff5fd1422e'   # releases_macos.json
FLUTTER_SHA_X64='17d39b000a5d0681e3f7b61a105a36f6f31dd41ab9073f625fd466f38035f901'
PLISTBUDDY="${PLISTBUDDY:-/usr/libexec/PlistBuddy}"   # 시험용으로 바꿔 끼울 수 있음
PY="${KUNG_PYTHON:-/usr/bin/python3}"
if [ -f tool/deploy.local ]; then . tool/deploy.local; fi
SDK="${KUNG_FLUTTER_SDK:-$HOME/.kungkung/flutter}"

mkdir -p .local && chmod 700 .local
RUN="$APP_DIR/.local/deploy-runs/$(date +%Y%m%d-%H%M%S)-$$"
DERIVED="$APP_DIR/.local/iphone-deploy"
LOCK="$APP_DIR/.local/iphone-deploy.lock"
mkdir -p "$RUN"

finish() {
  code=$?
  printf '%s\n' "$code" > "$RUN/exit-code"
  if [ "$(cat "$LOCK/pid" 2>/dev/null || true)" = "$$" ]; then rm -rf "$LOCK"; fi
  if [ "$code" -ne 0 ]; then
    echo "✗ 실패 (코드 $code). 로그 폴더: $RUN" >&2
    echo "  이 창의 끝부분(✗ 위 20줄쯤)을 복사해 Claude에게 보내 주세요." >&2
  fi
}
trap finish EXIT
trap 'exit 130' INT HUP TERM   # 창을 닫거나 Ctrl-C여도 잠금을 푼다

# 잠금: 같은 앱을 두 창에서 동시에 설치하지 않게. 지난번 창을 닫아 남은 잠금은 스스로 치운다
if ! mkdir "$LOCK" 2>/dev/null; then
  old=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
    echo "다른 창에서 설치가 진행 중입니다(프로세스 $old). 그 창이 끝난 뒤 다시 실행하세요." >&2
    exit 1
  fi
  rm -rf "$LOCK"
  mkdir "$LOCK"
fi
echo $$ > "$LOCK/pid"

say() { printf '\n▶ %s\n' "$*"; }
hint() {   # 로그에서 흔한 원인을 찾아 할 일을 한국어로
  f=$1
  if grep -q 'CocoaPods not installed' "$f"; then echo '→ CocoaPods가 필요해졌습니다. Claude에게 이 메시지를 보내 주세요.' >&2; fi
  if grep -qi 'agree.*license\|license agreement' "$f"; then echo '→ Xcode 약관 동의가 필요합니다: sudo xcodebuild -license accept  (Mac 암호 입력) 뒤 다시 실행' >&2; fi
  if grep -q 'is not installed. To use with Xcode\|iOS .* is not installed' "$f"; then echo '→ Xcode에 iOS 플랫폼이 없습니다: xcodebuild -downloadPlatform iOS  뒤 다시 실행' >&2; fi
  if grep -q 'No Account\|No signing certificate\|No development certificates\|requires a provisioning profile\|No profiles' "$f"; then echo '→ Xcode → Settings → Accounts에서 유료 개발자 계정으로 로그인돼 있는지 확인한 뒤 다시 실행' >&2; fi
  if grep -q 'errSecInternalComponent' "$f"; then echo '→ 키체인 서명 실패: SSH가 아니라 Mac 화면의 터미널에서 실행하고, 키체인 창이 뜨면 Mac 암호 입력 후 "항상 허용"' >&2; fi
  if grep -q 'Rosetta' "$f"; then echo '→ Rosetta가 필요합니다: softwareupdate --install-rosetta --agree-to-license  뒤 다시 실행' >&2; fi
  if grep -qi 'developer mode' "$f"; then echo '→ 아이폰 설정 → 개인정보 보호 및 보안 → 개발자 모드를 켜고 재시동' >&2; fi
  if grep -qi 'locked\|passcode' "$f"; then echo '→ 아이폰 잠금을 풀고 다시 실행' >&2; fi
  return 0
}
run_step() {   # run_step 이름 로그 명령… — 질문으로 멈추지 않게 입력은 막고, 실패하면 로그 끝과 할 일을 보여 준다
  name=$1 log=$2; shift 2
  if "$@" </dev/null >"$log" 2>&1; then return 0; fi
  echo "✗ $name 실패. 로그 끝:" >&2
  tail -30 "$log" >&2
  hint "$log"
  exit 1
}
choose() {   # choose 질문 파일(줄마다 값<TAB>설명) → 고른 값(못 고르면 빈 값). 하나면 묻지 않는다
  file=$2
  n=$(grep -c . "$file" || true)
  if [ "$n" -eq 1 ]; then cut -f1 "$file"; return 0; fi
  if [ "$n" -eq 0 ] || ! { : </dev/tty; } 2>/dev/null; then return 0; fi
  { echo "$1"; awk -F'\t' '{ printf "  %d) %s\n", NR, $2 }' "$file"; printf '번호를 입력하고 Enter: '; } >/dev/tty
  ans=''
  read -r ans </dev/tty || true
  case "$ans" in ''|*[!0-9]*) return 0 ;; esac
  sed -n "${ans}p" "$file" | cut -f1
}

echo "킁킁! 아이폰 설치 · 커밋 $(git rev-parse --short HEAD 2>/dev/null || echo '?') · 로그 $RUN"
echo "처음은 15~25분 걸립니다(Flutter 받기 + 첫 빌드). 다음부터는 몇 분입니다. 이 창을 닫지 마세요."

# 0. 도구: Xcode가 실제로 선택돼 있는지 (command -v만으로는 /usr/bin의 대리 실행 파일 때문에 늘 통과)
for t in xcrun git curl; do
  command -v "$t" >/dev/null || { echo "$t 를 찾을 수 없습니다. App Store에서 Xcode를 설치하고 한 번 실행한 뒤 다시 실행하세요." >&2; exit 1; }
done
if ! xcodebuild -version > "$RUN/xcode.log" 2>&1; then
  tail -5 "$RUN/xcode.log" >&2
  hint "$RUN/xcode.log"
  echo '→ Xcode를 쓰도록 설정해야 합니다. 아래 줄을 붙여 넣고 Mac 암호를 입력한 뒤, 같은 한 줄을 다시 실행하세요:' >&2
  echo '  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer && sudo xcodebuild -runFirstLaunch' >&2
  exit 1
fi
[ -x "$PY" ] || { echo "$PY 가 없습니다. Xcode를 한 번 실행해 추가 구성 요소를 설치한 뒤 다시 실행하세요." >&2; exit 1; }
echo "Xcode: $(head -1 "$RUN/xcode.log")"

# 1. Flutter (고정 버전, 이 앱 전용)
if [ ! -x "$SDK/bin/flutter" ] || [ "$(cat "$SDK/.kungkung-pin" 2>/dev/null || true)" != "$FLUTTER_PIN" ]; then
  case "$(uname -m)" in
    arm64) zip="flutter_macos_arm64_${FLUTTER_PIN}-stable.zip"; sum="${KUNG_FLUTTER_SHA256:-$FLUTTER_SHA_ARM64}" ;;
    *)     zip="flutter_macos_${FLUTTER_PIN}-stable.zip";       sum="${KUNG_FLUTTER_SHA256:-$FLUTTER_SHA_X64}" ;;
  esac
  base="${KUNG_FLUTTER_BASE:-https://storage.googleapis.com/flutter_infra_release/releases/stable/macos}"
  parent=$(dirname "$SDK"); dl="$parent/.flutter-download"
  mkdir -p "$dl"
  free=$(df -k "$parent" | awk 'NR == 2 { print $4 }')
  if [ "${free:-0}" -lt 7000000 ]; then echo "디스크 여유 공간이 부족합니다(7GB 필요, 지금 $((${free:-0} / 1000000))GB). 공간을 비운 뒤 다시 실행하세요." >&2; exit 1; fi
  say "Flutter $FLUTTER_PIN 받는 중 — 약 2.3GB, 처음 한 번만 (인터넷에 따라 5~20분, 끊기면 다시 실행하면 이어 받음)"
  have=''
  if [ -f "$dl/$zip" ]; then have=$(shasum -a 256 "$dl/$zip" | cut -d' ' -f1); fi
  if [ "$have" != "$sum" ]; then
    curl -fL --retry 3 -C - -# -o "$dl/$zip" "$base/$zip" || { echo 'Flutter 받기가 끊겼습니다. 인터넷을 확인하고 같은 한 줄을 다시 붙여 넣으세요(이어 받습니다).' >&2; exit 1; }
    have=$(shasum -a 256 "$dl/$zip" | cut -d' ' -f1)
  fi
  if [ "$have" != "$sum" ]; then rm -f "$dl/$zip"; echo 'Flutter 파일이 깨졌습니다(체크섬 다름). 같은 한 줄을 다시 붙여 넣으세요.' >&2; exit 1; fi
  say "Flutter 압축 푸는 중 (1~3분)"
  rm -rf "$dl/x" && mkdir "$dl/x"
  unzip -q "$dl/$zip" -d "$dl/x"
  [ -x "$dl/x/flutter/bin/flutter" ] || { echo 'Flutter 압축 안에 flutter/bin/flutter가 없습니다.' >&2; exit 1; }
  rm -rf "$SDK"
  mv "$dl/x/flutter" "$SDK"
  echo "$FLUTTER_PIN" > "$SDK/.kungkung-pin"
  rm -rf "$dl"
fi
export PATH="$SDK/bin:$PATH" FLUTTER_SWIFT_PACKAGE_MANAGER=true
say "Flutter 확인 (처음은 도구 준비로 1~5분)"
flutter --version </dev/null
flutter precache --ios </dev/null

# 2. 서명 팀: 키체인의 유효한 Apple Development 인증서(OU = 팀 ID)
if [ -z "${DEPLOY_TEAM:-}" ]; then
  { security find-identity -v -p codesigning 2>/dev/null || true; } | awk -F'"' '/Apple Development/ { split($1, a, " "); print a[2] }' > "$RUN/valid-ids.txt"
  { security find-certificate -a -c 'Apple Development' -Z -p 2>/dev/null || true; } > "$RUN/certs.pem"
  "$PY" - "$RUN/valid-ids.txt" "$RUN/certs.pem" > "$RUN/teams.txt" <<'PY' || true
import re, subprocess, sys
valid = set(l.strip().upper() for l in open(sys.argv[1]) if l.strip())
sha, buf, certs = None, None, []   # find-certificate -Z -p: "SHA-1 hash: …" 다음에 PEM
for line in open(sys.argv[2], errors="replace").read().split("\n"):
    m = re.match(r"\s*SHA-1 hash:\s*([0-9A-Fa-f]+)", line)
    if m: sha = m.group(1).upper(); continue
    if "BEGIN CERTIFICATE" in line: buf = [line]; continue
    if buf is not None:
        buf.append(line)
        if "END CERTIFICATE" in line: certs.append((sha, "\n".join(buf) + "\n")); buf, sha = None, None
use = [c for c in certs if c[0] in valid] or certs   # find-identity가 비면(키체인 목록 문제) 전부로
teams = {}
for _, pem in use:
    subj = subprocess.run(["openssl", "x509", "-noout", "-subject"], input=pem, capture_output=True, text=True).stdout
    ou = re.search(r"OU\s*=\s*([A-Z0-9]{10})\b", subj)
    org = re.search(r"(?:^|[/,]\s*)O\s*=\s*([^/,\n]+)", subj.replace("subject=", ""))
    if ou: teams.setdefault(ou.group(1), (org.group(1).strip() if org else "?"))
for t, name in sorted(teams.items()):
    print("%s\t%s (%s)" % (t, name.replace("\t", " "), t))
PY
  DEPLOY_TEAM=$(choose '서명 팀이 여럿입니다. 유료 개발자 계정의 팀을 고르세요:' "$RUN/teams.txt")
  if [ -z "$DEPLOY_TEAM" ]; then
    echo '서명 팀을 정하지 못했습니다. Xcode → Settings → Accounts에 유료 개발자 계정으로 로그인한 뒤 다시 실행하세요.' >&2
    echo '(팀이 여럿이고 번호를 못 넣는 창이면 tool/deploy.local에 DEPLOY_TEAM=팀ID 를 적습니다)' >&2
    exit 1
  fi
  if [ "$(grep -c . "$RUN/teams.txt")" -gt 1 ]; then printf 'DEPLOY_TEAM=%s\n' "$DEPLOY_TEAM" >> tool/deploy.local; echo "(고른 팀을 tool/deploy.local에 저장했습니다. 다음부터 묻지 않습니다)"; fi
fi
case "$DEPLOY_TEAM" in *[!A-Z0-9]*|'') echo "DEPLOY_TEAM 값이 이상합니다: $DEPLOY_TEAM" >&2; exit 1 ;; esac

# 3. 아이폰: Mac과 페어링되고 지금 닿는 실제 아이폰 (예전 기기·아이패드·꺼진 기기는 뺌)
if [ -z "${DEPLOY_DEVICE:-}" ]; then
  xcrun devicectl list devices --json-output "$RUN/devices.json" > "$RUN/devices.log" 2>&1 || true
  "$PY" - "$RUN/devices.json" > "$RUN/phones.txt" <<'PY' || true
import json, sys
try:
    devs = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    sys.exit(0)
rows = []
for d in devs:
    hw = d.get("hardwareProperties") or {}
    cp = d.get("connectionProperties") or {}
    dp = d.get("deviceProperties") or {}
    if hw.get("platform") != "iOS" or hw.get("reality", "physical") != "physical": continue
    if hw.get("deviceType", "iPhone") != "iPhone": continue
    if cp.get("pairingState", "paired") != "paired" or cp.get("tunnelState") == "unavailable": continue
    did = hw.get("udid") or d.get("identifier")
    if not did: continue
    name = dp.get("name") or hw.get("marketingName") or did
    rows.append((cp.get("tunnelState") == "connected", did, "%s (%s)" % (name, cp.get("transportType") or cp.get("tunnelState") or "?")))
for r in ([r for r in rows if r[0]] or rows):
    print("%s\t%s" % (r[1], r[2].replace("\t", " ")))
PY
  DEPLOY_DEVICE=$(choose '아이폰이 여럿입니다. 설치할 아이폰을 고르세요:' "$RUN/phones.txt")
  if [ -z "$DEPLOY_DEVICE" ]; then
    tail -5 "$RUN/devices.log" >&2 || true
    echo '아이폰을 찾지 못했습니다. USB로 연결하고 잠금을 푼 뒤("이 컴퓨터를 신뢰" → 신뢰) 같은 한 줄을 다시 실행하세요.' >&2
    echo '(여러 대에서 번호를 못 넣는 창이면 tool/deploy.local에 DEPLOY_DEVICE=기기ID — 목록: xcrun devicectl list devices)' >&2
    exit 1
  fi
fi
echo "서명 팀·아이폰 확인됨"

# 4. 게임 파일 → Flutter 설정(Generated.xcconfig, SwiftPM 패키지). 서명은 5단계 xcodebuild가 한다
say "게임 파일 복사 · Flutter 설정 (1~3분)"
run_step '게임 파일 복사' "$RUN/sync.log" ./tool/sync_web.sh
tail -1 "$RUN/sync.log"
run_step 'flutter pub get' "$RUN/pub.log" flutter pub get
run_step 'Flutter iOS 설정' "$RUN/config.log" flutter build ios --release --config-only --no-codesign

# 5. 실제 기기용 서명 빌드 (Release: 홈 화면에서 디버거 없이 열림)
stamp=$(cat "$SDK/bin/cache/engine.stamp" 2>/dev/null || echo none)
if [ -d "$DERIVED" ] && [ "$(cat .local/engine.stamp 2>/dev/null || true)" != "$stamp" ]; then rm -rf "$DERIVED"; fi   # Flutter가 바뀌면 옛 빌드 캐시가 헤더 오류를 냄
build() {
  xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -configuration Release \
    -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" \
    -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
    DEVELOPMENT_TEAM="$DEPLOY_TEAM" CODE_SIGN_STYLE=Automatic CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES \
    build </dev/null > "$RUN/build.log" 2>&1
}
build_fail() {
  echo '✗ 빌드 실패. 오류 줄:' >&2
  grep -E 'error:|errSec|No Account|No profiles|requires a provisioning' "$RUN/build.log" | head -15 >&2 || tail -25 "$RUN/build.log" >&2
  hint "$RUN/build.log"
  exit 1
}
say "아이폰용 빌드 (처음 5~10분, 다음부터 1~3분) — 키체인 창이 뜨면 Mac 암호를 넣고 \"항상 허용\""
had=0; [ -d "$DERIVED" ] && had=1
if ! build; then
  [ "$had" = 1 ] || build_fail
  echo "빌드 실패 → 빌드 캐시를 지우고 한 번 더 시도합니다"
  cp "$RUN/build.log" "$RUN/build-1.log"; rm -rf "$DERIVED"
  build || build_fail
fi
echo "$stamp" > .local/engine.stamp
APP="$DERIVED/Build/Products/Release-iphoneos/Runner.app"
test -d "$APP" || { echo "빌드 결과 앱이 없습니다: $APP" >&2; exit 1; }
codesign --verify --deep --strict "$APP"
ID=$("$PLISTBUDDY" -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
if [ "$ID" != "$BUNDLE" ]; then echo "앱 Bundle ID가 $ID 입니다(기대 $BUNDLE). 설치 중단." >&2; exit 1; fi
echo "✓ 빌드·서명 확인됨"

# 6. 설치 → 실행
say "아이폰에 설치 (1분 안팎)"
if ! xcrun devicectl device install app --device "$DEPLOY_DEVICE" "$APP" --json-output "$RUN/install.json" > "$RUN/install.log" 2>&1; then
  tail -15 "$RUN/install.log" >&2
  hint "$RUN/install.log"
  echo '✗ 설치 실패: 아이폰 잠금 해제·개발자 모드(설정 → 개인정보 보호 및 보안)를 확인하고 다시 실행하세요.' >&2
  exit 1
fi
echo "✓ 설치됨"
if xcrun devicectl device process launch --device "$DEPLOY_DEVICE" --terminate-existing "$BUNDLE" --json-output "$RUN/launch.json" > "$RUN/launch.log" 2>&1; then
  echo "✓ 아이폰에서 킁킁! 실행됨 ($((SECONDS / 60))분 걸림)"
else
  echo "✓ 설치는 끝났습니다. 실행은 실패했으니 아이폰 잠금을 풀고 홈 화면의 킁킁!을 누르세요. (로그: $RUN/launch.log)"
fi
