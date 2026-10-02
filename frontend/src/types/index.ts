// ─── WebSocket 이벤트 타입 ───────────────────────────────────────────────────

export type SensorEventType =
  | 'medication_taken'
  | 'bottle_state_changed'
  | 'tumbler_state_changed'
  | 'equipment_detected'
  | 'sensor_pulse'
  | 'sensor_reading';

export type SensorReadingPayload = {
  bottle_id: string;
  acc_x: number;
  acc_y: number;
  acc_z: number;
  accel_magnitude: number;
  gyro_magnitude: number;
  state_deg: number;
  timestamp: string;
};

export type WebSocketMessage<T = unknown> = {
  type: SensorEventType;
  payload: T;
  timestamp: string; // ISO 8601
};

// ─── 약통 및 복용 이력 타입 ─────────────────────────────────────────────────────

export type Bottle = {
  bottle_id: string;
  name: string;
  target_time: string;
  status?: 'ACTIVE' | 'ARCHIVED';
  created_at?: string;
  ended_at?: string;
};

export type MedicationLog = {
  id: string;
  bottle_id: string;
  event_type: string;
  taken_at: string;
  status: string;
  compliance_status?: 'ON_TIME' | 'EARLY' | 'LATE';
  diff_minutes?: number;
};

export type MedicationTakenPayload = {
  bottle_id: string;
  taken_at: string;
  status: string;
  state_deg?: number;
  compliance_status?: 'ON_TIME' | 'EARLY' | 'LATE';
  diff_minutes?: number;
};

export type BottleState = 'idle' | 'moving' | 'pouring' | 'settled';

export type BottleStatePayload = {
  bottle_id?: string;
  state: BottleState;
  transitioned_at?: string;
};

export type AdherenceStats = {
  total_logs: number;
  adherence_rate: number;
  streak_days: number;
  bottle_stats: Record<string, number>;
};

// ─── WebSocket 훅 반환 타입 ───────────────────────────────────────────────────

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

export type WebSocketEvent =
  | { type: 'medication_taken'; payload: MedicationTakenPayload }
  | { type: 'bottle_state_changed'; payload: BottleStatePayload }
  | { type: 'tumbler_state_changed'; payload: { state: string } }
  | { type: 'equipment_detected'; payload: { equipmentName: string } }
  | { type: 'sensor_pulse'; payload: { bottle_id: string; timestamp: string } }
  | { type: 'sensor_reading'; payload: SensorReadingPayload };

export type UseWebSocketReturn = {
  status: WebSocketStatus;
  lastEvent: WebSocketEvent | null;
  send: (data: unknown) => void;
};
