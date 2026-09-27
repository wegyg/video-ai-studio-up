# ShortsDirector — self-host image.
# Remotion renders in headless Chromium and we composite with FFmpeg, so the
# image ships Node, FFmpeg, Chromium runtime libs, and CJK fonts.
FROM node:22-bookworm-slim AS base

# System deps: ffmpeg (render/composite/audio), fonts (Latin + CJK for Korean),
# and the shared libs headless Chromium needs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps (this also triggers Remotion to fetch its Chromium shell at first render).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Pre-download Remotion's headless Chromium shell so the FIRST render in
# production is fast (otherwise it fetches ~108MB on the first request).
RUN npx remotion browser ensure || true

ENV NODE_ENV=production
ENV PORT=3000
# Persist job/output files outside the container if you mount a volume here.
ENV SD_WORK_DIR=/data
RUN mkdir -p /data

EXPOSE 3000
CMD ["npm", "run", "start"]
