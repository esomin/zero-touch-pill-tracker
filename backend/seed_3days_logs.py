import os
import asyncio
from datetime import datetime, timezone, timedelta
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("DB_NAME", "med_tracker")


def get_iso_time(days_ago: int, hour: int, minute: int) -> str:
    """KST 기준 특정 날짜/시각을 ISO UTC 문자열로 변환"""
    kst = timezone(timedelta(hours=9))
    now_kst = datetime.now(kst)
    today_midnight_kst = datetime(now_kst.year, now_kst.month, now_kst.day, 0, 0, 0, tzinfo=kst)
    target_kst = today_midnight_kst - timedelta(days=days_ago) + timedelta(hours=hour, minutes=minute)
    return target_kst.astimezone(timezone.utc).isoformat()


async def seed_logs():
    client = AsyncIOMotorClient(MONGO_URI)
    db = client[DB_NAME]

    print(f"[seed] MongoDB 연결 중: {MONGO_URI.split('@')[-1] if '@' in MONGO_URI else MONGO_URI}")
    print(f"[seed] 데이터베이스: {DB_NAME}")

    # 1. 최근 3일 전 ~ 오늘 데이터 중복 정리
    start_iso = get_iso_time(3, 0, 0)
    end_iso = get_iso_time(-1, 0, 0)
    delete_result = await db["medication_logs"].delete_many({
        "taken_at": {"$gte": start_iso, "$lt": end_iso}
    })
    if delete_result.deleted_count > 0:
        print(f"[seed] 기존 데이터 {delete_result.deleted_count}건 정리 완료.")

    # 2. 동적 날짜가 적용된 총 10회 복용 이력 생성
    logs = [
        # ────────────── -3일 전 ──────────────
        {
            "bottle_id": "BOTTLE_01",
            "event_type": "settled",
            "taken_at": get_iso_time(3, 8, 12),  # 08:12 KST (+12분)
            "status": "SUCCESS",
            "compliance_status": "ON_TIME",
            "diff_minutes": 12,
        },
        {
            "bottle_id": "BOTTLE_02",
            "event_type": "settled",
            "taken_at": get_iso_time(3, 12, 22),  # 12:22 KST (-8분)
            "status": "SUCCESS",
            "compliance_status": "ON_TIME",
            "diff_minutes": -8,
        },
        {
            "bottle_id": "BOTTLE_03",
            "event_type": "settled",
            "taken_at": get_iso_time(3, 22, 45),  # 22:45 KST (+15분)
            "status": "SUCCESS",
            "compliance_status": "ON_TIME",
            "diff_minutes": 15,
        },

        # ────────────── -2일 전 ──────────────
        {
            "bottle_id": "BOTTLE_01",
            "event_type": "settled",
            "taken_at": get_iso_time(2, 6, 40),  # 06:40 KST (-80분 -> 조기 복용)
            "status": "SUCCESS",
            "compliance_status": "EARLY",
            "diff_minutes": -80,
        },
        {
            "bottle_id": "BOTTLE_02",
            "event_type": "settled",
            "taken_at": get_iso_time(2, 12, 35),  # 12:35 KST (+5분)
            "status": "SUCCESS",
            "compliance_status": "ON_TIME",
            "diff_minutes": 5,
        },
        {
            "bottle_id": "BOTTLE_03",
            "event_type": "settled",
            "taken_at": get_iso_time(2, 22, 15),  # 22:15 KST (-15분)
            "status": "SUCCESS",
            "compliance_status": "ON_TIME",
            "diff_minutes": -15,
        },

        # ────────────── -1일 전 ──────────────
        {
            "bottle_id": "BOTTLE_01",
            "event_type": "settled",
            "taken_at": get_iso_time(1, 7, 50),  # 07:50 KST (-10분)
            "status": "SUCCESS",
            "compliance_status": "ON_TIME",
            "diff_minutes": -10,
        },
        {
            "bottle_id": "BOTTLE_02",
            "event_type": "settled",
            "taken_at": get_iso_time(1, 13, 45),  # 13:45 KST (+75분 -> 지연 복용)
            "status": "SUCCESS",
            "compliance_status": "LATE",
            "diff_minutes": 75,
        },
        {
            "bottle_id": "BOTTLE_03",
            "event_type": "settled",
            "taken_at": get_iso_time(1, 22, 38),  # 22:38 KST (+8분)
            "status": "SUCCESS",
            "compliance_status": "ON_TIME",
            "diff_minutes": 8,
        },

        # ────────────── 오늘 (1회 복용) ──────────────
        {
            "bottle_id": "BOTTLE_01",
            "event_type": "settled",
            "taken_at": get_iso_time(0, 8, 30),  # 오늘 아침 08:30 KST (+30분)
            "status": "SUCCESS",
            "compliance_status": "ON_TIME",
            "diff_minutes": 30,
        },
    ]

    insert_result = await db["medication_logs"].insert_many(logs)
    print(f"[seed] 완료! 총 {len(insert_result.inserted_ids)}건의 복용 이력이 성공적으로 생성되었습니다 (최근 3일 9회 + 오늘 1회).")
    client.close()


if __name__ == "__main__":
    asyncio.run(seed_logs())
