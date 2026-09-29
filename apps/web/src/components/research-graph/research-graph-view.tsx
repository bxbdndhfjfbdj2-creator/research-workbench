import type { ResearchGraphViewModel } from "../../server/queries";

export function ResearchGraphView({ graph }: { graph: ResearchGraphViewModel }) {
  return (
    <div className="research-graph-layout">
      <section className="panel">
        <h3>研究节点</h3>
        <div className="graph-node-grid">
          {graph.nodes.map((node) => (
            <article className="graph-node-card" data-testid="research-node" key={node.id}>
              <div className="graph-node-heading">
                <span className="node-type">{node.type}</span>
                {node.isOfficial ? (
                  <span className="status-label official">正式</span>
                ) : node.revisionStatus ? (
                  <span className="status-label">{node.revisionStatus}</span>
                ) : null}
              </div>
              <h4>{node.title}</h4>
              <p className="meta">
                {node.revisionNumber ? `当前版本 · ${node.revisionNumber}` : "尚无版本"}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>研究关系</h3>
        <div className="relation-list">
          {graph.edges.length === 0 ? <p className="meta">尚无研究关系。</p> : null}
          {graph.edges.map((edge) => (
            <div className="relation-row" key={edge.id}>
              <span>{edge.fromTitle}</span>
              <strong>{edge.relation}</strong>
              <span>{edge.toTitle}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h3>科研分支</h3>
        <div className="branch-list">
          {graph.branches.length === 0 ? <p className="meta">尚无科研分支。</p> : null}
          {graph.branches.map((branch) => (
            <article className="branch-card" data-testid="research-branch" key={branch.id}>
              <div>
                <h4>{branch.name}</h4>
                <p className="meta">起点 · {branch.originTitle}</p>
              </div>
              <div>
                <span className="status-label">
                  {branch.status === "closed" ? "已关闭" : "开放"}
                </span>
              </div>
              {branch.closeReason ? (
                <p className="branch-reason">{branch.closeReason}</p>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
