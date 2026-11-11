FROM node:20-alpine AS builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app/backend
ENV NODE_ENV=production
ENV PORT=4000
COPY --from=builder /app/backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/backend/dist ./dist
COPY database /app/database
COPY logo-parkcloud.png /app/logo-parkcloud.png
COPY Consola_y_Diagrama_ER_ParkCloud.html /app/Consola_y_Diagrama_ER_ParkCloud.html
EXPOSE 4000
CMD ["node", "dist/main.js"]

