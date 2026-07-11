<template>
  <div v-if="card && board" class="drawer-overlay" @click.self="closeCard">
    <aside class="drawer">
      <header class="drawer-head">
        <input class="d-name" :value="card.name" @change="e => setField('name', (e.target as HTMLInputElement).value)" :readonly="readOnly" />
        <button class="d-close" title="Close" @click="closeCard">✕</button>
      </header>

      <div class="drawer-body">
        <!-- Status -->
        <div class="d-field">
          <div class="d-label">Status</div>
          <select class="d-select" :value="card.status || ''" :disabled="readOnly" @change="e => setField('status', (e.target as HTMLSelectElement).value)">
            <option value="">—</option>
            <option v-for="c in board.columns" :key="c.key" :value="c.key">{{ c.key }}</option>
          </select>
        </div>

        <!-- Labels (per-card) -->
        <div class="d-field">
          <div class="d-label">Labels</div>
          <div class="d-chips">
            <span v-for="l in cardLabels" :key="l.id" class="chip" :style="{ background: l.color }">{{ l.name || " " }}</span>
            <button v-if="!readOnly" class="chip-add" @click="labelsOpen = !labelsOpen">＋ Label</button>
          </div>
          <div v-if="labelsOpen" class="picker">
            <label v-for="d in labelDefs" :key="d.id" class="pick-row">
              <input type="checkbox" :checked="(card.labels || []).includes(d.id)" @change="toggleLabel(d.id)" />
              <span class="lbl-bar" :style="{ background: d.color }">{{ d.name || "(unnamed)" }}</span>
            </label>
            <div class="pick-new">
              <input v-model="newLabelName" placeholder="New label name…" @keydown.enter="createLabel" />
              <button @click="createLabel">Create</button>
            </div>
          </div>
        </div>

        <!-- Assignees -->
        <div class="d-field">
          <div class="d-label">Assignees</div>
          <div class="d-chips">
            <span v-for="p in cardAssignees" :key="p.id" class="av" :style="{ background: p.color || '#6b6b8a' }" :title="p.name">{{ p.me ? "🧔" : initials(p.name) }}</span>
            <button v-if="!readOnly" class="chip-add" @click="assignOpen = !assignOpen">＋</button>
          </div>
          <div v-if="assignOpen" class="picker">
            <label v-for="p in people" :key="p.id" class="pick-row">
              <input type="checkbox" :checked="(card.assignees || []).includes(p.id)" @change="toggleAssignee(p.id)" />
              <span>{{ p.name }}{{ p.me ? " (you)" : "" }}</span>
            </label>
          </div>
        </div>

        <!-- Description -->
        <div class="d-field">
          <div class="d-label">Description</div>
          <textarea class="d-desc" :value="card.description || ''" :readonly="readOnly" rows="4" placeholder="Add a description…"
            @change="e => setField('description', (e.target as HTMLTextAreaElement).value)" />
        </div>

        <!-- Comments -->
        <div class="d-field">
          <div class="d-label">Comments</div>
          <div v-for="c in (card.commentList || [])" :key="c.id" class="comment">
            <div class="c-head"><b>{{ c.author }}</b> <span class="muted">{{ fmtDate(c.at) }}</span></div>
            <div class="c-text">{{ c.text }}</div>
          </div>
          <div v-if="!readOnly" class="comment-add">
            <input v-model="newComment" placeholder="Write a comment…" @keydown.enter="addComment" />
            <button :disabled="!newComment.trim()" @click="addComment">Post</button>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { Board, Card } from "~/types";

const { workspace, openCardId, closeCard, updateCard, readOnly, user } = useWorkspace();

const labelsOpen = ref(false);
const assignOpen = ref(false);
const newComment = ref("");
const newLabelName = ref("");

const initials = (n: string) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const fmtDate = (s?: string) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

const board = computed<Board | null>(() => workspace.value?.boards[workspace.value.activeBoard] ?? null);
const card = computed<Card | null>(() => {
  const id = openCardId.value; if (id == null || !board.value) return null;
  for (const g of board.value.groups) { const it = g.items.find((x) => String(x.id) === String(id)); if (it) return it; }
  return null;
});
const labelDefs = computed(() => board.value?.labelDefs || []);
const cardLabels = computed(() => (card.value?.labels || []).map((id) => labelDefs.value.find((d) => d.id === id)).filter(Boolean) as { id: string; name: string; color: string }[]);
const people = computed(() => workspace.value?.people || []);
const cardAssignees = computed(() => (card.value?.assignees || []).map((id) => people.value.find((p) => p.id === id)).filter(Boolean) as NonNullable<typeof people.value>);

function setField(field: keyof Card, value: string) {
  if (readOnly.value || card.value == null) return;
  updateCard(card.value.id, (c) => { (c as Record<string, unknown>)[field] = value; });
}
function toggleLabel(id: string) {
  if (readOnly.value || !card.value) return;
  updateCard(card.value.id, (c) => {
    c.labels = c.labels || [];
    c.labels = c.labels.includes(id) ? c.labels.filter((x) => x !== id) : [...c.labels, id];
  });
}
function toggleAssignee(id: string) {
  if (readOnly.value || !card.value) return;
  updateCard(card.value.id, (c) => {
    c.assignees = c.assignees || [];
    c.assignees = c.assignees.includes(id) ? c.assignees.filter((x) => x !== id) : [...c.assignees, id];
  });
}
const PALETTE = ["#40b869", "#e2445c", "#a23bc7", "#2f9be0", "#f0a020", "#12b886"];
function createLabel() {
  const name = newLabelName.value.trim(); if (!name || !card.value) return;
  updateCard(card.value.id, (c, d) => {
    const b = d.boards[d.activeBoard];
    b.labelDefs = b.labelDefs || [];
    d.nextId = (d.nextId || 1000) + 1;
    const def = { id: "lb" + d.nextId, name, color: PALETTE[b.labelDefs.length % PALETTE.length] };
    b.labelDefs.push(def);
    c.labels = c.labels || []; c.labels.push(def.id); // apply to THIS card only
  });
  newLabelName.value = "";
}
function addComment() {
  const text = newComment.value.trim(); if (!text || !card.value) return;
  updateCard(card.value.id, (c, d) => {
    c.commentList = c.commentList || [];
    d.nextId = (d.nextId || 1000) + 1;
    c.commentList.push({ id: d.nextId, author: user.value?.name || "You", at: new Date().toISOString(), text });
  });
  newComment.value = "";
}
</script>
