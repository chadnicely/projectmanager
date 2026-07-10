<template>
  <div class="auth">
    <form class="auth-card" @submit.prevent="submit">
      <div class="brand"><span class="mark">B</span> Base</div>
      <h1>{{ mode === "signup" ? "Create your account" : "Sign in to Base" }}</h1>
      <div v-if="err" class="auth-err">{{ err }}</div>
      <label v-if="mode === 'signup'">Name<input v-model="name" autocomplete="name" /></label>
      <label>Email<input v-model="email" type="email" autocomplete="username" /></label>
      <label>Password<input v-model="password" type="password" :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'" /></label>
      <button type="submit" :disabled="busy">{{ busy ? "…" : mode === "signup" ? "Create account" : "Log in" }}</button>
      <p class="auth-switch">
        {{ mode === "signup" ? "Already have an account?" : "New here?" }}
        <a @click="toggle">{{ mode === "signup" ? "Log in" : "Create an account" }}</a>
      </p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

const { signIn } = useWorkspace();
const mode = ref<"login" | "signup">("login");
const email = ref("");
const password = ref("");
const name = ref("");
const err = ref("");
const busy = ref(false);

function toggle() { mode.value = mode.value === "signup" ? "login" : "signup"; err.value = ""; }

async function submit() {
  if (!email.value || !password.value) { err.value = "Enter your email and password."; return; }
  busy.value = true; err.value = "";
  try { await signIn(mode.value, email.value.trim(), password.value, name.value.trim()); }
  catch (e) { err.value = e instanceof Error ? e.message : "Something went wrong."; }
  finally { busy.value = false; }
}
</script>
