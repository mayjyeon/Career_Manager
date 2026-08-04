/** 휴지통 — 지운 자료를 되살리거나 완전히 지웁니다. */
import { session } from "../board.js";
import {
  TRASH_DAYS,
  daysLeft,
  emptyTrash,
  listTrash,
  purgeExpired,
  purgeItem,
  restoreItem,
} from "../trash.js";
import { TEACHER } from "../roles.js";
import { FIELDS, bindSearchBar, createFilter, hasFilter, matches, searchBar } from "./search-bar.js";
import { confirmDialog, emptyState, esc, on, relativeDate, toast } from "../ui.js";

export const meta = {
  id: "trash",
  icon: "🗑️",
  title: "휴지통",
  // 휴지통은 모든 자료를 훑어야 합니다.
  // 낸 사람 이름은 제출물 안에 함께 들어 있어 profiles 까지 볼 필요는 없습니다.
  needs: ["submissions", "portfolios"],
  // 선생님이 등록한 포트폴리오도 휴지통을 거칩니다.
  owns: ["portfolios"],
};

// 보관 기간이 지난 것 정리는 이 화면을 열 때 한 번만 합니다.
// 로그인할 때마다 하면 아직 구독하지도 않은 자료까지 훑게 됩니다.
let purged = false;

const KIND_BADGE = {
  "학생": "badge--danger",
  "상담 기록": "",
  "공지": "badge--muted",
  "과제": "badge--muted",
  "제출물": "badge--muted",
  "포트폴리오": "badge--muted",
};

/** 화면을 다시 그려도 검색 조건은 유지합니다. */
const KIND_FIELD = {
  name: "kind",
  label: "종류",
  options: [
    ["", "전체"],
    ...Object.keys(KIND_BADGE).map((kind) => [kind, kind]),
  ],
};

const SEARCH_FIELDS = [
  KIND_FIELD,
  { ...FIELDS.keyword, placeholder: "내용·이름으로 검색" },
];

const filter = createFilter(SEARCH_FIELDS);

const keep = (item) =>
  (!filter.kind || item.kind === filter.kind) &&
  matches(filter.keyword, item.title, item.detail);

function row(item, index) {
  const left = daysLeft(item.deletedAt);

  return `
    <tr>
      <td><span class="badge ${KIND_BADGE[item.kind] ?? ""}">${esc(item.kind)}</span></td>
      <td>
        ${esc(item.title)}
        ${item.detail ? `<div class="caption">${esc(item.detail)}</div>` : ""}
      </td>
      <td class="nowrap caption">${esc(relativeDate(item.deletedAt))}</td>
      <td class="nowrap caption">${left === 0 ? "곧 정리됨" : `${left}일 남음`}</td>
      <td class="actions">
        <button class="btn btn--secondary btn--sm" data-restore="${index}">되살리기</button>
        <button class="btn btn--danger btn--sm" data-purge="${index}">완전 삭제</button>
      </td>
    </tr>`;
}

export function render(container) {
  const all = listTrash(session.role());
  const items = all.filter(keep);
  const filtered = hasFilter(filter);
  const rerender = () => render(container);

  // 학생은 공지·과제·제출물·포트폴리오만 지울 수 있어 종류를 고를 일이 적습니다.
  const fields =
    session.role() === TEACHER
      ? SEARCH_FIELDS
      : SEARCH_FIELDS.filter((field) => field.name !== "kind");

  if (!purged) {
    purged = true;
    // 서버가 따로 없어 보관 기간이 지난 것은 이때 정리합니다.
    purgeExpired(session.role())
      .then((count) => {
        if (count) rerender();
      })
      .catch(() => {});
  }

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">휴지통</h1>
        <p class="page-subtitle">
          지운 자료는 ${TRASH_DAYS}일 동안 보관하다가 자동으로 정리됩니다.
        </p>
      </div>
      ${
        all.length
          ? `<div class="page-head__actions">
               <button class="btn btn--danger" data-empty>휴지통 비우기</button>
             </div>`
          : ""
      }
    </div>

    ${
      all.length
        ? `<section class="card" style="margin-bottom:16px">
             ${searchBar({ id: "trash", filter, fields })}
           </section>`
        : ""
    }

    <section class="card card--flush">
      ${
        items.length
          ? `<div class="table-wrap">
               <table class="table table--compact">
                 <thead>
                   <tr>
                     <th>종류</th><th>내용</th><th>지운 때</th><th>남은 기간</th>
                     <th class="actions">관리</th>
                   </tr>
                 </thead>
                 <tbody>${items.map(row).join("")}</tbody>
               </table>
             </div>`
          : emptyState(
              filtered
                ? {
                    icon: "🔍",
                    title: "조건에 맞는 자료가 없습니다",
                    desc: "검색 조건을 바꾸거나 초기화해 보세요.",
                    action: `<button class="btn btn--secondary" data-search-reset="trash">검색 조건 초기화</button>`,
                  }
                : {
                    icon: "🗑️",
                    title: "휴지통이 비어 있습니다",
                    desc: "지운 자료가 여기에 모입니다.",
                  }
            )
      }
    </section>`;

  bindSearchBar(container, { id: "trash", filter, fields, onChange: rerender });

  on(container, "[data-restore]", async (button) => {
    const item = items[Number.parseInt(button.dataset.restore, 10)];
    if (!item) return;

    try {
      await restoreItem(item);
      toast(`${item.kind}을(를) 되살렸습니다.`, "success");
      rerender();
    } catch {
      // 오류 메시지는 데이터 계층이 토스트로 알립니다.
    }
  });

  on(container, "[data-purge]", async (button) => {
    const item = items[Number.parseInt(button.dataset.purge, 10)];
    if (!item) return;

    const ok = await confirmDialog({
      title: "완전 삭제",
      message: `‘${item.title}’ 을(를) 완전히 지울까요?\n되돌릴 수 없습니다.`,
      confirmLabel: "완전 삭제",
    });
    if (!ok) return;

    try {
      await purgeItem(item);
      toast("완전히 지웠습니다.");
      rerender();
    } catch {
      // 오류 메시지는 데이터 계층이 토스트로 알립니다.
    }
  });

  on(container, "[data-empty]", async () => {
    const ok = await confirmDialog({
      title: "휴지통 비우기",
      message:
        `${all.length}건을 모두 완전히 지울까요?` +
        (filtered ? " 검색 조건과 상관없이 휴지통 전체를 지웁니다." : "") +
        "\n되돌릴 수 없습니다.",
      confirmLabel: "모두 삭제",
    });
    if (!ok) return;

    try {
      await emptyTrash(session.role());
      toast("휴지통을 비웠습니다.");
      rerender();
    } catch {
      // 오류 메시지는 데이터 계층이 토스트로 알립니다.
    }
  });
}
