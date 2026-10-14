# IT-SYSTEM หน้าเว็บ (Next.js 16) — build แบบ standalone แล้วรันด้วย node server.js (ไม่มี node_modules ทั้งก้อนใน image)
# ค่า runtime: API_URL (เช่น http://express:8020/api/v1 ใน docker network) — ตั้งใน docker-compose.yml service frontend
# หน้าเว็บไม่เปิดสู่ภายนอกเอง: ให้ Caddy / Cloudflare Tunnel อยู่ด้านหน้า (deploy/Caddyfile) และ bind 127.0.0.1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# server.js + ไฟล์ที่ trace แล้ว / ไฟล์ static ของ build / public (PWA: sw.js, offline.html, icons)
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO /dev/null http://127.0.0.1:3000/offline.html || exit 1
CMD ["node", "server.js"]
