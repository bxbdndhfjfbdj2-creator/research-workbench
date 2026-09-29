import type { ProjectEvidenceViewModel } from "../../server/queries";

export function EvidenceResultsView({
  evidence,
}: {
  evidence: ProjectEvidenceViewModel;
}) {
  return (
    <div className="research-graph-layout">
      <section className="panel">
        <h3>不可变研究结果</h3>
        <div className="result-list">
          {evidence.results.length === 0 ? <p className="meta">尚无研究结果。</p> : null}
          {evidence.results.map((result) => (
            <article className="result-card" data-testid="research-result" key={result.id}>
              <div className="result-card-heading">
                <strong>{result.dataVersionRef}</strong>
                <span className="status-label">{result.executionKind === "code" ? "代码运行" : "人工运行"}</span>
              </div>
              <dl>
                <div><dt>分析方案</dt><dd>{result.analysisTitle}</dd></div>
                <div><dt>运行引用</dt><dd>{result.runRef}</dd></div>
                {result.gitRepositoryFullName ? (
                  <div><dt>代码仓库</dt><dd>{result.gitRepositoryFullName}</dd></div>
                ) : null}
                {result.gitCommitSha ? (
                  <div><dt>提交</dt><dd className="mono">{result.gitCommitSha}</dd></div>
                ) : null}
                <div><dt>输出</dt><dd>{result.outputRefs.join("、")}</dd></div>
                {result.supersededBy ? (
                  <div><dt>状态</dt><dd>已被新结果替代</dd></div>
                ) : null}
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>结果与研究节点的证据关系</h3>
        <div className="relation-list">
          {evidence.links.length === 0 ? <p className="meta">尚无证据关联。</p> : null}
          {evidence.links.map((link) => (
            <div className="relation-row" key={link.id}>
              <span className="mono">{link.resultId.slice(0, 8)}</span>
              <strong>{link.relation}</strong>
              <span>{link.nodeTitle}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
