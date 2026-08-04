/**
 * Google 계정 로그인.
 * Firebase Authentication 의 Google 제공업체를 사용합니다.
 */
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { firebaseContext } from "./firebase.js";

/** 사용자에게 보여줄 메시지를 담은 오류. silent 면 안내하지 않습니다. */
export class AuthError extends Error {
  constructor(message, { silent = false } = {}) {
    super(message);
    this.name = "AuthError";
    this.silent = silent;
  }
}

/** Firebase 오류 코드를 한국어 안내 문구로 바꿉니다. */
function describe(error) {
  switch (error?.code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return new AuthError("로그인을 취소했습니다.", { silent: true });

    case "auth/popup-blocked":
      return new AuthError(
        "브라우저가 로그인 창을 차단했습니다. 팝업 차단을 해제한 뒤 다시 시도해주세요."
      );

    case "auth/unauthorized-domain":
      return new AuthError(
        `이 주소(${window.location.hostname})가 Firebase 승인된 도메인에 없습니다. ` +
          "Firebase Console → Authentication → 설정 → 승인된 도메인에 추가해주세요."
      );

    case "auth/operation-not-allowed":
      return new AuthError(
        "Firebase Console → Authentication → Sign-in method 에서 Google 로그인을 사용 설정해주세요."
      );

    case "auth/network-request-failed":
      return new AuthError("네트워크 연결을 확인한 뒤 다시 시도해주세요.");

    default:
      return new AuthError(error?.message || "로그인 중 문제가 발생했습니다.");
  }
}

/**
 * 로그인 상태 변화를 구독합니다.
 * 새로고침해도 로그인이 유지되므로 첫 호출은 잠시 뒤에 들어옵니다.
 * @param {(user: object|null) => void} handler
 * @returns {() => void} 구독 해제 함수
 */
export function watchUser(handler) {
  return onAuthStateChanged(firebaseContext().auth, handler);
}

/** Google 계정으로 로그인합니다. */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  // 계정을 여러 개 쓰는 경우를 위해 항상 계정 선택 화면을 띄웁니다.
  provider.setCustomParameters({ prompt: "select_account" });

  try {
    const result = await signInWithPopup(firebaseContext().auth, provider);
    return result.user;
  } catch (error) {
    throw describe(error);
  }
}

/** 로그아웃합니다. */
export async function signOutUser() {
  try {
    await signOut(firebaseContext().auth);
  } catch (error) {
    throw describe(error);
  }
}
