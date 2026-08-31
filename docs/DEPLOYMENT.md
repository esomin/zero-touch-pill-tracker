# 도커 배포 가이드 (Docker Compose Deployment Guide)

본 가이드는 클라우드 VM(GCP Compute Engine, AWS EC2) 또는 온프레미스 단일 서버 환경에서 **Docker Compose**를 사용하여 **Zero-Touch Pill Tracker** 서비스를 배포하고 운영하는 방법을 안내합니다.

---

## 주요 도커 구성 파일

| 파일 경로 | 설명 |
| :--- | :--- |
| [`compose.yml`](../compose.yml) | VM/서버 환경 원터치 풀스택 컨테이너 오케스트레이션 설정 |
| [`.env.docker.example`](../.env.docker.example) | 도커 환경 변수 템플릿 파일 |
| [`backend/Dockerfile`](../backend/Dockerfile) | FastAPI 백엔드 프로덕션용 Dockerfile (Python 3.11-slim, 비-루트 보안 계정, 포트 환경변수 지원) |
| [`backend/.dockerignore`](../backend/.dockerignore) | venv, pycache, .env 등 불필요한 빌드 컨텍스트 제외 |
| [`frontend/Dockerfile`](../frontend/Dockerfile) | React SPA 프로덕션용 멀티 스테이지 Dockerfile (Node 22 Build -> Nginx 1.27 Alpine Serve) |
| [`frontend/nginx.conf.template`](../frontend/nginx.conf.template) | Nginx 웹서버 설정 (정적 파일 캐싱, Gzip 압축, 헬스체크 지원) |
| [`frontend/.dockerignore`](../frontend/.dockerignore) | node_modules, dist, .env 등 빌드 제외 파일 설정 |

---

## 배포 및 실행 단계

### 1단계. 사전 준비 (서버 환경)
서버에 Docker 및 Docker Compose 플러그인이 설치되어 있어야 합니다.
```bash
# Docker 동작 여부 확인
docker --version
docker compose version
```

### 2단계. 프로젝트 소스 코드 클론 및 디렉토리 이동
```bash
git clone <REPOSITORY_URL>
cd zero-touch-pill-tracker
```

### 3단계. 환경 변수 설정
`.env.docker.example`을 복사하여 `.env` 파일을 생성하고 서버 환경에 맞게 값을 수정합니다.
```bash
cp .env.docker.example .env
```

`.env` 설정 항목 예시:
```env
# ── [백엔드 DB 설정] ──────────────────────────────────────────
# 방법 A) 클라우드 MongoDB Atlas 연결 시 (기본 권장)
MONGO_URI=mongodb+srv://admin:password@prod-cluster.bat4mdb.mongodb.net/?appName=prod-cluster

# 방법 B) 서버 내 로컬 MongoDB 컨테이너 연결 시 (profile with-mongo 사용 시)
# MONGO_URI=mongodb://admin:password@mongodb:27017/med_tracker?authSource=admin

DB_NAME=med_tracker
BACKEND_PORT=8000

# ── [프론트엔드 빌드 설정] ──────────────────────────────────────
# 사용자가 브라우저에서 접근할 서버의 공인 IP 또는 도메인 주소
VITE_API_URL=http://<서버_공인_IP_또는_도메인>:8000
VITE_WS_URL=ws://<서버_공인_IP_또는_도메인>:8000
FRONTEND_PORT=80
```

> **주의**: `VITE_API_URL`과 `VITE_WS_URL`은 브라우저에서 실행되는 프론트엔드가 백엔드 API/웹소켓에 접근하는 주소이므로, `localhost`가 아닌 **실제 서버의 외부 공인 IP 또는 도메인**을 입력해야 합니다.

### 4단계. 서비스 빌드 및 백그라운드 실행

#### 방법 A. 클라우드 MongoDB Atlas 사용 시 (기본 권장)
외부 클라우드 DB를 사용하므로 `backend`와 `frontend` 컨테이너 2개만 기동합니다.
```bash
docker compose up -d --build
```

#### 방법 B. 서버 내 로컬 MongoDB 컨테이너도 함께 실행할 때
```bash
docker compose --profile with-mongo up -d --build
```

---

## 모니터링 및 운영 관리

### 컨테이너 상태 확인
```bash
docker compose ps
```

### 실시간 로그 확인
```bash
# 전체 서비스 실시간 로그
docker compose logs -f

# 백엔드 로그만 확인
docker compose logs -f backend

# 프론트엔드(Nginx) 로그만 확인
docker compose logs -f frontend
```

### 서비스 중지 및 재시작
```bash
# 서비스 중지
docker compose down

# 코드 수정 후 재빌드 및 재시작
docker compose up -d --build
```

---

## 방화벽 / 보안 그룹(Security Group) 설정

클라우드 콘솔(GCP Firewall Rules 또는 AWS Security Group)에서 아래 인바운드 포트를 허용해야 정상 접속이 가능합니다:
- **80 (TCP)**: 프론트엔드 웹 UI 접속
- **8000 (TCP)**: 백엔드 REST API 및 WebSocket (`/ws/{user_id}`) 접속
