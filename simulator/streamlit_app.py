import time
import threading

import streamlit as st

from imu_simulator import BOTTLE_PRESETS, generate_imu
from shared_state import params as _params  # 모듈 캐시로 단일 인스턴스 보장
from ws_emitter import start_stream
from datetime import datetime, timezone, timedelta

KST = timezone(timedelta(hours=9))


def compute_sim_timestamp(offset_days: int = 0, custom_time: str = "현재 시각") -> str:
    """
    KST(한국 표준시)를 기준으로 시뮬레이션 타임스탬프를 생성합니다.
    custom_time이 '12:30 (점심)'인 경우 오늘 KST 12:30:00 시각을 생성합니다.
    """
    now_kst = datetime.now(KST) + timedelta(days=offset_days)
    if custom_time and custom_time != "현재 시각":
        try:
            hh, mm = map(int, custom_time.split()[0].split(":"))
            target_dt = now_kst.replace(hour=hh, minute=mm, second=0, microsecond=0)
            return target_dt.isoformat()
        except Exception:
            return now_kst.isoformat()
    return now_kst.isoformat()


st.set_page_config(page_title="Zero-Touch Pill Tracker Sensor Simulator", layout="wide")

# ── 우상단 Running... 멈춤 인디케이터 스타일 다듬기 ──────────────────────────
st.markdown("""
<style>
/* 우상단 Running 스피너를 메인컬러 스타일로 매끄럽게 처리 */
div[data-testid="stStatusWidget"] {
    visibility: visible !important;
}
</style>
""", unsafe_allow_html=True)

# ── 세션 상태 초기화 ──────────────────────────────────────────────────────────

if "selected_bottle" not in st.session_state:
    st.session_state.selected_bottle = "BOTTLE_01"

if "bottle_state" not in st.session_state:
    st.session_state.bottle_state = "보관 중 (0도)"

if "tilt_angle" not in st.session_state:
    st.session_state.tilt_angle = 0

if "noise_level" not in st.session_state:
    st.session_state.noise_level = 0.1

if "trigger_impulse" not in st.session_state:
    st.session_state.trigger_impulse = False

if "streaming" not in st.session_state:
    st.session_state.streaming = False

if "date_offset_days" not in st.session_state:
    st.session_state.date_offset_days = 0

if "custom_time" not in st.session_state:
    st.session_state.custom_time = "현재 시각"

# ── 매 리런마다 _params 동기화 ──────────────────────────────────────────────────
_params["bottle_state"]       = st.session_state.bottle_state
_params["selected_bottle"]    = st.session_state.selected_bottle
_params["tilt_angle"]         = st.session_state.tilt_angle
_params["noise_level"]        = st.session_state.noise_level
_params["trigger_impulse"]    = st.session_state.trigger_impulse
_params["date_offset_days"]   = st.session_state.date_offset_days
_params["custom_time"]        = st.session_state.custom_time

# ── 스트림 종료 감지 ──────────────────────────────────────────────────────────
if st.session_state.streaming and st.session_state.stop_event is not None:
    if st.session_state.stop_event.is_set():
        st.session_state.streaming = False
        st.session_state.stop_event = None

# ── 헤더 및 사용 가이드 ────────────────────────────────────────────────────────
st.title("Zero-Touch Pill Tracker — Sensor Simulator")
st.caption("실측 데이터 기반 3축 자이로·가속도(IMU) 센서 및 자율 복용 모션을 시뮬레이션합니다.")

st.info(
    "시뮬레이터 사용 가이드\n"
    "• 일반 테스트 (추천): STEP 1 약통 선택 후 [5초 자동 복용 시나리오 실행] 클릭 (자동 연결 및 5초 복용 전송 완료)\n"
    "• 고급 수동 테스트: 하단 [고급 테스팅] 메뉴를 열고 [수동 지속 전송 시작]을 켠 뒤 각도 및 털기 조작"
)
st.divider()

col_control, col_status = st.columns([1, 1], gap="large")

# ── 좌측: 컨트롤 패널 ────────────────────────────────────────────────────────
with col_control:
    st.subheader("컨트롤 패널")

    # STEP 1: 약통 선택
    bottle_options = list(BOTTLE_PRESETS.keys())
    st.session_state.selected_bottle = st.selectbox(
        label="STEP 1: 약통 선택 (Device ID / Bottle ID)",
        options=bottle_options,
        index=bottle_options.index(st.session_state.selected_bottle),
        format_func=lambda b: BOTTLE_PRESETS.get(b, b),
        help="시뮬레이션할 약통(Device ID)을 선택하세요.",
    )

    # STEP 2: 날짜/시간 오프셋 설정 (과거 복용 데이터 시뮬레이션)
    st.write("**STEP 2: 테스트 날짜/시간 설정**")
    d_col1, d_col2 = st.columns(2)
    with d_col1:
        st.session_state.date_offset_days = st.number_input(
            label="날짜 오프셋 (일)",
            min_value=-30,
            max_value=30,
            value=st.session_state.date_offset_days,
            step=1,
            help="0 = 오늘, -1 = 어제, -2 = 2일 전",
        )
    with d_col2:
        t_opts = ["현재 시각", "08:00 (아침)", "12:30 (점심)", "22:30 (취침전)"]
        st.session_state.custom_time = st.selectbox(
            label="복용 시각",
            options=t_opts,
            index=t_opts.index(st.session_state.custom_time) if st.session_state.custom_time in t_opts else 0,
            help="전송할 복용 타임스탬프 시각을 지정합니다.",
        )

    # STEP 3: 노이즈 레벨 슬라이더
    st.session_state.noise_level = st.slider(
        label="STEP 3: 노이즈 레벨 (손떨림 / 임펄스 오차)",
        min_value=0.0,
        max_value=1.0,
        value=st.session_state.noise_level,
        step=0.05,
        format="%.2f",
        help="0.0 = 노이즈 없음 / 1.0 = 최대 노이즈",
    )

    st.write("")

    # STEP 4: 자동 복용 시나리오 실행 버튼
    st.write("**STEP 4: 원클릭 자동 복용 테스트**")
    if st.button("5초 자동 복용 시나리오 실행", use_container_width=True, type="primary"):
        # 스트림 자동 시작
        if not st.session_state.streaming:
            stop_event = threading.Event()

            def get_reading() -> dict:
                impulse = _params.get("trigger_impulse", False)
                _params["trigger_impulse"] = False
                imu = generate_imu(
                    _params["bottle_state"],
                    _params["tilt_angle"],
                    _params["noise_level"],
                    impulse,
                )

                return {
                    "bottle_id": _params["selected_bottle"],
                    "timestamp": compute_sim_timestamp(
                        _params.get("date_offset_days", 0),
                        _params.get("custom_time", "현재 시각"),
                    ),
                    **imu,
                }

            start_stream(
                user_id="user-1",
                get_reading=get_reading,
                stop_event=stop_event,
            )
            st.session_state.stop_event = stop_event
            st.session_state.streaming = True

        progress_bar = st.progress(0, text="5초 복용 시나리오를 시작합니다...")

        steps = [
            (0, "1. 책상 위 보관 중 (0도)", 0.6, 15),
            (45, "2. 약통 집어 들기 (45도)", 0.8, 35),
            (110, "3. 손바닥에 알약 털어넣기 (110도)", 1.2, 60),
            (110, "4. 툭툭 털기 충격 발생 (110도)", 0.8, 80),
            (45, "5. 통 세우는 중 (45도)", 0.8, 90),
            (0, "6. 책상에 놓기 (0도)", 0.8, 100),
        ]

        with st.status("복용 시나리오 스트리밍 진행 중...", expanded=True) as status_box:
            for angle, state_desc, duration, pct in steps:
                st.session_state.tilt_angle = angle
                st.session_state.bottle_state = state_desc
                _params["tilt_angle"] = angle
                _params["bottle_state"] = state_desc
                if angle == 110 and "충격" in state_desc:
                    st.session_state.trigger_impulse = True
                    _params["trigger_impulse"] = True

                status_box.write(f"{state_desc}")
                progress_bar.progress(pct, text=f"{state_desc} ({pct}%)")
                time.sleep(duration)

            status_box.update(label="5초 복용 시나리오 전송 완료!", state="complete", expanded=False)

        # 시나리오 종료 후 자동 스트림 중지
        if st.session_state.stop_event is not None:
            st.session_state.stop_event.set()
        st.session_state.streaming = False
        st.session_state.stop_event = None
        st.rerun()

    st.write("")

    # [수동 실행] 고급 테스팅 아코디언 메뉴
    with st.expander("고급 테스팅: 수동 각도 제어 및 지속 전송"):
        st.caption("개발자 전용: 특정 각도 고정 및 지속 스트리밍 테스트")

        b_col1, b_col2, b_col3 = st.columns(3)
        with b_col1:
            if st.button("0° 보관 중", use_container_width=True):
                st.session_state.tilt_angle = 0
                st.session_state.bottle_state = "보관 중 (0도)"
                st.rerun()
        with b_col2:
            if st.button("45° 집어 들기", use_container_width=True):
                st.session_state.tilt_angle = 45
                st.session_state.bottle_state = "손바닥으로 기울임 (45도)"
                st.rerun()
        with b_col3:
            if st.button("110° 알약 털기", use_container_width=True):
                st.session_state.tilt_angle = 110
                st.session_state.bottle_state = "알약 털어넣기 (110도)"
                st.rerun()

            # 110도 하위 트리 구조: 110도 선택 시에만 활성화
            is_110_active = (st.session_state.tilt_angle == 110)
            if st.button(
                "└─ 툭툭 털기 충격",
                use_container_width=True,
                disabled=not is_110_active,
            ):
                if not st.session_state.streaming:
                    st.warning("수동 지속 전송 시작을 먼저 켜고 클릭하셔야 백엔드로 전달됩니다.")
                else:
                    st.session_state.trigger_impulse = True
                    st.toast("툭툭 털기 임펄스 노이즈 주입!")
                    st.rerun()

            st.markdown(
                "<p style='font-size: 0.72rem; color: #888888; margin-top: -8px; margin-bottom: 8px; line-height: 1.2;'>"
                "수동 전송이 켜진 상태에서 누르면 백엔드로 1회성 충격 노이즈(3.2m/s²)가 즉시 전달됩니다."
                "</p>",
                unsafe_allow_html=True,
            )

        st.divider()
        st.write("**수동 지속 전송 제어**")
        if not st.session_state.streaming:
            if st.button("수동 지속 전송 시작", use_container_width=True, type="secondary"):
                stop_event = threading.Event()

                def get_reading_manual() -> dict:
                    impulse = _params.get("trigger_impulse", False)
                    _params["trigger_impulse"] = False
                    imu = generate_imu(
                        _params["bottle_state"],
                        _params["tilt_angle"],
                        _params["noise_level"],
                        impulse,
                    )
                    return {
                        "bottle_id": _params["selected_bottle"],
                        "timestamp": compute_sim_timestamp(
                            _params.get("date_offset_days", 0),
                            _params.get("custom_time", "현재 시각"),
                        ),
                        **imu,
                    }

                start_stream(
                    user_id="user-1",
                    get_reading=get_reading_manual,
                    stop_event=stop_event,
                )
                st.session_state.stop_event = stop_event
                st.session_state.streaming = True
                st.rerun()
        else:
            if st.button("수동 전송 중지", use_container_width=True, type="secondary"):
                if st.session_state.stop_event is not None:
                    st.session_state.stop_event.set()
                st.session_state.streaming = False
                st.session_state.stop_event = None
                st.rerun()

# ── 우측: 실시간 데이터 미리보기 ───────────────────────────────────────────────
with col_status:
    st.subheader("실시간 센서 Raw Data 및 송신 패킷 미리보기")

    # 현재 생성 센서값 및 시리얼 로그 샘플링
    sample_imu = generate_imu(
        st.session_state.bottle_state,
        st.session_state.tilt_angle,
        st.session_state.noise_level,
        st.session_state.trigger_impulse,
    )
    if st.session_state.trigger_impulse:
        st.session_state.trigger_impulse = False

    st.write("**아두이노 시리얼 모니터 / 플로터 출력 포맷 (Raw Logs)**")
    serial_str = f"AccX:{sample_imu['acc_x']:.2f},AccY:{sample_imu['acc_y']:.2f},AccZ:{sample_imu['acc_z']:.2f},State:{sample_imu['state_deg']}"
    st.code(serial_str, language="text")

    st.divider()

    st.write("**WebSocket 송신 JSON 패킷 미리보기**")
    packet = {
        "bottle_id": st.session_state.selected_bottle,
        "timestamp": compute_sim_timestamp(
            st.session_state.date_offset_days,
            st.session_state.custom_time,
        ),
        **sample_imu,
    }
    st.json(packet)
