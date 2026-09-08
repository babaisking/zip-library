FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p data uploads
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
