from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from db.mongo_client import medication_logs, bottles

router = APIRouter(prefix="/logs", tags=["Medication Logs"])


class MedicationLogCreate(BaseModel):
    bottle_id: str = Field(..., example="BOTTLE_01")
    event_type: str = Field("settled", example="settled")
    taken_at: Optional[str] = None
    status: str = Field("SUCCESS", example="SUCCESS")
    compliance_status: Optional[str] = None
    diff_minutes: Optional[int] = None


class MedicationLogResponse(BaseModel):
    id: str
    bottle_id: str
    event_type: str
    taken_at: str
    status: str
    compliance_status: Optional[str] = "ON_TIME"
    diff_minutes: Optional[int] = 0


class AdherenceStatsResponse(BaseModel):
    total_logs: int
    adherence_rate: float
    streak_days: int
    bottle_stats: dict


KST = timezone(timedelta(hours=9))


def compute_compliance_status(taken_at_str: str, target_time_str: Optional[str] = None) -> tuple[str, int]:
    """
    약통 설정 시각과 실제 복용 시각을 비교하여 compliance_status 및 diff_minutes 산출
    - 한국 표준시(KST: UTC+9) 기준으로 시각을 환산하여 오차를 계산합니다.
    - compliance_status: 'ON_TIME' (±60분 이내) | 'EARLY' | 'LATE'
    - diff_minutes: 설정 시각 대비 복용 오차 분 (음수=조기 복용, 양수=지연 복용)
    """
    if not target_time_str:
        return ("ON_TIME", 0)

    try:
        taken_dt = datetime.fromisoformat(taken_at_str.replace("Z", "+00:00"))
        # 한국 표준시(KST: UTC+9)로 변환
        if taken_dt.tzinfo is not None:
            taken_dt = taken_dt.astimezone(KST)
        else:
            taken_dt = taken_dt.replace(tzinfo=KST)

        parts = target_time_str.split(":")
        t_hour = int(parts[0])
        t_min = int(parts[1]) if len(parts) > 1 else 0

        taken_total_min = taken_dt.hour * 60 + taken_dt.minute
        target_total_min = t_hour * 60 + t_min
        diff_min = taken_total_min - target_total_min

        # 24시간 순환 보정 (예: 자정 전후 복용)
        if diff_min > 720:
            diff_min -= 1440
        elif diff_min < -720:
            diff_min += 1440

        if abs(diff_min) <= 60:
            status = "ON_TIME"
        elif diff_min < -60:
            status = "EARLY"
        else:
            status = "LATE"

        return (status, diff_min)
    except Exception:
        return ("ON_TIME", 0)


def _serialize(doc: dict) -> dict:
    doc['id'] = str(doc.pop('_id'))
    return doc


def calculate_streak(logs: list[dict]) -> int:
    """
    연속 복용 달성 일수 (Streak) 알고리즘:
    - 복용 기록이 발생한 유일 날짜(Date)들의 집합(set) 생성.
    - 오늘(Today) 또는 어제(Yesterday)를 기준으로 시작하여 하루도 끊김 없이 연속으로 복용한 날짜 수를 카운트.
    - 오늘과 어제 모두 복용 기록이 없으면(하루 이상 거름) 연속 달성 일수는 0일.
    """
    if not logs:
        return 0

    unique_dates = set()
    for log in logs:
        taken_at_str = log.get("taken_at")
        if taken_at_str:
            try:
                dt = datetime.fromisoformat(taken_at_str.replace("Z", "+00:00"))
                if dt.tzinfo is not None:
                    dt = dt.astimezone(KST)
                else:
                    dt = dt.replace(tzinfo=KST)
                unique_dates.add(dt.date())
            except Exception:
                pass

    if not unique_dates:
        return 0

    today = datetime.now(KST).date()
    yesterday = today - timedelta(days=1)

    if today in unique_dates:
        check_date = today
    elif yesterday in unique_dates:
        check_date = yesterday
    else:
        # 오늘, 어제 모두 복용 이력이 없는 경우 streak은 0일
        return 0

    streak = 0
    while check_date in unique_dates:
        streak += 1
        check_date -= timedelta(days=1)

    return streak


@router.delete("", response_model=dict)
@router.delete("/", response_model=dict)
async def clear_logs():
    """복용 이력 로그 전체 삭제"""
    res = await medication_logs().delete_many({})
    return {"status": "success", "deleted_count": res.deleted_count, "message": f"전체 복용 이력 로그 {res.deleted_count}건이 삭제되었습니다."}


@router.delete("/recent", response_model=dict)
@router.delete("/recent/", response_model=dict)
async def clear_recent_logs(
    hours: float = Query(1.0, description="삭제할 최근 시간 (기본값: 1.0시간)")
):
    """최근 N시간 이내에 기록된 복용 이력 로그만 선택 삭제 (기본 1.0시간)"""
    cutoff_dt = datetime.now(timezone.utc) - timedelta(hours=hours)
    cutoff_iso = cutoff_dt.isoformat()

    res = await medication_logs().delete_many({"taken_at": {"$gte": cutoff_iso}})
    return {
        "status": "success",
        "deleted_count": res.deleted_count,
        "hours": hours,
        "message": f"최근 {hours}시간 이내 복용 이력 로그 {res.deleted_count}건이 성공적으로 삭제되었습니다."
    }


@router.get("", response_model=List[MedicationLogResponse])
@router.get("/", response_model=List[MedicationLogResponse])
async def get_logs(
    bottle_id: Optional[str] = Query(None, description="약통 식별자"),
    start: Optional[str] = Query(None, description="조회 시작 시각 (ISO 8601)"),
    end: Optional[str] = Query(None, description="조회 종료 시각 (ISO 8601)"),
):
    """복용 이력 로그 목록 조회"""
    query: dict = {}
    if bottle_id:
        query["bottle_id"] = bottle_id

    if start or end:
        query["taken_at"] = {}
        if start:
            query["taken_at"]["$gte"] = start
        if end:
            query["taken_at"]["$lte"] = end

    cursor = medication_logs().find(query).sort("taken_at", -1)
    docs = await cursor.to_list(length=300)

    # 약통 정보 맵핑 사전 구축 (target_time 계산용)
    all_bottles = await bottles().find({}, {"_id": 0, "bottle_id": 1, "target_time": 1}).to_list(length=100)
    target_time_map = {b["bottle_id"]: b.get("target_time") for b in all_bottles}

    # 60초 이내 중복 기록 디두플리케이션 및 복용 성과 데이터 보강
    filtered_docs = []
    last_times_by_bottle: dict[str, datetime] = {}

    for doc in docs:
        b_id = doc.get("bottle_id", "")
        taken_str = doc.get("taken_at")
        if not taken_str:
            filtered_docs.append(doc)
            continue
        try:
            taken_dt = datetime.fromisoformat(taken_str.replace("Z", "+00:00"))
        except Exception:
            filtered_docs.append(doc)
            continue

        last_dt = last_times_by_bottle.get(b_id)
        if last_dt is None or abs((last_dt - taken_dt).total_seconds()) >= 60.0:
            last_times_by_bottle[b_id] = taken_dt

            # target_time이 존재하는 경우 정확한 compliance_status 및 diff_minutes 갱신
            target_time = target_time_map.get(b_id)
            if target_time:
                c_status, diff_m = compute_compliance_status(taken_str, target_time)
                doc["compliance_status"] = c_status
                doc["diff_minutes"] = diff_m
            elif "compliance_status" not in doc or doc["compliance_status"] is None:
                doc["compliance_status"] = "ON_TIME"
                doc["diff_minutes"] = 0

            filtered_docs.append(doc)

    return [_serialize(doc) for doc in filtered_docs]


@router.post("", response_model=MedicationLogResponse, status_code=201)
@router.post("/", response_model=MedicationLogResponse, status_code=201)
async def create_log(body: MedicationLogCreate):
    """복용 이력 수동 생성 및 영속화"""
    taken_time = body.taken_at or datetime.now(timezone.utc).isoformat()

    # 약통 정보 조회하여 compliance_status 및 diff_minutes 산출
    target_bottle = await bottles().find_one({"bottle_id": body.bottle_id})
    target_time = target_bottle.get("target_time") if target_bottle else None

    c_status, diff_m = compute_compliance_status(taken_time, target_time)

    doc = {
        "bottle_id": body.bottle_id,
        "event_type": body.event_type,
        "taken_at": taken_time,
        "status": body.status,
        "compliance_status": body.compliance_status or c_status,
        "diff_minutes": body.diff_minutes if body.diff_minutes is not None else diff_m,
    }

    result = await medication_logs().insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    return doc


@router.get("/stats", response_model=AdherenceStatsResponse)
async def get_adherence_stats():
    """복약 순응도(%) 및 연속 달성 일수(Streak) 통계 실시간 계산"""
    all_bottles = await bottles().find(
        {"$or": [{"status": "ACTIVE"}, {"status": {"$exists": False}}]},
        {"_id": 0}
    ).to_list(length=100)
    all_logs = await medication_logs().find({}, {"_id": 0}).to_list(length=1000)

    total_logs = len(all_logs)
    bottle_counts: dict[str, int] = {}
    for log in all_logs:
        b_id = log.get("bottle_id", "UNKNOWN")
        bottle_counts[b_id] = bottle_counts.get(b_id, 0) + 1

    # 최근 7일간 복용 기록 수 계산
    now = datetime.now(KST)
    seven_days_ago = now - timedelta(days=7)
    recent_7days_logs = []
    for log in all_logs:
        taken_at_str = log.get("taken_at")
        if taken_at_str:
            try:
                dt = datetime.fromisoformat(taken_at_str.replace("Z", "+00:00"))
                if dt.tzinfo is not None:
                    dt = dt.astimezone(KST)
                else:
                    dt = dt.replace(tzinfo=KST)
                if dt >= seven_days_ago:
                    recent_7days_logs.append(log)
            except Exception:
                pass

    # 최근 7일 복약 순응도 계산 (%)
    target_doses = max(len(all_bottles) * 7, 1)
    adherence_rate = round((len(recent_7days_logs) / target_doses) * 100, 1)
    adherence_rate = min(adherence_rate, 100.0)

    # 정확한 연속 복용 달성 일수 (Streak) 계산
    streak_days = calculate_streak(all_logs)

    return {
        "total_logs": total_logs,
        "adherence_rate": adherence_rate,
        "streak_days": streak_days,
        "bottle_stats": bottle_counts,
    }


@router.delete("/{log_id}")
async def delete_log(log_id: str):
    """복용 로그 삭제"""
    try:
        oid = ObjectId(log_id)
    except Exception:
        raise HTTPException(status_code=400, detail="유효하지 않은 log_id 입니다.")

    res = await medication_logs().delete_one({"_id": oid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="해당 로그를 찾을 수 없습니다.")
    return {"ok": True, "deleted_id": log_id}
