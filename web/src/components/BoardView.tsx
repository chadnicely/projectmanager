import { useWorkspace } from "../store";
import type { Board, Card, Group, Person } from "../types";

const initials = (n: string) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

function colColor(board: Board, key?: string) {
  return board.columns?.find((c) => c.key === key)?.color || "#3b5bdb";
}
function labelDefs(board: Board, ids?: string[]) {
  const defs = board.labelDefs || [];
  return (ids || []).map((id) => defs.find((d) => d.id === id)).filter(Boolean) as { id: string; name: string; color: string }[];
}
function Avatars({ ids, people }: { ids?: string[]; people: Person[] }) {
  const list = (ids || []).map((id) => people.find((p) => p.id === id)).filter(Boolean) as Person[];
  if (!list.length) return null;
  return (
    <span className="avatars">
      {list.map((p) => (
        <span key={p.id} className="av" style={{ background: p.color || "#6b6b8a" }} title={p.name}>{p.me ? "🧔" : initials(p.name)}</span>
      ))}
    </span>
  );
}

function CardRow({ board, card, people }: { board: Board; card: Card; people: Person[] }) {
  const labels = labelDefs(board, card.labels);
  return (
    <tr className="card-row">
      <td className="c-name">
        <span>{card.name}</span>
        {labels.length > 0 && (
          <span className="chips">
            {labels.map((l) => (<span key={l.id} className="chip" style={{ background: l.color }}>{l.name || " "}</span>))}
          </span>
        )}
      </td>
      <td className="c-status">
        {card.status ? <span className="pill" style={{ background: colColor(board, card.status) }}>{card.status}</span> : <span className="muted">—</span>}
      </td>
      <td className="c-assignees"><Avatars ids={card.assignees} people={people} /></td>
      <td className="c-meta">
        {(card.commentList?.length ?? 0) > 0 && <span className="badge">💬 {card.commentList!.length}</span>}
        {(card.fileList?.length ?? 0) > 0 && <span className="badge">📎 {card.fileList!.length}</span>}
      </td>
    </tr>
  );
}

export function BoardView() {
  const { state } = useWorkspace();
  if (!state) return null;
  const demoOn = state.demo !== false;
  const board = state.boards[state.activeBoard];
  const inSpace = board && board.spaceId === state.activeSpace && (demoOn || !board.demo) && !board.archived;

  if (!board || !inSpace) {
    return (
      <div className="empty">
        <h2>No board selected</h2>
        <p>Pick a board on the left, or this workspace has none yet.</p>
      </div>
    );
  }

  const groups: Group[] = board.groups.filter((g) => (demoOn || !g.demo) && !g.archived);

  return (
    <div className="board-view">
      <div className="board-head"><h1>{board.name}</h1></div>
      {groups.map((g) => (
        <section key={g.id} className="group">
          <div className="group-head" style={{ ["--gc" as string]: g.color || "#868e9c" }}>
            <span className="dot" style={{ background: g.color || "#868e9c" }} />
            <span className="g-name">{g.name}</span>
            <span className="count">{g.items.length}</span>
          </div>
          <table className="cards">
            <tbody>
              {g.items.map((c) => (<CardRow key={c.id} board={board} card={c} people={state.people} />))}
              {g.items.length === 0 && <tr><td className="muted empty-row">No cards</td></tr>}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
