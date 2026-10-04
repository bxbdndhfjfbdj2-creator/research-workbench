const RULE = {
  id: 'leave-approval',
  name: '员工请假审批',
  text: '员工提交请假后，由直属负责人审批。',
};

export function createInitialState() {
  return {
    organization: {
      name: '星河公司',
      status: '运行正常',
    },
    members: {
      zhangsan: {
        name: '张三',
        role: '员工',
        manager: '李四',
        status: '在岗',
      },
      lisi: {
        name: '李四',
        role: '经理',
        status: '在岗',
      },
    },
    tasks: [],
    events: [],
    rules: [RULE],
  };
}

function copyState(state) {
  return structuredClone(state);
}

function appendEvent(state, title, detail) {
  state.events.push({
    id: `event-${state.events.length + 1}`,
    step: state.events.length + 1,
    title,
    detail,
  });
}

export function submitLeave(state) {
  if (state.members.zhangsan.status !== '在岗') {
    throw new Error('当前状态不能再次提交请假');
  }

  const next = copyState(state);
  next.members.zhangsan.status = '请假审批中';
  next.organization.status = '有 1 项待办';
  next.tasks.push({
    id: 'leave-task-1',
    type: '请假审批',
    title: '审批张三的请假申请',
    applicant: '张三',
    assignee: '李四',
    status: '待处理',
    decision: null,
    triggeredByRule: RULE.name,
  });
  appendEvent(next, '张三提交请假申请', '触发规则：员工请假审批');
  return next;
}

export function decideLeave(state, decision) {
  if (!['批准', '驳回'].includes(decision)) {
    throw new Error('审批结果只能是批准或驳回');
  }

  const task = state.tasks.find((item) => item.type === '请假审批' && item.status === '待处理');
  if (!task) {
    throw new Error('当前没有可审批的请假任务');
  }

  const next = copyState(state);
  const nextTask = next.tasks.find((item) => item.id === task.id);
  nextTask.status = '已完成';
  nextTask.decision = decision;
  next.members.zhangsan.status = decision === '批准' ? '请假已批准' : '请假已驳回';
  next.organization.status = '无待办任务';
  appendEvent(next, `李四${decision}请假`, `任务已完成：${nextTask.title}`);
  return next;
}

export function resetState() {
  return createInitialState();
}
