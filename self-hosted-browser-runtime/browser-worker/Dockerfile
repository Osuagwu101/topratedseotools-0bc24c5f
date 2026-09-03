FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/browser-worker
COPY browser-worker/package.json ./package.json
COPY browser-worker/src ./src
COPY browser-worker/test ./test

ENV NODE_ENV=production
ENV PORT=8081
ENV CHROMIUM_EXECUTABLE=/usr/bin/chromium

RUN node --test test/*.test.mjs \
    && test -x /usr/bin/chromium

EXPOSE 8081
CMD ["node", "src/server.mjs"]
