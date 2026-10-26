FROM node:20-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data && chown -R node:node /app /data
USER node
ENV DATA_DIR=/data
EXPOSE 3000
CMD ["npm", "start"]
