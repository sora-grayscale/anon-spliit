# ===========================================
# anon-spliit Dockerfile
# Multi-stage build for Next.js with pnpm
# ===========================================

FROM node:21-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /usr/app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

# Install dependencies
RUN apk add --no-cache openssl && \
    pnpm install --frozen-lockfile && \
    pnpm prisma generate

# Copy source files
COPY next.config.mjs tsconfig.json reset.d.ts tailwind.config.js postcss.config.js ./
COPY src ./src
COPY messages ./messages
COPY public ./public
COPY scripts ./scripts

# Build environment
ENV NEXT_TELEMETRY_DISABLED=1

# Copy build environment and build
COPY scripts/build.env .env
RUN pnpm build && rm -rf .next/cache

# ===========================================
# Runtime dependencies stage
# ===========================================
FROM node:21-alpine AS runtime-deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /usr/app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile --prod && \
    pnpm prisma generate

# ===========================================
# Runner stage
# ===========================================
FROM node:21-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

EXPOSE 3000/tcp
WORKDIR /usr/app

# Copy necessary files
COPY package.json ./
COPY --from=runtime-deps /usr/app/node_modules ./node_modules
COPY --from=base /usr/app/public ./public
COPY --from=base /usr/app/prisma ./prisma
COPY --from=base /usr/app/.next ./.next
COPY scripts ./scripts

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

ENTRYPOINT ["/bin/sh", "/usr/app/scripts/container-entrypoint.sh"]
