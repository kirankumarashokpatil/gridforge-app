## Multi-stage Dockerfile for GridForge (Vite + React)
## - Stage 1: Install deps, build static assets
## - Stage 2: Serve with nginx

# ---------- Builder Stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# Copy the rest of the source
COPY . .

# Build production assets
RUN npm run build


# ---------- Production Runtime Stage ----------
FROM nginx:alpine AS runner

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config if needed
# COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port
EXPOSE 80

# Nginx runs by default
CMD ["nginx", "-g", "daemon off;"]
