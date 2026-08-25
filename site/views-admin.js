/* Admin views. renderClientDetail is shared with the implementor screen. */
window.Views = window.Views || {};

const STATUS_OPTS = ["Open", "In Progress", "Done", "N/A"];
const CLIENT_STATUS_OPTS = ["Not Started", "In Progress", "Live", "Completed"];

function pct(tasks) {
  if (!tasks || !tasks.length) return 0;
  const done = tasks.filter((t) => t.status === "Done" || t.status === "N/A").length;
  return Math.round((done / tasks.length) * 100);
}

const LIVE_SOON_DAYS = 14, UNOWNED_WINDOW_DAYS = 21, STALE_DAYS = 7;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((new Date(dateStr + "T00:00:00") - today) / 86400000);
}

function countdownLabel(d) {
  if (d === null) return "";
  if (d > 0) return `T-${d} day${d === 1 ? "" : "s"}`;
  if (d === 0) return "Goes live today";
  return `Live ${-d}d ago`;
}

function clientRow(c) {
  return `<tr class="rowlink" data-id="${c.id}">
    <td><b>${esc(c.dsp_name)}</b></td><td>${esc(c.short_code)}</td><td>${esc(c.vendor || "—")}</td>
    <td><span class="rag rag-${c.rag || "none"}"></span></td>
    <td>${esc(c.status)}</td><td>${esc(c.implementor?.name || "—")}</td>
    <td>${fmtDate(c.tt_live_date)}</td>
    <td><span class="bar"><span style="width:${pct(c.tasks)}%"></span></span> ${pct(c.tasks)}%</td>
    <td>${(c.client_modules || []).filter((m) => m.opted)
          .map((m) => `<span class="chip">${m.module}</span>`).join("") || "—"}</td>
  </tr>`;
}

const CLIENT_TABLE_HEAD = `<thead><tr>
  <th>DSP</th><th>Code</th><th>Vendor</th><th>RAG</th><th>Status</th>
  <th>Implementor</th><th>TT live</th><th>Checklist</th><th>Modules</th></tr></thead>`;

function wireClientRows(view) {
  view.querySelectorAll(".rowlink").forEach((r) =>
    (r.onclick = () => (location.hash = `#client/${r.dataset.id}`)));
}

Views.renderToday = async (view) => {
  const [clients, lastAct] = await Promise.all([Store.listClients(), Store.listLastActivity()]);
  const lastByClient = Object.fromEntries(lastAct.map((r) => [r.client_id, r.last_activity]));
  const active = clients.filter((c) => c.status !== "Completed");
  const openish = (t) => t.status === "Open" || t.status === "In Progress";
  const now = new Date();  // local date, not UTC — must agree with daysUntil()'s day boundary
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const allTasks = clients.flatMap((c) => (c.tasks || []).map((t) => ({ ...t, _client: c })));

  const soon = active
    .filter((c) => { const d = daysUntil(c.tt_live_date); return d !== null && d >= 0 && d <= LIVE_SOON_DAYS; })
    .sort((a, b) => (a.tt_live_date || "").localeCompare(b.tt_live_date || ""));
  const overdue = allTasks
    .filter((t) => openish(t) && t.due_date && t.due_date < todayIso)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const unowned = allTasks.filter((t) => {
    const d = daysUntil(t._client.tt_live_date);
    return openish(t) && !t.assignee_id && d !== null && d >= 0 && d <= UNOWNED_WINDOW_DAYS;
  });
  const atRisk = active.filter((c) => c.rag === "R" || c.rag === "A");
  const auditGap = soon.filter((c) =>
    (c.tasks || []).some((t) => t.template?.phase === "audit" && openish(t)));
  const stale = active.filter((c) => {
    const last = lastByClient[c.id];
    return !last || (Date.now() - new Date(last).getTime()) / 86400000 >= STALE_DAYS;
  });

  const clientLink = (c) => `<a href="#client/${c.id}">${esc(c.dsp_name)}</a>`;
  const table = (head, rows) => `<table class="grid"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  const section = (title, count, body) => count
    ? `<h2>${title} <span class="muted">(${count})</span></h2>${body}` : "";

  const soonRows = soon.map((c) => `<tr>
      <td>${clientLink(c)}</td><td><b>${countdownLabel(daysUntil(c.tt_live_date))}</b></td>
      <td>${fmtDate(c.tt_live_date)}</td><td>${esc(c.implementor?.name || "—")}</td>
      <td><span class="bar"><span style="width:${pct(c.tasks)}%"></span></span> ${pct(c.tasks)}%</td>
      <td><span class="rag rag-${c.rag || "none"}"></span> ${esc(c.status)}</td></tr>`).join("");
  const overdueRows = overdue.map((t) => `<tr>
      <td>${clientLink(t._client)}</td><td>${esc(t.title)}</td>
      <td>${esc(t.assignee?.name || "Unassigned")}</td><td>${fmtDate(t.due_date)}</td>
      <td>${t.status}</td></tr>`).join("");
  const unownedRows = unowned.map((t) => `<tr>
      <td>${clientLink(t._client)}</td><td>${esc(t.title)}</td>
      <td>${countdownLabel(daysUntil(t._client.tt_live_date))}</td></tr>`).join("");
  const riskRows = atRisk.map((c) => `<tr>
      <td>${clientLink(c)}</td><td><span class="rag rag-${c.rag}"></span> ${c.rag}</td>
      <td>${esc(c.status)}</td><td>${fmtDate(c.tt_live_date)}</td>
      <td>${esc(c.implementor?.name || "—")}</td></tr>`).join("");
  const gapRows = auditGap.map((c) => {
    const openAudit = (c.tasks || []).filter((t) => t.template?.phase === "audit" && openish(t));
    return `<tr><td>${clientLink(c)}</td>
      <td>${countdownLabel(daysUntil(c.tt_live_date))}</td>
      <td>${openAudit.map((t) => `<span class="chip">${esc(t.title)}</span>`).join(" ")}</td></tr>`;
  }).join("");
  const staleRows = stale.map((c) => {
    const last = lastByClient[c.id];
    const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    return `<tr><td>${clientLink(c)}</td>
      <td>${days === null ? "no activity yet" : days + " days quiet"}</td>
      <td>${esc(c.implementor?.name || "—")}</td><td>${esc(c.status)}</td></tr>`;
  }).join("");

  const total = soon.length + overdue.length + unowned.length + atRisk.length + auditGap.length + stale.length;
  view.innerHTML = `<div class="page-head"><h1>Today</h1>
      <span class="muted">${new Date().toDateString()}</span></div>` +
    (total === 0 ? `<p class="muted" style="font-size:15px">Nothing needs attention. 🎉</p>` : "") +
    section("Going live soon", soon.length,
      table(`<th>Client</th><th>Countdown</th><th>TT live</th><th>Implementor</th><th>Checklist</th><th>Status</th>`, soonRows)) +
    section("Overdue", overdue.length,
      table(`<th>Client</th><th>Task</th><th>Owner</th><th>Due</th><th>Status</th>`, overdueRows)) +
    section(`Unowned work (go-live ≤ ${UNOWNED_WINDOW_DAYS}d)`, unowned.length,
      table(`<th>Client</th><th>Task</th><th>Go-live</th>`, unownedRows)) +
    section("At risk (RAG)", atRisk.length,
      table(`<th>Client</th><th>RAG</th><th>Status</th><th>TT live</th><th>Implementor</th>`, riskRows)) +
    section("Audit gaps before go-live", auditGap.length,
      table(`<th>Client</th><th>Countdown</th><th>Open audit items</th>`, gapRows)) +
    section("Gone quiet", stale.length,
      table(`<th>Client</th><th>Silence</th><th>Implementor</th><th>Status</th>`, staleRows));
};

Views.renderClients = async (view) => {
  const clients = await Store.listClients();
  view.innerHTML = `
    <div class="page-head"><h1>Clients</h1><button id="new-client" type="button">+ New client</button></div>
    <div id="new-client-form" class="card">
      <input id="nc-name" placeholder="DSP name">
      <input id="nc-code" placeholder="Short code" maxlength="8" style="width:110px">
      <select id="nc-vendor"><option value="">Vendor…</option><option>ADP</option><option>Paycom</option></select>
      <input id="nc-tt" type="date" title="TT live date">
      <button id="nc-save" type="button">Create</button>
    </div>
    <table class="grid">${CLIENT_TABLE_HEAD}<tbody>${clients.map(clientRow).join("")}</tbody></table>
    ${clients.length ? "" : `<p class="muted">No clients yet — create one above or run the import.</p>`}`;
  $("#new-client").onclick = () => $("#new-client-form").classList.toggle("open");
  $("#nc-save").onclick = () => guard(async () => {
    const name = $("#nc-name").value.trim();
    if (!name) { toast("DSP name is required"); return; }
    const c = await Store.createClient({
      dsp_name: name,
      short_code: $("#nc-code").value.trim().toUpperCase(),
      vendor: $("#nc-vendor").value || null,
      tt_live_date: $("#nc-tt").value || null,
    });
    toast("Client created", true);
    location.hash = `#client/${c.id}`;
  });
  wireClientRows(view);
};

Views.renderClientDetail = async (view, id) => {
  const me = Store.getMe();
  const isAdmin = me.role === "admin";
  const dis = isAdmin ? "" : "disabled";
  const [c, users, activity] = await Promise.all([Store.getClient(id), Store.listUsers(), Store.getActivity(id)]);
  const active = users.filter((u) => u.active);
  const userOpts = (sel) => `<option value="">Unassigned</option>` + active.map((u) =>
    `<option value="${u.id}" ${u.id === sel ? "selected" : ""}>${esc(u.name)}</option>`).join("");
  const tasksFor = (phase) => c.tasks
    .filter((t) => (t.template ? t.template.phase === phase : phase === "onboarding"))
    .sort((a, b) => (a.template?.sort_order ?? 999) - (b.template?.sort_order ?? 999) || a.id - b.id);

  const taskRow = (t) => {
    const canEdit = isAdmin || t.assignee_id === me.id;
    const notes = (t.task_notes || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    const noteLine = (n) =>
      `<div class="note">"${esc(n.note)}" — ${esc(n.author?.name || "import")}, ${n.created_at.slice(0, 10)}</div>`;
    return `<tr data-task="${t.id}">
      <td>${esc(t.title)}${t.template_id ? "" : ` <span class="chip">ad-hoc</span>`}</td>
      <td><select class="t-assignee" ${dis}>${userOpts(t.assignee_id)}</select></td>
      <td><input type="date" class="t-due" value="${t.due_date || ""}" ${dis}></td>
      <td><select class="t-status" ${canEdit ? "" : "disabled"}>
        ${STATUS_OPTS.map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}
      </select></td>
      <td class="notes-cell">
        ${notes.length ? noteLine(notes[0]) : `<span class="muted">no notes</span>`}
        ${notes.length > 1 ? `<details><summary class="muted">${notes.length - 1} more</summary>
          ${notes.slice(1).map(noteLine).join("")}</details>` : ""}
        ${canEdit ? `<button class="t-note small secondary" type="button">+ note</button>` : ""}
      </td></tr>`;
  };

  const moduleRow = (m) => `<tr data-mod="${m.id}">
    <td>${m.module}</td>
    <td><input type="checkbox" class="m-opted" ${m.opted ? "checked" : ""} ${dis}></td>
    <td><input type="checkbox" class="m-training" ${m.training_done ? "checked" : ""} ${dis}></td>
    <td><input type="date" class="m-date" value="${m.training_date || ""}" ${dis}></td></tr>`;

  view.innerHTML = `
    <div class="page-head">
      <h1>${esc(c.dsp_name)} <span class="muted">${esc(c.short_code)}</span></h1>
      <a href="#${isAdmin ? "clients" : "my-clients"}">← back</a>
    </div>
    <div style="margin:-6px 0 12px;display:flex;gap:8px;flex-wrap:wrap">
      ${(() => { const d = daysUntil(c.tt_live_date);
                 return d === null ? "" : `<span class="chip"><b>${countdownLabel(d)}</b></span>`; })()}
      ${(() => { const m = (c.notes || "").match(/coverage:\s*(\S+)/i);
                 return m ? `<span class="chip">Audit folder ${esc(m[1])}</span>` : ""; })()}
      <span class="chip">Onboarding ${pct(tasksFor("onboarding"))}%</span>
      <span class="chip">Audit ${pct(tasksFor("audit"))}%</span>
    </div>
    <div class="card head-grid">
      <label>Status <select id="c-status" ${dis}>
        ${CLIENT_STATUS_OPTS.map((s) => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}
      </select></label>
      <label>RAG <select id="c-rag" ${dis}>
        ${["", "G", "A", "R"].map((r) => `<option value="${r}" ${r === (c.rag || "") ? "selected" : ""}>${r || "—"}</option>`).join("")}
      </select></label>
      <label>Vendor <select id="c-vendor" ${dis}>
        ${["", "ADP", "Paycom"].map((v) => `<option value="${v}" ${v === (c.vendor || "") ? "selected" : ""}>${v || "—"}</option>`).join("")}
      </select></label>
      <label>Implementor <select id="c-imp" ${dis}>${userOpts(c.implementor_id)}</select></label>
      <label>TT live <input id="c-tt" type="date" value="${c.tt_live_date || ""}" ${dis}></label>
      <label>Payroll cutoff <input id="c-cutoff" type="date" value="${c.payroll_cutoff_date || ""}" ${dis}></label>
      <label>First pay <input id="c-pay" type="date" value="${c.first_pay_date || ""}" ${dis}></label>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Modules &amp; training</h2>
      <table class="grid"><thead><tr><th>Module</th><th>Opted</th><th>Training done</th><th>Training date</th></tr></thead>
      <tbody>${c.client_modules.slice()
        .sort((a, b) => CONFIG.MODULES.indexOf(a.module) - CONFIG.MODULES.indexOf(b.module))
        .map(moduleRow).join("")}</tbody></table>
    </div>
    <div class="tabbar">
      <button id="tab-onb" class="active" type="button">Onboarding (${tasksFor("onboarding").length})</button>
      <button id="tab-aud" type="button">Audit (${tasksFor("audit").length})</button>
    </div>
    <div id="task-area"></div>
    ${isAdmin ? `<div class="card" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      <input id="adhoc-title" placeholder="Ad-hoc task title" style="flex:1;min-width:180px">
      <select id="adhoc-assignee">${userOpts(null)}</select>
      <input id="adhoc-due" type="date">
      <button id="adhoc-add" type="button">Add task</button>
    </div>` : ""}
    <div class="card" style="margin-top:14px">
      <h2 style="margin-top:0">Activity</h2>
      ${activity.length ? activity.map((a) => `<div class="act-row">
          <span class="when">${a.created_at.slice(0, 16).replace("T", " ")}</span>
          <b>${esc(a.actor?.name || "sync")}</b> ${esc(a.detail)}</div>`).join("")
        : `<p class="muted">No activity recorded yet.</p>`}
    </div>`;

  const reload = () => Views.renderClientDetail(view, id);

  const renderTasks = (phase) => {
    $("#tab-onb").classList.toggle("active", phase === "onboarding");
    $("#tab-aud").classList.toggle("active", phase === "audit");
    $("#task-area").innerHTML = `<table class="grid"><thead><tr>
      <th>Task</th><th>Assignee</th><th>Due</th><th>Status</th><th>Notes</th></tr></thead>
      <tbody>${tasksFor(phase).map(taskRow).join("")}</tbody></table>`;
    $("#task-area").querySelectorAll("tr[data-task]").forEach((row) => {
      const tid = Number(row.dataset.task);
      const t = c.tasks.find((x) => x.id === tid);
      const asg = row.querySelector(".t-assignee");
      if (!asg.disabled) asg.onchange = () => {
        const prev = t.assignee_id;
        const who = asg.options[asg.selectedIndex].text;
        saveChange(`${t.title} → ${asg.value ? "assigned to " + who : "unassigned"}`,
          () => Store.updateTask(tid, { assignee_id: asg.value || null }),
          () => Store.updateTask(tid, { assignee_id: prev }),
          reload);
      };
      const due = row.querySelector(".t-due");
      if (!due.disabled) due.onchange = () => {
        const prev = t.due_date;
        saveChange(`${t.title} → due ${due.value || "—"}`,
          () => Store.updateTask(tid, { due_date: due.value || null }),
          () => Store.updateTask(tid, { due_date: prev }),
          reload);
      };
      const st = row.querySelector(".t-status");
      if (!st.disabled) st.onchange = () => guard(async () => {
        const prevStatus = t.status, prevDone = t.done_date;
        if (st.value === "Done") {
          const note = prompt("Completion note (required):");
          if (note === null || !note.trim()) { st.value = t.status; toast("A note is required to mark Done"); return; }
          await Store.addNote(tid, note.trim());
          await Store.updateTask(tid, { status: "Done", done_date: new Date().toISOString().slice(0, 10) });
          toastUndo(`${t.title} → Done`, async () => {
            await Store.updateTask(tid, { status: prevStatus, done_date: prevDone });
            toast("Undone — note kept in history", true);
            reload();
          });
        } else {
          await Store.updateTask(tid, { status: st.value, done_date: null });
          toastUndo(`${t.title} → ${st.value}`, async () => {
            await Store.updateTask(tid, { status: prevStatus, done_date: prevDone });
            toast("Undone", true);
            reload();
          });
        }
        reload();
      });
      const nb = row.querySelector(".t-note");
      if (nb) nb.onclick = () => guard(async () => {
        const note = prompt("Note:");
        if (note && note.trim()) { await Store.addNote(tid, note.trim()); toast("Note added", true); reload(); }
      });
    });
  };
  $("#tab-onb").onclick = () => renderTasks("onboarding");
  $("#tab-aud").onclick = () => renderTasks("audit");
  renderTasks("onboarding");

  if (isAdmin) {
    const FIELD_LABELS = {
      status: "Status", rag: "RAG", vendor: "Vendor", implementor_id: "Implementor",
      tt_live_date: "TT live", payroll_cutoff_date: "Payroll cutoff", first_pay_date: "First pay",
    };
    const bind = (sel, field) => {
      const el = $(sel);
      el.onchange = () => {
        const prev = c[field];
        const shown = el.tagName === "SELECT" ? el.options[el.selectedIndex].text : (el.value || "—");
        saveChange(`${FIELD_LABELS[field]} → ${shown}`,
          () => Store.updateClient(id, { [field]: el.value || null }),
          () => Store.updateClient(id, { [field]: prev }),
          reload);
      };
    };
    bind("#c-status", "status"); bind("#c-rag", "rag"); bind("#c-vendor", "vendor");
    bind("#c-imp", "implementor_id"); bind("#c-tt", "tt_live_date");
    bind("#c-cutoff", "payroll_cutoff_date"); bind("#c-pay", "first_pay_date");

    view.querySelectorAll("tr[data-mod]").forEach((row) => {
      const mid = Number(row.dataset.mod);
      const m = c.client_modules.find((x) => x.id === mid);
      const wire = (cls, field, label, isCheckbox) => {
        row.querySelector(cls).onchange = (e) => {
          const prev = m[field];
          const val = isCheckbox ? e.target.checked : (e.target.value || null);
          saveChange(`${m.module}: ${label} → ${isCheckbox ? (val ? "yes" : "no") : (val || "—")}`,
            () => Store.updateModule(mid, { [field]: val }),
            () => Store.updateModule(mid, { [field]: prev }),
            reload);
        };
      };
      wire(".m-opted", "opted", "opted", true);
      wire(".m-training", "training_done", "training done", true);
      wire(".m-date", "training_date", "training date", false);
    });

    $("#adhoc-add").onclick = () => guard(async () => {
      const title = $("#adhoc-title").value.trim();
      if (!title) { toast("Task title required"); return; }
      await Store.createTask({
        client_id: id, title,
        assignee_id: $("#adhoc-assignee").value || null,
        due_date: $("#adhoc-due").value || null,
      });
      toast("Task added", true);
      reload();
    });
  }
};

Views.renderOpenItems = async (view) => {
  const [open, done] = await Promise.all([Store.listOpenItems(), Store.listDoneItems()]);
  const groups = {};
  open.forEach((t) => {
    const k = t.assignee?.name || "Unassigned";
    (groups[k] = groups[k] || []).push(t);
  });
  const openRow = (t) => `<tr>
    <td><a href="#client/${t.client_id}">${esc(t.client?.dsp_name)}</a></td>
    <td>${esc(t.title)}</td><td>${t.status}</td><td>${fmtDate(t.due_date)}</td>
    <td class="notes-cell">${latestNote(t)}</td></tr>`;
  const doneRow = (t) => `<tr>
    <td><a href="#client/${t.client_id}">${esc(t.client?.dsp_name)}</a></td>
    <td>${esc(t.title)}</td><td>${esc(t.assignee?.name || "—")}</td>
    <td>${fmtDate(t.done_date)}</td><td class="notes-cell">${latestNote(t)}</td></tr>`;
  view.innerHTML = `<div class="page-head"><h1>Open Items</h1>
      <span class="muted">${open.length} open across ${Object.keys(groups).length} people</span></div>` +
    (open.length ? Object.entries(groups).map(([who, ts]) => `
      <h2>${esc(who)} <span class="muted">(${ts.length})</span></h2>
      <table class="grid"><thead><tr>
        <th>Client</th><th>Task</th><th>Status</th><th>Due</th><th>Latest note</th></tr></thead>
      <tbody>${ts.map(openRow).join("")}</tbody></table>`).join("")
      : `<p class="muted">Nothing open — all assigned work is done.</p>`) +
    `<h2>Recently done <span class="muted">(last ${done.length})</span></h2>
     <table class="grid"><thead><tr>
       <th>Client</th><th>Task</th><th>By</th><th>Done</th><th>Note</th></tr></thead>
     <tbody>${done.map(doneRow).join("") || `<tr><td colspan="5" class="muted">nothing yet</td></tr>`}</tbody></table>`;
};
Views.renderTeam = async (view) => {
  const [users, adminEmails] = await Promise.all([Store.listUsers(), Store.getAdminEmails()]);
  view.innerHTML = `<div class="page-head"><h1>Team</h1></div>
    <p class="muted">Accounts are created by signing up on the login page with an @uzio.com email.
       Admins are whoever is on the admin list (stored in app_config).</p>
    <table class="grid"><thead><tr>
      <th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead><tbody>
    ${users.map((u) => `<tr data-id="${u.id}" data-email="${esc(u.email)}">
      <td><input class="u-name" value="${esc(u.name)}"></td>
      <td>${esc(u.email)}</td>
      <td>${u.role}</td>
      <td><input type="checkbox" class="u-active" ${u.active ? "checked" : ""}></td>
      <td><button class="u-role small secondary" type="button">
        ${u.role === "admin" ? "Make implementor" : "Make admin"}</button></td>
    </tr>`).join("")}</tbody></table>`;
  view.querySelectorAll("tbody tr").forEach((row) => {
    const uid = row.dataset.id, email = row.dataset.email;
    const u = users.find((x) => x.id === uid);
    const rerender = () => Views.renderTeam(view);
    row.querySelector(".u-name").onchange = (e) => {
      const prev = u.name;
      saveChange(`Name → ${e.target.value.trim()}`,
        () => Store.updateUser(uid, { name: e.target.value.trim() }),
        () => Store.updateUser(uid, { name: prev }),
        rerender);
    };
    row.querySelector(".u-active").onchange = (e) => {
      const prev = u.active;
      saveChange(`${u.name} → ${e.target.checked ? "active" : "deactivated"}`,
        () => Store.updateUser(uid, { active: e.target.checked }),
        () => Store.updateUser(uid, { active: prev }),
        rerender);
    };
    row.querySelector(".u-role").onclick = () => guard(async () => {
      const makeAdmin = !adminEmails.includes(email.toLowerCase());
      const next = makeAdmin
        ? [...adminEmails, email.toLowerCase()]
        : adminEmails.filter((x) => x !== email.toLowerCase());
      if (!next.length) { toast("At least one admin must remain"); return; }
      await Store.setAdminEmails(next);
      await Store.updateUser(uid, { role: makeAdmin ? "admin" : "implementor" });
      toastUndo(`${u.name} → ${makeAdmin ? "admin" : "implementor"}`, async () => {
        await Store.setAdminEmails(adminEmails);
        await Store.updateUser(uid, { role: u.role });
        toast("Undone", true);
        rerender();
      });
      rerender();
    });
  });
};
