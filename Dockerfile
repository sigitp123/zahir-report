# Zahir Insight — image untuk hosting (satu instance melayani banyak customer: REPORT_SCOPE=company)
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.js ./
COPY public ./public
COPY custom_queries ./custom_queries
ENV PORT=3300 NODE_ENV=production REPORT_SCOPE=company DATA_ROOT=/data
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3300/version || exit 1
CMD ["node", "server.js"]
