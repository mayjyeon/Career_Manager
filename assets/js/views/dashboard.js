/** 대시보드 — 관리 중인 학생 수, 누적 상담 수, 최근 상담 기록. */
import { studentService, counselingService } from "../services.js";
import {
  esc,
  formatDate,
  relativeDate,
  initials,
  categoryClass,
  emptyState,
} from "../ui.js";

export const meta = { id: "dashboard", icon: "🏠", title: "대시보드" };

function recentItem(session) {
  const name = session.student?.name ?? "(삭제된 학생)";

  return `
    <li class="recent__item">
      <div class="avatar" aria-hidden="true">${esc(initials(name))}</div>
      <div class="recent__body">
        <div class="recent__head">
          <span class="recent__name">${esc(name)}</span>
          <span class="badge ${categoryClass(session.category)}">${esc(session.category)}</span>
          <span class="recent__date" title="${esc(formatDate(session.sessionDate))}">
            ${esc(relativeDate(session.sessionDate))}
          </span>
        </div>
        <p class="recent__text">${esc(session.content)}</p>
      </div>
    </li>`;
}

export function render(container, { navigate }) {
  const totalStudents = studentService.getActiveCount();
  const totalSessions = counselingService.getTotalCount();
  const recent = counselingService.getRecent(8);

  container.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">대시보드</h1>
        <p class="page-subtitle">상담 현황을 한눈에 확인하세요.</p>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat">
        <div class="stat__icon" aria-hidden="true">👥</div>
        <div>
          <p class="stat__label">관리 중인 학생</p>
          <p class="stat__value">${totalStudents}<span class="stat__unit">명</span></p>
        </div>
      </div>
      <div class="stat">
        <div class="stat__icon stat__icon--success" aria-hidden="true">📝</div>
        <div>
          <p class="stat__label">누적 상담</p>
          <p class="stat__value">${totalSessions}<span class="stat__unit">건</span></p>
        </div>
      </div>
    </div>

    <section class="card">
      <div class="card__head">
        <h2 class="section-title">최근 상담 기록</h2>
        ${
          recent.length
            ? `<button class="btn btn--ghost btn--sm" data-go="counseling">상담일지 열기 →</button>`
            : ""
        }
      </div>
      ${
        recent.length
          ? `<ul class="recent" style="list-style:none;margin:0;padding:0">
               ${recent.map(recentItem).join("")}
             </ul>`
          : emptyState({
              icon: "🗒️",
              title: "아직 상담 기록이 없습니다",
              desc: "학생을 등록하고 첫 상담 기록을 남겨보세요.",
              action: `<button class="btn btn--primary" data-go="students">학생 등록하러 가기</button>`,
            })
      }
    </section>`;

  container.querySelectorAll("[data-go]").forEach((btn) =>
    btn.addEventListener("click", () => navigate(btn.dataset.go))
  );
}
