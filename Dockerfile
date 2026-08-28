FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.main.json tsconfig.cloud.json tsconfig.node.json postcss.config.js tailwind.config.js ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
ENV MASCAYL_ENV=production
EXPOSE 8080
CMD ["node", "dist/cloud/server.js"]
