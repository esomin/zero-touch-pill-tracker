import React, { useState, useEffect, useMemo } from 'react';
import type { BottleState, SensorReadingPayload } from '../../types';
import {
  IconActivity,
  IconGauge,
  IconChevronDown,
  IconChevronUp,
  IconX,
} from '@tabler/icons-react';

interface SensorDebugPanelProps {
  activeBottleId?: string;
  bottleName?: string;
  currentState: BottleState;
  lastReading: SensorReadingPayload | null;
  onClose?: () => void;
}

interface DataPoint {
  time: string;
  acc_z: number;
  xy_peak: number;
  state_deg: number;
  state: BottleState;
}

const MAX_HISTORY = 40;

const STATE_CONFIG: Record<
  BottleState,
  { label: string; color: string; bg: string; border: string; desc: string; step: number }
> = {
  idle: {
    label: 'IDLE (보관 중)',
    color: 'text-slate-600',
    bg: 'bg-slate-100',
    border: 'border-slate-300',
    desc: '수평 바닥에 안정적으로 거치된 상태 (기울기 0°)',
    step: 1,
  },
  moving: {
    label: 'MOVING (약통 이동 중)',
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    desc: '약통을 들어 올리거나 손목을 기울이는 중 (기울기 ~45°)',
    step: 2,
  },
  pouring: {
    label: 'POURING (알약 털어넣기)',
    color: 'text-rose-700',
    bg: 'bg-rose-50',
    border: 'border-rose-400',
    desc: '손바닥에 약통을 털어 넣는 강한 스냅 감지 (110° & XY 피크)',
    step: 3,
  },
  settled: {
    label: 'SETTLED (거치 완료 / 복용 판정)',
    color: 'text-teal-700',
    bg: 'bg-teal-50',
    border: 'border-teal-400',
    desc: '약통을 다시 바닥에 내려놓아 복용 완료 확정',
    step: 4,
  },
};

export const SensorDebugPanel: React.FC<SensorDebugPanelProps> = ({
  activeBottleId = 'BOTTLE_01',
  bottleName,
  currentState,
  lastReading,
  onClose,
}) => {
  const [history, setHistory] = useState<DataPoint[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);

  // 센서 샘플 수신 시 슬라이딩 윈도우 버퍼 업데이트
  useEffect(() => {
    if (!lastReading) return;

    const xyPeak = Math.sqrt(
      (lastReading.acc_x || 0) ** 2 + (lastReading.acc_y || 0) ** 2
    );

    const point: DataPoint = {
      time: new Date(lastReading.timestamp || Date.now()).toLocaleTimeString('ko-KR', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      acc_z: lastReading.acc_z,
      xy_peak: xyPeak,
      state_deg: lastReading.state_deg || 0,
      state: currentState,
    };

    setHistory((prev) => {
      const next = [...prev, point];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  }, [lastReading, currentState]);

  // SVG 차트 좌표 계산 (기존 대비 1.5배 확대: 600x130 -> 900x180)
  const svgWidth = 900;
  const svgHeight = 180;
  const padding = { top: 20, right: 20, bottom: 30, left: 50 };
  const graphWidth = svgWidth - padding.left - padding.right;
  const graphHeight = svgHeight - padding.top - padding.bottom;

  // Z축 가속도 경로 생성 (-2 ~ 14 m/s² 스케일)
  const minVal = -2;
  const maxVal = 14;
  const getY = (val: number) => {
    const clamped = Math.max(minVal, Math.min(maxVal, val));
    const normalized = (clamped - minVal) / (maxVal - minVal);
    return padding.top + graphHeight - normalized * graphHeight;
  };

  const getX = (index: number, total: number) => {
    if (total <= 1) return padding.left;
    return padding.left + (index / (total - 1)) * graphWidth;
  };

  const pointsZ = useMemo(() => {
    if (history.length === 0) return '';
    return history
      .map((p, i) => `${getX(i, history.length)},${getY(p.acc_z)}`)
      .join(' ');
  }, [history]);

  const pointsXY = useMemo(() => {
    if (history.length === 0) return '';
    return history
      .map((p, i) => `${getX(i, history.length)},${getY(p.xy_peak)}`)
      .join(' ');
  }, [history]);

  // 임계값 가이드 라인 Y좌표 (Z < 5.5, XY > 7.5)
  const yZThreshold = getY(5.5);
  const yXYThreshold = getY(7.5);
  const yGravity98 = getY(9.81);

  return (
    <div className="fixed bottom-6 right-6 z-40 max-w-[95vw] w-[calc(100vw-3rem)] sm:w-[780px] bg-white/95 backdrop-blur-md border border-indigo-200 rounded-2xl shadow-2xl transition-all duration-300 overflow-hidden ring-1 ring-black/5 animate-fade-in">
      {/* 헤더 & 기기 정보 & 윈도우 컨트롤 */}
      <div className="px-5 py-3.5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between gap-3 border-b border-indigo-900/40 select-none">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600/80 text-white flex items-center justify-center shadow-xs">
            <IconActivity size={18} className="animate-pulse text-indigo-200" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-slate-100 tracking-wide">
                실시간 센서 FSM Demo View
              </h3>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 font-semibold">
                {activeBottleId} {bottleName ? `(${bottleName})` : ''}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* 최소화/펼치기 버튼 */}
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
            title={isMinimized ? '창 펼치기' : '창 최소화'}
          >
            {isMinimized ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
          </button>

          {/* 닫기 버튼 */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-400 hover:text-rose-300 hover:bg-rose-500/20 transition-colors cursor-pointer"
              title="DEMO 모드 닫기"
            >
              <IconX size={18} />
            </button>
          )}
        </div>
      </div>

      {/* 최소화 상태일 때 간략 스트립 */}
      {isMinimized ? (
        <div className="px-5 py-3 bg-white flex items-center justify-between text-sm">
          <div className="flex items-center gap-2.5">
            <span className="text-xs text-gray-500">현재 상태:</span>
            <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${STATE_CONFIG[currentState]?.bg} ${STATE_CONFIG[currentState]?.color} border ${STATE_CONFIG[currentState]?.border}`}>
              {STATE_CONFIG[currentState]?.label || currentState}
            </span>
          </div>
          <div className="font-mono text-xs text-gray-500">
            {lastReading ? `Tilt: ${lastReading.state_deg}° | AccZ: ${lastReading.acc_z.toFixed(2)} m/s²` : '대기 중'}
          </div>
        </div>
      ) : (
        /* 펼침 상태 메인 바디 */
        <div className="p-4 space-y-3.5 max-h-[85vh] overflow-y-auto">
          {/* 4단계 FSM 상태 파이프라인 시각화 (배경색 통일) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['idle', 'moving', 'pouring', 'settled'] as const).map((stKey, idx) => {
              const item = STATE_CONFIG[stKey];
              const isActive = currentState === stKey;
              return (
                <div
                  key={stKey}
                  className={`p-2.5 rounded-xl border transition-all duration-200 flex flex-col justify-between ${
                    isActive
                      ? 'bg-indigo-50/90 border-indigo-400 ring-2 ring-indigo-400/40 shadow-xs scale-[1.02]'
                      : 'bg-slate-50 border-slate-200/80 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span className={isActive ? 'text-indigo-700 font-mono font-semibold' : 'text-gray-400 font-mono'}>
                      STEP 0{idx + 1}
                    </span>
                    {isActive && (
                      <span className="flex h-2.5 w-2.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-600"></span>
                      </span>
                    )}
                  </div>
                  <div className={`text-xs font-bold mt-1 ${isActive ? 'text-indigo-950' : 'text-gray-600'}`}>
                    {item.label}
                  </div>
                  <div className={`text-[10px] mt-1 line-clamp-2 leading-tight ${isActive ? 'text-indigo-800/80 font-medium' : 'text-gray-500'}`}>
                    {item.desc}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 실시간 센서 파형 SVG 차트 */}
          <div className="bg-slate-900 rounded-xl p-3.5 text-white shadow-inner">
            <div className="flex items-center justify-between mb-2 text-xs">
              <div className="flex items-center gap-3">
                <span className="font-bold flex items-center gap-1.5 text-slate-200 text-xs">
                  <IconGauge size={15} className="text-teal-400" />
                  실시간 가속도 파형 (50Hz)
                </span>
                <div className="flex items-center gap-2.5 text-[11px]">
                  <span className="flex items-center gap-1 text-teal-400 font-mono font-medium">
                    <span className="w-2.5 h-0.5 bg-teal-400 inline-block"></span> Acc Z (기울기)
                  </span>
                  <span className="flex items-center gap-1 text-rose-400 font-mono font-medium">
                    <span className="w-2.5 h-0.5 bg-rose-400 inline-block"></span> XY 피크 (스냅)
                  </span>
                </div>
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                {lastReading ? `Tilt: ${lastReading.state_deg}° | AccZ: ${lastReading.acc_z.toFixed(2)} m/s²` : '대기 중...'}
              </div>
            </div>

            {/* SVG Sparkline Canvas (1.5배 확대 높이 h-36) */}
            <div className="w-full overflow-hidden">
              <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-36 select-none">
                {/* 그리드 가이드 라인 */}
                <line
                  x1={padding.left}
                  y1={yGravity98}
                  x2={svgWidth - padding.right}
                  y2={yGravity98}
                  stroke="#475569"
                  strokeDasharray="3 3"
                  strokeWidth="0.8"
                />
                <text x={padding.left - 6} y={yGravity98 + 3} fill="#94a3b8" fontSize="10" textAnchor="end" fontFamily="monospace">
                  9.8(1g)
                </text>

                <line
                  x1={padding.left}
                  y1={yXYThreshold}
                  x2={svgWidth - padding.right}
                  y2={yXYThreshold}
                  stroke="#f43f5e"
                  strokeDasharray="2 2"
                  strokeWidth="0.8"
                  opacity="0.6"
                />
                <text x={svgWidth - padding.right + 4} y={yXYThreshold + 3} fill="#f43f5e" fontSize="10" textAnchor="start" fontFamily="monospace">
                  스냅 임계치(7.5)
                </text>

                <line
                  x1={padding.left}
                  y1={yZThreshold}
                  x2={svgWidth - padding.right}
                  y2={yZThreshold}
                  stroke="#2dd4bf"
                  strokeDasharray="2 2"
                  strokeWidth="0.8"
                  opacity="0.6"
                />
                <text x={svgWidth - padding.right + 4} y={yZThreshold + 3} fill="#2dd4bf" fontSize="10" textAnchor="start" fontFamily="monospace">
                  기울임 임계치(5.5)
                </text>

                {/* XY Peak 파형 (Rose) */}
                {pointsXY && (
                  <polyline
                    fill="none"
                    stroke="#fb7185"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={pointsXY}
                  />
                )}

                {/* Acc Z 파형 (Teal) */}
                {pointsZ && (
                  <polyline
                    fill="none"
                    stroke="#2dd4bf"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={pointsZ}
                  />
                )}

                {/* 데이터 부족 시 안내 */}
                {history.length < 2 && (
                  <text
                    x={svgWidth / 2}
                    y={svgHeight / 2}
                    fill="#64748b"
                    fontSize="13"
                    textAnchor="middle"
                    fontFamily="sans-serif"
                  >
                    센서 데이터 스트리밍 시 실시간 그래프가 출력됩니다.
                  </text>
                )}
              </svg>
            </div>

            {/* 하단 현재 측정치 요약 스트립 */}
            <div className="grid grid-cols-4 gap-2 pt-2.5 mt-1 border-t border-slate-800 text-[11px] font-mono">
              <div>
                <span className="text-slate-400 block text-[10px]">Acc X</span>
                <span className="text-slate-200 font-semibold text-xs">{lastReading?.acc_x?.toFixed(2) ?? '0.00'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Acc Y</span>
                <span className="text-slate-200 font-semibold text-xs">{lastReading?.acc_y?.toFixed(2) ?? '0.00'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Acc Z (수직)</span>
                <span className="text-teal-400 font-semibold text-xs">{lastReading?.acc_z?.toFixed(2) ?? '9.81'}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Gyro 크기</span>
                <span className="text-amber-400 font-semibold text-xs">{lastReading?.gyro_magnitude?.toFixed(2) ?? '0.00'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
