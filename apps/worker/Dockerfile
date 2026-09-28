# Build from the repo root:  docker build -f apps/worker/Dockerfile .
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w worker --include-workspace-root=false --ignore-scripts
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN npm run build -w worker

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production FFMPEG_PATH=/usr/bin/ffmpeg FFPROBE_PATH=/usr/bin/ffprobe DATA_DIR=/data
COPY package.json package-lock.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w worker --include-workspace-root=false --omit=dev --ignore-scripts
COPY --from=build /app/apps/worker/dist apps/worker/dist
WORKDIR /app/apps/worker
EXPOSE 4000
CMD ["node", "dist/index.js"]
