// RadioVerse admin API — runs as a Supabase Edge Function.
//
// Only the account anurag171@gmail.com may call this. Every request must
// carry the caller's access token in the Authorization header; the function
// verifies the caller is the admin before performing any operation using the
// service_role key (which never reaches the browser).
//
// Deploy:
//   supabase functions deploy admin-api --no-verify-jwt
//   supabase secrets set SERVICE_ROLE_KEY=your_service_role_key
//   (or link the function to your project via the Dashboard editor and set
//    SUPABASE_SERVICE_ROLE_KEY in Function secrets — the platform injects
//    SUPABASE_URL automatically.)
//
// Endpoint: https://<project-ref>.supabase.co/functions/v1/admin-api

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ADMIN_EMAIL = "anurag171@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceRoleKey || !supabaseUrl) {
    return json({ error: "Server not configured" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- Verify caller is the admin ----
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing access token" }, 401);

  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller.user) return json({ error: "Unauthorized" }, 401);
  if (caller.user.email !== ADMIN_EMAIL) return json({ error: "Forbidden" }, 403);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action } = body;
  try {
    switch (action) {
      case "list_users": {
        const { data: users, error } = await admin.auth.admin.listUsers({
          perPage: 1000,
        });
        if (error) throw error;

        const { data: profiles, error: profErr } = await admin
          .from("profiles")
          .select("id, email, full_name, status, is_admin, default_country");
        if (profErr) throw profErr;

        const map = new Map((profiles || []).map((p) => [p.id, p]));
        const out = (users || []).map((u) => {
          const prof = map.get(u.id) || {};
          return {
            id: u.id,
            email: u.email,
            full_name: prof.full_name || u.user_metadata?.full_name || "",
            status: prof.status || "pending",
            is_admin: !!prof.is_admin,
            default_country: prof.default_country || "",
            confirmed_at: u.confirmed_at,
            last_sign_in_at: u.last_sign_in_at,
            created_at: u.created_at,
          };
        });
        return json({ users: out });
      }

      case "set_status": {
        const { user_id, status } = body;
        if (!user_id || !["pending", "approved", "rejected"].includes(status)) {
          return json({ error: "Invalid user_id or status" }, 400);
        }
        const { error } = await admin
          .from("profiles")
          .update({ status })
          .eq("id", user_id);
        if (error) throw error;
        return json({ ok: true });
      }

      case "delete_user": {
        const { user_id } = body;
        if (!user_id) return json({ error: "Missing user_id" }, 400);
        const { error } = await admin.auth.admin.deleteUser(user_id);
        if (error) throw error;
        return json({ ok: true });
      }

      case "reset_password": {
        const { user_id, password } = body;
        if (!user_id) return json({ error: "Missing user_id" }, 400);
        if (!password || password.length < 6) {
          return json({ error: "Password must be at least 6 characters" }, 400);
        }
        const { error } = await admin.auth.admin.updateUserById(user_id, {
          password,
        });
        if (error) throw error;
        return json({ ok: true });
      }

      case "send_reset_email": {
        const { email } = body;
        if (!email) return json({ error: "Missing email" }, 400);
        const { data, error } = await admin.auth.resetPasswordForEmail(email);
        if (error) throw error;
        return json({ ok: true, hint: data });
      }

      case "update_profile": {
        const { user_id, full_name, default_country } = body;
        if (!user_id) return json({ error: "Missing user_id" }, 400);
        const patch = {};
        if (typeof full_name === "string") patch.full_name = full_name;
        if (typeof default_country === "string") patch.default_country = default_country;
        if (Object.keys(patch).length === 0) {
          return json({ error: "Nothing to update" }, 400);
        }
        const { error } = await admin.from("profiles").update(patch).eq("id", user_id);
        if (error) throw error;
        if (typeof full_name === "string") {
          await admin.auth.admin.updateUserById(user_id, {
            user_metadata: { ...(patch.full_name ? { full_name } : {}) },
          });
        }
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("admin-api error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
