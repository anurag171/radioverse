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
  $("register-form").addEventListener("submit", handleRegister);
  $("show-register").addEventListener("click", () => showPanel("register"));
  $("show-login").addEventListener("click", () => showPanel("login"));
  $("pending-login").addEventListener("click", () => showPanel("login"));
  $("signout-btn").addEventListener("click", () => {
    supabase.auth.signOut().catch(() => {});
  });
  $("admin-btn").addEventListener("click", () => {
    if (window.RADIOVERSE_ADMIN && typeof window.RADIOVERSE_ADMIN.open === "function") {
      window.RADIOVERSE_ADMIN.open();
    }
  });
}

async function getProfile(user) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("status, full_name, is_admin, default_country")
      .eq("id", user.id)
      .maybeSingle();
    if (error) {
      console.warn("Could not read profile:", error.message);
      return null;
    }
    return data || null;
  } catch (err) {
    console.warn("Could not read profile:", err);
    return null;
  }
}

function isAdmin(user) {
  return user && user.email === (config.adminEmail || "").trim().toLowerCase();
}

async function enterApp(user) {
  const profile = await getProfile(user);
  const status = profile ? profile.status : null;
  if (status !== "approved") {
    await supabase.auth.signOut().catch(() => {});
    showPanel("pending");
    return;
  }
  const app = window.RADIOVERSE_APP;
  if (app && typeof app.setDefaultCountry === "function") {
    app.setDefaultCountry(profile.default_country);
  }
  $("login-screen").hidden = true;
  document.body.classList.add("authed");
  $("user-label").textContent = profile.full_name || user.email || "Signed in";
  $("account-chip").hidden = false;
  $("admin-btn").hidden = !isAdmin(user);
  if (!appInited) {
    appInited = true;
    window.RADIOVERSE_APP.init();
  }
}

function showLogin() {
  $("login-screen").hidden = false;
  document.body.classList.remove("authed");
  $("account-chip").hidden = true;
  $("admin-btn").hidden = true;
  if (window.RADIOVERSE_ADMIN && typeof window.RADIOVERSE_ADMIN.close === "function") {
    window.RADIOVERSE_ADMIN.close();
  }
  showPanel("login");
  const app = window.RADIOVERSE_APP;
  if (app && typeof app.stopPlayer === "function") app.stopPlayer();
}

function showPanel(name) {
  const panels = ["login", "register", "pending"];
  for (const p of panels) {
    $(`${p}-panel`).hidden = p !== name;
  }
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
      if (error.message && /email not confirmed/i.test(error.message)) {
        showPanel("pending");
      } else {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
      }
    }
  } catch (err) {
    errorEl.textContent = "Something went wrong. Try again.";
    errorEl.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = "Sign in";
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = $("register-name").value.trim();
  const email = $("register-email").value.trim();
  const password = $("register-password").value;
  const errorEl = $("register-error");
  const submit = $("register-submit");

  errorEl.hidden = true;
  if (!email || !password) {
    errorEl.textContent = "Enter both email and password.";
    errorEl.hidden = false;
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = "Password must be at least 6 characters.";
    errorEl.hidden = false;
    return;
  }

  submit.disabled = true;
  submit.textContent = "Submitting\u2026";
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    if (data.session) {
      await supabase.auth.signOut().catch(() => {});
    }
    showPanel("pending");
  } catch (err) {
    errorEl.textContent = "Something went wrong. Try again.";
    errorEl.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = "Request access";
  }
}

boot();
