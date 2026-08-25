/* Implementor views. Client detail is shared: Views.renderClientDetail handles both roles. */
window.Views = window.Views || {};

const myItemsExpanded = new Set();
let myItemsQuery = "";

Views.renderMyItems = async (view) => {
  const me = Store.getMe();
  const [open, done, teams] = await Promise.all([
    Store.listOpenTasks(), Store.listDoneTasks(), Store.getTeams(),
  ]);
  const myEmail = (me.email || "").toLowerCase();
  const myTeams = Object.entries(teams).filter(([, l]) => l.includes(myEmail)).map(([t]) => t);
  const isMine = (t) => {
    if (t.assignee_id) return t.assignee_id === me.id;
    if (t.assigned_team) return myTeams.includes(t.assigned_team);
    const team = t.template?.owner_team;
    if (!team || team === "Implementor") return t.client?.implementor_id === me.id;
    return myTeams.includes(team);
  };
  const items = open.filter(isMine);
  const doneMine = done.filter(isMine);
  const byClient = {};
  items.forEach((t) => {
    const k = t.client?.dsp_name || "?";
    (byClient[k] = byClient[k] || []).push(t);
  });
  const row = (t) => `<tr data-task="${t.id}">
    <td>${esc(t.title)}</td><td>${statusPill(t.status)}</td>
    <td class="notes-cell">${latestNote(t)}</td>
    <td>
      ${t.status === "Open" ? `<button class="t-start small secondary" type="button">Start</button>` : ""}
      <button class="t-done small" type="button">Done</button>
      <button class="t-addnote small secondary" type="button">+ note</button>
    </td></tr>`;
  const groupHtml = (name, ts) => `
    <details class="cgroup" data-client="${esc(name)}" ${myItemsExpanded.has(name) ? "open" : ""}>
      <summary><b>${esc(name)}</b> <span class="muted">(${ts.length} open)</span></summary>
      <table class="grid"><thead><tr>
        <th>Task</th><th>Status</th><th>Latest note</th><th>Actions</th></tr></thead>
      <tbody>${ts.map(row).join("")}</tbody></table>
    </details>`;
  const visibleGroups = Object.entries(byClient).filter(([name]) =>
    !myItemsQuery || name.toLowerCase().includes(myItemsQuery));
  view.innerHTML = `<div class="page-head"><h1>My Open Items</h1>
      <span class="muted">${items.length} open</span></div>
    <div class="filter-bar"><input id="mi-q" type="search" placeholder="Search client…" value="${esc(myItemsQuery)}"></div>` +
    (items.length
      ? (visibleGroups.length
          ? visibleGroups.map(([name, ts]) => groupHtml(name, ts)).join("")
          : `<p class="muted">No clients match.</p>`)
      : `<p class="muted">Nothing assigned to you right now.</p>`) +
    `<details class="cgroup">
       <summary><b>My recently done (${doneMine.length})</b></summary>
       <table class="grid"><thead><tr><th>Task</th><th>Client</th><th>Done</th><th>Note</th></tr></thead>
       <tbody>${doneMine.map((t) => `<tr><td>${esc(t.title)}</td>
          <td>${esc(t.client?.dsp_name)}</td><td>${fmtDate(t.done_date)}</td>
          <td class="notes-cell">${latestNote(t)}</td></tr>`).join("")
          || `<tr><td colspan="4" class="muted">nothing yet</td></tr>`}</tbody></table>
     </details>`;

  view.querySelectorAll("details.cgroup").forEach((d) => {
    d.ontoggle = () => { const k = d.dataset.client; if (!k) return; if (d.open) myItemsExpanded.add(k); else myItemsExpanded.delete(k); };
  });

  $("#mi-q").oninput = (e) => { myItemsQuery = e.target.value.trim().toLowerCase(); Views.renderMyItems(view); };
  if (myItemsQuery) {
    const q = $("#mi-q");
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }

  view.querySelectorAll("tr[data-task]").forEach((r) => {
    const tid = Number(r.dataset.task);
    const item = items.find((x) => x.id === tid);
    const rerender = () => Views.renderMyItems(view);
    const start = r.querySelector(".t-start");
    if (start) start.onclick = () => guard(async () => {
      await Store.updateTask(tid, { status: "In Progress" });
      toastUndo(`${item.title} → In Progress`, async () => {
        await Store.updateTask(tid, { status: "Open" });
        toast("Undone", true);
        rerender();
      });
      rerender();
    });
    r.querySelector(".t-done").onclick = () => guard(async () => {
      const note = prompt("Completion note (required):");
      if (note === null) return;
      if (!note.trim()) { toast("A note is required to mark Done"); return; }
      const prevStatus = item.status;
      await Store.addNote(tid, note.trim());
      await Store.updateTask(tid, { status: "Done", done_date: new Date().toISOString().slice(0, 10) });
      toastUndo(`${item.title} → Done`, async () => {
        await Store.updateTask(tid, { status: prevStatus, done_date: null });
        toast("Undone — note kept in history", true);
        rerender();
      });
      rerender();
    });
    r.querySelector(".t-addnote").onclick = () => guard(async () => {
      const note = prompt("Note:");
      if (note && note.trim()) { await Store.addNote(tid, note.trim()); toast("Note added", true); rerender(); }
    });
  });
};

Views.renderMyClients = async (view) => {
  const me = Store.getMe();
  const clients = (await Store.listClients()).filter((c) => c.implementor_id === me.id);
  view.innerHTML = `<div class="page-head"><h1>My Clients</h1></div>` +
    (clients.length
      ? `<table class="grid">${CLIENT_TABLE_HEAD}<tbody>${clients.map(clientRow).join("")}</tbody></table>`
      : `<p class="muted">No clients have you as implementor yet.</p>`);
  wireClientRows(view);
};
