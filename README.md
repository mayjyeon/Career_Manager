# Career_Manager

학생 진로상담 관리 웹 애플리케이션입니다.

기존 C#(WPF + EF Core/SQLite) 데스크톱 프로그램인
[`simsy0924/CareerManagerProgram`](https://github.com/simsy0924/CareerManagerProgram)을
JavaScript 웹사이트로 옮긴 것입니다.

Google 계정으로 로그인하고, 학생·상담 데이터는 Firebase(Firestore)에 저장합니다.
`main` 브랜치에 푸시하면 GitHub Actions 가 GitHub Pages 로 자동 배포합니다.

## 화면 구성

로그인한 계정에 따라 **선생님 화면**과 **학생 화면**이 다르게 열립니다.

### 선생님 화면

| 화면 | 설명 |
| --- | --- |
| 대시보드 | 관리 중인 학생 수, 누적 상담 수, 최근 상담 기록 8건 |
| 학생 관리 | 학생 검색·추가·수정·비활성화·일괄 삭제, 명렬표 엑셀 업로드, 학생 계정 연결 확인 |
| 상담일지 | 상담 기록 조회·추가·수정·삭제, 진로상담총괄표 내보내기 |
| 공지사항 | 공지 작성·수정·삭제, 학년·반별 공개 |
| 과제 | 과제 출제와 학생별 제출물 확인 |
| 포트폴리오 | 학생들이 올린 포트폴리오를 학생별로 열람 |
| 통계 | 월별 상담 추이, 상담 구분 비율, 학년·반별 현황 |
| 사용량 | Firestore 를 얼마나 읽고 쓰는지 그래프로 확인 |
| 휴지통 | 지운 자료 되살리기·완전 삭제 |

### 학생 화면

| 화면 | 설명 |
| --- | --- |
| 홈 | 내야 할 과제, 새 공지, 내 포트폴리오 수, 회원 탈퇴 |
| 공지사항 | 내 학년·반이 대상인 공지 열람 |
| 과제 | 과제 확인, 제출·수정·제출 취소 |
| 포트폴리오 | 내 진로 활동 기록 추가·수정·삭제 |
| 휴지통 | 내가 지운 자료 되살리기 |

## 지우기와 휴지통

지운 자료는 곧바로 사라지지 않고 **휴지통에서 30일 동안** 기다립니다.
그동안은 언제든 되살릴 수 있고, 기간이 지나면 자동으로 정리됩니다.

- **학생 삭제** — 학생 관리에서 여러 명을 골라 한 번에 지웁니다(자퇴·졸업 등).
  소속과 상담 기록도 함께 들어가며, 되살리면 같이 돌아옵니다.
  잠깐 목록에서만 빼려면 삭제 대신 **비활성화**를 쓰세요.
- **회원 탈퇴** — 학생이 홈 화면 아래에서 직접 탈퇴합니다.
  내 정보·제출물·포트폴리오를 **휴지통을 거치지 않고 바로** 지우고 로그아웃합니다.
  구글 계정 자체는 그대로 남아, 다시 로그인하면 새로 시작합니다.

> 서버가 따로 없는 정적 사이트라 ‘30일 뒤 자동 삭제’ 는
> 앱을 열 때 지난 항목을 찾아 지우는 방식으로 동작합니다.
> 한동안 아무도 접속하지 않으면 그만큼 늦게 정리됩니다.

## 임시 저장

공지·과제·제출물·포트폴리오처럼 글이 긴 화면은 **입력하는 동안 이 브라우저에 자동 보관**합니다.
실수로 창을 닫아도 다시 열면 “쓰다 만 내용이 있습니다” 안내가 뜨고, 원할 때만 불러옵니다.
저장을 마치면 지워지며, 보관한 내용은 서버로 보내지 않아 다른 기기에서는 보이지 않습니다.

## 사용량 보기

**사용량** 화면에서 Firestore 문서를 얼마나 읽고 쓰는지 그래프로 볼 수 있습니다.
값은 Google Cloud Monitoring 에서 가져옵니다.

쓰려면 두 가지가 필요합니다.

1. 로그인한 계정이 그 Google Cloud 프로젝트의 **모니터링 뷰어**일 것
   (보통 프로젝트를 만든 사람은 이미 권한이 있습니다)
2. 화면에서 **‘사용량 조회 권한 연결’** 을 눌러 한 번 더 동의

로그인할 때 받는 권한으로는 사용량을 읽을 수 없어 따로 여쭙습니다.
학생 계정은 이 과정을 거치지 않으므로 로그인 경험이 달라지지 않습니다.
받은 권한은 브라우저 탭에만 잠시 보관되고 한 시간쯤 뒤 만료됩니다.

반응형 레이아웃과 다크 모드도 지원합니다.

## 선생님과 학생 구분

`assets/js/roles.js` 의 `TEACHER_EMAIL` 에 적힌 계정으로 로그인하면 선생님,
그 밖의 구글 계정은 모두 학생으로 봅니다.

```js
export const TEACHER_EMAIL = "mayjyeon52@gmail.com";
```

> 이 값을 바꿀 때는 `firestore.rules` 안의 같은 주소도 함께 고쳐야 합니다.
> 화면만 바꾸면 데이터 접근 권한은 그대로 남습니다.

학생은 처음 로그인할 때 **학년·반·번호와 이름**을 입력합니다.
이 값으로 자기에게 온 공지와 과제를 받아 봅니다.

선생님은 **학생 관리** 화면 아래쪽 ‘학생 계정 연결’ 표에서
학생이 적은 값이 명렬표와 맞는지 확인할 수 있습니다.
학생이 직접 적는 값이라 틀릴 수 있어, `이름 다름`·`명렬표에 없음` 으로 표시된 학생은
따로 확인해 주세요.

## 파일 첨부는 링크로

공지·과제·제출물·포트폴리오에는 **파일을 직접 올리지 않고 주소를 붙입니다.**
구글 드라이브·유튜브 등에 올린 뒤 주소를 넣으면 됩니다.

- 유튜브 영상과 이미지 주소는 화면에서 바로 펼쳐 보입니다.
- `제목 | 주소` 로 적으면 그 제목으로 보입니다.
- 드라이브 파일은 **링크가 있는 모든 사용자**로 공유해 두어야 학생이 열 수 있습니다.

> 파일을 앱에 직접 올리려면 Cloud Storage 가 필요한데,
> 2026년 2월부터 결제 계정(Blaze 요금제)을 연결해야 쓸 수 있습니다.
> Firestore 에 파일을 넣는 방법도 무료 용량이 1GB 뿐이라 금방 찹니다.
> 그래서 비용이 들지 않는 링크 첨부 방식을 씁니다.

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

데이터는 **Firestore** 에 저장하며, 두 종류로 나뉩니다.

상담 기록은 선생님 계정 안에만 있고 본인만 읽고 씁니다.

```
users/{uid}/students/{id}      학생 (이름·성별·메모)
users/{uid}/schoolYears/{id}   학년도 소속(학년·반·번호)
users/{uid}/sessions/{id}      상담 기록 (날짜·회기·구분·소요시간·내용)
```

공지·과제처럼 선생님과 학생이 함께 보는 자료는 따로 둡니다.

```
profiles/{uid}      학생이 적은 학년·반·번호·이름
notices/{id}        공지사항   (선생님만 작성, 로그인한 사람은 모두 열람)
assignments/{id}    과제       (선생님만 작성, 로그인한 사람은 모두 열람)
submissions/{id}    과제 제출물 (낸 학생 본인과 선생님만 열람)
portfolios/{id}     포트폴리오  (올린 학생 본인과 선생님만 열람)
```

`firestore.rules` 의 보안 규칙이 이 경계를 지킵니다.

- **상담 기록**은 선생님 본인만 접근합니다.
- **제출물과 포트폴리오**는 낸 학생과 선생님만 볼 수 있고, 다른 학생은 목록에서도 안 보입니다.
- **공지와 과제**는 로그인한 사람이면 모두 읽을 수 있습니다.
  학년·반 지정은 화면에서 걸러 보여주는 것이지 비밀이 아니므로,
  학생에게 보이면 안 되는 내용은 올리지 마세요.

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
    roles.js                   선생님·학생 구분, 공개 대상 처리
    board.js                   공지·과제·제출물·포트폴리오 데이터 계층
    links.js                   첨부 링크 해석 (유튜브·드라이브 등)
    trash.js                   휴지통 (30일 보관 후 정리)
    drafts.js                  임시 저장
    chart.js                   막대·비율·꺾은선 그래프
    monitoring.js              Cloud Monitoring 사용량 조회
    views/
      dashboard.js             대시보드 (선생님)
      students.js              학생 관리 (선생님)
      counseling.js            상담일지 (선생님)
      notices.js               공지사항 (공용)
      assignments.js           과제 (공용)
      portfolio.js             포트폴리오 (공용)
      student-home.js          학생 첫 화면
      profile-form.js          학생 정보 입력
      post-parts.js            글·첨부 링크 보여주기 (공용 조각)
      statistics.js            통계 (선생님)
      usage.js                 사용량 (선생님)
      trash.js                 휴지통 (공용)
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
| 선생님인데 학생 화면이 뜸 | `roles.js` 의 `TEACHER_EMAIL` 과 로그인한 계정이 같은지 확인 |
| 학생 정보 등록에서 저장 실패 | `firestore.rules` 를 새로 배포했는지 확인 (`profiles` 규칙이 필요합니다) |
| 학생이 공지를 못 봄 | 공지의 공개 대상과 학생이 등록한 학년·반이 맞는지 확인 |
| 첨부 링크를 학생이 못 열음 | 드라이브에서 ‘링크가 있는 모든 사용자’ 로 공유했는지 확인 |
| 사용량 화면에 권한 오류 | Google Cloud 콘솔에서 ‘모니터링 뷰어’ 역할과 Cloud Monitoring API 사용 설정 확인 |
| 사용량이 갑자기 안 보임 | 권한이 한 시간마다 만료됩니다. ‘사용량 조회 권한 연결’ 을 다시 누르세요 |
| 지운 자료를 되살리고 싶음 | 휴지통에서 30일 안에는 되살릴 수 있습니다 |
