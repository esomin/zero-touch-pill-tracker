import { useState, useCallback, useRef } from 'react';

export const BLE_SERVICE_UUID = '4fa21234-8e3a-45c2-965e-04f76c3f1234'.toLowerCase();
export const BLE_CONFIG_CHAR_UUID = '4fa21234-8e3a-45c2-965e-04f76c3f1002'.toLowerCase();
export const BLE_STATUS_CHAR_UUID = '4fa21234-8e3a-45c2-965e-04f76c3f1001'.toLowerCase();

export type BLEStatus = 'idle' | 'scanning' | 'connecting' | 'connected' | 'sending' | 'success' | 'error';

export interface UseWebBluetoothReturn {
  isSupported: boolean;
  status: BLEStatus;
  statusMessage: string;
  error: string | null;
  connectedDeviceName: string | null;
  connectBleDevice: () => Promise<string | null>;
  sendWifiConfig: (ssid: string, pass: string) => Promise<boolean>;
  sendWsConfig: (wsUrl: string) => Promise<boolean>;
  sendCalibrationCmd: () => Promise<boolean>;
  disconnectBleDevice: () => void;
  resetStatus: () => void;
}

export function useWebBluetooth(): UseWebBluetoothReturn {
  const isSupported = typeof window !== 'undefined' && 'bluetooth' in navigator;
  const [status, setStatus] = useState<BLEStatus>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [connectedDeviceName, setConnectedDeviceName] = useState<string | null>(null);

  const deviceRef = useRef<any>(null);
  const gattServerRef = useRef<any>(null);

  const resetStatus = useCallback(() => {
    setStatus('idle');
    setStatusMessage('');
    setError(null);
  }, []);

  const disconnectBleDevice = useCallback(() => {
    try {
      if (gattServerRef.current && gattServerRef.current.connected) {
        console.log('[BLE] Disconnecting GATT session.');
        gattServerRef.current.disconnect();
      }
    } catch (_) { }
    deviceRef.current = null;
    gattServerRef.current = null;
    setConnectedDeviceName(null);
    setStatus('idle');
    setStatusMessage('');
    setError(null);
  }, []);

  // 1단계: BLE 기기 탐색 및 GATT 서버 연결
  const connectBleDevice = useCallback(async (): Promise<string | null> => {
    if (!isSupported) {
      setError('이 브라우저는 Web Bluetooth API를 지원하지 않습니다. Chrome, Edge 또는 Android Chrome을 사용해주세요.');
      setStatus('error');
      return null;
    }

    try {
      setStatus('scanning');
      setStatusMessage('주변 ESP32 약통 기기(SmartPillBox)를 탐색 중입니다...');
      setError(null);

      const navBt = (navigator as any).bluetooth;
      let device: any = null;

      // 1. 크롬 BLE 팝업 호출
      console.log('[BLE Step 1] Requesting BLE device...');
      try {
        device = await navBt.requestDevice({
          filters: [
            { namePrefix: 'SmartPillBox' },
            { namePrefix: 'Smart' },
            { namePrefix: 'ESP32' }
          ],
          optionalServices: [BLE_SERVICE_UUID],
        });
      } catch (filterErr: any) {
        if (filterErr.name === 'NotFoundError') {
          throw filterErr;
        }
        console.warn('[BLE Step 1 Warning] 필터 탐색 실패, 전체 기기 검색 모드로 재시도:', filterErr);
        device = await navBt.requestDevice({
          acceptAllDevices: true,
          optionalServices: [BLE_SERVICE_UUID],
        });
      }

      const devName = device.name || 'SmartPillBox_Device';
      console.log('[BLE Step 1 Complete] Selected Device:', devName, device.id);

      // 2. GATT 연결
      setStatus('connecting');
      setStatusMessage(`[${devName}] 기기에 BLE GATT 연결 중...`);
      console.log('[BLE Step 2] Connecting to GATT server...');

      const server = await device.gatt.connect();
      console.log('[BLE Step 2 Complete] GATT Connected:', server.connected);

      deviceRef.current = device;
      gattServerRef.current = server;
      setConnectedDeviceName(devName);

      setStatus('connected');
      setStatusMessage(`[${devName}] 기기와 BLE 연결이 성공적으로 완료되었습니다!`);

      // 끊김 감지 핸들러 등록
      device.addEventListener('gattserverdisconnected', () => {
        console.log('[BLE Event] Device disconnected');
        if (deviceRef.current === device) {
          deviceRef.current = null;
          gattServerRef.current = null;
          // 전송 성공(success) 상태일 때는 UI 표시를 위해 connectedDeviceName을 유지함
          setStatus((prevStatus) => {
            if (prevStatus !== 'success') {
              setConnectedDeviceName(null);
            }
            return prevStatus;
          });
        }
      });

      return devName;
    } catch (err: any) {
      console.error('[WebBluetooth Connect Error]', err);
      disconnectBleDevice();

      if (err.name === 'NotFoundError') {
        setStatus('idle');
        setStatusMessage('기기 선택이 취소되었습니다.');
      } else {
        setStatus('error');
        const errMsg = err.message || 'BLE 기기 연결 중 오류가 발생했습니다.';
        setError(errMsg);
        setStatusMessage(`오류 발생: ${errMsg}`);
      }
      return null;
    }
  }, [isSupported, disconnectBleDevice]);

  // 2단계: 데이터 전송 (Wi-Fi, WS, Calibration)
  const sendPayloadToChar = useCallback(async (payload: string | Uint8Array): Promise<boolean> => {
    if (!isSupported) {
      setError('이 브라우저는 Web Bluetooth API를 지원하지 않습니다.');
      setStatus('error');
      return false;
    }

    try {
      let server = gattServerRef.current;

      // 만약 아직 연결이 안 되어 있다면 연결 시도
      if (!server || !server.connected) {
        const name = await connectBleDevice();
        if (!name) return false;
        server = gattServerRef.current;
      }

      setStatus('sending');
      setStatusMessage('ESP32 기기로 설정 데이터를 전송 중입니다...');

      console.log('[BLE Step 3] Fetching primary service:', BLE_SERVICE_UUID);
      const service = await server.getPrimaryService(BLE_SERVICE_UUID);

      console.log('[BLE Step 3] Fetching characteristic:', BLE_CONFIG_CHAR_UUID);
      const configChar = await service.getCharacteristic(BLE_CONFIG_CHAR_UUID);

      const encoder = new TextEncoder();
      const dataBuffer = typeof payload === 'string' ? encoder.encode(payload) : payload;
      console.log('[BLE Step 4] Writing data buffer...');

      try {
        if (typeof configChar.writeValueWithoutResponse === 'function') {
          await configChar.writeValueWithoutResponse(dataBuffer);
        } else if (typeof configChar.writeValueWithResponse === 'function') {
          await configChar.writeValueWithResponse(dataBuffer);
        } else {
          await configChar.writeValue(dataBuffer);
        }
      } catch (writeErr: any) {
        console.warn('[BLE Step 4 Exception]', writeErr);
        if (typeof configChar.writeValue === 'function') {
          await configChar.writeValue(dataBuffer);
        } else {
          throw writeErr;
        }
      }

      console.log('[BLE Step 4 Complete] Data write successfully finished!');

      setStatus('success');
      setStatusMessage('설정이 성공적으로 전송되었습니다! ESP32 기기가 Wi-Fi로 재접속 중입니다.');

      // GATT 세션만 정숙하게 해제 (기기 이름 상태는 유지하여 성공 화면 표시)
      try {
        if (gattServerRef.current && gattServerRef.current.connected) {
          gattServerRef.current.disconnect();
        }
      } catch (_) { }

      return true;
    } catch (err: any) {
      console.error('[WebBluetooth Write Error]', err);

      if (err.name === 'NotFoundError') {
        setStatus('idle');
        setStatusMessage('작업이 취소되었습니다.');
      } else {
        setStatus('error');
        const errMsg = err.message || 'BLE GATT 데이터 전송 중 오류가 발생했습니다.';
        setError(errMsg);
        setStatusMessage(`오류 발생: ${errMsg}`);
      }
      return false;
    }
  }, [isSupported, connectBleDevice, disconnectBleDevice]);

  const sendWifiConfig = useCallback(async (ssid: string, pass: string): Promise<boolean> => {
    const cleanSsid = ssid.trim();
    const cleanPass = pass.trim();
    if (!cleanSsid) {
      setError('Wi-Fi SSID를 입력해주세요.');
      setStatus('error');
      return false;
    }

    try {
      localStorage.setItem('last_wifi_ssid', cleanSsid);
    } catch (_) { }

    const payload = `WIFI:${cleanSsid},${cleanPass}`;
    return sendPayloadToChar(payload);
  }, [sendPayloadToChar]);

  const sendWsConfig = useCallback(async (wsUrl: string): Promise<boolean> => {
    const cleanUrl = wsUrl.trim();
    if (!cleanUrl) {
      setError('WebSocket URL을 입력해주세요.');
      setStatus('error');
      return false;
    }

    try {
      localStorage.setItem('last_ws_url', cleanUrl);
    } catch (_) { }

    const payload = `WS:${cleanUrl}`;
    return sendPayloadToChar(payload);
  }, [sendPayloadToChar]);

  const sendCalibrationCmd = useCallback(async (): Promise<boolean> => {
    const cmd = new Uint8Array([0x01]);
    return sendPayloadToChar(cmd);
  }, [sendPayloadToChar]);

  return {
    isSupported,
    status,
    statusMessage,
    error,
    connectedDeviceName,
    connectBleDevice,
    sendWifiConfig,
    sendWsConfig,
    sendCalibrationCmd,
    disconnectBleDevice,
    resetStatus,
  };
}
