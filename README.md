# JPOP 연합공연 소통 사이트 (concertsite)

참가 팀 대표와 팀원이 공연 준비를 함께 진행하는 비공개 사이트입니다. 기존 Google Apps Script 사이트를 Node.js + MongoDB로 옮기고 다시 설계했습니다.

- **홈**: D-day, 우리 팀 할 일(미제출 항목, 안 한 투표, 비어 있는 팀 정보), 셋리스트로 계산한 공연 순서 타임라인, 공지, 최근 소식
- **팀**: 팀 정보, 셋리스트(러닝타임 합계와 배정 시간 비교, 여러 곡 붙여넣기), 이미지 갤러리
- **진행**: 팀 × 항목 제출 현황(독촉 문구 복사), 투표(1인 1표 또는 팀당 1표, 마감 전 변경, 진짜 익명, 마감 후 결과 공개)
- **소통**: 회의록(결정사항, 담당자와 기한이 있는 할 일), 총괄대표 문의, 자유게시판
- **관리**: 공연 정보와 순서, 팀, 접속 코드 발급·재발급·끄기, 백업, 기존 데이터 가져오기

## 접속 방식

사람마다 비밀번호(자동 생성 `XXXXX-XXXXX` 또는 총괄대표가 정한 6자 이상)를 발급하고, 접속 링크 `https://사이트주소/k/코드`를 카톡으로 보냅니다. 링크를 누르면 로그인되고, 그 기기에서는 60일간 유지됩니다.

| 역할 | 할 수 있는 일 |
|---|---|
| 팀 구성원 | 열람, 우리 팀 제출 상태 변경, 투표, 회의록·문의·게시글 작성 |
| 팀 대표 | 위 권한 + 우리 팀 정보, 셋리스트, 이미지 편집 + 대표자 톡방·연락처 열람 |
| 총괄대표 | 전체 편집, 접속 코드 관리, 취합·투표 생성, 문의 답변 |

보안 관련 동작:
- 코드는 해시로만 저장합니다.
- 로그인 시도는 15분에 10회로 제한합니다.
- 재발급하면 기존 기기의 로그인이 끊깁니다.
- 대표자 연락처와 톡방 링크는 서버에서 역할별로 걸러서 보냅니다.

## Render 배포

1. **MongoDB Atlas 준비**
   - 기존 클러스터를 쓰면 됩니다. 이 앱은 `jpop_union` DB를 따로 씁니다.
   - Atlas → Network Access에 `0.0.0.0/0`을 추가합니다. Render 무료 플랜은 고정 IP가 없습니다.
   - 접속 문자열(`mongodb+srv://...`)을 준비합니다.
2. **Render에서 New → Blueprint를 고르고 이 저장소를 연결합니다.** `render.yaml`대로 무료 웹 서비스가 만들어집니다.
3. **환경변수를 입력합니다.**
   - `MONGODB_URI`: Atlas 접속 문자열
   - `ADMIN_BOOTSTRAP_TOKEN`: 처음 들어갈 임시 코드. 예: `FIRST-ADMIN1`처럼 추측하기 어려운 값
   - `SESSION_SECRET`: Blueprint면 자동 생성됩니다. 직접 만든 서비스라 비어 있어도, 서버가 DB에 키를 만들어 계속 씁니다.
4. **배포가 끝나면** 사이트에서 임시 코드로 로그인합니다. 홈에 뜨는 **기존 데이터 가져오기**로 `import-data.json`을 고릅니다.
5. 가져오기 결과 화면에 새 접속 코드가 한 번만 표시됩니다. 각자에게 "안내 문구 복사"로 보냅니다.
   - 총괄대표 본인 코드로 다시 로그인했는지 확인합니다.
   - 그다음 Render에서 `ADMIN_BOOTSTRAP_TOKEN`을 **삭제**합니다.

무료 플랜은 15분 동안 접속이 없으면 잠듭니다. 다음 접속 때 깨어나는 데 1분 정도 걸리며, 로딩 화면에 그 안내가 나옵니다.

## 기존 Apps Script 데이터 옮기기

```bash
pip install openpyxl pillow
# 구글 시트를 .xlsx로 내려받고, 표시 중인 이미지를 드라이브 파일ID.확장자 이름으로 한 폴더에 모은 뒤
python3 scripts/convert_apps_script.py 시트.xlsx import-data.json --images ./images --event-date 2027-01-30 --title "1월 JPOP 연합공연"
```

옮기지 않는 것과 바뀌는 것:
- 기존 토큰 값은 옮기지 않고 새로 발급합니다. 라벨, 역할, 팀만 옮깁니다.
- 테마 색상이 비어 있는 팀에는 기본 색을 배정합니다.
- 결과 JSON에는 연락처와 운영규약이 들어 있으므로 커밋하지 않습니다(`.gitignore` 처리됨).

## 로컬 개발

```bash
npm install
npm test                                     # API 테스트 (메모리 MongoDB)
npm run build && node scripts/dev-memory-server.js   # http://localhost:3000, 코드 DEV00-ADMIN
```

실제 DB로 개발하려면 `.env` 없이 환경변수로 `MONGODB_URI=... npm start`를 실행합니다. 프론트 수정 중에는 `npx vite`(5173, `/api`는 3000으로 프록시)를 함께 띄웁니다.

## 구조

```
server/        Express API
  app.js       미들웨어, 라우터, 정적 파일
  auth.js      접속 코드, 세션 쿠키, 역할
  state.js     로그인 사용자용 전체 상태 (역할별 필터링)
  routes/      auth, content(공연·팀·셋리스트), progress(취합·투표), board(회의록·문의·게시판·파일), admin
client/        Preact + Vite
  src/pages/   Home, Teams, Progress, Polls, Board, Rules, Admin, Login
scripts/       데이터 변환, 메모리 DB 개발 서버
test/          API 테스트
docs/PROJECT_CONTEXT.md  설계 결정 기록
```
