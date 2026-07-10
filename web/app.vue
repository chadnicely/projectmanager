<template>
  <div v-if="booting" class="boot">Loading…</div>
  <AuthScreen v-else-if="!user" />
  <div v-else class="app">
    <Topbar :app="app" @update:app="app = $event" />
    <div class="body">
      <Sidebar />
      <main class="main">
        <BoardView v-if="app === 'boards' && workspace" />
        <div v-else class="empty">
          <h2>{{ cap(app) }}</h2>
          <p>This screen is being ported to the new stack next.</p>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { AppName } from "~/types";

const { user, workspace, booting, boot } = useWorkspace();
const app = ref<AppName>("boards");
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

onMounted(boot);
</script>
