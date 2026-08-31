#!/bin/bash
# 모든 서비스를 동시에 시작하는 개발 환경 스크립트

ROOT="$(cd "$(dirname "$0")" && pwd)"

# ── 색상 정의 ─────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
RESET='\033[0m'

# ── 종료 시 모든 자식 프로세스 정리 ──────────────────────────────────────────
PIDS=()
cleanup() {
  echo -e "\n${YELLOW}[dev] 서비스 종료 중...${RESET}"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null
  done
  wait
  echo -e "${YELLOW}[dev] 종료 완료${RESET}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── 1. MongoDB (Docker) ───────────────────────────────────────────────────────
echo -e "${CYAN}[mongo ] Docker MongoDB 시작...${RESET}"
docker compose -f "$ROOT/compose-local.yml" up -d
echo -e "${GREEN}[mongo ] 완료 (port 27017)${RESET}"

# ── 2. Backend (FastAPI) ──────────────────────────────────────────────────────
echo -e "${CYAN}[backend] uvicorn 시작...${RESET}"
(
  cd "$ROOT/backend"
  source venv/bin/activate
  uvicorn main:app --reload --host 0.0.0.0 --port 8000
) &
PIDS+=($!)
echo -e "${GREEN}[backend] PID $! (port 8000)${RESET}"

# ── 3. Simulator (Streamlit) ──────────────────────────────────────────────────
echo -e "${CYAN}[sim    ] Streamlit 시작...${RESET}"
(
  cd "$ROOT/simulator"
  source venv/bin/activate
  streamlit run streamlit_app.py --server.port 8501
) &
PIDS+=($!)
echo -e "${GREEN}[sim    ] PID $! (port 8501)${RESET}"

# ── 4. Frontend (Vite) ────────────────────────────────────────────────────────
echo -e "${CYAN}[front  ] Vite dev 서버 시작...${RESET}"
(
  cd "$ROOT/frontend"
  npm run dev
) &
PIDS+=($!)
echo -e "${GREEN}[front  ] PID $! (port 5173)${RESET}"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}  Frontend  → http://localhost:5173${RESET}"
echo -e "${GREEN}  Backend   → http://localhost:8000${RESET}"
echo -e "${GREEN}  API Docs  → http://localhost:8000/docs${RESET}"
echo -e "${GREEN}  Simulator → http://localhost:8501${RESET}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${YELLOW}  Ctrl+C 로 전체 종료${RESET}"
echo ""

# 모든 백그라운드 프로세스가 살아있는 동안 대기
wait
