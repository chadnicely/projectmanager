<template>
  <header class="topbar">
    <div class="app-switcher">
      <button v-for="(meta, key) in APPS" :key="key" class="app-tile" :class="{ active: key === app }"
        :title="meta.name" :style="{ background: meta.grad }" @click="$emit('update:app', key)">
        {{ meta.icon }}
      </button>
    </div>
    <div class="logo"><span class="mark" :style="{ background: APPS[app].grad }">{{ APPS[app].icon }}</span><b>{{ APPS[app].name }}</b></div>
    <span class="workspace">{{ spaceName }}</span>
    <span v-if="readOnly" class="ro-pill">Read-only</span>
    <div class="spacer" />
    <button class="avatar" :title="user?.name" @click="signOut">🧔</button>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { AppName } from "~/types";

const props = defineProps<{ app: AppName }>();
defineEmits<{ "update:app": [AppName] }>();

const { workspace, user, readOnly, signOut } = useWorkspace();

const APPS: Record<AppName, { name: string; icon: string; grad: string }> = {
  boards: { name: "Boards", icon: "◫", grad: "linear-gradient(135deg,#12c2ae,#0e9e90)" },
  base: { name: "Base", icon: "▦", grad: "linear-gradient(135deg,#f0a020,#e2445c)" },
  time: { name: "Time", icon: "◷", grad: "linear-gradient(135deg,#3b5bdb,#2f9be0)" },
  team: { name: "Team", icon: "👥", grad: "linear-gradient(135deg,#a23bc7,#7048e8)" },
};

const spaceName = computed(() => {
  const w = workspace.value;
  return w?.spaces.find((s) => s.id === w.activeSpace)?.name || "My Workspace";
});
void props;
</script>
