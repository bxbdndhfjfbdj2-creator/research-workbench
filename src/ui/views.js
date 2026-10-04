import { getEntitiesByType, getEntity, getRelations } from '../runtime/world.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function name(world, id) { return escapeHtml(getEntity(world, id)?.name || id); }
function state(entity, slot) { return entity?.states?.[slot] || '未设置'; }
function empty(text) { return `<div class="empty-state">${escapeHtml(text)}</div>`; }
function entityCard(entity, subtitle='') {
  const slot = entity.type === '成员' ? '任职状态' : '生命周期状态';
  return `<button class="entity-card" type="button" data-select-id="${escapeHtml(entity.id)}" data-select-type="${escapeHtml(entity.type)}"><span><strong>${escapeHtml(entity.name)}</strong><small>${escapeHtml(subtitle || entity.type)}</small></span><em>${escapeHtml(state(entity, slot))}</em></button>`;
}
function listNames(world, relations, side) {
  return relations.map((r) => name(world, side === 'subject' ? r.subjectId : r.objectId)).join('、') || '无';
}
function recentFor(events, entityId) {
  return events.filter((event) => JSON.stringify(event.params || {}).includes(entityId) || JSON.stringify(event.changes || {}).includes(entityId)).slice(-5).reverse();
}

export function renderOverview(world, events) {
  const members = getEntitiesByType(world, '成员').filter((e) => state(e, '任职状态') === '在职');
  const departments = getEntitiesByType(world, '部门').filter((e) => state(e, '生命周期状态') === '运行中');
  const projects = getEntitiesByType(world, '项目组').filter((e) => state(e, '生命周期状态') === '运行中');
  const latest = [...events].slice(-5).reverse();
  return `<section class="view-head"><div><p class="kicker">当前世界</p><h2>组织总览</h2><p>这里显示的是运行中的组织状态，而不是编译进页面的固定结构。</p></div></section>
  <div class="metric-grid"><article><span>在职成员</span><strong>${members.length}</strong></article><article><span>运行部门</span><strong>${departments.length}</strong></article><article><span>运行项目</span><strong>${projects.length}</strong></article><article><span>事件总数</span><strong>${events.length}</strong></article></div>
  <section class="content-card"><h3>最近事件</h3>${latest.length ? latest.map((e)=>`<div class="timeline-row"><span class="status-dot ${e.status==='失败'?'bad':''}"></span><div><strong>${escapeHtml(e.type)}</strong><small>${escapeHtml(e.status)} · ${escapeHtml(e.occurredAt)}</small></div></div>`).join('') : empty('还没有运行事件。')}</section>`;
}

export function renderPeople(world, events, { selectedId } = {}) {
  const people = getEntitiesByType(world, '成员');
  const selected = selectedId ? getEntity(world, selectedId) : null;
  let detail = '';
  if (selected?.type === '成员') {
    const depts = getRelations(world, { subjectId:selected.id, type:'属于' });
    const projects = getRelations(world, { subjectId:selected.id, type:'参与' });
    const owns = getRelations(world, { objectId:selected.id, type:'负责人' });
    const recent = recentFor(events, selected.id);
    detail = `<aside class="detail-card"><p class="kicker">人员详情</p><h3>${escapeHtml(selected.name)}</h3><dl><dt>任职状态</dt><dd>${escapeHtml(state(selected,'任职状态'))}</dd><dt>所属部门</dt><dd>${listNames(world,depts,'object')}</dd><dt>参与项目</dt><dd>${listNames(world,projects,'object')}</dd><dt>负责对象</dt><dd>${listNames(world,owns,'subject')}</dd></dl><h4>相关事件</h4>${recent.length?recent.map(e=>`<p class="mini-event">${escapeHtml(e.type)} · ${escapeHtml(e.status)}</p>`).join(''):empty('暂无相关事件')}</aside>`;
  }
  return `<section class="view-head"><div><p class="kicker">成员</p><h2>人员</h2><p>人员归属、项目参与和负责人关系彼此独立。</p></div></section><div class="split-view"><div class="entity-list">${people.length?people.map((person)=>entityCard(person)).join(''):empty('暂无成员')}</div>${detail}</div>`;
}

export function renderDepartments(world, events, { selectedId } = {}) {
  const departments = getEntitiesByType(world, '部门');
  const selected = selectedId ? getEntity(world, selectedId) : null;
  let detail='';
  if(selected?.type==='部门'){
    const members=getRelations(world,{type:'属于',objectId:selected.id});
    const owners=getRelations(world,{subjectId:selected.id,type:'负责人'});
    detail=`<aside class="detail-card"><p class="kicker">部门详情</p><h3>${escapeHtml(selected.name)}</h3><dl><dt>生命周期</dt><dd>${escapeHtml(state(selected,'生命周期状态'))}</dd><dt>负责人</dt><dd>${listNames(world,owners,'object')}</dd><dt>成员</dt><dd>${listNames(world,members,'subject')}</dd></dl></aside>`;
  }
  return `<section class="view-head"><div><p class="kicker">组织单元</p><h2>部门</h2><p>部门是运行时存在，可以随组织变化创建、结束和更换负责人。</p></div></section><div class="split-view"><div class="entity-list">${departments.length?departments.map((d)=>entityCard(d,`${getRelations(world,{type:'属于',objectId:d.id}).length} 名成员`)).join(''):empty('暂无部门')}</div>${detail}</div>`;
}

export function renderProjects(world, events, { selectedId } = {}) {
  const projects=getEntitiesByType(world,'项目组');
  const selected=selectedId?getEntity(world,selectedId):null;
  let detail='';
  if(selected?.type==='项目组'){
    const participants=getRelations(world,{type:'参与',objectId:selected.id});
    const owners=getRelations(world,{subjectId:selected.id,type:'负责人'});
    const participantLines=participants.map((r)=>{
      const member=getEntity(world,r.subjectId);
      const depts=getRelations(world,{subjectId:r.subjectId,type:'属于'});
      return `<li><strong>${escapeHtml(member?.name||r.subjectId)}</strong><span>${listNames(world,depts,'object')}</span></li>`;
    }).join('');
    detail=`<aside class="detail-card"><p class="kicker">项目详情</p><h3>${escapeHtml(selected.name)}</h3><dl><dt>生命周期</dt><dd>${escapeHtml(state(selected,'生命周期状态'))}</dd><dt>负责人</dt><dd>${listNames(world,owners,'object')}</dd></dl><h4>跨部门参与成员</h4><ul class="participant-list">${participantLines||'<li>暂无参与成员</li>'}</ul></aside>`;
  }
  return `<section class="view-head"><div><p class="kicker">横向协作</p><h2>项目</h2><p>项目与部门平级存在，可以跨部门连接成员。</p></div></section><div class="split-view"><div class="entity-list">${projects.length?projects.map((p)=>entityCard(p,`${getRelations(world,{type:'参与',objectId:p.id}).length} 名参与者`)).join(''):empty('暂无项目')}</div>${detail}</div>`;
}

export function renderRelations(world) {
  if(!world.relations.length) return `<section class="view-head"><div><p class="kicker">关系图</p><h2>关系</h2></div></section>${empty('暂无关系')}`;
  return `<section class="view-head"><div><p class="kicker">关系图</p><h2>关系</h2><p>底层真相是关系图，而不是一棵固定组织树。</p></div></section><div class="relation-list">${world.relations.map((r)=>`<div class="relation-row">${name(world,r.subjectId)} —${escapeHtml(r.type)}→ ${name(world,r.objectId)}</div>`).join('')}</div>`;
}

export function renderEvents(events) {
  return `<section class="view-head"><div><p class="kicker">审计历史</p><h2>事件</h2><p>成功和失败的组织变更都会留下记录。</p></div></section><div class="event-feed">${events.length?[...events].reverse().map((e)=>`<article class="event-entry ${e.status==='失败'?'failed':''}"><div><strong>${escapeHtml(e.type)}</strong><span>${escapeHtml(e.status)}</span></div><small>${escapeHtml(e.occurredAt||'')}</small>${e.error?`<p>${escapeHtml(e.error)}</p>`:''}<details><summary>查看变化</summary><pre>${escapeHtml(JSON.stringify(e.changes||[],null,2))}</pre></details></article>`).join(''):empty('暂无事件')}</div>`;
}

export function renderPolicy(model) {
  const relations=Object.entries(model.relationTypes).map(([type,rule])=>`<li><strong>${escapeHtml(type)}</strong>：${rule.subjects.map(escapeHtml).join(' / ')} → ${rule.objects.map(escapeHtml).join(' / ')}</li>`).join('');
  return `<section class="view-head"><div><p class="kicker">稳定层</p><h2>制度与组织模型</h2><p>日常人员、部门和项目变化不会修改这里。</p></div></section><section class="content-card"><h3>${escapeHtml(model.version)}</h3><p>存在类型：${model.entityTypes.map(escapeHtml).join('、')}</p><h4>关系约束</h4><ul>${relations}</ul></section>`;
}
