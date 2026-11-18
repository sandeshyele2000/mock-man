FROM node:24-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci
COPY scripts/ ./scripts/
COPY frontend/ ./frontend/
RUN npm --prefix frontend run build

FROM nginx:alpine
RUN apk add --no-cache jq
COPY --chmod=755 frontend/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
