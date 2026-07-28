/**
 * 공지·과제·제출물·포트폴리오가 함께 쓰는 조각들.
 * 글 내용 보여주기, 첨부 링크 목록, 링크 입력 칸을 모아 두었습니다.
 */
import { MAX_LINKS, formatLinks, linkIcon, linkKind, safeUrl, youtubeId } from "../links.js";
import { esc, relativeDate } from "../ui.js";

/* =========================================================
   보여주기
   ========================================================= */
/** 줄바꿈과 주소를 살려 글 내용을 보여줍니다. */
export function renderBody(text) {
  if (!text) return "";

  // 먼저 전부 이스케이프한 뒤 주소만 링크로 바꿉니다.
  const linked = esc(text).replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`
  );

  return `<div class="post__body">${linked}</div>`;
}

/** 첨부 링크. 유튜브 영상과 이미지는 바로 볼 수 있게 펼쳐 줍니다. */
export function renderLinks(links) {
  // 앱을 거치지 않고 들어온 값이 섞일 수 있어 주소를 다시 확인합니다.
  const safe = (links ?? [])
    .map((link) => ({ label: String(link?.label ?? ""), url: safeUrl(link?.url) }))
    .filter((link) => link.url);

  if (safe.length === 0) return "";

  const embeds = safe
    .map((link) => {
      const video = youtubeId(link.url);
      if (video) {
        return `
          <div class="embed">
            <iframe src="https://www.youtube-nocookie.com/embed/${esc(video)}"
                    title="${esc(link.label)}" loading="lazy" allowfullscreen
                    referrerpolicy="strict-origin-when-cross-origin"></iframe>
          </div>`;
      }

      if (linkKind(link.url) === "image") {
        return `
          <a class="media" href="${esc(link.url)}" target="_blank" rel="noopener">
            <img src="${esc(link.url)}" alt="${esc(link.label)}" loading="lazy" />
          </a>`;
      }

      return "";
    })
    .join("");

  const list = safe
    .map(
      (link) => `
      <a class="attachment" href="${esc(link.url)}" target="_blank" rel="noopener">
        <span class="attachment__icon" aria-hidden="true">${linkIcon(link.url)}</span>
        <span class="attachment__name">${esc(link.label || link.url)}</span>
        <span class="attachment__go" aria-hidden="true">↗</span>
      </a>`
    )
    .join("");

  return `${embeds ? `<div class="media-grid">${embeds}</div>` : ""}<div class="attachments">${list}</div>`;
}

/** 글 머리에 붙는 작성 시각. */
export function renderPostMeta(post, extra = "") {
  const edited =
    post.updatedAt && post.createdAt && post.updatedAt !== post.createdAt ? " · 수정됨" : "";

  return `<span class="caption">${esc(relativeDate(post.createdAt))}${edited}${extra}</span>`;
}

/* =========================================================
   링크 입력 칸
   ========================================================= */
/** 모달 안에 넣을 첨부 링크 칸을 만듭니다. */
export function linkField(existing = [], { label = "첨부 링크" } = {}) {
  return `
    <div class="field">
      <label class="field__label" for="p-links">${esc(label)}</label>
      <textarea class="textarea" id="p-links" name="links" rows="4"
                placeholder="한 줄에 하나씩 주소를 붙여넣으세요.&#10;예) 진로체험 안내문 | https://drive.google.com/file/d/…">${esc(formatLinks(existing))}</textarea>
      <p class="caption">
        구글 드라이브·유튜브 등에 올린 뒤 주소를 붙여주세요. 유튜브 영상과 이미지는 화면에서 바로 보입니다.
        ‘제목 | 주소’ 로 적으면 그 제목으로 보이고, ${MAX_LINKS}개까지 붙일 수 있습니다.
        드라이브 파일은 <b>링크가 있는 모든 사용자</b>로 공유해 두어야 학생이 열 수 있습니다.
      </p>
    </div>`;
}
