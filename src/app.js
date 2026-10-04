import { ORGANIZATION_MODEL } from './model/organization-model.js';
import { createSeedWorld } from './demo/seed-world.js';
import { createBrowserStore, StorageError } from './storage/browser-store.js';
import { createOrganizationApp } from './app-controller.js';
import { getEntitiesByType, getRelations } from './runtime/world.js';
import {
  hireMember, createDepartment, createProject, assignDepartment, removeDepartmentMember,
  transferMember, joinProject, leaveProject, setOwner, leaveOrganization, endEntity,
} from './model/organization-actions.js';
import { renderOverview, renderPeople, renderDepartments, renderProjects, renderRelations, renderEvents, renderPolicy, escapeHtml } from './ui/views.js';

const store = createBrowserStore(window.localStorage, { key: 'organization-runtime-v0.1', modelVersion: ORGANIZATION_MODEL.version });
const idFactory = (prefix='id') => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const controller = createOrganizationApp({ store, seedFactory:createSeedWorld, model:ORGANIZATION_MODEL, now:()=>new Date().toISOString(), idFactory });
let current = null;
let currentView = 'overview';
let selectedId = null;

const el = {
  worldName: document.querySelector('#world-name'), modelVersion: document.querySelector('#model-version'), nav: document.querySelector('#main-nav'),
  root: document.querySelector('#view-root'), notice: document.querySelector('#notice'), panel: document.querySelector('#operation-panel'),
  toggle: document.querySelector('#toggle-operations'), close: document.querySelector('#close-operations'), form: document.querySelector('#operation-form'),
  type: document.querySelector('#operation-type'), fields: document.querySelector('#operation-fields'), reset: document.querySelector('#reset-button'),
};

const actionLabels = {
  hire:'成员入职', createDepartment:'创建部门', assignDepartment:'成员加入部门', removeDepartment:'成员移出部门', transfer:'人员调岗',
  createProject:'创建项目', joinProject:'成员加入项目', leaveProject:'成员退出项目', owner:'更换负责人', leaveOrg:'成员离职', end:'结束部门或项目',
};

function options(entities, placeholder='请选择') { return `<option value="">${placeholder}</option>${entities.map((e)=>`<option value="${escapeHtml(e.id)}">${escapeHtml(e.name)}</option>`).join('')}`; }
function active(type){ return getEntitiesByType(current.world,type).filter((e)=>e.states?.任职状态!=='离职'&&e.states?.生命周期状态!=='已结束'); }
function field(label, body){return `<label>${label}${body}</label>`;}
function select(name, entities, placeholder){return `<select name="${name}" required>${options(entities,placeholder)}</select>`;}
function text(name, placeholder){return `<input name="${name}" autocomplete="off" required placeholder="${placeholder}">`;}

function renderOperationFields(){
  if(!current) return;
  const members=active('成员'), departments=active('部门'), projects=active('项目组');
  const type=el.type.value;
  const map={
    hire: field('成员姓名',text('name','例如：赵六')),
    createDepartment: field('部门名称',text('name','例如：人工智能部')),
    createProject: field('项目名称',text('name','例如：火星计划')),
    assignDepartment: field('成员',select('memberId',members,'选择成员'))+field('部门',select('departmentId',departments,'选择部门')),
    removeDepartment: field('成员',select('memberId',members,'选择成员'))+field('部门',select('departmentId',departments,'选择部门')),
    transfer: field('成员',select('memberId',members,'选择成员'))+field('原部门',select('fromDepartmentId',departments,'选择原部门'))+field('目标部门',select('toDepartmentId',departments,'选择目标部门')),
    joinProject: field('成员',select('memberId',members,'选择成员'))+field('项目',select('projectId',projects,'选择项目')),
    leaveProject: field('成员',select('memberId',members,'选择成员'))+field('项目',select('projectId',projects,'选择项目')),
    owner: field('对象',select('targetId',[...departments,...projects],'选择部门或项目'))+field('新负责人',select('memberId',members,'选择成员')),
    leaveOrg: field('成员',select('memberId',members,'选择成员')),
    end: field('对象',select('entityId',[...departments,...projects],'选择部门或项目')),
  };
  el.fields.innerHTML=map[type]||'';
}

function setNotice(message, kind='info'){
  if(!message){el.notice.hidden=true;el.notice.textContent='';return;}
  el.notice.hidden=false;el.notice.className=`notice ${kind}`;el.notice.textContent=message;
}

function render(){
  if(!current) return;
  el.worldName.textContent=current.world.name;
  el.modelVersion.textContent=ORGANIZATION_MODEL.version;
  const props={selectedId};
  const views={
    overview:()=>renderOverview(current.world,current.events), people:()=>renderPeople(current.world,current.events,props),
    departments:()=>renderDepartments(current.world,current.events,props), projects:()=>renderProjects(current.world,current.events,props),
    relations:()=>renderRelations(current.world), events:()=>renderEvents(current.events), policy:()=>renderPolicy(ORGANIZATION_MODEL),
  };
  el.root.innerHTML=(views[currentView]||views.overview)();
  el.nav.querySelectorAll('[data-view]').forEach((button)=>button.classList.toggle('active',button.dataset.view===currentView));
  renderOperationFields();
}

function buildEvent(data){
  const type=data.get('type');
  const p=(name)=>data.get(name);
  if(type==='hire') return hireMember({name:p('name').trim()});
  if(type==='createDepartment') return createDepartment({name:p('name').trim()});
  if(type==='createProject') return createProject({name:p('name').trim()});
  if(type==='assignDepartment') return assignDepartment({memberId:p('memberId'),departmentId:p('departmentId')});
  if(type==='removeDepartment') return removeDepartmentMember({memberId:p('memberId'),departmentId:p('departmentId')});
  if(type==='transfer') return transferMember({memberId:p('memberId'),fromDepartmentId:p('fromDepartmentId'),toDepartmentId:p('toDepartmentId')});
  if(type==='joinProject') return joinProject({memberId:p('memberId'),projectId:p('projectId')});
  if(type==='leaveProject') return leaveProject({memberId:p('memberId'),projectId:p('projectId')});
  if(type==='owner') {
    const targetId=p('targetId');
    const currentOwnerIds=getRelations(current.world,{subjectId:targetId,type:'负责人'}).map((r)=>r.objectId);
    return setOwner({targetId,currentOwnerIds,memberId:p('memberId')});
  }
  if(type==='leaveOrg') return leaveOrganization({memberId:p('memberId'),relations:current.world.relations});
  if(type==='end') {
    const entityId=p('entityId');
    const entity=current.world.entities.find((e)=>e.id===entityId);
    return endEntity({entityId,type:entity.type});
  }
  throw new Error('未知操作');
}

el.type.innerHTML=Object.entries(actionLabels).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
el.type.addEventListener('change',renderOperationFields);
el.nav.addEventListener('click',(event)=>{const button=event.target.closest('[data-view]');if(!button)return;currentView=button.dataset.view;selectedId=null;render();});
el.root.addEventListener('click',(event)=>{const card=event.target.closest('[data-select-id]');if(!card)return;selectedId=card.dataset.selectId;render();});
el.toggle.addEventListener('click',()=>el.panel.classList.add('open'));
el.close.addEventListener('click',()=>el.panel.classList.remove('open'));
el.form.addEventListener('submit',(event)=>{event.preventDefault();try{const ev=buildEvent(new FormData(el.form));current=controller.dispatch(ev);setNotice(current.record.status==='成功'?`${current.record.type}：执行成功`:`${current.record.type}：${current.record.error}`,current.record.status==='成功'?'success':'error');render();}catch(error){setNotice(error.message,'error');}});
el.reset.addEventListener('click',()=>{if(!window.confirm('确认重置演示？当前浏览器中的组织变化和事件历史将被清空。'))return;current=controller.reset();selectedId=null;currentView='overview';setNotice('演示已重置','success');render();});

try { current=controller.start(); render(); }
catch(error){ setNotice(error instanceof StorageError ? `${error.message}。请使用“重置演示”显式清理。` : error.message,'error'); }
