FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine

WORKDIR /app
ENV HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --production

COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 5180

CMD ["node", "server/start.mjs"]
