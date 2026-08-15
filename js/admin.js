import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.RADIOVERSE_CONFIG || {};
const ADMIN_EMAIL = (config.adminEmail || "").trim().toLowerCase();

let supabase = null;
let users = [];
let editingId = null;

const $ = (id) => document.getElementById(id);

function boot() {
  if (!config.supabaseUrl || !config.supabaseAnonKey) return;
  supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  $("admin-close").addEventListener("click", close);
}

function setStatus(message, isError = false) {
  const el = $("admin-status");
  el.hidden = !message;
  el.textContent = message || "";
  el.classList.toggle("error", isError);
  el.classList.toggle("success", !isError);
}

async function open() {
  try {
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user;
    if (!user || user.email.toLowerCase() !== ADMIN_EMAIL) {
      setStatus("Only the administrator can open this page.", true);
      return;
    }
  } catch (e) {
    setStatus("Could not verify your session.", true);
    return;
  }

  $("admin-screen").hidden = false;
  $("admin-status").hidden = true;
  await refresh();
}

function close() {
  $("admin-screen").hidden = true;
  $("admin-status").hidden = true;
}

async function refresh() {
  const wrap = $("admin-users");
  wrap.innerHTML = '<div class="admin-loading">Loading users&#8230;</div>';
  $("admin-empty").hidden = true;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, status, is_admin, default_country, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;

    users = (data || []).sort((a, b) => {
      const aIsMe = (a.email || "").toLowerCase() === ADMIN_EMAIL ? 0 : 1;
      const bIsMe = (b.email || "").toLowerCase() === ADMIN_EMAIL ? 0 : 1;
      if (aIsMe !== bIsMe) return aIsMe - bIsMe;
      return (a.email || "").localeCompare(b.email || "");
    });

    if (users.length === 0) {
      $("admin-empty").hidden = false;
    }
    render();
  } catch (e) {
    wrap.innerHTML = "";
    setStatus(e.message, true);
  }
}

function render() {
  const wrap = $("admin-users");
  wrap.innerHTML = "";
  for (const u of users) {
    wrap.appendChild(userCard(u));
  }
}

function statusBadge(status) {
  const map = {
    approved: ["badge-ok", "Approved"],
    pending: ["badge-wait", "Pending"],
    rejected: ["badge-err", "Rejected"],
  };
  const [cls, label] = map[status] || ["badge-wait", status || "Unknown"];
  return `<span class="admin-badge ${cls}">${label}</span>`;
}

function userCard(u) {
  const card = document.createElement("div");
  card.className = "admin-user";
  card.dataset.id = u.id;

  const isMe = (u.email || "").toLowerCase() === ADMIN_EMAIL;
  const meTag = isMe ? ' <span class="admin-me">(you)</span>' : "";
  const isEditing = editingId === u.id;

  const statusCell = isEditing
    ? `<select class="admin-select" data-field="status">
         <option value="pending" ${u.status === "pending" ? "selected" : ""}>Pending</option>
         <option value="approved" ${u.status === "approved" ? "selected" : ""}>Approved</option>
         <option value="rejected" ${u.status === "rejected" ? "selected" : ""}>Rejected</option>
       </select>`
    : statusBadge(u.status);

  const nameCell = isEditing
    ? `<input class="admin-input" data-field="full_name" value="${escapeAttr(u.full_name || "")}" />`
    : `<span class="admin-name">${escapeHtml(u.full_name || u.email || "—")}</span>`;

  const countryCell = isEditing
    ? `<input class="admin-input" data-field="default_country" list="admin-countries" value="${escapeAttr(u.default_country || "")}" placeholder="e.g. India" />
       <datalist id="admin-countries">${countryOptions()}</datalist>`
    : `<span class="admin-country">${escapeHtml(u.default_country || "—")}</span>`;

  const actions = isEditing
    ? `<button type="button" class="admin-btn-sm primary" data-action="save">Save</button>
       <button type="button" class="admin-btn-sm" data-action="cancel">Cancel</button>`
    : `<button type="button" class="admin-btn-sm" data-action="edit" ${isMe ? "disabled" : ""}>Edit</button>
       <button type="button" class="admin-btn-sm" data-action="reset" ${isMe ? "disabled" : ""}>Reset password</button>
       <button type="button" class="admin-btn-sm danger" data-action="delete" ${isMe ? "disabled" : ""}>Delete</button>`;

  card.innerHTML = `
    <div class="admin-user-main">
      <div class="admin-user-head">
        <span class="admin-email">${escapeHtml(u.email || "")}${meTag}</span>
        ${statusCell}
      </div>
      <div class="admin-user-fields">
        <div class="admin-field"><span class="admin-label">Name</span>${nameCell}</div>
        <div class="admin-field"><span class="admin-label">Default country</span>${countryCell}</div>
        <div class="admin-field admin-meta"><span class="admin-label">Joined</span><span>${escapeHtml(fmtDate(u.created_at))}</span></div>
      </div>
      <div class="admin-user-actions">${actions}</div>
    </div>
  `;

  card.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;

    const action = btn.dataset.action;
    if (action === "edit") {
      editingId = u.id;
      render();
    } else if (action === "cancel") {
      editingId = null;
      render();
    } else if (action === "save") {
      const fullName = card.querySelector('[data-field="full_name"]').value.trim();
      const country = card.querySelector('[data-field="default_country"]').value.trim();
      const status = card.querySelector('[data-field="status"]').value;
      await run(async () => {
        const updates = {};
        if (fullName !== u.full_name) updates.full_name = fullName;
        if (country !== u.default_country) updates.default_country = country;
        if (Object.keys(updates).length) {
          const { error } = await supabase
            .from("profiles")
            .update(updates)
            .eq("id", u.id);
          if (error) throw error;
        }
        if (status !== u.status) {
          const { error } = await supabase
            .from("profiles")
            .update({ status })
            .eq("id", u.id);
          if (error) throw error;
        }
        editingId = null;
        await refresh();
        setStatus("Changes saved.", false);
      });
    } else if (action === "reset") {
      await promptReset(u);
    } else if (action === "delete") {
      const ok = window.confirm(`Delete the account of ${u.email}? This cannot be undone.`);
      if (!ok) return;
      await run(async () => {
        const { error } = await supabase.rpc("admin_delete_user", {
          target_user_id: u.id,
        });
        if (error) throw error;
        setStatus(`Deleted ${u.email}.`, false);
        await refresh();
      });
    }
  });

  return card;
}

async function promptReset(u) {
  setStatus("");
  try {
    await supabase.auth.resetPasswordForEmail(u.email);
    setStatus(`Password reset email sent to ${u.email}.`, false);
  } catch (e) {
    setStatus(`Could not send reset email: ${e.message}`, true);
  }
}

async function run(fn) {
  setStatus("");
  try {
    await fn();
  } catch (e) {
    setStatus(e.message, true);
  }
}

function countryOptions() {
  const sel = $("country-select");
  if (!sel || !sel.options.length) return "";
  const seen = new Set();
  let html = "";
  for (const opt of sel.options) {
    if (seen.has(opt.value)) continue;
    seen.add(opt.value);
    html += `<option value="${escapeAttr(opt.value)}"></option>`;
  }
  return html;
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

boot();

window.RADIOVERSE_ADMIN = { open, close };
