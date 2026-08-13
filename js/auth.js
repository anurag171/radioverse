import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.RADIOVERSE_CONFIG || {};

let supabase = null;
let appInited = false;

const $ = (id) => document.getElementById(id);

function boot() {
  const isAuthMode = Boolean(config.supabaseUrl && config.supabaseAnonKey);

  if (!isAuthMode) {
    window.RADIOVERSE_APP.init();
    return;
  }

  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
  document.body.classList.add("auth-mode");

  supabase.auth.getSession().then(({ data }) => {
    if (data.session) {
      enterApp(data.session.user);
    } else {
      showLogin();
    }
  });

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) enterApp(session.user);
    if (event === "SIGNED_OUT") showLogin();
  });

  $("login-form").addEventListener("submit", handleLogin);
  $("signout-btn").addEventListener("click", () => {
    supabase.auth.signOut().catch(() => {});
  });
}

function enterApp(user) {
  $("login-screen").hidden = true;
  document.body.classList.add("authed");
  $("user-label").textContent = user.email || "Signed in";
  $("account-chip").hidden = false;
  if (!appInited) {
    appInited = true;
    window.RADIOVERSE_APP.init();
  }
}

function showLogin() {
  $("login-screen").hidden = false;
  document.body.classList.remove("authed");
  $("account-chip").hidden = true;
  const app = window.RADIOVERSE_APP;
  if (app && typeof app.stopPlayer === "function") app.stopPlayer();
}

async function handleLogin(e) {
  e.preventDefault();
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  const errorEl = $("login-error");
  const submit = $("login-submit");

  errorEl.hidden = true;
  if (!email || !password) {
    errorEl.textContent = "Enter both email and password.";
    errorEl.hidden = false;
    return;
  }

  submit.disabled = true;
  submit.textContent = "Signing in\u2026";
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
    }
  } catch (err) {
    errorEl.textContent = "Something went wrong. Try again.";
    errorEl.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = "Sign in";
  }
}

boot();
