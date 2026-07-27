# Career_Manager

학생 진로상담 관리 웹 애플리케이션입니다.

기존 C#(WPF + EF Core/SQLite) 데스크톱 프로그램인
[`simsy0924/CareerManagerProgram`](https://github.com/simsy0924/CareerManagerProgram)을
JavaScript 웹사이트로 옮긴 것입니다.

## 실행 방법

빌드 도구나 설치가 필요 없는 정적 웹사이트입니다. ES 모듈을 사용하기 때문에
`index.html` 파일을 직접 여는 대신 간단한 로컬 서버로 실행해주세요.

```bash
# 저장소 폴더에서
python3 -m http.server 8000
```

브라우저에서 <http://localhost:8000> 으로 접속합니다.

GitHub Pages(`Settings → Pages → Deploy from a branch`)로도 바로 배포할 수 있습니다.

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

데이터는 브라우저의 `localStorage`에 저장됩니다.
서버가 없으므로 **기기와 브라우저마다 데이터가 따로 관리**되며,
브라우저 저장소를 지우면 함께 삭제됩니다.

처음 실행할 때는 화면을 둘러볼 수 있도록 예시 학생 4명과 상담 기록이 들어 있습니다.
학생을 직접 등록하기 시작하면 예시 데이터는 다시 생성되지 않습니다.

## 폴더 구조

```
index.html
assets/
  css/style.css          디자인 토큰 및 전체 스타일
  js/
    app.js               사이드바 내비게이션 · 화면 전환 (원본 MainWindow/MainViewModel)
    store.js             localStorage 데이터 계층 (원본 AppDbContext)
    services.js          업무 로직 (원본 StudentService/CounselingService)
    ui.js                모달 · 토스트 · 포맷 유틸리티
    views/
      dashboard.js       대시보드
      students.js        학생 관리
      counseling.js      상담일지
      placeholder.js     일정 · 통계 (준비 중 화면)
```

## 원본 C# 프로젝트와의 대응

| 원본 (C#) | 이번 웹 버전 |
| --- | --- |
| `CareerCounseling.Core/Entities` | `assets/js/store.js` 의 데이터 구조 |
| `CareerCounseling.Infrastructure` (EF Core + SQLite) | `assets/js/store.js` (localStorage) |
| `CareerCounseling.Wpf/Services` | `assets/js/services.js` |
| `CareerCounseling.Wpf/ViewModels` + `Views` | `assets/js/views/*.js` |
| `CareerCounseling.Wpf/Themes` | `assets/css/style.css` |

데이터 구조(학생 · 학년도 소속 · 상담 기록)와 유효성 검사 규칙
(학년도/학년/반/번호 중복 확인, 필수 입력 항목, 회기 번호 자동 부여)은
원본 로직을 그대로 옮겼습니다.
