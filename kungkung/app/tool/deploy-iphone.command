#!/bin/bash
# 킁킁! 아이폰 개발 설치 — Mac에서 실행 (Finder에서 더블클릭, 또는 Terminal에서 ./tool/deploy-iphone.command)
#
# 가설: 서명 팀과 아이폰을 Mac에서 스스로 찾고, 게임 파일 복사 → Flutter 설정 → 실제 기기용 서명 빌드(Release)
#       → 서명·Bundle ID 확인 → devicectl 설치 → 실행까지 한 번에 하면, 업데이트는 git pull + 더블클릭 한 번이다.
#
# - 저장소가 공개라 팀 ID·기기 ID는 저장소에 두지 않는다. 자동으로 찾고, 못 찾거나 여럿이면
#   tool/deploy.local(깃에 안 올라감)에 DEPLOY_TEAM=… / DEPLOY_DEVICE=… 를 적는다.
# - SSH 세션에서는 키체인 서명이 실패할 수 있다(errSecInternalComponent). 로그인된 Mac에서 더블클릭으로 실행한다.
# - 기존 앱을 지우지 않고 같은 Bundle ID로 덮어 설치한다.
set -euo pipefail
umask 077

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
BUNDLE='com.ffogtive.kungkung'
if [ -f tool/deploy.local ]; then . tool/deploy.local; fi

RUN="$APP_DIR/.local/deploy-runs/$(date +%Y%m%d-%H%M%S)-$$"
DERIVED="$APP_DIR/.local/iphone-deploy"
LOCK="$APP_DIR/.local/iphone-deploy.lock"
mkdir -p "$RUN"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo '다른 설치가 진행 중인지 확인하세요. (잠금: .local/iphone-deploy.lock — 진행 중인 것이 없으면 이 폴더만 지운다)' >&2
  exit 1
fi
finish() {
  code=$?
  printf '%s\n' "$code" > "$RUN/exit-code"
  rmdir "$LOCK" 2>/dev/null || true
  if [ "$code" -ne 0 ]; then echo "✗ 실패 (코드 $code). 로그: $RUN" >&2; fi
}
trap finish EXIT
echo "킁킁! 아이폰 설치 · 커밋 $(git rev-parse --short HEAD 2>/dev/null || echo '?') · 로그 $RUN"

# 0. 도구
for t in flutter xcodebuild xcrun pod; do
  command -v "$t" >/dev/null || { echo "$t 를 찾을 수 없습니다. app/README.md의 'Mac 준비'를 먼저 하세요." >&2; exit 1; }
done

# 1. 서명 팀: Xcode에 로그인한 계정의 Apple Development 인증서(OU = 팀 ID)에서
if [ -z "${DEPLOY_TEAM:-}" ]; then
  DEPLOY_TEAM=$( { security find-certificate -a -c 'Apple Development' -p 2>/dev/null || true; } | /usr/bin/python3 -c '
import re, subprocess, sys
teams = set()
for pem in re.findall(r"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----", sys.stdin.read(), re.S):
    subj = subprocess.run(["openssl", "x509", "-noout", "-subject"], input=pem, capture_output=True, text=True).stdout
    m = re.search(r"OU\s*=\s*([A-Z0-9]{10})", subj)
    if m: teams.add(m.group(1))
print(teams.pop() if len(teams) == 1 else "")' 2>/dev/null || true)
  if [ -z "$DEPLOY_TEAM" ]; then
    echo '서명 팀을 하나로 못 정했습니다. Xcode → Settings → Accounts에 로그인하거나(팀이 여럿이면) tool/deploy.local에 DEPLOY_TEAM=팀ID 를 적으세요.' >&2
    exit 1
  fi
fi

# 2. 아이폰: Mac과 페어링된 실제 iOS 기기 하나
if [ -z "${DEPLOY_DEVICE:-}" ]; then
  xcrun devicectl list devices --json-output "$RUN/devices.json" > "$RUN/devices.log" 2>&1 || true
  DEPLOY_DEVICE=$(/usr/bin/python3 - "$RUN/devices.json" <<'PY' 2>/dev/null || true
import json, sys
try:
    devs = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    sys.exit(0)
ids = []
for d in devs:
    hw, cp = d.get("hardwareProperties", {}), d.get("connectionProperties", {})
    if hw.get("platform") == "iOS" and hw.get("reality", "physical") == "physical" and cp.get("pairingState", "paired") == "paired" and hw.get("udid"):
        ids.append(hw["udid"])
print(ids[0] if len(ids) == 1 else "")
PY
)
  if [ -z "$DEPLOY_DEVICE" ]; then
    echo '아이폰을 하나로 못 찾았습니다. USB로 연결해 잠금을 풀고 "이 컴퓨터를 신뢰"를 누른 뒤 다시 실행하세요.' >&2
    echo '(여러 대면 tool/deploy.local에 DEPLOY_DEVICE=기기ID — 목록: xcrun devicectl list devices)' >&2
    exit 1
  fi
fi
echo "서명 팀·아이폰 확인됨"

# 3. 게임 파일 → Flutter 설정(Generated.xcconfig, Pods)
./tool/sync_web.sh
flutter pub get > "$RUN/pub.log" 2>&1
flutter build ios --release --config-only > "$RUN/config.log" 2>&1 || { tail -20 "$RUN/config.log" >&2; exit 1; }
if [ ! -d ios/Pods ]; then (cd ios && pod install) > "$RUN/pod.log" 2>&1; fi

# 4. 실제 기기용 서명 빌드 (Release: 홈 화면에서 디버거 없이 열림)
echo "빌드 중… (처음은 몇 분)"
if ! xcodebuild -workspace ios/Runner.xcworkspace -scheme Runner -configuration Release \
    -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" \
    -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
    DEVELOPMENT_TEAM="$DEPLOY_TEAM" CODE_SIGN_STYLE=Automatic CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES \
    build > "$RUN/build.log" 2>&1; then
  grep -E 'error:|errSec|No Account|No profiles|requires a provisioning' "$RUN/build.log" | head -15 >&2 || tail -25 "$RUN/build.log" >&2
  exit 1
fi
APP="$DERIVED/Build/Products/Release-iphoneos/Runner.app"
test -d "$APP"
codesign --verify --deep --strict "$APP"
ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
if [ "$ID" != "$BUNDLE" ]; then echo "앱 Bundle ID가 $ID 입니다(기대 $BUNDLE). 설치 중단." >&2; exit 1; fi
echo "빌드·서명 확인됨"

# 5. 설치 → 실행
xcrun devicectl device install app --device "$DEPLOY_DEVICE" "$APP" --json-output "$RUN/install.json" > "$RUN/install.log" 2>&1 \
  || { tail -15 "$RUN/install.log" >&2; echo '설치 실패: 아이폰 잠금 해제·개발자 모드(설정 → 개인정보 보호 및 보안)를 확인하세요.' >&2; exit 1; }
echo "설치됨"
if xcrun devicectl device process launch --device "$DEPLOY_DEVICE" --terminate-existing "$BUNDLE" --json-output "$RUN/launch.json" > "$RUN/launch.log" 2>&1; then
  echo "✓ 아이폰에서 킁킁! 실행됨"
else
  echo "✓ 설치는 끝났습니다. 실행은 실패했으니 아이폰 잠금을 풀고 홈 화면의 킁킁!을 누르세요. (로그: $RUN/launch.log)"
fi
