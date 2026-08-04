/**
 * 첨부 링크.
 *
 * 파일은 앱에 직접 올리지 않고 구글 드라이브·유튜브 같은 곳의 주소를 붙입니다.
 * (Cloud Storage 는 결제 계정을 연결해야 쓸 수 있고,
 *  Firestore 에 파일을 넣으면 얼마 안 되는 무료 용량을 금방 채웁니다.)
 *
 * 저장 형태는 [{ label, url }] 이고, 화면에서는 종류에 맞게 보여줍니다.
 */

/** 한 글에 붙일 수 있는 링크 수. */
export const MAX_LINKS = 20;

/* =========================================================
   주소 알아보기
   ========================================================= */
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i;

/** 유튜브 주소에서 영상 번호를 뽑습니다. */
export function youtubeId(url) {
  const match =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(
      url
    );
  return match ? match[1] : null;
}

/** 구글 드라이브 주소에서 파일 번호를 뽑습니다. */
function driveId(url) {
  const match = /drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]{10,})/.exec(url);
  return match ? match[1] : null;
}

/**
 * 화면에 넣어도 되는 주소인지 확인합니다.
 *
 * 저장할 때도 검사하지만, 학생이 앱을 거치지 않고 직접 값을 넣을 수도 있어
 * 보여주기 직전에 한 번 더 봅니다. http/https 가 아니면 링크로 만들지 않습니다.
 */
export function safeUrl(url) {
  if (typeof url !== "string") return null;

  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/** 링크 종류를 알아냅니다. */
export function linkKind(url) {
  if (youtubeId(url)) return "youtube";
  if (driveId(url)) return "drive";
  if (IMAGE_EXTENSION.test(url)) return "image";
  if (/\.pdf(\?|#|$)/i.test(url)) return "pdf";
  if (/\.hwpx?(\?|#|$)/i.test(url)) return "hwp";
  if (/docs\.google\.com/.test(url)) return "docs";
  return "link";
}

const ICONS = {
  youtube: "▶️",
  drive: "🗂️",
  docs: "📄",
  image: "🖼️",
  pdf: "📕",
  hwp: "📘",
  link: "🔗",
};

export const linkIcon = (url) => ICONS[linkKind(url)] ?? ICONS.link;

/** 제목을 안 적었을 때 주소에서 보기 좋은 이름을 만듭니다. */
function guessLabel(url) {
  if (youtubeId(url)) return "유튜브 영상";
  if (driveId(url)) return "구글 드라이브 파일";

  try {
    const { hostname, pathname } = new URL(url);
    const last = decodeURIComponent(pathname.split("/").filter(Boolean).pop() ?? "");
    return last || hostname;
  } catch {
    return url;
  }
}

/* =========================================================
   입력 다루기
   ========================================================= */
/**
 * 한 줄에 하나씩 적은 링크를 읽습니다.
 * "제목 | 주소" 처럼 적으면 제목을 쓰고, 주소만 적으면 알아서 이름을 붙입니다.
 *
 * @returns {{ ok: true, links: Array<{label,url}> } | { ok: false, error: string }}
 */
export function parseLinks(text) {
  const lines = (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > MAX_LINKS) {
    return { ok: false, error: `링크는 ${MAX_LINKS}개까지 붙일 수 있습니다.` };
  }

  const links = [];

  for (const line of lines) {
    const divider = line.lastIndexOf("|");
    const label = divider > 0 ? line.slice(0, divider).trim() : "";
    const url = (divider > 0 ? line.slice(divider + 1) : line).trim();

    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: `‘${line}’ 은 주소가 아닙니다. http 로 시작하는 주소를 적어주세요.` };
    }

    try {
      new URL(url);
    } catch {
      return { ok: false, error: `‘${url}’ 을 알아볼 수 없습니다.` };
    }

    links.push({ label: label || guessLabel(url), url });
  }

  return { ok: true, links };
}

/** 저장된 링크를 다시 입력 칸에 채울 글자로 바꿉니다. */
export function formatLinks(links) {
  return (links ?? []).map((link) => `${link.label} | ${link.url}`).join("\n");
}
