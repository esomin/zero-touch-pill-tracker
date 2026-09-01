# ── 1단계: 프론트엔드 빌드 ──────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# 빌드 시점에 주입할 환경변수 (기본값 설정 가능)
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_WS_URL=${VITE_WS_URL}

# 패키지 의존성 복사 및 설치
COPY package*.json ./
RUN npm ci


# 소스 코드 복사 및 프로덕션 빌드
COPY . .
RUN npm run build

# ── 2단계: Nginx를 통한 정적 서빙 ───────────────────────────
FROM nginx:1.27-alpine-slim

# 기본 포트 설정 (Cloud Run 등에서 PORT 환경변수 오버라이드 가능)
ENV PORT=80

# 빌드 산출물 복사
COPY --from=builder /app/dist /usr/share/nginx/html

# Nginx 템플릿 복사 (Nginx 공식 이미지가 시작 시 ${PORT}를 치환함)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
