# Career_Manager

학생 진로상담 관리 웹 애플리케이션입니다.

기존 C#(WPF + EF Core/SQLite) 데스크톱 프로그램인
[`simsy0924/CareerManagerProgram`](https://github.com/simsy0924/CareerManagerProgram)을
JavaScript 웹사이트로 옮긴 것입니다.

Google 계정으로 로그인하고, 학생·상담 데이터는 Firebase(Firestore)에 저장합니다.
`main` 브랜치에 푸시하면 GitHub Actions 가 GitHub Pages 로 자동 배포합니다.

## 화면 구성

| 화면 | 설명 |
| --- | --- |
| 대시보드 | 관리 중인 학생 수, 누적 상담 수, 최근 상담 기록 8건 |
| 학생 관리 | 학생 검색(이름/학년/반), 추가, 수정, 비활성화, **명렬표 엑셀 업로드** |
| 상담일지 | 학생별 상담 기록 조회 및 추가, **진로상담총괄표 내보내기** |
| 일정 | 준비 중 |
| 통계 | 준비 중 |

기존 WPF 프로그램의 기능에 더해 명렬표 일괄 등록과 한글 서식 내보내기를 지원합니다.
반응형 레이아웃과 다크 모드도 지원합니다.

## 명렬표 엑셀 업로드

**학생 관리 → 명렬표 업로드** 에서 학급 명렬표 파일을 올리면 학생을 한 번에 등록합니다.

학교에서 쓰는 아래 형태의 **교차표**를 그대로 읽습니다.

```
              2026학년도 1학년 학급명렬표
 ┌──────┬───────────────────────┬──────┬───────────────────────┐
 │ 번호 │           남          │ 번호 │           여          │
 │      │ 1반 │ 2반 │ 3반 │ …   │      │ 6반 │ 7반 │ 8반 │ …   │
 ├──────┼─────┼─────┼─────┼─────┼──────┼─────┼─────┼─────┼─────┤
 │  1   │홍길동│                 │  1   │김영희│                 │
```

- **학년도·학년** 은 맨 위 제목에서 읽습니다.
- **반** 은 `○반` 제목이 있는 열에서, **번호** 는 왼쪽 `번호` 열에서 읽습니다.
- 병합된 `남`/`여` 구역으로 성별까지 함께 저장합니다.
- `학년도·학년·반·번호·이름` 열이 있는 **목록형** 명렬표도 읽을 수 있습니다.

읽어 들인 내용은 저장하기 전에 미리보기로 보여 줍니다.
이미 같은 학년도·학년·반·번호에 학생이 있으면 **중복**으로 표시되고,
줄마다 *건너뛰기* 또는 *덮어쓰기* 를 고를 수 있습니다(기본값은 건너뛰기).

| 형식 | 지원 |
| --- | --- |
| `.xlsx` · `.xlsm` | ✅ |
| `.csv` (UTF-8 · EUC-KR) | ✅ |
| 나이스에서 받은 HTML 표 형태의 `.xls` | ✅ |
| 예전 엑셀 이진 형식 `.xls` | ❌ 엑셀에서 `.xlsx` 로 저장한 뒤 올려주세요 |

## 진로상담총괄표 내보내기

**상담일지 → 총괄표 내보내기** 에서 기간을 정하면
그 기간의 상담 기록을 학교 결재 서식(진로상담총괄표)에 채워 한글 문서로 내려받습니다.

- 파일 형식은 한글의 공개 표준인 **`.hwpx`** 입니다.
  한컴오피스 한글 2010 이상과 한컴독스에서 바로 열리고,
  한글에서 *다른 이름으로 저장* 하면 `.hwp` 로 바꿀 수 있습니다.
  (비공개 이진 형식인 `.hwp` 는 브라우저에서 직접 만들 수 없습니다.)
- **학번** 은 학년·반·번호로 만든 5자리 숫자입니다. (1학년 3반 5번 → `10305`)
- **상담 구분** 은 서식과 같은 `진로 / 진학 / 기타` 3종입니다.
- **상담시간** 합계와 하단 누계표(A·C·주당시수)를 자동으로 계산합니다.
  내보낼 때 **학기 적용 주 수(B)** 와 **주당 수업시수(D)** 를 입력받습니다.
- 이 서식은 **50분을 한 시간(차시)** 으로 셉니다.
  (`assets/js/counseling-form.js` 의 `MINUTES_PER_HOUR`)

문서 만들기는 모두 브라우저 안에서 이뤄져 상담 내용이 외부로 나가지 않습니다.
외부 라이브러리 없이 브라우저에 내장된 압축 기능(`CompressionStream`)만 씁니다.

## 데이터 저장

데이터는 **Firestore** 에 로그인한 사용자별로 나누어 저장합니다.

```
users/{uid}/students/{id}      학생 (이름·성별·메모)
users/{uid}/schoolYears/{id}   학년도 소속(학년·반·번호)
users/{uid}/sessions/{id}      상담 기록 (날짜·회기·구분·소요시간·내용)
```

`firestore.rules` 의 보안 규칙에 따라 **본인이 만든 데이터만 읽고 쓸 수 있습니다.**
다른 사람의 데이터는 로그인해도 접근할 수 없습니다.

로그인하면 어느 기기·브라우저에서든 같은 데이터를 볼 수 있고,
변경 사항은 열려 있는 모든 창에 실시간으로 반영됩니다.
오프라인일 때는 마지막으로 받은 데이터를 그대로 볼 수 있으며,
다시 연결되면 저장하지 못한 내용이 전송됩니다.

## 처음 준비하기

### 1. Firebase 프로젝트 만들기

1. [Firebase Console](https://console.firebase.google.com/) 에서 프로젝트를 만듭니다.
2. **빌드 → Authentication → 시작하기 → Sign-in method** 에서 **Google** 을 사용 설정합니다.
3. **빌드 → Firestore Database → 데이터베이스 만들기** 로 Firestore 를 만듭니다.
   (프로덕션 모드로 시작한 뒤 아래 4번에서 규칙을 넣습니다.)
4. **Firestore Database → 규칙** 탭에 이 저장소의 `firestore.rules` 내용을 붙여넣고 게시합니다.
   Firebase CLI 를 쓴다면 `firebase deploy --only firestore:rules` 로도 됩니다.
5. **프로젝트 설정 → 내 앱 → 웹 앱 추가(`</>`)** 로 웹 앱을 등록하고,
   화면에 나오는 `firebaseConfig` 값을 복사해 둡니다.

### 2. 승인된 도메인 등록 (중요)

**Authentication → 설정 → 승인된 도메인** 에 앱을 서비스할 주소를 추가해야
Google 로그인이 동작합니다. 없으면 로그인할 때 `unauthorized-domain` 오류가 납니다.

- GitHub Pages 주소: `<사용자명>.github.io` (예: `mayjyeon.github.io`)
- 로컬 개발: `localhost` (기본으로 등록되어 있습니다)

### 3. GitHub Secrets 등록

저장소의 **Settings → Secrets and variables → Actions → New repository secret** 에서
1번에서 복사한 값을 등록합니다.

| Secret 이름 | 필수 | `firebaseConfig` 의 항목 |
| --- | --- | --- |
| `FIREBASE_API_KEY` | ✅ | `apiKey` |
| `FIREBASE_AUTH_DOMAIN` | ✅ | `authDomain` |
| `FIREBASE_PROJECT_ID` | ✅ | `projectId` |
| `FIREBASE_APP_ID` | ✅ | `appId` |
| `FIREBASE_STORAGE_BUCKET` | | `storageBucket` |
| `FIREBASE_MESSAGING_SENDER_ID` | | `messagingSenderId` |

> Firebase 웹 설정값은 브라우저에 노출되는 공개 값이라 그 자체로는 비밀이 아닙니다.
> 실제 보안은 `firestore.rules` 의 규칙과 승인된 도메인 설정이 담당합니다.
> 다만 프로젝트 정보를 저장소에 남기지 않으려고 Secrets 로 주입합니다.

### 4. GitHub Pages 켜기

저장소의 **Settings → Pages → Build and deployment → Source** 를
**GitHub Actions** 로 지정합니다.

이후 `main` 브랜치에 푸시하면 `.github/workflows/deploy.yml` 이
설정 파일을 만들고 GitHub Pages 로 배포합니다.
**Actions** 탭에서 `Deploy to GitHub Pages` 워크플로를 직접 실행할 수도 있습니다.

## 로컬에서 실행하기

빌드 도구나 설치가 필요 없는 정적 웹사이트입니다.
다만 Firebase 설정 파일이 하나 필요합니다.

```bash
# 1) 설정 파일 만들기 (둘 중 하나)
cp assets/js/firebase-config.example.js assets/js/firebase-config.js   # 직접 값 채우기

FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=... \
FIREBASE_PROJECT_ID=... FIREBASE_APP_ID=... \
node scripts/generate-firebase-config.mjs                             # 환경 변수로 생성

# 2) 로컬 서버 실행 (ES 모듈이라 파일을 직접 열면 안 됩니다)
python3 -m http.server 8000
```

브라우저에서 <http://localhost:8000> 으로 접속합니다.
`assets/js/firebase-config.js` 는 `.gitignore` 에 있어 저장소에 올라가지 않습니다.

설정 파일이 없으면 앱이 무엇을 해야 하는지 안내 화면을 띄웁니다.

## 폴더 구조

```
index.html                     로그인 화면 · 앱 셸
firestore.rules                Firestore 보안 규칙 (사용자별 접근 제한)
firebase.json                  Firebase CLI 설정
scripts/
  generate-firebase-config.mjs 환경 변수 → firebase-config.js 생성
.github/workflows/deploy.yml   GitHub Pages 자동 배포
assets/
  css/style.css                디자인 토큰 및 전체 스타일
  js/
    app.js                     로그인 게이트 · 내비게이션 · 화면 전환 (원본 MainWindow/MainViewModel)
    firebase.js                Firebase 앱 초기화
    firebase-config.example.js 설정 파일 예시 (복사해서 사용)
    auth.js                    Google 로그인 / 로그아웃
    store.js                   Firestore 데이터 계층 (원본 AppDbContext)
    services.js                업무 로직 (원본 StudentService/CounselingService)
    ui.js                      모달 · 토스트 · 포맷 유틸리티
    zip.js                     ZIP 읽기·쓰기 (xlsx 읽기와 hwpx 쓰기에 공용)
    sheet.js                   엑셀 · CSV · HTML 표 읽기
    roster.js                  명렬표 해석 (교차표 · 목록형)
    hwpx.js                    한글 문서(.hwpx) 생성기
    counseling-form.js         진로상담총괄표 서식 구성
    views/
      dashboard.js             대시보드
      students.js              학생 관리
      counseling.js            상담일지
      placeholder.js           일정 · 통계 (준비 중 화면)
```

## 원본 C# 프로젝트와의 대응

| 원본 (C#) | 이번 웹 버전 |
| --- | --- |
| `CareerCounseling.Core/Entities` | `assets/js/store.js` 의 데이터 구조 |
| `CareerCounseling.Infrastructure` (EF Core + SQLite) | `assets/js/store.js` (Firestore) |
| `CareerCounseling.Wpf/Services` | `assets/js/services.js` |
| `CareerCounseling.Wpf/ViewModels` + `Views` | `assets/js/views/*.js` |
| `CareerCounseling.Wpf/Themes` | `assets/css/style.css` |

데이터 구조(학생 · 학년도 소속 · 상담 기록)와 유효성 검사 규칙
(학년도/학년/반/번호 중복 확인, 필수 입력 항목, 회기 번호 자동 부여)은
원본 로직을 그대로 옮겼습니다.

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| `Firebase 설정이 필요합니다` 화면 | `firebase-config.js` 가 있는지, GitHub Secrets 가 등록됐는지 |
| 로그인 시 승인된 도메인 오류 | Authentication → 설정 → 승인된 도메인에 배포 주소 추가 |
| `Google 로그인을 사용 설정해주세요` | Authentication → Sign-in method 에서 Google 활성화 |
| 로그인은 되는데 데이터 접근 권한 오류 | `firestore.rules` 를 Firebase 에 게시했는지 확인 |
| 로그인 창이 뜨지 않음 | 브라우저 팝업 차단 해제 |
| 명렬표에서 학생을 못 찾음 | `○반` 제목 줄과 `번호` 열이 있는지, 제목에 `2026학년도 1학년` 이 들어 있는지 |
| 명렬표 업로드가 안 됨 | 예전 `.xls` 라면 엑셀에서 `.xlsx` 로 다시 저장 |
| 내보낸 문서가 안 열림 | 한컴오피스 한글 2010 이상인지 확인 (그 이전 버전은 `.hwpx` 를 지원하지 않습니다) |
