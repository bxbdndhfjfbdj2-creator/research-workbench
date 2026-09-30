import { registerExternalDataAction } from "../../server/file-actions";

export function ExternalReferenceForm({ projectId }: { projectId: string }) {
  return (
    <form action={registerExternalDataAction} className="panel">
      <h3>登记受控外部数据</h3>
      <input type="hidden" name="projectId" value={projectId} />
      <label>
        标题
        <input name="title" required />
      </label>
      <label>
        资料类型
        <select name="fileKind" defaultValue="dataset">
          <option value="dataset">数据集</option>
          <option value="data_documentation">数据文档</option>
          <option value="general_attachment">一般资料</option>
        </select>
      </label>
      <input type="hidden" name="accessClass" value="restricted" />
      <label>
        受控 locator
        <input name="uriOrLocator" required placeholder="secure-datalake://..." />
      </label>
      <label>
        Manifest hash
        <input name="manifestHash" required />
      </label>
      <label>
        Access policy ref
        <input name="accessPolicyRef" required />
      </label>
      <label>
        License / agreement ref
        <input name="licenseOrAgreementRef" />
      </label>
      <label>
        版本标签
        <input name="versionLabel" required />
      </label>
      <button type="submit">登记外部数据</button>
    </form>
  );
}
