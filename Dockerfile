FROM alpine:edge

# hadolint ignore=DL3018
RUN apk update && \
  apk add --no-cache \
  dumb-init \
  curl \
  fontconfig \
  font-noto-cjk \
  && \
  fc-cache -fv && \
  apk add --no-cache \
  chromium \
  nss \
  freetype \
  freetype-dev \
  harfbuzz \
  ca-certificates \
  ttf-freefont \
  nodejs \
  yarn \
  && \
  apk add --update --no-cache tzdata && \
  cp /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
  echo "Asia/Tokyo" > /etc/timezone && \
  apk del tzdata

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn
COPY src/ src/
COPY tsconfig.json .

ENTRYPOINT ["dumb-init", "--"]
CMD ["yarn", "build"]