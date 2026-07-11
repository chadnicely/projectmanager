<template>
  <div v-if="!board" class="empty">
    <h2>No board selected</h2>
    <p>Pick a board on the left, or this workspace has none yet.</p>
  </div>
  <div v-else class="board-view">
    <div class="board-head"><h1>{{ board.name }}</h1></div>
    <section v-for="g in groups" :key="g.id" class="group">
      <div class="group-head">
        <span class="dot" :style="{ background: g.color || '#868e9c' }" />
        <span class="g-name">{{ g.name }}</span>
        <span class="count">{{ g.items.length }}</span>
      </div>
      <table class="cards">
        <tbody>
          <tr v-for="c in g.items" :key="c.id" class="card-row" @click="openCard(c.id)">
            <td class="c-name">
              <span>{{ c.name }}</span>
              <span v-if="labelsFor(c).length" class="chips">
                <span v-for="l in labelsFor(c)" :key="l.id" class="chip" :style="{ background: l.color }">{{ l.name || " " }}</span>
              </span>
            </td>
            <td class="c-status">
              <span v-if="c.status" class="pill" :style="{ background: colColor(c.status) }">{{ c.status }}</span>
              <span v-else class="muted">—</span>
            </td>
            <td class="c-assignees">
              <span v-if="avatarsFor(c).length" class="avatars">
                <span v-for="p in avatarsFor(c)" :key="p.id" class="av" :style="{ background: p.color || '#6b6b8a' }" :title="p.name">{{ p.me ? "🧔" : initials(p.name) }}</span>
              </span>
            </td>
            <td class="c-meta">
              <span v-if="(c.commentList?.length ?? 0) > 0" class="badge">💬 {{ c.commentList!.length }}</span>
              <span v-if="(c.fileList?.length ?? 0) > 0" class="badge">📎 {{ c.fileList!.length }}</span>
            </td>
          </tr>
          <tr>
            <td colspan="4"><div class="add-row" @click="addCard(g.id)">＋ Add card</div></td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Board, Card, WorkspaceState } from "~/types";

const { workspace, update, openCard } = useWorkspace();
const initials = (n: string) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const demoOn = computed(() => workspace.value?.demo !== false);

const board = computed<Board | null>(() => {
  const w = workspace.value; if (!w) return null;
  const b = w.boards[w.activeBoard];
  const ok = b && b.spaceId === w.activeSpace && (demoOn.value || !b.demo) && !b.archived;
  return ok ? b : null;
});
const groups = computed(() => (board.value?.groups || []).filter((g) => (demoOn.value || !g.demo) && !g.archived));

function colColor(key?: string) { return board.value?.columns?.find((c) => c.key === key)?.color || "#3b5bdb"; }
function labelsFor(card: Card) {
  const defs = board.value?.labelDefs || [];
  return (card.labels || []).map((id) => defs.find((d) => d.id === id)).filter(Boolean) as { id: string; name: string; color: string }[];
}
function avatarsFor(card: Card) {
  const people = workspace.value?.people || [];
  return (card.assignees || []).map((id) => people.find((p) => p.id === id)).filter(Boolean) as NonNullable<WorkspaceState["people"]>;
}

function addCard(groupId: string) {
  update((d) => {
    const b = d.boards[d.activeBoard];
    const g = b?.groups.find((x) => x.id === groupId);
    if (!g) return;
    d.nextId = (d.nextId || 1000) + 1;
    g.items.push({ id: d.nextId, name: "New card", status: "", assignees: [], labels: [], commentList: [], fileList: [] });
  });
}
</script>
