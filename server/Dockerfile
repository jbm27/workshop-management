# Workshop API — use with Railway root directory = server
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
# Railway injects PORT; config.js reads process.env.PORT
EXPOSE 3001
CMD ["node", "src/index.js"]
