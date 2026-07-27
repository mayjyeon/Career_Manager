/**
 * Firebase 웹 설정 예시 파일.
 *
 * 이 파일을 같은 폴더에 `firebase-config.js` 라는 이름으로 복사한 뒤
 * Firebase Console(프로젝트 설정 → 내 앱 → 웹 앱)의 값으로 채워주세요.
 * `firebase-config.js` 는 .gitignore 에 등록되어 있어 저장소에 올라가지 않습니다.
 *
 * 배포 시에는 GitHub Actions 가 저장소 Secrets 를 읽어
 * 같은 형식의 파일을 자동으로 만들어 줍니다.
 *
 *   node scripts/generate-firebase-config.mjs
 *
 * 명령으로도 환경 변수에서 생성할 수 있습니다.
 */
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000",
};
