FROM node:14-slim

# @see https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-in-docker

RUN apt-get update \
  && apt-get install -y wget gnupg \
  && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
  && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
  && apt-get update \
  && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -r pptruser
RUN useradd -r -g pptruser -G audio,video pptruser

WORKDIR /app

COPY --chown=pptruser:pptruser package.json yarn.lock ./
RUN yarn
RUN chown -R pptruser:pptruser ./node_modules
COPY --chown=pptruser:pptruser . .

USER pptruser

CMD ["yarn", "build"]