import test from 'node:test';
import assert from 'node:assert/strict';
import { ORGANIZATION_MODEL } from '../src/model/organization-model.js';
import { createSeedWorld } from '../src/demo/seed-world.js';
import { createBrowserStore } from '../src/storage/browser-store.js';
import { createOrganizationApp } from '../src/app-controller.js';
import { getEntity, getRelations } from '../src/runtime/world.js';
import {
  hireMember, createDepartment, transferMember, createProject, joinProject,
  setOwner, leaveOrganization, endEntity,
} from '../src/model/organization-actions.js';

class FakeStorage { constructor(){this.map=new Map();} getItem(k){return this.map.get(k)??null;} setItem(k,v){this.map.set(k,String(v));} removeItem(k){this.map.delete(k);} }
function idFactory(){let n=0;return(prefix='id')=>`${prefix}-${++n}`;}
const now=(()=>{let n=0;return()=>`2026-10-04T12:00:${String(n++).padStart(2,'0')}.000Z`;})();

test('组织在固定模型上持续变化而无需重编译', () => {
  const storage=new FakeStorage();
  const store=createBrowserStore(storage,{key:'org',modelVersion:ORGANIZATION_MODEL.version});
  const app=createOrganizationApp({store,seedFactory:createSeedWorld,model:ORGANIZATION_MODEL,now,idFactory:idFactory()});
  let state=app.start();
  const initialVersion=state.world.modelVersion;

  state=app.dispatch(hireMember({name:'赵六'}));
  const zhaoliu=state.world.entities.find((e)=>e.name==='赵六');
  assert.ok(zhaoliu);

  state=app.dispatch(createDepartment({name:'人工智能部'}));
  const ai=state.world.entities.find((e)=>e.name==='人工智能部');
  assert.ok(ai);

  state=app.dispatch(transferMember({memberId:'member-zhangsan',fromDepartmentId:'dept-rd',toDepartmentId:ai.id}));
  state=app.dispatch(createProject({name:'火星计划'}));
  const mars=state.world.entities.find((e)=>e.name==='火星计划');
  state=app.dispatch(joinProject({memberId:'member-zhangsan',projectId:mars.id}));
  state=app.dispatch(joinProject({memberId:'member-wangwu',projectId:mars.id}));
  state=app.dispatch(setOwner({targetId:mars.id,currentOwnerIds:[],memberId:'member-wangwu'}));
  state=app.dispatch(leaveOrganization({memberId:'member-lisi',relations:state.world.relations}));
  const rdOwners=getRelations(state.world,{subjectId:'dept-rd',type:'负责人'}).map((r)=>r.objectId);
  state=app.dispatch(setOwner({targetId:'dept-rd',currentOwnerIds:rdOwners,memberId:'member-wangwu'}));
  state=app.dispatch(endEntity({entityId:mars.id,type:'项目组'}));

  assert.equal(state.world.modelVersion,'组织模型-0.1');
  assert.equal(state.world.modelVersion,initialVersion);
  assert.equal(getEntity(state.world,zhaoliu.id).states.任职状态,'在职');
  assert.equal(getRelations(state.world,{subjectId:'member-zhangsan',type:'属于',objectId:ai.id}).length,1);
  assert.equal(getRelations(state.world,{subjectId:'member-zhangsan',type:'参与',objectId:mars.id}).length,1);
  assert.equal(getEntity(state.world,'member-lisi').states.任职状态,'离职');
  assert.equal(getRelations(state.world,{objectId:'member-lisi',type:'负责人'}).length,0);
  assert.equal(getRelations(state.world,{subjectId:'dept-rd',type:'负责人',objectId:'member-wangwu'}).length,1);
  assert.equal(getEntity(state.world,mars.id).states.生命周期状态,'已结束');
  assert.ok(getEntity(state.world,mars.id));
  assert.equal(state.events.length,10);
  assert.ok(state.events.every((event)=>event.status==='成功'));

  const beforeFailure=structuredClone(state.world);
  state=app.dispatch(transferMember({memberId:'member-zhangsan',fromDepartmentId:ai.id,toDepartmentId:'missing-department'}));
  assert.equal(state.record.status,'失败');
  assert.deepEqual(state.world,beforeFailure);
  assert.equal(state.events.length,11);
  assert.equal(state.events.at(-1).status,'失败');

  const reloaded=createOrganizationApp({store,seedFactory:createSeedWorld,model:ORGANIZATION_MODEL,now,idFactory:idFactory()}).start();
  assert.deepEqual(reloaded.world,state.world);
  assert.deepEqual(reloaded.events,state.events);
});
