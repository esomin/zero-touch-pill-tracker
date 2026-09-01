from datetime import datetime, timezone

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from db.mongo_client import create_indexes
from routers import bottle, log
from websocket.handler import handle_sensor_stream, manager

app = FastAPI(title="Zero-Touch Pill Tracker API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],                                  # 로컬, 도커, 배포 서버(GCP VM), Firebase 등 모든 출처 허용
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# REST API 라우터 등록
app.include_router(bottle.router, prefix="/api")
app.include_router(log.router,    prefix="/api")


# ── 앱 시작/종료 이벤트 ───────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    try:
        await create_indexes()
        print("[startup] MongoDB 인덱스 및 약통 데이터베이스 준비 완료")
    except Exception as e:
        print(f"[startup] MongoDB 연결 경고 (WebSocket은 정상 동작): {e}")


# ── WebSocket 엔드포인트 ──────────────────────────────────────────────────────

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    시뮬레이터와 프론트엔드가 공통으로 연결하는 WebSocket 엔드포인트.

    - 시뮬레이터: 3축 자이로·가속도(IMU) 센서 데이터 및 약통 ID 전송
    - 프론트엔드: 복용 완료(medication_taken) 이벤트 실시간 수신
    """
    await handle_sensor_stream(websocket, user_id)


# ── 헬스 체크 ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {"status": "ok", "app": "Zero-Touch Pill Tracker"}


# ── 개발 테스트용 ─────────────────────────────────────────────────────────────

@app.post("/dev/trigger/{user_id}/medication-taken")
async def trigger_medication_taken(user_id: str, bottle_id: str = "BOTTLE_01"):
    """복용 완료 이벤트를 수동으로 강제 브로드캐스트 — 프론트엔드 UI 확인용"""
    now_iso = datetime.now(timezone.utc).isoformat()
    await manager.broadcast(user_id, {
        "type": "medication_taken",
        "payload": {
            "bottle_id": bottle_id,
            "taken_at": now_iso,
            "status": "SUCCESS",
            "state_deg": 110,
        },
        "timestamp": now_iso,
    })
    return {"triggered": True, "bottle_id": bottle_id}
