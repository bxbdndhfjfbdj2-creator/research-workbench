import {
  createFileLinkAction,
  retireFileLinkAction,
} from "../../server/file-actions";
import type { FileLinkViewModel } from "../../server/queries";

export function FileLinkForm({
  projectId,
  fileVersionId,
  activeLinks,
}: {
  projectId: string;
  fileVersionId: string;
  activeLinks: FileLinkViewModel[];
}) {
  return (
    <section className="panel">
      <h3>科研对象关联</h3>
      <form action={createFileLinkAction}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="fileVersionId" value={fileVersionId} />
        <label>
          对象类型
          <select name="subjectType" defaultValue="project">
            <option value="project">项目</option>
            <option value="research_node_revision">研究节点版本</option>
            <option value="research_task">研究任务</option>
            <option value="research_result">研究结果</option>
            <option value="scientific_decision">科学决策</option>
            <option value="data_version">数据版本</option>
          </select>
        </label>
        <label>
          Stable ID
          <input name="subjectId" defaultValue={projectId} required />
        </label>
        <label>
          关系
          <select name="relation" defaultValue="documents">
            <option value="documents">documents</option>
            <option value="input_to">input_to</option>
            <option value="output_of">output_of</option>
            <option value="supports">supports</option>
            <option value="challenges">challenges</option>
            <option value="review_material">review_material</option>
            <option value="source_for">source_for</option>
          </select>
        </label>
        <button type="submit">创建关联</button>
      </form>

      {activeLinks.length > 0 ? (
        <ul>
          {activeLinks.map((link) => (
            <li key={link.id}>
              {link.relation} · {link.subjectType} · {link.subjectId}
              <form action={retireFileLinkAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="fileLinkId" value={link.id} />
                <input name="reason" required placeholder="退役原因" />
                <button type="submit">退役关联</button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
