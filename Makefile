AVD ?= rosario_api35
EMULATOR := $(HOME)/Android/Sdk/emulator/emulator

.PHONY: emulator dev open release

# Don't use `pnpm android`: it launches the AVD without -gpu swiftshader_indirect and the host GPU segfaults.
emulator:
	@adb devices | grep -q '^emulator-' || setsid nohup $(EMULATOR) -avd $(AVD) -gpu swiftshader_indirect >/dev/null 2>&1 &
	adb wait-for-device
	@until [ "$$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
	@echo "emulator ready"

dev: emulator
	@! lsof -ti tcp:8081 -sTCP:LISTEN >/dev/null || { echo "port 8081 busy (stale Metro?); Expo would silently move to 8082"; exit 1; }
	@(until curl -s localhost:8081/status | grep -q running; do sleep 1; done; $(MAKE) -s open >/dev/null) &
	cd app && pnpm start

# Run while Metro is up; 127.0.0.1 via adb reverse survives emulator restarts, the LAN URL doesn't.
open:
	adb reverse tcp:8081 tcp:8081
	adb shell am start -a android.intent.action.VIEW -d exp://127.0.0.1:8081

# Usage: make release V=1.2.0. Pushing the tag triggers .github/workflows/build-apk.yml, which builds the APK and publishes the GitHub Release.
release:
	@test -n "$(V)" || { echo "usage: make release V=1.2.0"; exit 1; }
	@git diff --quiet HEAD || { echo "uncommitted changes; commit them first"; exit 1; }
	@! git rev-parse -q --verify refs/tags/v$(V) >/dev/null || { echo "tag v$(V) already exists"; exit 1; }
	node -e 'const fs=require("fs");for(const[f,k]of[["app/app.json","expo"],["app/package.json",null]]){const j=JSON.parse(fs.readFileSync(f));(k?j[k]:j).version="$(V)";fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")}'
	git commit -m "release v$(V)" app/app.json app/package.json
	git tag v$(V)
	git push origin HEAD v$(V)
