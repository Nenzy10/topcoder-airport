# Stage 1: build the frontend
FROM node:22-alpine AS webbuild
WORKDIR /web
COPY web/package*.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# Stage 2: runtime (server + built frontend, single service)
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY server/ ./server/
COPY --from=webbuild /web/dist ./web/dist
EXPOSE 8080
CMD ["node", "server/src/index.js"]
