<template>
  <aside class="sidebar">
    <div class="sb-head">Workspaces</div>
    <div class="ws-list">
      <div v-for="s in spaces" :key="s.id" class="ws-row" :class="{ active: s.id === workspace!.activeSpace }" @click="switchSpace(s.id)">
        <span class="ws-sq" :style="{ background: s.color || '#6b6b8a' }">{{ initials(s.name) }}</span>
        <span class="nm">{{ s.name }}</span>
      </div>
    </div>

    <div class="sb-head">Boards</div>
    <div class="board-list">
      <div v-if="boards.length === 0" class="sb-empty">No boards in this workspace yet.</div>
      <div v-for="b in boards" :key="b.i" class="board-row" :class="{ active: b.i === workspace!.activeBoard }" @click="update((d) => { d.activeBoard = b.i; })">
        <span class="ic">🗂</span><span class="nm">{{ b.board.name }}</span>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { WorkspaceState } from "~/types";

const { workspace, update } = useWorkspace();
const initials = (n: string) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const isVis = (o: { demo?: boolean }) => (workspace.value?.demo !== false) || !o.demo;

const spaces = computed(() => (workspace.value?.spaces || []).filter(isVis));
const boards = computed(() =>
  (workspace.value?.boards || [])
    .map((board, i) => ({ board, i }))
    .filter(({ board }) => board.spaceId === workspace.value!.activeSpace && isVis(board) && !board.archived),
);

function switchSpace(id: string) {
  update((d: WorkspaceState) => {
    d.activeSpace = id;
    const idx = d.boards.findIndex((b) => b.spaceId === id && !b.archived);
    if (idx >= 0) d.activeBoard = idx;
  });
}
</script>
