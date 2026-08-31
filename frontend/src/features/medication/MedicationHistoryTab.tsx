import React, { useState, useMemo } from 'react';
import { Badge } from '@mantine/core';
import type { MedicationLog, Bottle, AdherenceStats } from '../../types';

interface MedicationHistoryTabProps {
  logs: MedicationLog[];
  bottles: Bottle[];
  stats: AdherenceStats | null;
}

const BOTTLE_NAME_FALLBACK: Record<string, string> = {
  BOTTLE_01: '아침 유산균',
  BOTTLE_02: '점심 비타민 B',
  BOTTLE_03: '취침 전 비염약',
};

// 로컬 YYYY-MM-DD 날짜 문자열 추출 헬퍼 (타임존 오프셋 반영)
const getLocalDateString = (d: Date | string): string => {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// 백엔드 전달 복용 성과 데이터(compliance_status, diff_minutes) 기반 배지 렌더링
const renderIntakeStatusBadge = (
  complianceStatus?: 'ON_TIME' | 'EARLY' | 'LATE',
  diffMinutes?: number,
  takenAtIso?: string,
  targetTimeStr?: string
) => {
  if (complianceStatus) {
    if (complianceStatus === 'ON_TIME') {
      return (
        <Badge color="teal" variant="light" size="sm">
          정시 복용 완료
        </Badge>
      );
    } else if (complianceStatus === 'EARLY') {
      const hours = diffMinutes ? Math.max(1, Math.round(Math.abs(diffMinutes) / 60)) : 1;
      return (
        <Badge color="blue" variant="light" size="sm">
          조기 복용 ({hours}시간 전)
        </Badge>
      );
    } else if (complianceStatus === 'LATE') {
      const hours = diffMinutes ? Math.max(1, Math.round(diffMinutes / 60)) : 1;
      return (
        <Badge color="orange" variant="light" size="sm">
          지연 복용 ({hours}시간 후)
        </Badge>
      );
    }
  }

  if (!takenAtIso || !targetTimeStr) {
    return (
      <Badge color="teal" variant="light" size="sm">
        복용 완료
      </Badge>
    );
  }

  const takenDate = new Date(takenAtIso);
  const timeParts = targetTimeStr.split(':').map(Number);
  const tHour = timeParts[0] || 0;
  const tMin = timeParts[1] || 0;

  const takenTotalMin = takenDate.getHours() * 60 + takenDate.getMinutes();
  const targetTotalMin = tHour * 60 + tMin;
  let diffMin = takenTotalMin - targetTotalMin;

  // 24시간 순환 보정
  if (diffMin > 720) diffMin -= 1440;
  else if (diffMin < -720) diffMin += 1440;

  if (Math.abs(diffMin) <= 60) {
    return (
      <Badge color="teal" variant="light" size="sm">
        정시 복용 완료
      </Badge>
    );
  } else if (diffMin < -60) {
    const hoursEarly = Math.max(1, Math.round(Math.abs(diffMin) / 60));
    return (
      <Badge color="blue" variant="light" size="sm">
        조기 복용 ({hoursEarly}시간 전)
      </Badge>
    );
  } else {
    const hoursLate = Math.max(1, Math.round(diffMin / 60));
    return (
      <Badge color="orange" variant="light" size="sm">
        지연 복용 ({hoursLate}시간 후)
      </Badge>
    );
  }
};

export const MedicationHistoryTab: React.FC<MedicationHistoryTabProps> = ({
  logs,
  bottles,
}) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDateStr, setSelectedDateStr] = useState(
    getLocalDateString(new Date())
  );

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const todayDateStr = useMemo(() => getLocalDateString(new Date()), []);

  // 1. 날짜별 복용 로그 매핑 (로컬 타임존 기준 YYYY-MM-DD)
  const logsByDate = useMemo(() => {
    const map = new Map<string, MedicationLog[]>();
    logs.forEach((log) => {
      const dStr = getLocalDateString(log.taken_at);
      if (dStr) {
        if (!map.has(dStr)) map.set(dStr, []);
        map.get(dStr)!.push(log);
      }
    });
    return map;
  }, [logs]);

  // 2. 캘린더 그리드 날짜 생성
  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const daysInMonth = lastDay.getDate();

    const days: { dateStr: string; dayNum: number; isCurrentMonth: boolean }[] = [];

    // 이전 달 빈 칸
    for (let i = 0; i < startDayOfWeek; i++) {
      const prevDate = new Date(year, month, -startDayOfWeek + i + 1);
      days.push({
        dateStr: getLocalDateString(prevDate),
        dayNum: prevDate.getDate(),
        isCurrentMonth: false,
      });
    }

    // 현재 달
    for (let i = 1; i <= daysInMonth; i++) {
      // 로컬 날짜 문자열 YYYY-MM-DD
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      days.push({
        dateStr,
        dayNum: i,
        isCurrentMonth: true,
      });
    }

    return days;
  }, [year, month]);

  // 달 이동
  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };
  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  // 선택된 날짜의 로그
  const selectedLogs = logsByDate.get(selectedDateStr) || [];
  const bottleMap = new Map(bottles.map((b) => [b.bottle_id, b.name]));

  // 약통별 준수율 계산
  const bottleStatsList = useMemo(() => {
    const uniqueDays = new Set(logs.map((l) => getLocalDateString(l.taken_at)).filter(Boolean));
    const totalDays = Math.max(1, uniqueDays.size);
    return bottles.map((b) => {
      const bLogs = logs.filter((l) => l.bottle_id === b.bottle_id).length;
      const rate = Math.min(100, Math.round((bLogs / totalDays) * 100));
      return {
        id: b.bottle_id,
        name: b.name,
        count: bLogs,
        rate,
      };
    });
  }, [bottles, logs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* 1열 (7컬럼): 월간 복약 캘린더 */}
      <div className="lg:col-span-7 bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-800">월간 복약 캘린더</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevMonth}
              className="px-2.5 py-1 !text-xs font-semibold rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
            >
              이전달
            </button>
            <span className="text-sm font-bold text-gray-800 font-mono px-2">
              {year}년 {month + 1}월
            </span>
            <button
              onClick={handleNextMonth}
              className="px-2.5 py-1 !text-xs font-semibold rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
            >
              다음달
            </button>
          </div>
        </div>

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 text-center text-xs font-semibold text-gray-400 border-b border-gray-100 pb-2 mb-2">
          <div className="text-rose-500">일</div>
          <div>월</div>
          <div>화</div>
          <div>수</div>
          <div>목</div>
          <div>금</div>
          <div className="text-indigo-600">토</div>
        </div>

        {/* 캘린더 날짜 그리드 */}
        <div className="grid grid-cols-7 gap-1.5">
          {calendarDays.map((item, idx) => {
            const dayLogs = logsByDate.get(item.dateStr) || [];
            const count = dayLogs.length;
            const isSelected = item.dateStr === selectedDateStr;
            const isToday = item.dateStr === todayDateStr && item.isCurrentMonth;

            // 달성 상태별 배지 색상
            let statusDot = null;
            if (count >= 3) {
              statusDot = <span className="w-1.5 h-1.5 rounded-full bg-teal-500"></span>;
            } else if (count > 0) {
              statusDot = <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>;
            }

            return (
              <button
                key={idx}
                onClick={() => item.isCurrentMonth && setSelectedDateStr(item.dateStr)}
                disabled={!item.isCurrentMonth}
                className={`h-14 p-1.5 rounded-lg border flex flex-col justify-between text-left transition-all ${!item.isCurrentMonth
                  ? 'bg-gray-50/50 border-gray-100 text-gray-300 cursor-not-allowed'
                  : isSelected
                    ? 'bg-teal-50 border-teal-500 ring-2 ring-teal-500/20 text-teal-950 shadow-xs'
                    : isToday
                      ? 'bg-teal-50/40 border-teal-400 hover:border-teal-500 text-gray-900 shadow-2xs'
                      : 'bg-white border-gray-200 hover:border-gray-300 text-gray-800'
                  }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs font-semibold ${isToday
                      ? 'w-5 h-5 flex items-center justify-center rounded-full bg-teal-600 text-white font-bold text-[11px] shadow-2xs'
                      : isSelected
                        ? 'text-teal-700 font-bold'
                        : ''
                      }`}
                  >
                    {item.dayNum}
                  </span>
                  {statusDot}
                </div>
                {item.isCurrentMonth && count > 0 && (
                  <span className="text-[10px] font-mono text-teal-700 font-semibold">
                    {count}회 완료
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 범례 (Legend) */}
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <span className="w-4 h-4 flex items-center justify-center rounded-full bg-teal-600 text-white text-[10px] font-bold shadow-2xs">
              {new Date().getDate()}
            </span>
            <span>TODAY</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-teal-500"></span>
            <span>완벽 달성 (3회 이상)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500"></span>
            <span>부분 달성 (1~2회)</span>
          </div>
        </div>
      </div>

      {/* 2열 (5컬럼): 약통별 달성률 통계 & 선택 일자 상세 리포트 */}
      <div className="lg:col-span-5 space-y-6">
        {/* 상단: 약통별 복용 준수율 비교 */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
          <h2 className="text-sm font-bold text-gray-800 mb-3">약통별 복용 준수율 비교</h2>
          <div className="space-y-3">
            {bottleStatsList.map((item) => (
              <div key={item.id} className="text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-gray-700">{item.name}</span>
                  <span className="font-mono text-gray-500">
                    {item.rate}% ({item.count}회)
                  </span>
                </div>
                <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-teal-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${item.rate}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 하단: 선택 날짜 복용 상세 리포트 */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-800">일별 복용 상세 리포트</h2>
            <span className="text-xs font-mono font-semibold text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
              {selectedDateStr}
            </span>
          </div>

          {selectedLogs.length === 0 ? (
            <div className="p-6 text-center text-xs text-gray-400 bg-gray-50 rounded-lg border border-gray-100">
              선택한 날짜에 기록된 복용 이력이 없습니다.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
              {selectedLogs.map((log) => {
                const targetBottle = bottles.find((b) => b.bottle_id === log.bottle_id);
                const bottleName =
                  targetBottle?.name ||
                  bottleMap.get(log.bottle_id) ||
                  BOTTLE_NAME_FALLBACK[log.bottle_id] ||
                  log.bottle_id;
                const logTime = new Date(log.taken_at).toLocaleTimeString('ko-KR', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                });

                return (
                  <div
                    key={log.id || `${log.bottle_id}-${log.taken_at}`}
                    className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-2 h-2 rounded-full bg-teal-500"></div>
                      <div>
                        <div className="font-semibold text-gray-800">{bottleName}</div>
                        <div className="text-[11px] font-mono text-gray-400">
                          {log.bottle_id}
                          {targetBottle?.target_time && (
                            <span className="ml-1.5 text-gray-400">
                              (설정: {targetBottle.target_time})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="mb-1">
                        {renderIntakeStatusBadge(
                          log.compliance_status,
                          log.diff_minutes,
                          log.taken_at,
                          targetBottle?.target_time
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono pr-1.5">{logTime}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
