FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
# npm ci, not bun install: libsignal is a git dependency (see package-lock.json)
# and Bun's installer fails to materialize its files into node_modules,
# leaving node_modules/libsignal without an index.js.
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

RUN rm -rf node_modules && npm ci --omit=dev

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends zip \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY frontend ./frontend
COPY por.traineddata ./por.traineddata

RUN mkdir -p auth tmp/uploads docs

EXPOSE 3334 3335

CMD ["node", "dist/main.js"]
