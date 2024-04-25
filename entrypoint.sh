#!/bin/sh

# DISPLAY環境変数が設定されている場合
if [ -n "$DISPLAY" ]; then
  rm /tmp/.X*-lock || true

  Xvfb :99 -ac -screen 0 "${WINDOW_WIDTH}x${WINDOW_HEIGHT}x16" -listen tcp &
  x11vnc -rfbport 5910 -shared -forever -noxdamage -display :99 -nopw -loop -xkb &
fi

while :
do
  rm -rf /data/userdata/Singleton* || true

  pnpm start || true

  # wait 10 minutes
  echo "Restarting in 10 minutes..."
  sleep 600
done

kill -9 "$(pgrep -f "Xvfb" | awk '{print $2}')"
kill -9 "$(pgrep -f "x11vnc" | awk '{print $2}')"
