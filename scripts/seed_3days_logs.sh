#!/bin/bash
# 최근 3일간의 복용 이력 시드 데이터를 Docker MongoDB 컨테이너에 삽입하는 스크립트

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

echo -e "${CYAN}[seed] MongoDB 컨테이너($CONTAINER_NAME) 확인 중...${RESET}"

# 컨테이너 실행 여부 확인
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo -e "${RED}[오류] MongoDB 컨테이너 '${CONTAINER_NAME}'가 실행 중이지 않습니다.${RESET}"
  echo -e "${YELLOW}먼저 './dev.sh' 또는 'docker compose -f compose-local.yml up -d' 로 컨테이너를 실행해 주세요.${RESET}"
  exit 1
fi

echo -e "${CYAN}[seed] 최근 3일치 복용 이력 데이터 삽입 중...${RESET}"
docker exec -i "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet < "$JS_FILE"

echo -e "${GREEN}[seed] 완료! 최근 3일간 총 9회(조기 1, 지연 1, 정상 7) 복용 이력이 성공적으로 생성되었습니다.${RESET}"
