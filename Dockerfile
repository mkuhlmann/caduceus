# syntax=docker/dockerfile:1

# Build stage: runs on the build host's architecture, since its output (static files and one JS bundle)
# is platform independent.
FROM --platform=$BUILDPLATFORM oven/bun:1.4-alpine AS build
WORKDIR /src

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build \
	&& bun build server/index.ts --target=bun --minify --outfile /out/server.js \
	&& cp -r dist /out/dist \
	&& mkdir -p /out/data

# Runtime stage: the Bun runtime, server.js and the built UI. No node_modules.
FROM oven/bun:1.4-alpine
WORKDIR /app

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=7811 \
	CADUCEUS_DIST=/app/dist \
	CADUCEUS_DATA_DIR=/data

COPY --from=build /out/server.js /app/server.js
COPY --from=build /out/dist /app/dist
COPY --from=build --chown=bun:bun /out/data /data

USER bun
VOLUME /data
EXPOSE 7811

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
	CMD wget -qO- "http://127.0.0.1:${PORT}/ui-api/auth" > /dev/null || exit 1

CMD ["bun", "server.js"]
