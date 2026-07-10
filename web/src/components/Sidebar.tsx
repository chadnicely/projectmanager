import { useWorkspace } from "../store";

const initials = (n: string) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const visible = (o: { demo?: boolean }, demo: boolean) => demo || !o.demo;

export function Sidebar() {
  const { state, update } = useWorkspace();
  if (!state) return <aside className="sidebar" />;
  const demoOn = state.demo !== false;
  const spaces = state.spaces.filter((s) => visible(s, demoOn));
  const boards = state.boards
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.spaceId === state.activeSpace && visible(b, demoOn) && !b.archived);

  const switchSpace = (id: string) =>
    update((d) => {
      d.activeSpace = id;
      const idx = d.boards.findIndex((b) => b.spaceId === id && !b.archived);
      if (idx >= 0) d.activeBoard = idx;
    });

  return (
    <aside className="sidebar">
      <div className="sb-head">Workspaces</div>
      <div className="ws-list">
        {spaces.map((s) => (
          <div key={s.id} className={"ws-row" + (s.id === state.activeSpace ? " active" : "")} onClick={() => switchSpace(s.id)}>
            <span className="ws-sq" style={{ background: s.color || "#6b6b8a" }}>{initials(s.name)}</span>
            <span className="nm">{s.name}</span>
          </div>
        ))}
      </div>

      <div className="sb-head">Boards</div>
      <div className="board-list">
        {boards.length === 0 && <div className="sb-empty">No boards in this workspace yet.</div>}
        {boards.map(({ b, i }) => (
          <div key={i} className={"board-row" + (i === state.activeBoard ? " active" : "")}
            onClick={() => update((d) => { d.activeBoard = i; })}>
            <span className="ic">🗂</span><span className="nm">{b.name}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
