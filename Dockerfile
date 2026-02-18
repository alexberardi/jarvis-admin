# Stage 1: Build frontend
FROM node:22-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Build backend
FROM node:22-alpine AS backend-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ .
RUN npx tsc

# Stage 3: Production runtime
FROM node:22-alpine
WORKDIR /app

# Install docker CLI for compose profile management
RUN apk add --no-cache docker-cli docker-cli-compose

# Copy backend production deps
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Copy compiled backend
COPY --from=backend-build /app/server/dist ./server/dist

# Copy frontend build
COPY --from=frontend-build /app/dist ./public

ENV NODE_ENV=production
ENV PORT=3000
ENV STATIC_DIR=/app/public
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "server/dist/index.js"]
