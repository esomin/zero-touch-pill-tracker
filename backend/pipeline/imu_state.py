from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

# ── 상수 ──────────────────────────────────────────────────────────────────────
# ── 센서 스케일 변환 참고 (Raw LSB -> 물리 단위) ────────────────────────────────
# ±2g 설정 시: 1g ≈ 16384 LSB, 1 m/s^2 ≈ 1670 LSB
# ±250dps 설정 시: 1 rad/s ≈ 7500 LSB

# 슬라이딩 윈도우 크기 (50Hz 기준 2.0초 수용)
WINDOW_SIZE = 100

# 약통 털어넣기(Shaking/Pouring) 복용 판별 임계값 (20Hz 시뮬레이터 & 실기기 겸용)
# 1. 일반적인 약통 기울임/털어넣기 스냅 시 평면 가속도 피크 7.5 m/s^2 이상 (약 0.75g~)
POURING_ACC_XY_MIN = 7.5

# 2. 동적 타격/기울임 동작 중 Z축 가속도 동요 수용 범위 (60도~110도 요동 수용)
POURING_ACC_Z_MAX = 5.5

# 3. 샘플 지속 개수 (20Hz 기준 4 샘플 = 0.2초)
INTAKE_SUSTAINED_SAMPLES = 4

# 미세 진동 노이즈 오탐 방지를 위한 이동(Moving) 가속도 임계값 (g 단위)
MOVE_ACCEL_THRESHOLD = 0.15

# 미세 일상 회전 억제를 위한 자이로 분산 임계값 ((rad/s)^2 단위)
MOVE_GYRO_VAR = 0.60

# 약통 4단계 상태 정의
# idle: 보관 중 (0도)
# moving: 집어 들거나 이동 중 (45도 등)
# pouring: 손바닥에 알약 털어넣기/Shaking 중 (기울임 & 강한 스냅)
# settled: 다시 제자리에 세워 거치 완료 (0도)
BottleState = Literal['idle', 'moving', 'pouring', 'settled']


@dataclass
class SensorReading:
    accel_magnitude: float
    gyro_magnitude: float
    acc_x: float = 0.0
    acc_y: float = 0.0
    acc_z: float = 9.81
    state_deg: int = 0
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


def raw_lsb_to_physical(
    acc_x_lsb: float,
    acc_y_lsb: float,
    acc_z_lsb: float,
    acc_lsb_per_g: float = 16384.0,
) -> tuple[float, float, float]:
    """
    아두이노 센서 Raw LSB 데이터를 물리 단위(m/s^2)로 변환한다.
    (기본 스케일: ±2g 기준 1g = 16384 LSB, 1g = 9.81 m/s^2)
    """
    ax_g = acc_x_lsb / acc_lsb_per_g
    ay_g = acc_y_lsb / acc_lsb_per_g
    az_g = acc_z_lsb / acc_lsb_per_g
    return ax_g * 9.81, ay_g * 9.81, az_g * 9.81


def detect_medication_intake(window: deque[SensorReading]) -> bool:
    """
    윈도우 내 샘플들이 영양제 복용 모션(손목 스냅 털어넣기 Shaking) 조건에 부합하는지 판별한다.

    조건:
    1. AccZ < POURING_ACC_Z_MAX (5.5 m/s^2 이하 - 60도~110도 요동 수용)
    2. sqrt(AccX^2 + AccY^2) > POURING_ACC_XY_MIN (7.5 m/s^2 이상 - 약통 털어넣기 피크)
    3. 최근 INTAKE_SUSTAINED_SAMPLES (4샘플 = 0.2초) 중 50% 이상(2개 이상) 조건 충족 시 인정
    """
    if len(window) < INTAKE_SUSTAINED_SAMPLES:
        return False

    recent_samples = list(window)[-INTAKE_SUSTAINED_SAMPLES:]

    valid_count = sum(
        1 for r in recent_samples
        if r.acc_z < POURING_ACC_Z_MAX and math.sqrt(r.acc_x**2 + r.acc_y**2) > POURING_ACC_XY_MIN
    )

    return (valid_count / INTAKE_SUSTAINED_SAMPLES) >= 0.50


# 빠른 상태 전이(안정화 판정)를 위한 최소 윈도우 크기 (0.3초 = 15샘플)
MIN_EVAL_WINDOW = 15

def detect_bottle_state(sensor_window: deque[SensorReading]) -> BottleState:
    """
    슬라이딩 윈도우 내 센서 값으로 약통의 움직임/거치 상태를 판별한다.
    """
    if len(sensor_window) < MIN_EVAL_WINDOW:
        return 'settled' if len(sensor_window) == 0 else 'moving'

    readings = list(sensor_window)

    # 1. 최근 센서독출 중 110도 털어넣는 중인지 검사
    latest = readings[-1]
    if latest.acc_z < POURING_ACC_Z_MAX and math.sqrt(latest.acc_x**2 + latest.acc_y**2) > POURING_ACC_XY_MIN:
        return 'pouring'

    # 2. 최근 0.4초(20개) 샘플의 안정도 검사 (통을 내려놓았을 때 즉시 settled/idle로 복귀)
    recent_eval = readings[-min(len(readings), 25):]
    accel_dev_mean = sum(abs(r.accel_magnitude - 1.0) for r in recent_eval) / len(recent_eval)
    gyro_values = [r.gyro_magnitude for r in recent_eval]
    gyro_mean = sum(gyro_values) / len(gyro_values)
    gyro_var = sum((v - gyro_mean) ** 2 for v in gyro_values) / len(gyro_values)

    # 중력 가속도(Z축)가 9.0 이상(0도 거치 상태)이고 잔진동이 낮으면 즉시 거치(settled)
    is_upright = latest.acc_z >= 8.5 and abs(latest.acc_x) < 3.0 and abs(latest.acc_y) < 3.0
    if is_upright and accel_dev_mean <= MOVE_ACCEL_THRESHOLD and gyro_var <= MOVE_GYRO_VAR:
        return 'settled'

    if accel_dev_mean > MOVE_ACCEL_THRESHOLD or gyro_var > MOVE_GYRO_VAR:
        return 'moving'
    return 'settled'


# 기존 호환성용 하위 별칭
detect_tumbler_state = detect_bottle_state


def make_medication_taken_event(
    bottle_id: str,
    timestamp: datetime | None = None,
) -> dict:
    """복용 완료 이벤트 딕셔너리 생성"""
    ts = timestamp or datetime.now(timezone.utc)
    return {
        'type': 'medication_taken',
        'payload': {
            'bottle_id': bottle_id,
            'taken_at': ts.isoformat(),
            'status': 'SUCCESS',
            'state_deg': 110,
        },
        'timestamp': ts.isoformat(),
    }


def make_state_event(
    new_state: BottleState,
    prev_state: BottleState,
    timestamp: datetime | None = None,
) -> dict | None:
    if new_state == prev_state:
        return None

    ts = timestamp or datetime.now(timezone.utc)

    return {
        'type': 'bottle_state_changed',
        'payload': {
            'state': new_state,
            'transitioned_at': ts.isoformat(),
        },
        'timestamp': ts.isoformat(),
    }
