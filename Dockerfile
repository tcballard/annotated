FROM node:22-bookworm-slim

ARG TARGETARCH
ARG YTDLP_VERSION=2026.06.09
ARG YTDLP_SHA256_AMD64=bf8aac79b72287a6d2043074415132558b43743a8f9461a22b0141e90f16ce66
ARG YTDLP_SHA256_ARM64=cabd246445bdfde0eda0dfe68bbe90354be83f3fdbbf077df11a2ea55f41cdbd

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
  case "$TARGETARCH" in \
    amd64) asset=yt-dlp_linux; checksum="$YTDLP_SHA256_AMD64" ;; \
    arm64) asset=yt-dlp_linux_aarch64; checksum="$YTDLP_SHA256_ARM64" ;; \
    *) echo "Unsupported Docker architecture for the pinned yt-dlp runtime: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  curl --fail --location --silent --show-error "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${asset}" --output /usr/local/bin/yt-dlp; \
  echo "$checksum  /usr/local/bin/yt-dlp" | sha256sum --check --strict; \
  chmod 0755 /usr/local/bin/yt-dlp; \
  /usr/local/bin/yt-dlp --version

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

RUN groupadd --system annotated && useradd --system --gid annotated --home-dir /app annotated \
  && chown -R annotated:annotated /app
USER annotated

ENV NODE_ENV=production
ENV PORT=8787
ENV YTDLP_BIN=/usr/local/bin/yt-dlp
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node --input-type=module -e "const r=await fetch('http://127.0.0.1:8787/api/ready'); process.exit(r.ok?0:1)"
CMD ["npm", "start"]
