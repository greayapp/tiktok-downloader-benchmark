#!/bin/sh
# Remove the daily monitor LaunchAgent.
LABEL=com.greyapp.tiktok-downloader-benchmark.monitor
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "removed $LABEL"
