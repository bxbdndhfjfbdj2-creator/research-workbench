import {
  createInitialState,
  submitLeave,
  decideLeave,
  resetState,
} from './engine.js';

let state = createInitialState();

const elements = {
  organizationStatus: document.querySelector('#organization-status'),
  membersList: document.querySelector('#members-list'),
  tasksList: document.querySelector('#tasks-list'),
  eventsList: document.querySelector('#events-list'),
  rulesList: document.querySelector('#rules-list'),
  taskCount: document.querySelector('#task-count'),
  eventCount: document.querySelector('#event-count'),
  submitLeaveButton: document.querySelector('#submit-leave-button'),
  submitHint: document.querySelector('#submit-hint'),
  resetButton: document.querySelector('#reset-button'),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderMembers() {
  elements.membersList.innerHTML = Object.values(state.members).map((member) => `
    <section class="member-card">
      <div class="member-top">
        <span class="member-name">${escapeHtml(member.name)}</span>
        <span class="state-pill">${escapeHtml(member.status)}</span>
      </div>
      <span class="role-pill">${escapeHtml(member.role)}</span>
      <p class="member-meta">${member.manager ? `直属负责人：${escapeHtml(member.manager)}` : '负责团队审批与管理'}</p>
    </section>
  `).join('');
}

function renderTasks() {
  const activeTasks = state.tasks.filter((task) => task.status === '待处理');
  elements.taskCount.textContent = `${activeTasks.length} 项`;

  if (state.tasks.length === 0) {
    elements.tasksList.innerHTML = '<div class="empty-state">当前没有待办任务。<br>提交一次请假，看看规则如何产生任务。</div>';
    return;
  }

  elements.tasksList.innerHTML = state.tasks.map((task) => `
    <section class="task-card ${task.status === '待处理' ? 'active' : ''}">
      <div class="task-title">${escapeHtml(task.title)}</div>
      <p class="task-meta">负责人：${escapeHtml(task.assignee)} · 状态：${escapeHtml(task.status)}${task.decision ? ` · 结果：${escapeHtml(task.decision)}` : ''}</p>
      <div class="task-rule">由规则“${escapeHtml(task.triggeredByRule)}”自动产生</div>
      ${task.status === '待处理' ? `
        <div class="task-actions">
          <button class="button button-approve" type="button" data-decision="批准">批准</button>
          <button class="button button-reject" type="button" data-decision="驳回">驳回</button>
        </div>
      ` : ''}
    </section>
  `).join('');
}

function renderEvents() {
  elements.eventCount.textContent = `${state.events.length} 条`;

  if (state.events.length === 0) {
    elements.eventsList.innerHTML = '<div class="empty-state">还没有事件发生。<br>组织目前处于初始状态。</div>';
    return;
  }

  elements.eventsList.innerHTML = state.events.map((event) => `
    <section class="event-card">
      <span class="event-step">${event.step}</span>
      <div class="event-title">${escapeHtml(event.title)}</div>
      <p class="event-detail">${escapeHtml(event.detail)}</p>
    </section>
  `).join('');
}

function renderRules() {
  elements.rulesList.innerHTML = state.rules.map((rule) => `
    <div>
      <div class="rule-name">${escapeHtml(rule.name)}</div>
      <p class="rule-text">若员工提交请假，则由直属负责人审批；审批完成后，任务结束并形成新的组织事件。</p>
    </div>
  `).join('');
}

function renderActions() {
  const canSubmit = state.members.zhangsan.status === '在岗';
  elements.submitLeaveButton.disabled = !canSubmit;
  elements.submitHint.textContent = canSubmit
    ? '点击后会触发组织规则。'
    : '当前流程已经开始；可在任务栏继续处理。';
}

function render() {
  elements.organizationStatus.textContent = state.organization.status;
  renderMembers();
  renderTasks();
  renderEvents();
  renderRules();
  renderActions();
}

elements.submitLeaveButton.addEventListener('click', () => {
  try {
    state = submitLeave(state);
    render();
  } catch (error) {
    elements.submitHint.textContent = error.message;
  }
});

elements.tasksList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-decision]');
  if (!button) return;

  try {
    state = decideLeave(state, button.dataset.decision);
    render();
  } catch (error) {
    elements.tasksList.insertAdjacentHTML('afterbegin', `<p class="hint">${escapeHtml(error.message)}</p>`);
  }
});

elements.resetButton.addEventListener('click', () => {
  state = resetState(state);
  render();
});

render();
