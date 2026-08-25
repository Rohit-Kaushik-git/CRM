/* Data layer — every Supabase call goes through Store. UI never touches supabase directly. */
window.Store = (() => {
  const sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  let me = null; // row from public.users for the signed-in person

  function fail(error) { throw new Error(error.message || "Request failed"); }

  async function signUp(name, email, password) {
    if (!/@uzio\.com$/i.test(email.trim())) throw new Error("Use your @uzio.com email");
    const { error } = await sb.auth.signUp({
      email: email.trim(), password, options: { data: { name } },
    });
    if (error) fail(error);
  }

  async function signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) fail(error);
  }

  async function signOut() { await sb.auth.signOut(); me = null; }

  async function loadMe() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { me = null; return null; }
    const { data, error } = await sb.from("users").select("*").eq("id", session.user.id).single();
    if (error) fail(error);
    me = data;
    return me;
  }

  const getMe = () => me;

  async function resetPassword(email) {
    if (!/@uzio\.com$/i.test(email.trim())) throw new Error("Enter your @uzio.com email first");
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) fail(error);
  }

  async function updatePassword(password) {
    const { error } = await sb.auth.updateUser({ password });
    if (error) fail(error);
  }

  function onPasswordRecovery(cb) {
    sb.auth.onAuthStateChange((event) => { if (event === "PASSWORD_RECOVERY") cb(); });
  }

  async function listUsers() {
    const { data, error } = await sb.from("users").select("*").order("name");
    if (error) fail(error);
    return data;
  }

  async function updateUser(id, patch) {
    const { error } = await sb.from("users").update(patch).eq("id", id);
    if (error) fail(error);
  }

  async function getAdminEmails() {
    const { data, error } = await sb.from("app_config").select("value").eq("key", "admin_emails").single();
    if (error) fail(error);
    return data.value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  async function setAdminEmails(list) {
    const { error } = await sb.from("app_config").update({ value: list.join(",") }).eq("key", "admin_emails");
    if (error) fail(error);
  }

  async function listClients() {
    const { data, error } = await sb.from("clients")
      .select(`*, implementor:users(name),
               tasks(id,title,status,assignee_id,due_date,
                     template:task_templates(phase),
                     assignee:users!tasks_assignee_id_fkey(name)),
               client_modules(module,opted,training_done)`)
      .order("dsp_name");
    if (error) fail(error);
    return data;
  }

  async function getClient(id) {
    const { data, error } = await sb.from("clients")
      .select(`*, implementor:users(name), client_modules(*),
               tasks(*, template:task_templates(phase,sort_order), assignee:users!tasks_assignee_id_fkey(name),
                     task_notes(note,created_at,author:users(name)))`)
      .eq("id", id).single();
    if (error) fail(error);
    return data;
  }

  async function createClient(fields) {
    const { data, error } = await sb.from("clients").insert(fields).select().single();
    if (error) fail(error);
    return data;
  }

  async function updateClient(id, patch) {
    const { error } = await sb.from("clients").update(patch).eq("id", id);
    if (error) fail(error);
  }

  async function updateModule(id, patch) {
    const { error } = await sb.from("client_modules").update(patch).eq("id", id);
    if (error) fail(error);
  }

  async function createTask(fields) { // ad-hoc task: template_id stays null
    const { error } = await sb.from("tasks").insert({ ...fields, created_by: me.id });
    if (error) fail(error);
  }

  async function updateTask(id, patch) {
    const { error } = await sb.from("tasks").update(patch).eq("id", id);
    if (error) fail(error);
  }

  async function addNote(taskId, note) {
    const { error } = await sb.from("task_notes").insert({ task_id: taskId, author_id: me.id, note });
    if (error) fail(error);
  }

  function openItemsQuery() {
    return sb.from("tasks")
      .select(`*, client:clients(dsp_name,short_code), assignee:users!tasks_assignee_id_fkey(name),
               task_notes(note,created_at,author:users(name))`)
      .not("assignee_id", "is", null);
  }

  async function listOpenItems(assigneeId) {
    let q = openItemsQuery().in("status", ["Open", "In Progress"])
      .order("due_date", { ascending: true, nullsFirst: false });
    if (assigneeId) q = q.eq("assignee_id", assigneeId);
    const { data, error } = await q;
    if (error) fail(error);
    return data;
  }

  async function listDoneItems(assigneeId) {
    let q = openItemsQuery().eq("status", "Done")
      .order("done_date", { ascending: false, nullsFirst: false }).limit(100);
    if (assigneeId) q = q.eq("assignee_id", assigneeId);
    const { data, error } = await q;
    if (error) fail(error);
    return data;
  }

  async function listLastActivity() {
    const { data, error } = await sb.from("client_last_activity").select("*");
    if (error) fail(error);
    return data;
  }

  async function getActivity(clientId) {
    const { data, error } = await sb.from("activity_log")
      .select("*, actor:users(name)")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) fail(error);
    return data;
  }

  return { signUp, signIn, signOut, loadMe, getMe, resetPassword, updatePassword, onPasswordRecovery, listUsers, updateUser,
           getAdminEmails, setAdminEmails, listClients, getClient, createClient,
           updateClient, updateModule, createTask, updateTask, addNote,
           listOpenItems, listDoneItems, listLastActivity, getActivity };
})();
