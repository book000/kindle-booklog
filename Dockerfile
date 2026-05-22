# pnpm v11 は Node.js v22.13+ を必要とするため、node:22-alpine をベースとして使用する。
# zenika/alpine-chrome:with-puppeteer-xvfb (Alpine 3.19 / Node.js 20) は pnpm v11 に対応していない。
FROM node:22-alpine AS runner

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PATH"

# zenika/alpine-chrome:with-puppeteer-xvfb が設定していた Puppeteer 向け環境変数
ENV CHROME_BIN=/usr/bin/chromium-browser \
    CHROME_PATH=/usr/lib/chromium/ \
    CHROMIUM_FLAGS="--disable-software-rasterizer --disable-dev-shm-usage" \
    DISPLAY=:99 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

# hadolint ignore=DL3002
USER root

# hadolint ignore=DL3018,DL3016
RUN apk upgrade --no-cache --available && \
  apk update && \
  apk add --update --no-cache \
    chromium \
    chromium-swiftshader \
    ttf-freefont \
    font-noto-emoji \
    font-wqy-zenhei \
    tini \
    tzdata \
    x11vnc \
    xvfb && \
  cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
  echo "Asia/Tokyo" > /etc/timezone && \
  apk del tzdata && \
  npm install -g corepack@latest && \
  corepack enable

WORKDIR /app

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

COPY tsconfig.json ./
COPY src src

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline

COPY entrypoint.sh ./
RUN chmod +x ./entrypoint.sh

ENV TZ=Asia/Tokyo
ENV NODE_ENV=production
ENV CONFIG_PATH=/data/config.json
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV LOG_DIR=/data/logs/
ENV DEBUG_DIRECTORY=/data/debug/
ENV COOKIE_AMAZON=/data/cookie-amazon.json
ENV COOKIE_BOOKLOG=/data/cookie-booklog.json
ENV WINDOW_WIDTH=1200
ENV WINDOW_HEIGHT=1700

ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
