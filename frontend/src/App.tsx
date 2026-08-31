import { useEffect, useState, useCallback, useMemo } from 'react';
import { Badge } from '@mantine/core';
import { useWebSocket } from './hooks/useWebSocket';
import { fetchBottles, fetchMedicationLogs, fetchAdherenceStats, deleteBottle } from './api/client';
import type { Bottle, MedicationLog, AdherenceStats, BottleState } from './types';
import { BottleCard } from './features/medication/BottleCard';
import { MedicationLogList } from './features/medication/MedicationLogList';
import { AdherenceDashboard } from './features/medication/AdherenceDashboard';
import { MedicationHistoryTab } from './features/medication/MedicationHistoryTab';
import { WifiProvisionModal } from './features/medication/WifiProvisionModal';
import { AddBottleModal } from './features/medication/AddBottleModal';
import { EditBottleModal } from './features/medication/EditBottleModal';
import { IconWifi, IconPlus, IconTrash, IconAlertCircle, IconLoader2 } from '@tabler/icons-react';

const WS_URL = 'ws://localhost:8000/ws/user-1';

const tabBase: React.CSSProperties = {
  writingMode: 'vertical-rl',
  textTransform: 'uppercase',
  padding: '12px 6px',
  cursor: 'pointer',
  border: 'none',
  borderTopLeftRadius: '6px',
  borderBottomLeftRadius: '6px',
  marginBottom: '8px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.05em',
  color: '#a5b4fc',
  backgroundColor: 'transparent',
  transition: 'all 0.15s ease',
};

const tabActive: React.CSSProperties = {
  color: '#4f46e5',
  backgroundColor: '#f8fafc',
};

const tabLabel: React.CSSProperties = {
  transform: 'rotate(180deg)',
  display: 'inline-block',
};

const STATUS_BADGE = {
  connected: { color: 'blue', label: '실시간 연동 완료' },
  connecting: { color: 'yellow', label: '연결 중...' },
  reconnecting: { color: 'yellow', label: '재연결 중...' },
  disconnected: { color: 'gray', label: '연결 대기' },
};

// 로컬 날짜 문자열 (YYYY-MM-DD) 변환 헬퍼
const getLocalDateStr = (d: Date = new Date()) => {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// URL Hash 기반의 경량 라우터 타입 (#today, #history)
type RoutePage = 'today' | 'history';

function App() {
  const { status, lastEvent } = useWebSocket(WS_URL);

  // URL Hash (#today, #history) 기반 라우팅 상태
  const [currentPage, setCurrentPage] = useState<RoutePage>(() => {
    const hash = window.location.hash.replace('#', '');
    return hash === 'history' ? 'history' : 'today';
  });

  const [isWifiModalOpen, setIsWifiModalOpen] = useState(false);
  const [isAddBottleModalOpen, setIsAddBottleModalOpen] = useState(false);
  const [prefilledDeviceId, setPrefilledDeviceId] = useState<string>('');
  const [editTargetBottle, setEditTargetBottle] = useState<Bottle | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [bottles, setBottles] = useState<Bottle[]>([]);
  const [logs, setLogs] = useState<MedicationLog[]>([]);
  const [stats, setStats] = useState<AdherenceStats | null>(null);

  // 목표 복용 시각(target_time) 오름차순 ➔ 동일 시각일 경우 등록이 오래된 순서(최초 등록 순) 유지
  const sortedBottles = useMemo(() => {
    const indexMap = new Map(bottles.map((b, i) => [b.bottle_id, i]));
    return [...bottles].sort((a, b) => {
      const timeDiff = a.target_time.localeCompare(b.target_time);
      if (timeDiff !== 0) return timeDiff;
      return (indexMap.get(a.bottle_id) ?? 0) - (indexMap.get(b.bottle_id) ?? 0);
    });
  }, [bottles]);

  // 실시간 약통별 복용 완료 여부 및 현재 각도/센서 스트리밍 상태
  const [takenBottles, setTakenBottles] = useState<Record<string, boolean>>({});
  const [bottleStates, setBottleStates] = useState<Record<string, BottleState>>({});
  const [lastTakenTimes, setLastTakenTimes] = useState<Record<string, string>>({});
  const [lastPulseTimes, setLastPulseTimes] = useState<Record<string, number>>({});

  // 서버 데이터 로드
  const loadData = useCallback(async () => {
    try {
      const [fetchedBottles, fetchedLogs, fetchedStats] = await Promise.all([
        fetchBottles(),
        fetchMedicationLogs(),
        fetchAdherenceStats(),
      ]);

      setBottles(fetchedBottles);
      setLogs(fetchedLogs);
      setStats(fetchedStats);

      // 오늘 날짜 문자열 (로컬 타임존 기준 YYYY-MM-DD)
      const todayStr = getLocalDateStr(new Date());
      const takenMap: Record<string, boolean> = {};
      const lastTimes: Record<string, string> = {};

      for (const log of fetchedLogs) {
        if (log.taken_at) {
          const logDateStr = getLocalDateStr(new Date(log.taken_at));
          if (logDateStr === todayStr) {
            takenMap[log.bottle_id] = true;
          }
        }
        if (!lastTimes[log.bottle_id] || new Date(log.taken_at) > new Date(lastTimes[log.bottle_id])) {
          lastTimes[log.bottle_id] = log.taken_at;
        }
      }

      setTakenBottles(takenMap);
      setLastTakenTimes(lastTimes);
    } catch (err) {
      console.error('[loadData error]', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // URL Hash 변경 리스너
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash === 'history') {
        setCurrentPage('history');
      } else {
        setCurrentPage('today');
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateTo = (page: RoutePage) => {
    setCurrentPage(page);
    window.location.hash = page;
  };

  // WebSocket 이벤트 수신 시 센서 스트리밍 핑 갱신 및 데이터 업데이트
  useEffect(() => {
    if (!lastEvent) return;

    if (lastEvent.type === 'sensor_pulse' && lastEvent.payload?.bottle_id) {
      const bId = lastEvent.payload.bottle_id;
      setLastPulseTimes((prev) => ({ ...prev, [bId]: Date.now() }));
    }

    if (lastEvent.type === 'medication_taken' && lastEvent.payload?.bottle_id) {
      const bId = lastEvent.payload.bottle_id;
      setLastPulseTimes((prev) => ({ ...prev, [bId]: Date.now() }));
      loadData();
    }

    if (lastEvent.type === 'bottle_state_changed') {
      const bottleId = (lastEvent.payload as any)?.bottle_id;
      const state = lastEvent.payload?.state;
      if (bottleId) {
        setLastPulseTimes((prev) => ({ ...prev, [bottleId]: Date.now() }));
        if (state) {
          setBottleStates((prev) => ({ ...prev, [bottleId]: state }));
        }
      }
      if (state === 'settled') {
        loadData();
      }
    }
  }, [lastEvent, loadData]);

  // 약통 등록 해제(삭제) 실행
  const handleDeleteBottleConfirm = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteBottle(deleteTarget.id);
      setIsDeleting(false);
      setDeleteTarget(null);
      await loadData();
    } catch (err) {
      console.error('[Delete Bottle Error]', err);
      setIsDeleting(false);
    }
  };

  const badge = STATUS_BADGE[status] || STATUS_BADGE.disconnected;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* 좌측 사이드바 탭 (TODAY / HISTORY) */}
      <div className="w-10 bg-slate-800 flex flex-col items-center pt-4 shrink-0">
        {(['today', 'history'] as const).map((page) => (
          <a
            key={page}
            href={`#${page}`}
            onClick={(e) => {
              e.preventDefault();
              navigateTo(page);
            }}
            style={{ ...tabBase, ...(currentPage === page ? tabActive : {}) }}
          >
            <span style={tabLabel}>{page === 'today' ? 'TODAY' : 'HISTORY'}</span>
          </a>
        ))}
      </div>

      {/* 메인 컨텐츠 */}
      <div className="flex-1 p-4" style={{ borderLeft: '1px solid #dee2e6' }}>
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-800">Zero-Touch Pill Tracker</h1>
            <Badge color={badge.color} variant="light">{badge.label}</Badge>
          </div>

          {/* 상단 기기 Wi-Fi/BLE 프로비저닝 세팅 버튼 */}
          <button
            type="button"
            onClick={() => setIsWifiModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold !text-xs rounded-lg shadow-xs transition-all cursor-pointer"
          >
            <IconWifi size={16} />
            <span>기기 Wi-Fi / BLE 설정</span>
          </button>
        </div>

        {/* 1. 하드웨어 Wi-Fi / BLE 설정 모달 */}
        <WifiProvisionModal
          isOpen={isWifiModalOpen}
          onClose={() => setIsWifiModalOpen(false)}
          onRegisterWithDevice={(deviceId) => {
            setIsWifiModalOpen(false);
            setPrefilledDeviceId(deviceId);
            setIsAddBottleModalOpen(true);
          }}
        />

        {/* 2. 소프트웨어 약통 신규 등록 모달 */}
        <AddBottleModal
          isOpen={isAddBottleModalOpen}
          onClose={() => {
            setIsAddBottleModalOpen(false);
            setPrefilledDeviceId('');
          }}
          onBottleAdded={() => {
            loadData();
            setPrefilledDeviceId('');
          }}
          existingBottleCount={bottles.length}
          initialBottleId={prefilledDeviceId}
        />

        {/* 3. 약통 정보 수정 모달 */}
        <EditBottleModal
          isOpen={!!editTargetBottle}
          bottle={editTargetBottle}
          onClose={() => setEditTargetBottle(null)}
          onBottleUpdated={() => {
            loadData();
          }}
        />

        {/* 3. 약통 등록 해제(삭제) 확인 대화상자 */}
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4 animate-fade-in">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-sm w-full p-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0 mt-0.5">
                  <IconAlertCircle size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900">약통 등록 해제 확인</h3>
                  <p className="text-xs text-gray-600 mt-1">
                    정말 <strong className="font-semibold text-gray-900">{deleteTarget.name} ({deleteTarget.id})</strong> 약통 등록을 해제하시겠습니까?
                  </p>
                  <p className="text-[11px] text-gray-400 mt-1">
                    등록 해제 시 메인 현황판에서 제외되며 복약 관리가 중단됩니다.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold !text-xs rounded-md transition-colors cursor-pointer"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleDeleteBottleConfirm}
                  disabled={isDeleting}
                  className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-semibold !text-xs rounded-md shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {isDeleting ? (
                    <>
                      <IconLoader2 size={14} className="animate-spin" />
                      <span>해제 중...</span>
                    </>
                  ) : (
                    <>
                      <IconTrash size={14} />
                      <span>등록 해제</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 라우트 1 — TODAY 페이지 (`/#today` 또는 기본 경로) */}
        {currentPage === 'today' && (
          <div>
            {/* 상단 1열 가로 배치: 복약 순응도 대시보드 */}
            <AdherenceDashboard
              stats={stats}
              activeDaysCount={new Set(logs.map((l) => (l.taken_at ? getLocalDateStr(new Date(l.taken_at)) : '')).filter(Boolean)).size || 1}
            />

            {/* 하단 2열 배치: 좌측 약통별 복용 현황, 우측 실시간 복용 이력 타임라인 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 좌측: 등록 약통 현황 */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    <span>약통별 복용 현황</span>
                    <span className="text-xs text-gray-400 font-mono font-normal">
                      ({bottles.length}개)
                    </span>
                  </h2>

                  {/* 패널 내 약통 신규 추가 버튼 */}
                  <button
                    type="button"
                    onClick={() => setIsAddBottleModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white font-semibold !text-xs rounded-md shadow-2xs transition-all cursor-pointer"
                  >
                    <IconPlus size={14} />
                    <span>약통 추가</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {sortedBottles.map((bottle) => (
                    <BottleCard
                      key={bottle.bottle_id}
                      bottle={bottle}
                      isTakenToday={!!takenBottles[bottle.bottle_id]}
                      currentState={bottleStates[bottle.bottle_id] || 'idle'}
                      lastTakenTime={lastTakenTimes[bottle.bottle_id]}
                      isStreaming={Date.now() - (lastPulseTimes[bottle.bottle_id] || 0) < 4000}
                      onEdit={(b) => setEditTargetBottle(b)}
                      onDelete={(id, name) => setDeleteTarget({ id, name })}
                    />
                  ))}
                </div>
              </div>

              {/* 우측: 실시간 복용 이력 타임라인 */}
              <div>
                <MedicationLogList logs={logs} bottles={bottles} />
              </div>
            </div>
          </div>
        )}

        {/* 라우트 2 — HISTORY 페이지 (`/#history`) */}
        {currentPage === 'history' && (
          <MedicationHistoryTab logs={logs} bottles={bottles} stats={stats} />
        )}
      </div>
    </div>
  );
}

export default App;
