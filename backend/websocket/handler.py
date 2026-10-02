from __future__ import annotations

import json
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect

from pipeline.imu_state import SensorReading, detect_bottle_state, make_state_event
from pipeline.noise_filter import filter_sensor, filter_sensor_3axis
from state.session_cache import session_cache


# ── 연결 관리 ─────────────────────────────────────────────────────────────────

class ConnectionManager:
    """
    user_id 별 활성 WebSocket 연결 목록을 관리한다.

    시뮬레이터(센서 데이터 송신)와 프론트엔드(이벤트 수신)가
    동일한 엔드포인트(/ws/{user_id})에 연결한다.
    백엔드는 수신한 센서 데이터를 처리한 뒤 상태 변화 이벤트를
    해당 user_id 의 모든 연결에 브로드캐스트한다.
    """

    def __init__(self) -> None:
        # user_id → 활성 WebSocket 연결 목록
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, user_id: str, ws: WebSocket) -> None:
        """핸드셰이크를 완료하고 연결 목록에 등록한다."""
        await ws.accept()
        self._connections[user_id].append(ws)

    def disconnect(self, user_id: str, ws: WebSocket) -> None:
        """
        연결 목록에서 제거한다.
        해당 user_id 의 연결이 모두 사라지면 세션 캐시도 정리한다.
        """
        conns = self._connections.get(user_id, [])
        if ws in conns:
            conns.remove(ws)
        if not conns:
            self._connections.pop(user_id, None)
            session_cache.remove(user_id)

    async def broadcast(self, user_id: str, message: dict) -> None:
        """
        user_id 의 모든 연결에 JSON 메시지를 전송한다.
        전송 실패한 연결은 자동으로 제거한다.
        """
        conns = self._connections.get(user_id, [])
        dead: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)

    def connection_count(self, user_id: str) -> int:
        return len(self._connections.get(user_id, []))


manager = ConnectionManager()


# ── WebSocket 엔드포인트 핸들러 ──────────────────────────────────────────────

async def handle_sensor_stream(ws: WebSocket, user_id: str) -> None:
    """
    /ws/{user_id} 엔드포인트 처리 함수.

    수신 메시지 형식 (시뮬레이터 → 백엔드):
    {
        "accel_magnitude": 1.05,
        "gyro_magnitude":  0.02,
        "mag_x": 30.5,   "mag_y": -15.2,   "mag_z": 45.1,  (생략 시 0.0)
        "timestamp": "..."                                    (생략 시 서버 현재 시각)
    }

    파이프라인 순서:
        noise_filter → imu_state → (settled 전이 시) mag_fingerprint
    """
    await manager.connect(user_id, ws)
    session = session_cache.get_or_create(user_id)
    _diag_count = 0  # 진단 로그용 샘플 카운터

    try:
        while True:
            raw = await ws.receive_text()

            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            raw_acc_x = float(data.get('acc_x', 0.10))
            raw_acc_y = float(data.get('acc_y', -0.05))
            raw_acc_z = float(data.get('acc_z', 9.81))
            bottle_id = str(data.get('bottle_id', 'BOTTLE_01'))
            state_deg = int(data.get('state_deg', 0))
            raw_ts = data.get('timestamp')
            if raw_ts:
                try:
                    ts = datetime.fromisoformat(raw_ts.replace('Z', '+00:00'))
                except Exception:
                    ts = datetime.now(timezone.utc)
            else:
                ts = datetime.now(timezone.utc)

            # ── 1. 노이즈 필터 ────────────────────────────────────────────────
            f_acc_x, f_acc_y, f_acc_z, f_accel, f_gyro = filter_sensor_3axis(
                session.ema_state,
                raw_acc_x,
                raw_acc_y,
                raw_acc_z,
                float(data.get('accel_magnitude', 1.0)),
                float(data.get('gyro_magnitude', 0.0)),
            )

            # ── 2. 슬라이딩 윈도우 갱신 ──────────────────────────────────────
            session.recent_sensor_window.append(
                SensorReading(
                    accel_magnitude=f_accel,
                    gyro_magnitude=f_gyro,
                    acc_x=f_acc_x,
                    acc_y=f_acc_y,
                    acc_z=f_acc_z,
                    state_deg=state_deg,
                    timestamp=ts,
                )
            )
            session_cache.touch(user_id)

            # ── 3. 센서 스트리밍 핑(sensor_pulse) & 실시간 디버그용 센서 데이터 Broadcast ─
            now_ts = datetime.now(timezone.utc)
            now_sec = now_ts.timestamp()
            last_pulse = getattr(session, f"last_pulse_{bottle_id}", 0)
            if (now_sec - last_pulse) >= 1.0:
                setattr(session, f"last_pulse_{bottle_id}", now_sec)
                await manager.broadcast(user_id, {
                    "type": "sensor_pulse",
                    "payload": {
                        "bottle_id": bottle_id,
                        "timestamp": ts.isoformat(),
                    },
                    "timestamp": ts.isoformat(),
                })

            # 실시간 디버그 모니터링용 센서 샘플 (약 10Hz = 0.1초마다 프론트엔드로 브로드캐스트)
            last_debug_emit = getattr(session, f"last_debug_{bottle_id}", 0)
            if (now_sec - last_debug_emit) >= 0.1:
                setattr(session, f"last_debug_{bottle_id}", now_sec)
                await manager.broadcast(user_id, {
                    "type": "sensor_reading",
                    "payload": {
                        "bottle_id": bottle_id,
                        "acc_x": round(f_acc_x, 2),
                        "acc_y": round(f_acc_y, 2),
                        "acc_z": round(f_acc_z, 2),
                        "accel_magnitude": round(f_accel, 2),
                        "gyro_magnitude": round(f_gyro, 2),
                        "state_deg": state_deg,
                        "timestamp": ts.isoformat(),
                    },
                    "timestamp": ts.isoformat(),
                })

            # ── 4. IMU 약통 상태 판별 ─────────────────────────────────
            from pipeline.imu_state import detect_medication_intake, make_medication_taken_event, detect_bottle_state, make_state_event
            from db.mongo_client import medication_logs

            prev_state = session.tumbler_state
            new_state = detect_bottle_state(session.recent_sensor_window)
            session.tumbler_state = new_state

            if new_state != prev_state:
                print(f'[handler] {user_id} 상태 전이: {prev_state} -> {new_state} '
                      f'(acc_z={f_acc_z:.3f}, state_deg={state_deg})')

            state_event = make_state_event(new_state, prev_state, timestamp=ts)
            if state_event:
                state_event['payload']['bottle_id'] = bottle_id
                await manager.broadcast(user_id, state_event)

            # ── 5. 영양제 복용 감지 및 MongoDB 영속화 ───────────
            # 약통별 중복 복용 감지 방지 (동일 약통은 60초에 1회만 정식 복용 저장)
            last_intake_time = session.last_intake_by_bottle.get(bottle_id)
            is_cooldown = (
                last_intake_time is not None and 
                (now_ts - last_intake_time).total_seconds() < 60.0
            )

            # 연속 반복 방지: 약통 털어넣기/기울임(pouring) 후 제자리 거치(settled)로 동작이 완전 종료된 순간 1회만 확정
            is_intake_completed = (prev_state == 'pouring' and new_state == 'settled')

            if not is_cooldown and is_intake_completed:
                session.last_intake_by_bottle[bottle_id] = now_ts
                session.last_intake_at = now_ts
                session.recent_sensor_window.clear()  # 슬라이딩 윈도우 잔여 센서값 리셋

                # 복용 성과 데이터 산출 (target_time과 비교)
                from db.mongo_client import bottles
                from routers.log import compute_compliance_status

                target_bottle = await bottles().find_one({"bottle_id": bottle_id})
                target_time = target_bottle.get("target_time") if target_bottle else None
                c_status, diff_m = compute_compliance_status(ts.isoformat(), target_time)

                intake_event = make_medication_taken_event(bottle_id, timestamp=ts)
                intake_event["payload"]["compliance_status"] = c_status
                intake_event["payload"]["diff_minutes"] = diff_m

                print(f'[handler] 약통 복용 감지 최종 확정 (중복방지 적용): {bottle_id} (compliance={c_status}, diff={diff_m}분)')
                await manager.broadcast(user_id, intake_event)

                # MongoDB 복용 이력 자동 영속화
                try:
                    await medication_logs().insert_one({
                        "bottle_id": bottle_id,
                        "event_type": "settled",
                        "taken_at": ts.isoformat(),
                        "status": "SUCCESS",
                        "compliance_status": c_status,
                        "diff_minutes": diff_m,
                    })
                    print(f'[handler] MongoDB 복용 로그 영속화 완료: {bottle_id} ({c_status})')
                except Exception as e:
                    print(f'[handler] MongoDB 저장 실패: {e}')

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(user_id, ws)
