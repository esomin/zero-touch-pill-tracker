# 복용 이력 시드(Seed) 데이터 생성 가이드

최근 3일치(9회) + 오늘 아침(1회) 총 10건의 복용 이력(정상/조기/지연)을 데이터베이스에 주입하는 명령어 메모입니다.

---

### 1. 클라우드 MongoDB Atlas 사용 시 (배포 서버)

백엔드 컨테이너(`med-tracker-backend`)에서 직접 파이썬 스크립트를 실행합니다:

```bash
docker exec -i med-tracker-backend python seed_3days_logs.py
```

---

### 2. 로컬 MongoDB 컨테이너 사용 시 (로컬 개발)

로컬 몽고 컨테이너(`med-tracker-mongo`)로 JS 스크립트를 직접 주입합니다:

```bash
docker exec -i med-tracker-mongo mongosh med_tracker --quiet < scripts/seed_3days_logs.js
```

---

### 3. 원터치 쉘 스크립트 실행 (환경 자동 감지)

```bash
./scripts/seed_3days_logs.sh
```
