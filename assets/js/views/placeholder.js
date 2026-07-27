/**
 * 준비 중인 화면(일정 · 통계).
 * 원본의 PlaceholderView / CalendarViewModel / StatisticsViewModel 과 동일하게
 * 자리만 잡아둔 화면입니다.
 */
import { emptyState } from "../ui.js";

function createPlaceholder({ id, icon, title, message }) {
  return {
    meta: { id, icon, title },
    render(container) {
      container.innerHTML = `
        <div class="page-head">
          <div>
            <h1 class="page-title">${title}</h1>
            <p class="page-subtitle">다음 단계에서 추가될 기능입니다.</p>
          </div>
        </div>
        <section class="card">
          ${emptyState({ icon, title: "준비 중인 기능입니다", desc: message })}
        </section>`;
    },
  };
}

export const calendar = createPlaceholder({
  id: "calendar",
  icon: "📅",
  title: "일정",
  message: "캘린더 기반 상담 일정 관리는 다음 단계에서 추가될 예정입니다.",
});

export const statistics = createPlaceholder({
  id: "statistics",
  icon: "📊",
  title: "통계",
  message: "상담 통계와 내담자별 보고서는 다음 단계에서 추가될 예정입니다.",
});
