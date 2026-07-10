export interface LabelDef { id: string; name: string; color: string; }
export interface Comment { id: number | string; author: string; at: string; text: string; }
export interface FileRec { id: number | string; name: string; type?: string; dataUrl?: string | null; size?: number; }

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
  commentList?: Comment[];
  fileList?: FileRec[];
  archived?: boolean;
  demo?: boolean;
}
export interface Group { id: string; name: string; color?: string; collapsed?: boolean; items: Card[]; archived?: boolean; demo?: boolean; }
export interface Column { key: string; color: string; }
export interface Board { name: string; spaceId: string; columns: Column[]; groups: Group[]; labelDefs?: LabelDef[]; archived?: boolean; demo?: boolean; }
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
