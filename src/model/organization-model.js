export const ORGANIZATION_MODEL = {
  version: '组织模型-0.1',
  entityTypes: ['成员', '部门', '项目组'],
  relationTypes: {
    属于: { subjects: ['成员'], objects: ['部门'] },
    参与: { subjects: ['成员'], objects: ['项目组'] },
    负责人: { subjects: ['部门', '项目组'], objects: ['成员'] },
  },
  stateSlots: {
    成员: { 任职状态: ['在职', '离职'] },
    部门: { 生命周期状态: ['运行中', '已结束'] },
    项目组: { 生命周期状态: ['运行中', '已结束'] },
  },
};
