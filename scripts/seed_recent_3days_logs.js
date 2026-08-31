// med_tracker DB - 최근 3일간(9회) + 오늘 아침(1회) 총 10회 복용 이력 동적 생성 스크립트
// - 조기 복용(EARLY): 1회 (-80분)
// - 지연 복용(LATE): 1회 (+75분)
// - 정상 복용(ON_TIME): 8회 (설정 시각 기준 ±30분 이내 오차)
// 언제 실행하든 실행 시점(now) 기준으로 날짜가 자동 동적 계산됩니다.

db = db.getSiblingDB('med_tracker');

(function () {
  const now = new Date();

  // KST(UTC+9) 기준 오늘 자정(00:00:00) 밀리초 계산
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstNow = new Date(now.getTime() + kstOffsetMs);
  const kstTodayMidnightMs = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
    0, 0, 0
  );

  // KST 특정 날짜/시각을 ISO UTC 문자열로 변환하는 헬퍼 함수
  function getISOTime(daysAgo, hour, minute) {
    const targetKstMs = kstTodayMidnightMs - (daysAgo * 24 * 60 * 60 * 1000) + (hour * 60 + minute) * 60 * 1000;
    const targetUtcMs = targetKstMs - kstOffsetMs;
    return new Date(targetUtcMs).toISOString();
  }

  // 1. 최근 3일 전 00:00:00 ~ 오늘 23:59:59 (내일 00:00:00 직전) 기존 데이터 중복 정리
  const startIso = getISOTime(3, 0, 0);
  const endIso = getISOTime(-1, 0, 0);
  const deleteResult = db.medication_logs.deleteMany({
    taken_at: { $gte: startIso, $lt: endIso }
  });
  if (deleteResult.deletedCount > 0) {
    print("Cleaned up " + deleteResult.deletedCount + " existing log(s) for the past 3 days and today.");
  }

  // 2. 동적 날짜가 적용된 총 10회 복용 이력 생성
  const logs = [
    // ────────────── -3일 전 ──────────────
    {
      bottle_id: "BOTTLE_01",
      event_type: "settled",
      taken_at: getISOTime(3, 8, 12),  // 08:12 KST (설정 08:00 대비 +12분)
      status: "SUCCESS",
      compliance_status: "ON_TIME",
      diff_minutes: 12
    },
    {
      bottle_id: "BOTTLE_02",
      event_type: "settled",
      taken_at: getISOTime(3, 12, 22), // 12:22 KST (설정 12:30 대비 -8분)
      status: "SUCCESS",
      compliance_status: "ON_TIME",
      diff_minutes: -8
    },
    {
      bottle_id: "BOTTLE_03",
      event_type: "settled",
      taken_at: getISOTime(3, 22, 45), // 22:45 KST (설정 22:30 대비 +15분)
      status: "SUCCESS",
      compliance_status: "ON_TIME",
      diff_minutes: 15
    },

    // ────────────── -2일 전 ──────────────
    {
      bottle_id: "BOTTLE_01",
      event_type: "settled",
      taken_at: getISOTime(2, 6, 40),  // 06:40 KST (설정 08:00 대비 -80분 -> 조기 복용)
      status: "SUCCESS",
      compliance_status: "EARLY",
      diff_minutes: -80
    },
    {
      bottle_id: "BOTTLE_02",
      event_type: "settled",
      taken_at: getISOTime(2, 12, 35), // 12:35 KST (설정 12:30 대비 +5분)
      status: "SUCCESS",
      compliance_status: "ON_TIME",
      diff_minutes: 5
    },
    {
      bottle_id: "BOTTLE_03",
      event_type: "settled",
      taken_at: getISOTime(2, 22, 15), // 22:15 KST (설정 22:30 대비 -15분)
      status: "SUCCESS",
      compliance_status: "ON_TIME",
      diff_minutes: -15
    },

    // ────────────── -1일 전 ──────────────
    {
      bottle_id: "BOTTLE_01",
      event_type: "settled",
      taken_at: getISOTime(1, 7, 50),  // 07:50 KST (설정 08:00 대비 -10분)
      status: "SUCCESS",
      compliance_status: "ON_TIME",
      diff_minutes: -10
    },
    {
      bottle_id: "BOTTLE_02",
      event_type: "settled",
      taken_at: getISOTime(1, 13, 45), // 13:45 KST (설정 12:30 대비 +75분 -> 지연 복용)
      status: "SUCCESS",
      compliance_status: "LATE",
      diff_minutes: 75
    },
    {
      bottle_id: "BOTTLE_03",
      event_type: "settled",
      taken_at: getISOTime(1, 22, 38), // 22:38 KST (설정 22:30 대비 +8분)
      status: "SUCCESS",
      compliance_status: "ON_TIME",
      diff_minutes: 8
    },

    // ────────────── 오늘 (1회 복용) ──────────────
    {
      bottle_id: "BOTTLE_01",
      event_type: "settled",
      taken_at: getISOTime(0, 8, 30),  // 오늘 아침 08:30 KST (설정 08:00 대비 +30분)
      status: "SUCCESS",
      compliance_status: "ON_TIME",
      diff_minutes: 30
    }
  ];

  const result = db.medication_logs.insertMany(logs);
  print("Inserted " + Object.keys(result.insertedIds).length + " medication logs successfully (past 3 days + today).");
})();
