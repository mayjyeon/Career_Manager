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
| 학생 관리 | 학생 검색(이름/학년/반), 추가, 수정, 비활성화 |
| 상담일지 | 학생별 상담 기록 조회 및 추가 |
| 일정 | 준비 중 |
| 통계 | 준비 중 |

기능 범위는 기존 WPF 프로그램과 동일하게 맞췄습니다.
반응형 레이아웃과 다크 모드를 추가로 지원합니다.

## 데이터 저장

데이터는 **Firestore** 에 로그인한 사용자별로 나누어 저장합니다.

```
users/{uid}/students/{id}      학생
users/{uid}/schoolYears/{id}   학년도 소속(학년·반·번호)
users/{uid}/sessions/{id}      상담 기록
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
