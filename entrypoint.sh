#!/bin/sh

# Xvfb と x11vnc を(再)起動し、ソケットの生成を待つ
start_display() {
  display_number="${DISPLAY#:}"
  display_number="${display_number%%.*}"
  x_socket="/tmp/.X11-unix/X${display_number}"

  rm -f /tmp/.X*-lock
  # 前回死んだ Xvfb が残したソケットが残っているとバインドできないため削除する
  rm -f "$x_socket"

  Xvfb "$DISPLAY" -ac -screen 0 "${WINDOW_WIDTH}x${WINDOW_HEIGHT}x16" -listen tcp &
  xvfb_pid=$!

  for _ in $(seq 1 30); do
    if [ -e "$x_socket" ]; then
      break
    fi
    sleep 1
  done
  if [ ! -e "$x_socket" ]; then
    echo "Xvfb did not become ready: $DISPLAY" >&2
    return 1
  fi

  x11vnc -rfbport 5910 -shared -forever -noxdamage -display "$DISPLAY" -nopw -loop -xkb &
  x11vnc_pid=$!
}

# X ディスプレイが実際に応答するか確認する(ソケットの存在だけでは死活判定できないため)
is_display_healthy() {
  timeout 5 xdpyinfo -display "$DISPLAY" >/dev/null 2>&1
}

# このエントリポイントが起動した Xvfb/x11vnc のプロセスのみ止める(既に死んでいても安全)。
# wait でプロセス終了を待ってから戻ることで、再起動直後の新しい Xvfb が
# 同じソケット/ポートへバインドしようとして衝突するのを防ぐ
stop_display() {
  if [ -n "$xvfb_pid" ]; then
    kill -9 "$xvfb_pid" 2>/dev/null || true
    wait "$xvfb_pid" 2>/dev/null || true
  fi
  if [ -n "$x11vnc_pid" ]; then
    kill -9 "$x11vnc_pid" 2>/dev/null || true
    wait "$x11vnc_pid" 2>/dev/null || true
  fi
}

# 応答しない Xvfb/x11vnc を止めてから起動し直す
restart_display() {
  echo "X display is not responding, restarting Xvfb/x11vnc: $DISPLAY" >&2
  stop_display
  start_display
}

# DISPLAY環境変数が設定されている場合
if [ -n "$DISPLAY" ]; then
  start_display || exit 1
fi

while :
do
  rm -rf /data/userdata/Singleton* || true

  if [ -n "$DISPLAY" ] && ! is_display_healthy; then
    restart_display
    if ! is_display_healthy; then
      echo "X display is still unresponsive after restart, skipping this cycle: $DISPLAY" >&2
      echo "Restarting in 10 minutes..."
      sleep 600
      continue
    fi
  fi

  pnpm start || true

  # wait 10 minutes
  echo "Restarting in 10 minutes..."
  sleep 600
done

stop_display
