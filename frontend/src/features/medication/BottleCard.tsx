import React from 'react';
import { Badge } from '@mantine/core';
import type { Bottle, BottleState } from '../../types';
import { IconX, IconPencil } from '@tabler/icons-react';

interface BottleCardProps {
  bottle: Bottle;
  isTakenToday: boolean;
  currentState?: BottleState;
  lastTakenTime?: string;
  isStreaming?: boolean;
  onDelete?: (bottleId: string, bottleName: string) => void;
  onEdit?: (bottle: Bottle) => void;
}

export const BottleCard: React.FC<BottleCardProps> = ({
  bottle,
  isTakenToday,
  currentState = 'idle',
  lastTakenTime,
  isStreaming = false,
  onDelete,
  onEdit,
}) => {
  const isPouring = currentState === 'pouring';
  const isMoving = currentState === 'moving';

  let statusBadge = (
    <Badge color="gray" variant="light">
      복용 대기 중
    </Badge>
  );

  if (isTakenToday) {
    statusBadge = (
      <Badge color="teal" variant="light">
        오늘 복용 완료
      </Badge>
    );
  } else if (isPouring) {
    statusBadge = (
      <Badge color="red" variant="light" className="animate-pulse">
        알약 털어넣는 중 (110°)
      </Badge>
    );
  } else if (isMoving) {
    statusBadge = (
      <Badge color="yellow" variant="light">
        약통 기울이는 중 (45°)
      </Badge>
    );
  }

  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3.5 hover:border-teal-200 transition-all duration-200 relative group shadow-2xs">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-gray-700 bg-gray-200/80 px-2 py-0.5 rounded font-semibold">
            {bottle.bottle_id}
          </span>

          {/* 센서 신호 수신 상태 인디케이터 (Mantine Badge 사용) */}
          {isStreaming ? (
            <Badge
              color="teal"
              variant="light"
              size="sm"
              leftSection={<span className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" />}
            >
              실시간 신호 수신 중
            </Badge>
          ) : (
            <Badge
              color="gray"
              variant="outline"
              size="sm"
              leftSection={<span className="w-1.5 h-1.5 rounded-full bg-gray-400" />}
            >
              신호 대기 중
            </Badge>
          )}
          <div className="flex items-center gap-0.5">
            {onEdit && (
              <button
                type="button"
                onClick={() => onEdit(bottle)}
                className="p-1 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-all cursor-pointer opacity-0 group-hover:opacity-100 !text-xs"
                title="약통 정보 수정"
                aria-label="약통 정보 수정"
              >
                <IconPencil size={14} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => onDelete(bottle.bottle_id, bottle.name)}
                className="p-1 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-all cursor-pointer opacity-0 group-hover:opacity-100 !text-xs"
                title="약통 등록 해제"
                aria-label="약통 등록 해제"
              >
                <IconX size={14} />
              </button>
            )}
          </div>
        </div>
        {statusBadge}
      </div>

      <h3 className="text-sm font-bold text-gray-900 mb-1">{bottle.name}</h3>

      <div className="flex items-center justify-between text-xs text-gray-500 mt-2.5 pt-2.5 border-t border-gray-200/70">
        <div>
          <span className="text-[11px] text-gray-400 block">목표 복용 시각</span>
          <span className="font-semibold text-gray-700">{bottle.target_time}</span>
        </div>
        {lastTakenTime && (
          <div className="text-right">
            <span className="text-[11px] text-gray-400 block">최근 복용 시각</span>
            <span className="font-semibold text-teal-600 font-mono">
              {new Date(lastTakenTime).toLocaleTimeString('ko-KR', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
