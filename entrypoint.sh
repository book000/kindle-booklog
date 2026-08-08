#!/bin/sh

# DISPLAY環境変数が設定されている場合
if [ -n "$DISPLAY" ]; then
  rm /tmp/.X*-lock || true

  Xvfb "$DISPLAY" -ac -screen 0 "${WINDOW_WIDTH}x${WINDOW_HEIGHT}x16" -listen tcp &

  display_number="${DISPLAY#:}"
  display_number="${display_number%%.*}"
  x_socket="/tmp/.X11-unix/X${display_number}"
  for _ in $(seq 1 30); do
    if [ -e "$x_socket" ]; then
      break
    fi
    sleep 1
  done
  if [ ! -e "$x_socket" ]; then
    echo "Xvfb did not become ready: $DISPLAY" >&2
    exit 1
  fi

  x11vnc -rfbport 5910 -shared -forever -noxdamage -display "$DISPLAY" -nopw -loop -xkb &
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
