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
import { confirmDialog, emptyState, esc, relativeDate, toast } from "../ui.js";

export const meta = {
  id: "trash",
  icon: "🗑️",
  title: "휴지통",
  // 휴지통은 모든 자료를 훑어야 합니다.
  // 낸 사람 이름은 제출물 안에 함께 들어 있어 profiles 까지 볼 필요는 없습니다.
  needs: ["submissions", "portfolios"],
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
  const items = listTrash(session.role());
  const rerender = () => render(container);

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
        items.length
          ? `<div class="page-head__actions">
               <button class="btn btn--danger" data-empty>휴지통 비우기</button>
             </div>`
          : ""
      }
    </div>

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
          : emptyState({
              icon: "🗑️",
              title: "휴지통이 비어 있습니다",
              desc: "지운 자료가 여기에 모입니다.",
            })
      }
    </section>`;

  container.querySelectorAll("[data-restore]").forEach((button) =>
    button.addEventListener("click", async () => {
      const item = items[Number.parseInt(button.dataset.restore, 10)];
      if (!item) return;

      try {
        await restoreItem(item);
        toast(`${item.kind}을(를) 되살렸습니다.`, "success");
        rerender();
      } catch {
        // 오류 메시지는 데이터 계층이 토스트로 알립니다.
      }
    })
  );

  container.querySelectorAll("[data-purge]").forEach((button) =>
    button.addEventListener("click", async () => {
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
    })
  );

  container.querySelector("[data-empty]")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "휴지통 비우기",
      message: `${items.length}건을 모두 완전히 지울까요?\n되돌릴 수 없습니다.`,
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
