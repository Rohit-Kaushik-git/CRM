/* Admin views. renderClientDetail is shared with the implementor screen. */
window.Views = window.Views || {};

/* Long text folds to two lines; a click unfolds it. Imported notes run to
   whole paragraphs, and unclamped they repeat themselves down the page. */
function clampHtml(text) {
  const t = String(text ?? "");
  return t.length > 220
    ? `<span class="clamp" title="click to expand" onclick="this.classList.toggle('open')">${esc(t)}</span>`
    : esc(t);
}

const STATUS_OPTS = ["Open", "In Progress", "Done", "N/A"];
const CLIENT_STATUS_OPTS = ["Not Started", "In Progress", "Live", "Completed", "Cancelled", "On Hold", "Unresponsive"];

function pct(tasks) {
  if (!tasks || !tasks.length) return 0;
  const done = tasks.filter((t) => t.status === "Done" || t.status === "N/A").length;
  return Math.round((done / tasks.length) * 100);
}

function statusPill(s) {
  const cls = { "Open": "pill-open", "In Progress": "pill-progress",
                "Done": "pill-done", "N/A": "pill-na" }[s] || "pill-open";
  return `<span class="pill ${cls}">${esc(s)}</span>`;
}
function clientStatusPill(s) {
  const cls = { "Not Started": "pill-notstarted", "In Progress": "pill-progress",
                "Live": "pill-live", "Completed": "pill-completed",
                "Cancelled": "pill-cancelled", "On Hold": "pill-onhold", "Unresponsive": "pill-unresponsive" }[s] || "pill-open";
  return `<span class="pill ${cls}">${esc(s)}</span>`;
}
const TEAM_NAMES = ["Data Team", "Tax Team", "Shruti"];
let auditFilter = "all", auditQuery = "";

function derivedOwnerLabel(t, client) {
  const team = t.template?.owner_team;
  if (!team || team === "Implementor") return client?.implementor?.name || "Unassigned";
  return team;
}
function effectiveOwnerLabel(t, client) {
  if (t.assignee_id) return t.assignee?.name || "Assigned";
  if (t.assigned_team) return t.assigned_team;
  return derivedOwnerLabel(t, client);
}
function isMigrating(c) { return c.vendor === "ADP" || c.vendor === "Paycom"; }

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

/* Client 360 journey: the template checklist grouped into stages, plus a pace
   check. Pace = share of the start→go-live window already elapsed vs share of
   applicable (non-N/A) checklist work done. The start is the contract-signed
   date when known, else the earliest of record creation and any task done date
   (30 clients were bulk-imported on one day, so creation alone runs late). */
const SETUP_TASKS = ["Company Setup", "Census Transfer",
  "Time Tracking Setup (Kiosk/Mobile/Web)", "Payment Method Transfer"];
const PACE_TOLERANCE = 0.10, PACE_BEHIND = 0.25, MIN_WINDOW_DAYS = 7;

function journeyStart(c, signedDate) {
  if (signedDate) return { date: signedDate, src: "contract signed" };
  const done = (c.tasks || []).map((t) => t.done_date).filter(Boolean).sort();
  const created = (c.created_at || "").slice(0, 10);
  const earliest = [created, done[0]].filter(Boolean).sort()[0] || null;
  return { date: earliest, src: earliest === created ? "record created" : "first task done" };
}

function journeyHtml(c, opts = {}) {
  const tmpl = (c.tasks || []).filter((t) => t.template);
  const byOrder = (a, b) => (a.template.sort_order ?? 999) - (b.template.sort_order ?? 999);
  const onb = tmpl.filter((t) => t.template.phase === "onboarding").sort(byOrder);
  const stages = [
    { key: "setup", label: "Setup", tasks: onb.filter((t) => SETUP_TASKS.includes(t.title)) },
    { key: "mig", label: "Data migration", tasks: onb.filter((t) => !SETUP_TASKS.includes(t.title)) },
    { key: "audit", label: "Audit", tasks: tmpl.filter((t) => t.template.phase === "audit").sort(byOrder) },
  ].map((s) => {
    const app = s.tasks.filter((t) => t.status !== "N/A");
    const done = app.filter((t) => t.status === "Done");
    const last = done.map((t) => t.done_date).filter(Boolean).sort().pop() || null;
    return { ...s, app, done, last,
      state: !app.length ? "skip" : done.length === app.length ? "done" : "todo" };
  });
  const live = c.status === "Live" || c.status === "Completed";
  const firstTodo = stages.find((s) => s.state === "todo");
  if (firstTodo) firstTodo.state = "cur";

  const start = journeyStart(c, opts.signedDate);
  const d = daysUntil(c.tt_live_date);
  const steps = [
    { label: "Started", state: start.date ? "done" : "todo",
      sub: start.date ? `${esc(start.date)}` : "date unknown", title: start.src },
    ...stages.map((s) => ({ label: s.label, state: s.state,
      sub: s.state === "skip" ? "not needed"
        : `${s.done.length}/${s.app.length}${s.state === "done" && s.last ? " · " + esc(s.last) : ""}` +
          (s.key === "mig" ? `<span id="hero-hist">${opts.histHtml || ""}</span>` : ""),
      title: s.app.map((t) => `${t.status === "Done" ? "✓" : "○"} ${t.title}`).join("\n") })),
    { label: "Go-live", state: live ? "done" : (!firstTodo ? "cur" : "todo"),
      sub: live ? esc(c.status) : d === null ? "no date"
        : d < 0 ? `<span class="overdue">${-d}d past date</span>` : countdownLabel(d) },
  ];

  /* Pace chip */
  let pace = "";
  const work = stages.flatMap((s) => s.app);
  const actual = work.length ? work.filter((t) => t.status === "Done").length / work.length : 1;
  const today = localIso(new Date());
  if (live) {
    pace = `<span class="pace pace-ok">Live</span>`;
  } else if (c.status === "Cancelled") {
    pace = `<span class="pace pace-na">Cancelled</span>`;
  } else if (c.status === "On Hold" || c.status === "Unresponsive") {
    pace = `<span class="pace pace-warn" title="Pace is not tracked while the client is paused">Paused · ${esc(c.status)}</span>`;
  } else if (!c.tt_live_date) {
    pace = `<span class="pace pace-na" title="Set a TT live date to track pace">No go-live date</span>`;
  } else if (d < 0) {
    pace = actual >= 1
      ? `<span class="pace pace-warn" title="Checklist complete but status not Live">Go-live passed ${-d}d ago · mark Live?</span>`
      : `<span class="pace pace-bad">Past go-live by ${-d}d · ${Math.round(actual * 100)}% done</span>`;
  } else if (start.date) {
    const win = (new Date(c.tt_live_date) - new Date(start.date)) / 86400000;
    if (win >= MIN_WINDOW_DAYS) {
      const expected = Math.min(1, Math.max(0, (new Date(today) - new Date(start.date)) / 86400000 / win));
      const gap = expected - actual;
      const why = `Expected ${Math.round(expected * 100)}% by today (from ${start.date}, ${start.src}) · actual ${Math.round(actual * 100)}%`;
      const lag = Math.max(1, Math.round(gap * win));
      pace = gap > PACE_BEHIND
        ? `<span class="pace pace-bad" title="${esc(why)}">Behind by ~${lag}d</span>`
        : gap > PACE_TOLERANCE
          ? `<span class="pace pace-warn" title="${esc(why)}">Slipping · ~${lag}d</span>`
          : `<span class="pace pace-ok" title="${esc(why)}">On track</span>`;
    } else {
      pace = `<span class="pace pace-na" title="Start to go-live window is under ${MIN_WINDOW_DAYS} days">Pace n/a</span>`;
    }
  }

  /* Next up: first open item in the current stage */
  let next = "";
  if (firstTodo) {
    const t = firstTodo.app.find((x) => x.status !== "Done");
    if (t) next = `<span class="next-up"><span class="muted">Next:</span> <b>${esc(t.title)}</b>
      <span class="muted">→ ${esc(effectiveOwnerLabel(t, c))}</span>${t.status === "In Progress" ? " " + statusPill(t.status) : ""}</span>`;
  }

  return `<ol class="journey">${steps.map((s) =>
      `<li class="js-${s.state}"${s.title ? ` title="${esc(s.title)}"` : ""}>
        <span class="dot">${s.state === "done" ? "✓" : s.state === "skip" ? "–" : ""}</span>
        <span class="jl">${s.label}</span><span class="js">${s.sub}</span></li>`).join("")}</ol>
    <div class="journey-foot">${pace}${next}</div>`;
}

/* Only Drive links are ever rendered as a link: the field is free text, and a
   javascript: or look-alike URL must not become a clickable button. */
function isDriveUrl(u) {
  return /^https:\/\/drive\.google\.com\/[^\s"'<>]*$/.test(String(u || "").trim());
}

function clientRow(c) {
  return `<tr class="rowlink" data-id="${c.id}">
    <td><b>${esc(c.dsp_name)}</b></td><td>${esc(c.short_code)}</td><td>${esc(c.vendor || "—")}</td>
    <td><span class="rag rag-${c.rag || "none"}"></span></td>
    <td>${clientStatusPill(c.status)}</td><td>${esc(c.implementor?.name || "—")}</td>
    <td>${fmtDate(c.tt_live_date)}</td>
    <td><span class="bar"><span style="width:${pct(c.tasks)}%"></span></span> ${pct(c.tasks)}%</td>
    <td>${(c.client_modules || []).filter((m) => m.opted)
          .sort((a, b) => CONFIG.MODULES.indexOf(a.module) - CONFIG.MODULES.indexOf(b.module))
          .map((m) => `<span class="chip">${m.module}</span>`).join("") || "—"}</td>
  </tr>`;
}

const CLIENT_TABLE_HEAD = `<thead><tr>
  <th>DSP</th><th>Code</th><th>Previous System</th><th>RAG</th><th>Status</th>
  <th>Implementor</th><th>TT live</th><th>Checklist</th><th>Modules</th></tr></thead>`;

function wireClientRows(view) {
  view.querySelectorAll(".rowlink").forEach((r) =>
    (r.onclick = () => (location.hash = `#client/${r.dataset.id}`)));
}

/* Today answers one question per lane: what is late, what is due this week,
   what is moving, what is stuck on someone else - plus the mail that names a
   client. Only a handful of open tasks carry a due date, so a task without one
   gets a date from its phase and the client's go-live (TODAY_OFFSETS); prior
   payroll is due PRIOR_WINDOW_DAYS after the first punch (priorPayrollState). */
const TODAY_OFFSETS = { setup: -7, mig: -5, audit: -2 };   // days relative to go-live
const TODAY_WEEK = 7, HYPERCARE_DAYS = 14, TODAY_CAP = 10;
const PAUSED_STATUSES = ["On Hold", "Unresponsive"];
const TODAY_SCOPE_KEY = "today_scope";

Views.renderToday = async (view) => {
  const soft = (p, empty = []) => p.catch((e) => { console.warn("Today:", e.message); return empty; });
  const [clients, lastAct, sysRows, apiRows, profRows, mailRows, teams] = await Promise.all([
    Store.listClients(), Store.listLastActivity(),
    soft(Store.listSystemActivity()), soft(Store.listApiActivity()), soft(Store.listClientProfiles()),
    soft(Store.listClientMail(), null), soft(Store.getTeams(), {})]);
  const me = Store.getMe() || {};
  const myEmail = String(me.email || "").toLowerCase();
  const myTeams = Object.keys(teams).filter((t) => (teams[t] || []).includes(myEmail));
  const lastByClient = Object.fromEntries(lastAct.map((r) => [r.client_id, r.last_activity]));
  const openish = (t) => t.status === "Open" || t.status === "In Progress";
  const isLive = (c) => c.status === "Live" || c.status === "Completed";
  const todayIso = localIso(new Date());
  /* One record per short code. The CRM holds the same DSP more than once
     (WEE1 three times); Today shows the record the work is happening on -
     Live first, then most tasks done, then latest activity - and flags the
     rest so someone cancels them. */
  const doneCount = (c) => (c.tasks || []).filter((t) => t.status === "Done").length;
  const dupes = [];
  const active = (() => {
    const all = clients.filter((c) => c.status !== "Completed" && c.status !== "Cancelled");
    const byCode = new Map();
    all.forEach((c) => {
      const k = String(c.short_code || "").trim().toUpperCase() || `id:${c.id}`;
      (byCode.get(k) || byCode.set(k, []).get(k)).push(c);
    });
    return [...byCode.values()].map((list) => {
      if (list.length === 1) return list[0];
      const rank = (c) => [isLive(c) ? 1 : 0, doneCount(c), String(lastByClient[c.id] || c.created_at || "")];
      list.sort((a, b) => { const x = rank(a), y = rank(b);
        return (y[0] - x[0]) || (y[1] - x[1]) || y[2].localeCompare(x[2]); });
      dupes.push({ keep: list[0], extra: list.slice(1) });
      return list[0];
    });
  })();
  const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return localIso(d); };
  const quietDays = (c) => {
    const last = lastByClient[c.id] || c.created_at;
    return last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  };

  /* Whose item: a person (user id) and/or a team. */
  const implOwner = (c) => ({ user: c.implementor_id, label: c.implementor?.name || "No implementer" });
  const ownerOf = (t, c) => {
    if (t.assignee_id) return { user: t.assignee_id, label: t.assignee?.name || "Assigned" };
    const team = t.assigned_team || t.template?.owner_team;
    if (team && team !== "Implementor") return { team, label: team };
    return implOwner(c);
  };

  /* Prior payroll window, one per company (see priorPayrollState). */
  const sysBy = Object.fromEntries(sysRows.map((s) => [s.dsp_short_code, s]));
  const feinBy = Object.fromEntries(profRows.filter((p) => p.fein).map((p) => [p.dsp_short_code, String(p.fein)]));
  const apiBy = {};
  apiRows.forEach((r) => { (apiBy[r.fein] = apiBy[r.fein] || {})[r.module_key] = r; });
  const seenFein = new Set(), priorBy = {};
  clients.forEach((c) => {
    const s = sysBy[c.short_code];
    const fein = feinBy[c.short_code] || (s && s.fein ? String(s.fein) : "");
    if (!fein || seenFein.has(fein)) return;
    const st = priorPayrollState(c, s, apiBy[fein]);
    if (st) { seenFein.add(fein); priorBy[c.id] = st; }
  });

  const items = [];
  const add = (o) => items.push(o);
  active.forEach((c) => {
    const open = (c.tasks || []).filter(openish);
    const impl = implOwner(c);
    if (PAUSED_STATUSES.includes(c.status)) {
      add({ lane: "waiting", client: c, owner: impl, kind: "paused",
            title: `Client ${c.status.toLowerCase()} · ${open.length} open task${open.length === 1 ? "" : "s"} parked` });
      return;
    }
    const gl = c.tt_live_date, dl = daysUntil(gl);
    open.forEach((t) => {
      if (/^Prior Pay/i.test(t.title) && priorBy[c.id]) return;   // the window item below covers it
      const owner = ownerOf(t, c);
      let due = t.due_date || null, why = t.due_date ? "due date set on the task" : "";
      if (!due && /^Prior Pay/i.test(t.title) && gl) {
        // No punch data for this company: punches start around go-live.
        due = addDays(gl, PRIOR_WINDOW_DAYS);
        why = `${PRIOR_WINDOW_DAYS} days after go-live (${gl}); no punch data yet`;
      } else if (!due && t.template && gl) {
        const stage = t.template.phase === "audit" ? "audit" : SETUP_TASKS.includes(t.title) ? "setup" : "mig";
        due = addDays(gl, TODAY_OFFSETS[stage]);
        why = `${-TODAY_OFFSETS[stage]} days before go-live (${gl})`;
      }
      if (!due) { add({ lane: "nodate", client: c, title: t.title, owner }); return; }
      const d = daysUntil(due);
      const base = { due, d, client: c, title: t.title, owner, why, status: t.status };
      if (d < 0) add({ lane: "overdue", ...base });
      else if (d <= TODAY_WEEK) add({ lane: "week", ...base });
      else if (t.status === "In Progress") add({ lane: "flight", ...base, sub: `due ${fmtDate(due)}` });
    });
    const st = priorBy[c.id];
    if (st && st.phase === "window") {
      const d = daysUntil(st.due);
      add({ lane: d < 0 ? "overdue" : d <= TODAY_WEEK ? "week" : "flight", due: st.due, d, client: c,
            title: "Prior payroll upload", owner: { team: "Data Team", label: "Data Team" },
            why: `${PRIOR_WINDOW_DAYS} days after the first punch (${st.start})`, sub: `due ${fmtDate(st.due)}` });
    } else if (st && st.phase === "next") {
      add({ lane: "waiting", client: c, owner: { team: "Data Team", label: "Data Team" }, kind: "punch",
            title: "Prior payroll · waiting for the first punch" });
    }
    if (!isLive(c) && gl) {
      if (dl < 0) add({ lane: "overdue", due: gl, d: dl, client: c, owner: impl, kind: "golive",
                        title: "Go-live date passed · mark Live or move the date", why: "TT live date" });
      else if (dl <= TODAY_WEEK) add({ lane: "week", due: gl, d: dl, client: c, owner: impl, kind: "golive",
                                       title: "Go-live", why: "TT live date" });
    }
    if (!c.implementor_id && !isLive(c) && dl !== null && dl >= 0 && dl <= UNOWNED_WINDOW_DAYS) {
      add({ lane: "waiting", client: c, owner: { label: "Admin" }, kind: "assign",
            title: `No implementer · go-live in ${dl} day${dl === 1 ? "" : "s"}` });
    }
    if (c.status === "Live" && gl && dl !== null && dl <= 0 && dl > -HYPERCARE_DAYS) {
      add({ lane: "flight", client: c, owner: impl, kind: "hyper",
            title: "First payrolls after go-live", sub: `day ${1 - dl} of ${HYPERCARE_DAYS}` });
    }
    const q = quietDays(c);
    if (!isLive(c) && (q === null || q >= STALE_DAYS)) {
      add({ lane: "waiting", client: c, owner: impl, kind: "quiet",
            title: q === null ? "No activity logged yet" : `No activity in ${q} days` });
    }
  });

  dupes.forEach(({ keep, extra }) => add({ lane: "waiting", client: keep, owner: { label: "Admin" }, kind: "dupe",
    title: `${extra.length + 1} CRM records share code ${keep.short_code} · cancel ${extra.map((c) => `"${c.dsp_name}"`).join(", ")}` }));

  /* Scope: Mine / Data team / Everyone, remembered per browser. */
  let scope = (() => { try { return localStorage.getItem(TODAY_SCOPE_KEY); } catch { return null; } })();
  const mineItem = (it) => (it.owner?.user && it.owner.user === me.id) || (it.owner?.team && myTeams.includes(it.owner.team));
  if (!scope) scope = items.some(mineItem) ? "mine" : "all";
  const inScope = (it) => scope === "all" ? true : scope === "data" ? it.owner?.team === "Data Team" : mineItem(it);
  const dataMail = new Set(teams["Data Team"] || []);
  const mailInScope = (m) => scope === "all" ? true : scope === "data" ? dataMail.has(String(m.mailbox).toLowerCase())
    : String(m.mailbox).toLowerCase() === myEmail;

  const clientLink = (c) => `<a href="#client/${c.id}">${esc(c.dsp_name)}</a>${c.rag === "R" || c.rag === "A"
    ? ` <span class="rag rag-${c.rag}" title="RAG ${c.rag}"></span>` : ""}`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const lateLabel = (d) => `${plural(-d, "day")} late`;
  const soonLabel = (d) => d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
  const dayHead = (iso) => {
    const d = daysUntil(iso);
    if (d === 0) return "Today";
    if (d === 1) return "Tomorrow";
    return new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  };
  const owners = (list) => [...new Set(list.map((x) => x.owner?.label).filter(Boolean))].join(", ");
  const groupByClient = (list) => {
    const m = new Map();
    list.forEach((x) => { const g = m.get(x.client.id) || { client: x.client, items: [] }; g.items.push(x); m.set(x.client.id, g); });
    return [...m.values()];
  };
  const capRows = (id, rows) => rows.map((r, i) => i >= TODAY_CAP ? r.replace('class="td-row', `data-cap="${id}" class="cap-hide td-row`) : r).join("") +
    (rows.length > TODAY_CAP ? `<div class="cap-more"><button type="button" class="linkish" data-capbtn="${id}">Show all ${rows.length}</button></div>` : "");
  const detail = (list) => `<div class="td-detail">${list.map((x) => `<div><span>${esc(x.title)}</span>
      <span class="muted">${esc(x.owner?.label || "")}${x.due ? ` · due ${fmtDate(x.due)}` : ""}${x.why ? ` · ${esc(x.why)}` : ""}</span></div>`).join("")}</div>`;

  const render = () => {
    const S = items.filter(inScope);
    const lane = (k) => S.filter((x) => x.lane === k);
    const overdue = lane("overdue"), week = lane("week"), flight = lane("flight"), waiting = lane("waiting"), nodate = lane("nodate");
    const dueToday = week.filter((x) => x.d === 0);
    const mail = mailRows ? mailRows.filter(mailInScope) : null;
    const needReply = mail ? mail.filter((m) => m.state === "needs_reply") : [];

    /* Overdue: one row per client, most late first. */
    const lateGroups = groupByClient(overdue).map((g) => ({ ...g, worst: Math.min(...g.items.map((x) => x.d)) }))
      .sort((a, b) => a.worst - b.worst);
    const lateRows = lateGroups.map((g) => {
      const it = g.items.sort((a, b) => a.d - b.d);
      return `<div class="td-row td-click" tabindex="0">
        <span class="td-c">${clientLink(g.client)}</span>
        <span class="td-t">${esc(it[0].title)}${it.length > 1 ? ` <span class="muted">+${it.length - 1} more</span>` : ""}
          <span class="td-o">${esc(owners(it))}</span></span>
        <span class="td-pill bad">${lateLabel(g.worst)}</span>${detail(it)}</div>`;
    });

    /* This week: by day, then by client. */
    const days = [...new Set(week.map((x) => x.due))].sort();
    const weekHtml = days.map((day) => {
      const groups = groupByClient(week.filter((x) => x.due === day));
      return `<div class="td-day">${esc(dayHead(day))}</div>` + groups.map((g) => {
        const it = g.items.sort((a, b) => (b.kind === "golive") - (a.kind === "golive"));
        const d = it[0].d;
        return `<div class="td-row td-click" tabindex="0">
          <span class="td-c">${clientLink(g.client)}</span>
          <span class="td-t">${esc(it[0].title)}${it.length > 1 ? ` <span class="muted">+${it.length - 1} more</span>` : ""}
            <span class="td-o">${esc(owners(it))}</span></span>
          <span class="td-pill ${d === 0 ? "warn" : ""}">${soonLabel(d)}</span>${detail(it)}</div>`;
      }).join("");
    }).join("");

    const simpleRows = (list, pill) => list.map((x) => `<div class="td-row">
        <span class="td-c">${clientLink(x.client)}</span>
        <span class="td-t">${esc(x.title)}<span class="td-o">${esc(x.owner?.label || "")}</span></span>
        <span class="td-pill">${esc(pill(x))}</span></div>`);
    const flightRows = simpleRows(flight, (x) => x.sub || x.status || "");
    const WAIT_ORDER = { dupe: 0, paused: 1, assign: 2, punch: 3, quiet: 4 };
    const waitRows = simpleRows(waiting.sort((a, b) => (WAIT_ORDER[a.kind] ?? 9) - (WAIT_ORDER[b.kind] ?? 9)),
      (x) => ({ dupe: "duplicate", paused: "client", assign: "assign", punch: "first punch", quiet: "quiet" }[x.kind] || ""));

    /* Mail */
    const MAIL_ORDER = { needs_reply: 0, waiting: 1, fyi: 2 };
    const MAIL_PILL = { needs_reply: ["needs reply", "bad"], waiting: ["waiting", "warn"], fyi: ["FYI", ""] };
    const ago = (iso) => { const h = Math.round((Date.now() - new Date(iso)) / 3600000);
      return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };
    const mailHtml = mail === null
      ? `<p class="muted td-empty">Mail sync is not set up yet.</p>`
      : !mail.length ? `<p class="muted td-empty">No client mail in the last 7 days.</p>`
      : capRows("mail", mail.slice().sort((a, b) => (MAIL_ORDER[a.state] - MAIL_ORDER[b.state]) || String(b.last_date).localeCompare(String(a.last_date)))
          .map((m) => { const [lab, tone] = MAIL_PILL[m.state] || ["", ""];
            const subj = String(m.mailbox).toLowerCase() === myEmail && /^https:\/\/mail\.google\.com\//.test(m.gmail_url || "")
              ? `<a href="${esc(m.gmail_url)}" target="_blank" rel="noopener">${esc(m.subject)}</a>` : esc(m.subject);
            return `<div class="td-row td-mail"><span class="td-pill ${tone}">${lab}</span>
              <span class="td-t"><b>${esc(m.client_name || "")}</b> · ${subj}
              <span class="td-o">last: ${esc(m.last_from || "")} · ${ago(m.last_date)}${scope !== "mine" ? ` · ${esc(String(m.mailbox).split("@")[0])}'s inbox` : ""}</span></span></div>`; }));

    /* Done this week */
    const weekAgo = addDays(todayIso, -7);
    const doneTasks = active.flatMap((c) => (c.tasks || []).filter((t) => t.status === "Done" && t.done_date && t.done_date >= weekAgo)
      .map((t) => ({ owner: ownerOf(t, c) }))).filter(inScope).length;
    const wentLive = active.filter((c) => c.status === "Live" && c.tt_live_date && c.tt_live_date >= weekAgo && c.tt_live_date <= todayIso)
      .filter((c) => inScope({ owner: implOwner(c) })).length;

    const late = overdue.length, soon = week.length;
    const headline = late
      ? `${plural(late, "thing")} ${late === 1 ? "is" : "are"} late. ${soon ? `${soon} due this week.` : "Nothing else due this week."}`
      : soon ? `Nothing is late. ${soon} due this week.` : "Nothing is late and nothing is due this week.";
    const lanePanel = (id, icon, title, rows, empty, cls = "") => `<section id="lane-${id}" class="card td-lane ${cls}">
        <h2>${icon} ${title}<span class="cnt">${rows.length}</span></h2>
        ${rows.length ? capRows(id, rows) : `<p class="muted td-empty">${empty}</p>`}</section>`;
    const k = (id, label, n, tone) => `<button type="button" class="td-k ${n ? tone : ""}" data-jump="lane-${id}">${label}<b>${n}</b></button>`;
    const SCOPES = [["mine", "Mine"], ["data", "Data team"], ["all", "Everyone"]];

    view.innerHTML = `<div class="td-head">
        <div><h1>${esc(headline)}</h1>
          <span class="muted">${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}${needReply.length ? ` · ${plural(needReply.length, "mail")} waiting for your reply` : ""}</span></div>
        <div class="td-scope" role="group" aria-label="Whose work">${SCOPES.map(([v, l]) =>
          `<button type="button" class="${scope === v ? "on" : ""}" data-scope="${v}">${l}</button>`).join("")}</div></div>
      <div class="td-ks">
        ${k("overdue", "Overdue", late, "bad")}${k("week", "Due today", dueToday.length, "warn")}
        ${k("week", "Next 7 days", soon - dueToday.length, "")}${k("waiting", "Waiting on others", waiting.length, "")}
        ${k("flight", "In flight", flight.length, "")}</div>
      <div class="td-grid"><div>
        ${lanePanel("overdue", "⚠", `Overdue <span class="muted td-sub">· ${plural(lateGroups.length, "client")}, most late first</span>`, lateRows, "Nothing is late.", "td-bad")}
        <section id="lane-week" class="card td-lane"><h2>📅 This week<span class="cnt">${soon}</span></h2>
          ${soon ? weekHtml : `<p class="muted td-empty">Nothing due in the next ${TODAY_WEEK} days.</p>`}
          ${nodate.length ? `<p class="muted td-foot">${plural(nodate.length, "open task")} ${nodate.length === 1 ? "has" : "have"} no date: the client has no go-live date set.</p>` : ""}</section>
        ${lanePanel("flight", "▶", "In flight", flightRows, "Nothing in progress right now.")}
        ${lanePanel("waiting", "⏳", "Waiting on others", waitRows, "Nothing is stuck.")}
      </div><div>
        <section id="lane-mail" class="card td-lane"><h2>✉ Mail <span class="muted td-sub">· last 7 days</span><span class="cnt">${mail ? mail.length : 0}</span></h2>${mailHtml}</section>
        <section class="card td-lane"><h2>✓ Done this week</h2>
          <p class="td-done"><b>${doneTasks}</b> tasks closed · <b>${wentLive}</b> went live</p></section>
      </div></div>`;

    view.querySelectorAll("[data-scope]").forEach((b) => (b.onclick = () => {
      scope = b.dataset.scope;
      try { localStorage.setItem(TODAY_SCOPE_KEY, scope); } catch { /* private mode */ }
      render();
    }));
    view.querySelectorAll("[data-jump]").forEach((b) => (b.onclick = () =>
      document.getElementById(b.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" })));
    view.querySelectorAll("[data-capbtn]").forEach((b) => (b.onclick = () => {
      view.querySelectorAll(`[data-cap="${b.dataset.capbtn}"]`).forEach((r) => r.classList.remove("cap-hide"));
      b.closest(".cap-more").remove();
    }));
    view.querySelectorAll(".td-click").forEach((r) => {
      const toggle = (e) => { if (e.target.closest("a")) return; r.classList.toggle("open"); };
      r.onclick = toggle;
      r.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(e); } };
    });
  };
  render();
};

Views.renderAuditStatus = async (view) => {
  const clients = (await Store.listClients()).filter(isMigrating);
  const auditTasks = (c) => (c.tasks || [])
    .filter((t) => t.template?.phase === "audit")
    .sort((a, b) => (a.template?.sort_order ?? 0) - (b.template?.sort_order ?? 0));
  const colTitles = [];
  clients.forEach((c) => auditTasks(c).forEach((t) => {
    if (!colTitles.includes(t.title)) colTitles.push(t.title);
  }));
  const doneish = (t) => t.status === "Done" || t.status === "N/A";
  const clientState = (c) => {
    const ts = auditTasks(c);
    if (!ts.length) return "none";
    return ts.every(doneish) ? "done" : "pending";
  };
  const matches = () => clients.filter((c) =>
    (!auditQuery || (c.dsp_name + " " + c.short_code).toLowerCase().includes(auditQuery)) &&
    (auditFilter === "all" || clientState(c) === auditFilter));

  const cellPill = (t) => t ? statusPill(t.status) : `<span class="muted">—</span>`;
  const rowHtml = (c) => {
    const byTitle = Object.fromEntries(auditTasks(c).map((t) => [t.title, t]));
    const ts = auditTasks(c);
    const p = ts.length ? Math.round(ts.filter(doneish).length / ts.length * 100) : 0;
    return `<tr class="rowlink" data-id="${c.id}">
      <td><b>${esc(c.dsp_name)}</b><div class="muted" style="font-size:11px">${esc(c.implementor?.name || "—")}</div></td>
      ${colTitles.map((title) => `<td>${cellPill(byTitle[title])}</td>`).join("")}
      <td><span class="bar"><span style="width:${p}%"></span></span> ${p}%</td></tr>`;
  };

  let page = 0;
  const render = () => {
    const list = matches();
    const pg = pageSlice(list, page); page = pg.p;
    $("#audit-rows").innerHTML = pg.rows.map(rowHtml).join("") ||
      `<tr><td colspan="${colTitles.length + 2}" class="muted">No clients match.</td></tr>`;
    $("#audit-pager").innerHTML = pagerHtml("aud", pg.p, pg.pages, list.length);
    hookPager("aud", (d) => { page += d; render(); });
    $("#audit-count").textContent = `${list.length} of ${clients.length} migrating clients`;
    wireClientRows(view);
  };

  view.innerHTML = `
    <div class="page-head"><h1>Audit Status</h1><span id="audit-count" class="muted"></span></div>
    <div class="filter-bar">
      <input id="as-q" type="search" placeholder="Search client…" value="${esc(auditQuery)}">
      <select id="as-filter">
        <option value="all" ${auditFilter === "all" ? "selected" : ""}>All</option>
        <option value="done" ${auditFilter === "done" ? "selected" : ""}>All done</option>
        <option value="pending" ${auditFilter === "pending" ? "selected" : ""}>Pending</option>
      </select>
    </div>
    <div style="overflow-x:auto"><table class="grid"><thead><tr>
      <th>Client</th>${colTitles.map((t) => `<th>${esc(t.replace(" Audit", ""))}</th>`).join("")}<th>Done</th>
    </tr></thead><tbody id="audit-rows"></tbody></table></div>
    <div id="audit-pager"></div>`;
  $("#as-q").oninput = (e) => { auditQuery = e.target.value.trim().toLowerCase(); page = 0; render(); };
  $("#as-filter").onchange = (e) => { auditFilter = e.target.value; page = 0; render(); };
  render();
};

Views.renderClients = async (view) => {
  const clients = await Store.listClients();
  const state = { q: "", status: "", vendor: "", rag: "", dfield: "tt_live_date" };
  const dRange = { from: "", to: "" };  // applies to state.dfield
  const matches = () => clients.filter((c) =>
    (!state.q || (c.dsp_name + " " + c.short_code).toLowerCase().includes(state.q)) &&
    (!state.status || c.status === state.status) &&
    (!state.vendor || (c.vendor || "—") === state.vendor) &&
    (!state.rag || (c.rag || "") === state.rag) &&
    dfPass(c[state.dfield], dRange));
  view.innerHTML = `
    <div class="page-head"><h1>Clients</h1><button id="new-client" type="button">+ New client</button></div>
    <div class="filter-bar">
      <input id="cf-q" type="search" placeholder="Search DSP name or code…">
      <select id="cf-status"><option value="">All statuses</option>
        ${CLIENT_STATUS_OPTS.map((s) => `<option>${s}</option>`).join("")}</select>
      <select id="cf-vendor"><option value="">All previous systems</option>
        <option>ADP</option><option>Paycom</option><option>New</option><option value="—">Not set</option></select>
      <select id="cf-rag"><option value="">All RAG</option>
        <option value="G">Green</option><option value="A">Amber</option><option value="R">Red</option></select>
      <select id="cf-dfield">
        <option value="tt_live_date">TT live</option>
        <option value="first_pay_date">First pay</option>
        <option value="payroll_cutoff_date">Payroll cutoff</option>
      </select>
      ${dfHtml("cli", dRange)}
      <span id="cf-count" class="muted"></span>
    </div>
    <table class="grid">${CLIENT_TABLE_HEAD}<tbody id="client-rows"></tbody></table>
    <div id="cf-pager"></div>
    <div class="modal-backdrop" id="nc-modal">
      <div class="modal">
        <h2>New client</h2>
        <form id="nc-form">
          <label>DSP name <input id="nc-name" required></label>
          <label>Short code <input id="nc-code" maxlength="8"></label>
          <label>Previous system <select id="nc-vendor" required>
            <option value="">Choose…</option><option>ADP</option><option>Paycom</option><option>New</option></select></label>
          <label>Time Tracking live date <input id="nc-tt" type="date"></label>
          <label>Payroll live date <input id="nc-pay" type="date"></label>
          <div class="actions">
            <button type="button" class="secondary" id="nc-cancel">Cancel</button>
            <button type="submit">Create</button>
          </div>
        </form>
      </div>
    </div>`;
  let page = 0;
  const renderRows = () => {
    const list = matches();
    const pg = pageSlice(list, page); page = pg.p;
    $("#client-rows").innerHTML = pg.rows.map(clientRow).join("") ||
      `<tr><td colspan="9" class="muted">No clients match.</td></tr>`;
    $("#cf-pager").innerHTML = pagerHtml("cli", pg.p, pg.pages, list.length);
    hookPager("cli", (d) => { page += d; renderRows(); });
    $("#cf-count").textContent = `${list.length} of ${clients.length}`;
    wireClientRows(view);
  };
  $("#cf-q").oninput = (e) => { state.q = e.target.value.trim().toLowerCase(); page = 0; renderRows(); };
  $("#cf-status").onchange = (e) => { state.status = e.target.value; page = 0; renderRows(); };
  $("#cf-vendor").onchange = (e) => { state.vendor = e.target.value; page = 0; renderRows(); };
  $("#cf-rag").onchange = (e) => { state.rag = e.target.value; page = 0; renderRows(); };
  $("#cf-dfield").onchange = (e) => { state.dfield = e.target.value; page = 0; renderRows(); };
  wireDateFilter("cli", dRange, () => { page = 0; renderRows(); });
  const modal = $("#nc-modal");
  $("#new-client").onclick = () => { modal.classList.add("open"); $("#nc-name").focus(); };
  $("#nc-cancel").onclick = () => modal.classList.remove("open");
  modal.onclick = (e) => { if (e.target === modal) modal.classList.remove("open"); };
  $("#nc-form").onsubmit = (e) => {
    e.preventDefault();
    guard(async () => {
      const c = await Store.createClient({
        dsp_name: $("#nc-name").value.trim(),
        short_code: $("#nc-code").value.trim().toUpperCase(),
        vendor: $("#nc-vendor").value || null,
        tt_live_date: $("#nc-tt").value || null,
        first_pay_date: $("#nc-pay").value || null,
      });
      toast("Client created", true);
      location.hash = `#client/${c.id}`;
    });
  };
  renderRows();
};

Views.renderClientDetail = async (view, id) => {
  const me = Store.getMe();
  const isAdmin = me.role === "admin";
  const dis = isAdmin ? "" : "disabled";
  const [c, users, activity, teams] = await Promise.all([Store.getClient(id), Store.listUsers(), Store.getActivity(id), Store.getTeams()]);
  const active = users.filter((u) => u.active);
  const userOpts = (sel) => `<option value="">Unassigned</option>` + active.map((u) =>
    `<option value="${u.id}" ${u.id === sel ? "selected" : ""}>${esc(u.name)}</option>`).join("");
  const tasksFor = (phase) => c.tasks
    .filter((t) => (t.template ? t.template.phase === phase : phase === "onboarding"))
    .sort((a, b) => (a.template?.sort_order ?? 999) - (b.template?.sort_order ?? 999) || a.id - b.id);

  const myEmail = (me.email || "").toLowerCase();
  const myTeams = Object.entries(teams).filter(([, list]) => list.includes(myEmail)).map(([t]) => t);
  const canWork = (t) => {
    if (isAdmin) return true;
    if (t.assignee_id) return t.assignee_id === me.id;
    if (t.assigned_team) return myTeams.includes(t.assigned_team);
    const team = t.template?.owner_team;
    if (!team || team === "Implementor") return c.implementor_id === me.id;
    return myTeams.includes(team);
  };

  const todayIsoLocal = (() => { const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; })();
  const ownerCell = (t) => {
    const label = effectiveOwnerLabel(t, c);
    if (!isAdmin) return esc(label);
    const cur = t.assignee_id ? `u:${t.assignee_id}` : (t.assigned_team ? `t:${t.assigned_team}` : "");
    return `<select class="t-owner">
      <option value="" ${cur === "" ? "selected" : ""}>Auto (${esc(derivedOwnerLabel(t, c))})</option>
      ${TEAM_NAMES.map((x) => `<option value="t:${x}" ${cur === "t:" + x ? "selected" : ""}>${x}</option>`).join("")}
      ${active.map((u) => `<option value="u:${u.id}" ${cur === "u:" + u.id ? "selected" : ""}>${esc(u.name)}</option>`).join("")}
    </select>`;
  };
  const taskRow = (t) => {
    const editable = canWork(t);
    const notes = (t.task_notes || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    const noteLine = (n) =>
      `<div class="note">"${clampHtml(n.note)}" — ${esc(n.author?.name || "sync")}, ${n.created_at.slice(0, 10)}</div>`;
    const due = !t.template_id && t.due_date
      ? ` <span class="${t.due_date < todayIsoLocal && t.status !== "Done" ? "overdue" : "muted"}">due ${t.due_date}</span>` : "";
    const selCls = { "Done": "sel-done", "In Progress": "sel-inprogress", "N/A": "sel-na" }[t.status] || "";
    return `<tr data-task="${t.id}">
      <td>${esc(t.title)}${!t.template_id ? ` <span class="chip">ad-hoc</span>` : ""}${due}</td>
      <td>${ownerCell(t)}</td>
      <td>${editable
        ? `<select class="t-status ${selCls}">${STATUS_OPTS.map((s) => `<option ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select>`
        : statusPill(t.status)}</td>
      <td class="notes-cell">
        ${notes.length ? noteLine(notes[0]) : `<span class="muted">no notes</span>`}
        ${notes.length > 1 ? `<details><summary class="muted">${notes.length - 1} more</summary>${notes.slice(1).map(noteLine).join("")}</details>` : ""}
        ${editable ? `<button class="t-note small secondary" type="button">+ note</button>` : ""}
      </td></tr>`;
  };

  const modNotes = (mod) => (c.client_notes || [])
    .filter((n) => n.scope === mod)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const moduleRow = (m) => { const notes = modNotes(m.module); const latest = notes[0];
    return `<tr data-mod="${m.id}" data-module="${m.module}">
    <td>${m.module}</td>
    <td><input type="checkbox" class="m-opted" ${m.opted ? "checked" : ""} ${dis}></td>
    <td><input type="checkbox" class="m-training" ${m.training_done ? "checked" : ""} ${dis}></td>
    <td><input type="date" class="m-date" value="${m.training_date || ""}" ${dis}></td>
    <td class="notes-cell">
      ${latest ? `<div class="note">"${clampHtml(latest.note)}" — ${esc(latest.author?.name || "sync")}, ${latest.created_at.slice(0, 10)}</div>` : `<span class="muted">no notes</span>`}
      ${notes.length > 1 ? `<details><summary class="muted">${notes.length - 1} more</summary>${notes.slice(1).map((n) => `<div class="note">"${clampHtml(n.note)}" — ${esc(n.author?.name || "sync")}, ${n.created_at.slice(0, 10)}</div>`).join("")}</details>` : ""}
      <button class="m-note small secondary" type="button">+ note</button>
    </td></tr>`; };

  view.innerHTML = `
    <div class="page-head">
      <h1>${esc(c.dsp_name)} <span class="muted">${esc(c.short_code)}</span></h1>
      <span style="display:flex;gap:14px;align-items:center">
        ${isDriveUrl(c.drive_folder_url)
          ? `<a class="btn-refresh" href="${esc(c.drive_folder_url)}" target="_blank" rel="noopener noreferrer"
               title="Open this client's folder under Amazon DSP in Google Drive">📁 Drive folder</a>`
          : isAdmin ? `<span class="muted" style="font-size:12px">No Drive folder linked — add it under Details</span>` : ""}
        <button type="button" class="btn-refresh" id="c-ecr"
          title="Who changed which employee profile or payment method field, when, and from where">Change reports</button>
        <a href="#${isAdmin ? "clients" : "my-clients"}">← back</a>
      </span>
    </div>
    <div class="card c360-hero">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${statusPill(c.status)}
        ${c.rag ? `<span class="rag rag-${esc(c.rag)}" title="RAG ${esc(c.rag)}"></span>` : ""}
        ${(() => { const d = daysUntil(c.tt_live_date);
                   return d === null ? "" : `<span class="chip"><b>${countdownLabel(d)}</b></span>`; })()}
        ${(() => { const m = (c.notes || "").match(/coverage:\s*(.+?)\s*\(last checked/i);
                   return m ? `<span class="chip">Audit folder ${esc(m[1])}</span>` : ""; })()}
        <span id="cd-chips" style="display:contents"></span>
      </div>
      <div id="c360-journey" class="journey-wrap">${journeyHtml(c)}</div>
    </div>
    <div class="c360">
    <div class="c360-main">
    ${isMigrating(c) ? `<div class="tabbar">
      <button id="tab-onb" class="active" type="button">Onboarding (${tasksFor("onboarding").length})</button>
      <button id="tab-aud" type="button">Audit (${tasksFor("audit").length})</button>
    </div>` : ""}
    <div id="task-area"></div>
    ${isAdmin ? `<div class="card" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
      <input id="adhoc-title" placeholder="Ad-hoc task title" style="flex:1;min-width:180px">
      <input id="adhoc-due" type="date">
      <button id="adhoc-add" type="button">Add task</button>
    </div>` : ""}
    <div class="card" style="margin-top:14px">
      <h2 style="margin-top:0">Modules &amp; training</h2>
      <table class="grid"><thead><tr><th>Module</th><th>Opted</th><th>Training done</th><th>Training date</th><th>Notes</th></tr></thead>
      <tbody>${c.client_modules.slice()
        .sort((a, b) => CONFIG.MODULES.indexOf(a.module) - CONFIG.MODULES.indexOf(b.module))
        .map(moduleRow).join("")}</tbody></table>
    </div>
    </div>
    <aside class="c360-side">
    <div class="card">
      <h2 style="margin-top:0">Details</h2>
      <div class="head-grid">
      <label>Status <select id="c-status" ${dis}>
        ${CLIENT_STATUS_OPTS.map((s) => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}
      </select></label>
      <label>RAG <select id="c-rag" ${dis}>
        ${["", "G", "A", "R"].map((r) => `<option value="${r}" ${r === (c.rag || "") ? "selected" : ""}>${r || "—"}</option>`).join("")}
      </select></label>
      <label>Previous System <select id="c-vendor" ${dis}>
        ${["", "ADP", "Paycom", "New"].map((v) => `<option value="${v}" ${v === (c.vendor || "") ? "selected" : ""}>${v || "—"}</option>`).join("")}
      </select></label>
      <label>Implementor <select id="c-imp" ${dis}>${userOpts(c.implementor_id)}</select></label>
      <label>TT live <input id="c-tt" type="date" value="${c.tt_live_date || ""}" ${dis}></label>
      <label>Payroll cutoff <input id="c-cutoff" type="date" value="${c.payroll_cutoff_date || ""}" ${dis}></label>
      <label>First pay <input id="c-pay" type="date" value="${c.first_pay_date || ""}" ${dis}></label>
      <label style="grid-column:1/-1">Drive folder
        <input id="c-drive" type="url" placeholder="https://drive.google.com/drive/folders/…"
          value="${esc(c.drive_folder_url || "")}" style="max-width:none" ${dis}></label>
      </div>
    </div>
    <div id="cd-glance"></div>
    <div id="cd-platform" style="margin-top:14px"></div>
    <div class="card" style="margin-top:14px">
      <h2 style="margin-top:0">Company notes</h2>
      <div id="company-notes">
      ${(() => { const notes = modNotes("Company");
        return notes.length ? notes.map((n) => `<div class="act-row"><span class="when">${n.created_at.slice(0, 10)}</span> <b>${esc(n.author?.name || "sync")}</b> ${clampHtml(n.note)}</div>`).join("") : `<p class="muted">No company notes yet.</p>`; })()}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input id="company-note-input" placeholder="Add a company-level note…" style="flex:1">
        <button id="company-note-add" type="button">Add</button>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <h2 style="margin-top:0">Activity
        <span class="tabbar" style="display:inline-flex;margin:0 0 0 10px;gap:4px">
          <button type="button" class="small secondary" data-actf="7">7d</button>
          <button type="button" class="small secondary" data-actf="30">30d</button>
          <button type="button" class="small secondary active" data-actf="0">All</button>
        </span></h2>
      <div id="act-list"></div>
    </div>
    </aside>
    </div>`;

  // Activity re-renders client-side on the 7d/30d/All picks - no refetch.
  const renderActivity = (days) => {
    let list = activity;
    if (days) {
      const cut = new Date(); cut.setDate(cut.getDate() - days);
      const iso = cut.toISOString().slice(0, 10);
      list = activity.filter((a) => String(a.created_at).slice(0, 10) >= iso);
    }
    const rowA = (a) => `<div class="act-row">
        <span class="when">${a.created_at.slice(0, 16).replace("T", " ")}</span>
        <b>${esc(a.actor?.name || "sync")}</b> ${clampHtml(a.detail)}</div>`;
    const rest = list.slice(8);
    $("#act-list").innerHTML = list.length
      ? list.slice(0, 8).map(rowA).join("") + (rest.length
          ? `<details><summary class="muted">${rest.length} older entries</summary>${rest.map(rowA).join("")}</details>` : "")
      : `<p class="muted">${days ? `Nothing in the last ${days} days.` : "No activity recorded yet."}</p>`;
  };
  view.querySelectorAll("[data-actf]").forEach((b) => b.onclick = () => {
    view.querySelectorAll("[data-actf]").forEach((x) => x.classList.toggle("active", x === b));
    renderActivity(Number(b.dataset.actf));
  });
  renderActivity(0);

  // Fills #cd-platform from the read-only reporting tables (views-data.js).
  // Fire-and-forget: the core page never waits on it and never breaks with it.
  if (typeof loadPlatformPanel === "function") loadPlatformPanel(c);
  $("#c-ecr").onclick = () => guard(async () => {
    if (typeof changeReportDrawer !== "function") throw new Error("Change report is not loaded — refresh the page.");
    changeReportDrawer(c, await Store.getClientFein(c.short_code));
  });

  const reload = () => Views.renderClientDetail(view, id);

  view.querySelectorAll("tr[data-mod] .m-note").forEach((btn) => {
    btn.onclick = () => guard(async () => {
      const scope = btn.closest("tr").dataset.module;
      const note = prompt(`${scope} note:`);
      if (note && note.trim()) { await Store.addClientNote(id, scope, note.trim()); toast("Note added", true); reload(); }
    });
  });

  $("#company-note-add").onclick = () => guard(async () => {
    const note = $("#company-note-input").value.trim();
    if (!note) return;
    await Store.addClientNote(id, "Company", note);
    toast("Note added", true);
    reload();
  });

  const renderTasks = (phase) => {
    const tb = $("#tab-onb"); if (tb) tb.classList.toggle("active", phase === "onboarding");
    const ta = $("#tab-aud"); if (ta) ta.classList.toggle("active", phase === "audit");
    $("#task-area").innerHTML = `<table class="grid"><thead><tr>
      <th>Task</th><th>Assignee</th><th>Status</th><th>Notes</th></tr></thead>
      <tbody>${tasksFor(phase).map(taskRow).join("")}</tbody></table>`;
    $("#task-area").querySelectorAll("tr[data-task]").forEach((row) => {
      const tid = Number(row.dataset.task);
      const t = c.tasks.find((x) => x.id === tid);
      const st = row.querySelector(".t-status");
      if (st) st.onchange = () => guard(async () => {
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
      const ow = row.querySelector(".t-owner");
      if (ow) ow.onchange = () => {
        const v = ow.value;
        const patch = v.startsWith("u:") ? { assignee_id: v.slice(2), assigned_team: null }
                    : v.startsWith("t:") ? { assignee_id: null, assigned_team: v.slice(2) }
                    : { assignee_id: null, assigned_team: null };
        const prev = { assignee_id: t.assignee_id, assigned_team: t.assigned_team };
        saveChange(`${t.title} → ${ow.options[ow.selectedIndex].text}`,
          () => Store.updateTask(tid, patch),
          () => Store.updateTask(tid, prev),
          reload);
      };
    });
  };
  const tabOnb = $("#tab-onb"); if (tabOnb) tabOnb.onclick = () => renderTasks("onboarding");
  const tabAud = $("#tab-aud"); if (tabAud) tabAud.onclick = () => renderTasks("audit");
  renderTasks("onboarding");

  if (isAdmin) {
    const FIELD_LABELS = {
      status: "Status", rag: "RAG", vendor: "Previous System", implementor_id: "Implementor",
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
    $("#c-drive").onchange = (e) => {
      const v = e.target.value.trim();
      if (v && !isDriveUrl(v)) { toast("Paste a Google Drive link (https://drive.google.com/…)"); e.target.value = c.drive_folder_url || ""; return; }
      const prev = c.drive_folder_url;
      saveChange(v ? "Drive folder linked" : "Drive folder link removed",
        () => Store.updateClient(id, { drive_folder_url: v || null }),
        () => Store.updateClient(id, { drive_folder_url: prev }),
        reload);
    };

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
        due_date: $("#adhoc-due").value || null,
      });
      toast("Task added", true);
      reload();
    });
  }
};

Views.renderOpenItems = async (view) => {
  const [open, done] = await Promise.all([Store.listOpenTasks(), Store.listDoneTasks()]);
  const openRow = (t) => `<tr>
    <td><a href="#client/${t.client_id}">${esc(t.client?.dsp_name)}</a></td>
    <td>${esc(t.title)}</td>
    <td>${statusPill(t.status)}</td>
    <td class="notes-cell">${latestNote(t)}</td></tr>`;
  const doneRow = (t) => `<tr>
    <td><a href="#client/${t.client_id}">${esc(t.client?.dsp_name)}</a></td>
    <td>${esc(t.title)}</td>
    <td>${esc(effectiveOwnerLabel(t, t.client))}</td>
    <td>${fmtDate(t.done_date)}</td>
    <td class="notes-cell">${latestNote(t)}</td></tr>`;
  // The open groups are small per owner; only the done history grows without
  // bound (capped at 100 by the query), so that is the paginated half.
  let donePage = 0, overdueOnly = false;
  const doneRange = { from: "", to: "" };
  const today = new Date().toISOString().slice(0, 10);
  const renderView = () => {
    const shownOpen = overdueOnly
      ? open.filter((t) => t.due_date && t.due_date < today && t.status !== "Done")
      : open;
    const groups = {};
    shownOpen.forEach((t) => { const k = effectiveOwnerLabel(t, t.client); (groups[k] = groups[k] || []).push(t); });
    const order = Object.keys(groups).sort();
    const shownDone = done.filter((t) => dfPass(t.done_date, doneRange));
    const pg = pageSlice(shownDone, donePage); donePage = pg.p;
    view.innerHTML = `<div class="page-head"><h1>Open Items</h1>
        <span class="muted">${shownOpen.length} open across ${order.length} owners</span></div>
      <div class="filter-bar"><label style="display:inline-flex;align-items:center;gap:5px">
        <input type="checkbox" id="oi-overdue" ${overdueOnly ? "checked" : ""}> overdue only (dated ad-hoc tasks)</label></div>` +
      (shownOpen.length ? order.map((who) => `
        <h2>${esc(who)} <span class="muted">(${groups[who].length})</span></h2>
        <table class="grid"><thead><tr>
          <th>Client</th><th>Task</th><th>Status</th><th>Latest note</th></tr></thead>
        <tbody>${groups[who].map(openRow).join("")}</tbody></table>`).join("")
        : `<p class="muted">${overdueOnly ? "Nothing overdue." : "Nothing open — all work is done."}</p>`) +
      `<h2>Recently done <span class="muted">(${shownDone.length} of last ${done.length})</span> ${dfHtml("done", doneRange)}</h2>
       <table class="grid"><thead><tr>
         <th>Client</th><th>Task</th><th>Owner</th><th>Done</th><th>Note</th></tr></thead>
       <tbody>${pg.rows.map(doneRow).join("") || `<tr><td colspan="5" class="muted">nothing in this range</td></tr>`}</tbody></table>` +
      pagerHtml("done", pg.p, pg.pages, shownDone.length);
    hookPager("done", (d) => { donePage += d; renderView(); });
    $("#oi-overdue").onchange = (e) => { overdueOnly = e.target.checked; renderView(); };
    wireDateFilter("done", doneRange, () => { donePage = 0; renderView(); });
  };
  renderView();
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
