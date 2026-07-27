/**
 * 환경 변수에서 assets/js/firebase-config.js 를 만들어 냅니다.
 *
 * GitHub Actions 는 저장소 Secrets 를 환경 변수로 넘겨 이 스크립트를 실행합니다.
 * 로컬에서도 같은 방식으로 쓸 수 있습니다.
 *
 *   FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=... \
 *   FIREBASE_PROJECT_ID=... FIREBASE_APP_ID=... \
 *   node scripts/generate-firebase-config.mjs
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "assets/js/firebase-config.js");

/** [설정 키, 환경 변수 이름, 필수 여부] */
const FIELDS = [
  ["apiKey", "FIREBASE_API_KEY", true],
  ["authDomain", "FIREBASE_AUTH_DOMAIN", true],
  ["projectId", "FIREBASE_PROJECT_ID", true],
  ["storageBucket", "FIREBASE_STORAGE_BUCKET", false],
  ["messagingSenderId", "FIREBASE_MESSAGING_SENDER_ID", false],
  ["appId", "FIREBASE_APP_ID", true],
  ["measurementId", "FIREBASE_MEASUREMENT_ID", false],
];

const config = {};
const missing = [];

for (const [key, envName, required] of FIELDS) {
  const value = (process.env[envName] ?? "").trim();
  if (value) config[key] = value;
  else if (required) missing.push(envName);
}

if (missing.length > 0) {
  console.error(
    `Firebase 설정을 만들 수 없습니다. 다음 값이 비어 있습니다:\n  ${missing.join("\n  ")}\n\n` +
      "GitHub 저장소의 Settings → Secrets and variables → Actions 에 등록해주세요."
  );
  process.exit(1);
}

const body = Object.entries(config)
  .map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`)
  .join("\n");

writeFileSync(
  OUTPUT,
  `// 이 파일은 scripts/generate-firebase-config.mjs 가 자동으로 만듭니다.\n` +
    `// 직접 수정하지 마세요.\n` +
    `export const firebaseConfig = {\n${body}\n};\n`,
  "utf8"
);

console.log(`firebase-config.js 생성 완료 (projectId: ${config.projectId})`);
