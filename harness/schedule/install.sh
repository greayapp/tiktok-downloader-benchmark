#!/bin/sh
# Install the daily monitor as a macOS LaunchAgent. It is started every hour
# from 11:00 to 23:00 local time (and at the next wake if the Mac was asleep);
# the monitor runs once per day and does nothing on later starts, or when the
# Mac is off the residential line (a VPN on). Remove with ./uninstall.sh.
set -eu
LABEL=com.greyapp.tiktok-downloader-benchmark.monitor
HARNESS=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/tiktok-downloader-benchmark-monitor.log"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$HARNESS</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>src/monitor.mjs</string><string>--push</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key>
  <array>$(for h in 11 12 13 14 15 16 17 18 19 20 21 22 23; do printf '<dict><key>Hour</key><integer>%s</integer><key>Minute</key><integer>0</integer></dict>' "$h"; done)</array>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed: $PLIST (log: $LOG)"
