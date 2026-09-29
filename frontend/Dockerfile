# ==============================================================================
# KeyPoints Studio — Frontend Dockerfile (Phase 18)
# Multi-stage: Node.js 20 build stage -> Nginx Alpine production server
# ==============================================================================

# Stage 1: Build the React application
FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first (leverage Docker layer caching)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Stage 2: Serve with lightweight Nginx
FROM nginx:alpine

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static assets from Stage 1
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
