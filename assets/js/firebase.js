/**
 * Firebase 초기화 계층.
 *
 * 빌드 도구를 쓰지 않는 정적 사이트이므로 Firebase SDK 를 CDN 의 ES 모듈로 직접 불러옵니다.
 * 버전을 올릴 때는 auth.js · store.js 의 import 주소도 함께 맞춰주세요.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

/** firebase-config.js 가 없거나 값이 비어 있을 때 발생합니다. */
export class FirebaseConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "FirebaseConfigError";
  }
}

const REQUIRED_KEYS = ["apiKey", "authDomain", "projectId", "appId"];

let context = null;
let booting = null;

async function loadConfig() {
  let module;
  try {
    module = await import("./firebase-config.js");
  } catch {
    throw new FirebaseConfigError(
      "firebase-config.js 파일이 없습니다. firebase-config.example.js 를 복사해 값을 채워주세요."
    );
  }

  const config = module.firebaseConfig;
  if (!config || typeof config !== "object") {
    throw new FirebaseConfigError(
      "firebase-config.js 가 firebaseConfig 를 내보내지 않습니다."
    );
  }

  const missing = REQUIRED_KEYS.filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new FirebaseConfigError(
      `firebase-config.js 에 다음 값이 비어 있습니다: ${missing.join(", ")}`
    );
  }

  return config;
}

async function boot() {
  const config = await loadConfig();
  const app = initializeApp(config);

  // 오프라인에서도 마지막으로 받은 데이터를 볼 수 있도록 로컬 캐시를 켭니다.
  // 여러 탭을 동시에 열어도 캐시를 공유합니다.
  let db;
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    // 시크릿 모드 등 IndexedDB 를 못 쓰는 환경에서는 메모리 캐시로 동작합니다.
    db = initializeFirestore(app, {});
  }

  context = { app, auth: getAuth(app), db };
  return context;
}

/** Firebase 앱을 초기화합니다. 여러 번 불러도 한 번만 실행됩니다. */
export function initFirebase() {
  if (context) return Promise.resolve(context);
  if (!booting) {
    booting = boot().catch((error) => {
      booting = null;
      throw error;
    });
  }
  return booting;
}

/** 초기화가 끝난 뒤 Firebase 인스턴스를 꺼내 씁니다. */
export function firebaseContext() {
  if (!context) {
    throw new Error("initFirebase() 를 먼저 호출해야 합니다.");
  }
  return context;
}
