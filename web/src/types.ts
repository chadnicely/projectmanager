// Workspace data shapes — mirror the existing app's state so the same backend works unchanged.

export interface LabelDef { id: string; name: string; color: string; }
export interface Comment { id: number | string; author: string; at: string; text: string; }
export interface FileRec { id: number | string; name: string; type?: string; dataUrl?: string | null; size?: number; }
export interface ChecklistItem { id: number | string; name: string; done: boolean; }
export interface Checklist { id: number | string; name: string; items: ChecklistItem[]; }

export interface Card {
  id: number | string;
  name: string;
  status?: string;
  created?: string;
  createdAt?: number;
  assignees?: string[];
  labels?: string[];
  description?: string;
  cover?: string | null;
  urls?: { id: number | string; url: string }[];
  commentList?: Comment[];
  fileList?: FileRec[];
  checklists?: Checklist[];
  archived?: boolean;
  demo?: boolean;
}

export interface Group {
  id: string;
  name: string;
  color?: string;
  collapsed?: boolean;
  items: Card[];
  members?: { people: string[]; teams: string[] };
  archived?: boolean;
  demo?: boolean;
}

export interface Column { key: string; color: string; }

export interface Board {
  name: string;
  spaceId: string;
  columns: Column[];
  groups: Group[];
  labelDefs?: LabelDef[];
  members?: { people: string[]; teams: string[] };
  archived?: boolean;
  demo?: boolean;
}

export interface Space { id: string; name: string; color?: string; demo?: boolean; }
export interface Person { id: string; name: string; email?: string; color?: string; me?: boolean; role?: string; demo?: boolean; }
export interface Team { id: string; name: string; members?: string[]; }

export interface WorkspaceState {
  boards: Board[];
  spaces: Space[];
  activeSpace: string;
  activeBoard: number;
  people: Person[];
  teams: Team[];
  base?: unknown;
  timeEntries?: unknown[];
  demo?: boolean;
  nextId?: number;
  view?: string;
  [k: string]: unknown;
}

export interface User { email: string; name: string; }
export type AppName = "boards" | "base" | "time" | "team";
