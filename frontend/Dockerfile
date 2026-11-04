FROM node:24-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci
COPY scripts/ ./scripts/
COPY frontend/ ./frontend/
ARG VITE_API_URL=http://localhost:8080
ARG VITE_MOCK_URL=http://localhost:9091
ENV VITE_API_URL=$VITE_API_URL VITE_MOCK_URL=$VITE_MOCK_URL
RUN npm --prefix frontend run build

FROM nginx:alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
