FROM oven/bun:1 AS builder

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN bun install

COPY tsconfig.json ./
COPY src ./src
RUN bun run build

RUN rm -rf node_modules && bun install --production

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY frontend ./frontend
COPY por.traineddata ./por.traineddata

RUN mkdir -p auth tmp/uploads docs

EXPOSE 3334 3335

CMD ["node", "dist/main.js"]
