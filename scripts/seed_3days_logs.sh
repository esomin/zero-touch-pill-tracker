#!/bin/bash
# 최근 3일간(9회) + 오늘 아침(1회) 총 10회 복용 이력 시드 데이터를 Docker MongoDB 컨테이너에 삽입하는 스크립트

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CONTAINER_NAME="med-tracker-mongo"
DB_NAME="med_tracker"
JS_FILE="$SCRIPT_DIR/seed_recent_3days_logs.js"

# 색상 정의
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

# 1. med-tracker-backend 컨테이너가 실행 중인 경우 (MongoDB Atlas 및 도커 배포 환경 - 가장 권장)
if docker ps --format '{{.Names}}' | grep -q "^med-tracker-backend$"; then
  echo -e "${CYAN}[seed] med-tracker-backend 컨테이너를 통해 데이터 삽입 중 (Atlas / 로컬 DB 자동 감지)...${RESET}"
  docker exec -i med-tracker-backend python seed_3days_logs.py
  echo -e "${GREEN}[seed] 완료! 최근 3일(9회) + 오늘 아침(1회) 총 10회 복용 이력이 성공적으로 생성되었습니다.${RESET}"
  exit 0
fi

# 2. 로컬 med-tracker-mongo 컨테이너가 실행 중인 경우 (로컬 전용 compose)
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "${CYAN}[seed] 로컬 MongoDB 컨테이너(${CONTAINER_NAME})로 JS 시드 실행 중...${RESET}"
  docker exec -i "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet < "$JS_FILE"
  echo -e "${GREEN}[seed] 완료! 최근 3일(9회) + 오늘 아침(1회) 총 10회 복용 이력이 성공적으로 생성되었습니다.${RESET}"
  exit 0
fi

# 3. 로컬 파이썬 가상환경으로 직접 실행 시도
if [ -f "$ROOT_DIR/backend/seed_3days_logs.py" ]; then
  echo -e "${CYAN}[seed] 로컬 파이썬 스크립트(backend/seed_3days_logs.py) 직접 실행 중...${RESET}"
  python3 "$ROOT_DIR/backend/seed_3days_logs.py" || "$ROOT_DIR/backend/venv/bin/python" "$ROOT_DIR/backend/seed_3days_logs.py"
  exit 0
fi

echo -e "${RED}[오류] 실행 중인 backend 또는 mongodb 컨테이너를 찾을 수 없습니다.${RESET}"
echo -e "${YELLOW}먼저 'docker compose up -d'로 서비스를 실행해 주세요.${RESET}"
exit 1

