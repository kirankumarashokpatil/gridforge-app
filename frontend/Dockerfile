# GridForge Frontend — React (Vite) + Nginx
# Multi-stage: build static assets, serve with nginx

# ---------- Builder Stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# Copy source
COPY . .

# Build production assets
RUN npm run build


# ---------- Production Runtime Stage ----------
FROM nginx:alpine AS runner

# SPA + reverse-proxy config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
