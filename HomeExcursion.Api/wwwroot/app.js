const state = {
  data: null,
  expenses: [],
  expenseFilter: "",
  expenseProject: "",
  expenseSort: "newest",
  filter: "open",
  area: "",
  sort: "smart"
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const moneyExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

document.addEventListener("DOMContentLoaded", () => {
  bindFilters();
  bindAreaFilter();
  bindTaskSort();
  bindTaskEditor();
  bindProjectDetails();
  bindExpenseEditor();
  bindExpenseFilters();
  bindExpenseNavigation();
  bindImageViewer();
  loadDashboard();
});

async function loadDashboard() {
  try {
    const response = await fetch("/api/home/dashboard", { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`Dashboard request failed (${response.status})`);
    state.data = await response.json();
    populateAreaControls();
    render();
    await loadExpenses();
  } catch (error) {
    console.error(error);
    document.querySelector("#tasks").innerHTML = `<div class="empty">Could not load Home Excursion.</div>`;
    document.querySelector("#projects").innerHTML = `<div class="empty">Could not load project data.</div>`;
    showToast("Couldn't load the dashboard.");
  }
}

function render() {
  renderHeader();
  renderSummary();
  renderProjects();
  renderMaintenance();
  renderTasks();
}

function renderHeader() {
  const { property, summary } = state.data;
  document.querySelector("#propertyName").textContent = property.name;
  const location = [property.city, property.state].filter(Boolean).join(", ");
  document.querySelector("#propertyLocation").textContent = [location, property.postalCode].filter(Boolean).join(" ");
  document.querySelector("#progressPercent").textContent = `${summary.progressPercent}%`;
  document.querySelector("#progressBar").style.width = `${summary.progressPercent}%`;
}

function renderSummary() {
  const s = state.data.summary;
  document.querySelector("#spent").textContent = money.format(Number(s.spent) || 0);
  document.querySelector("#maintenance").textContent = money.format(Number(s.maintenance) || 0);
  document.querySelector("#committed").textContent = money.format(Number(s.committed) || 0);
  document.querySelector("#estimated").textContent = money.format(Number(s.estimated) || 0);
  document.querySelector("#progressCount").textContent = `${s.completeItems} / ${s.totalItems}`;
}

function renderProjects() {
  const container = document.querySelector("#projects");
  const projects = [...state.data.projects];

  // Keep child projects in the data model for project-detail drill-down,
  // but only show top-level projects on the dashboard.
  const roots = projects
    .filter(project => project.parentProjectId == null)
    .sort((a, b) =>
      projectStatusRank(a) - projectStatusRank(b) ||
      projectDateRank(a) - projectDateRank(b) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.name.localeCompare(b.name)
    );

  if (!roots.length) {
    container.innerHTML = `<div class="empty">No projects yet.</div>`;
    return;
  }

  container.innerHTML = roots.map(project => {
    const status = (project.status || "").toLowerCase();
    const complete = status === "complete";
    const attention = !complete && status !== "planned";
    const badgeClass = complete ? "complete" : (attention ? "attention" : "");
    const estimate = project.estimatedCost != null
      ? `<div class="project-cost">${money.format(project.estimatedCost)} estimated</div>`
      : "";
    const spent = Number(project.actualSpent || 0);
    const spentLine = spent > 0
      ? `<div class="project-spend">${money.format(spent)} spent</div>`
      : "";
    const meta = [project.purpose, project.contractorName].filter(Boolean).join(" · ");

    return `<section class="project-card" role="button" tabindex="0" data-project-id="${project.id}" aria-label="Open ${escapeAttribute(project.name)} details">
      <div class="project-top">
        <div>
          <h3 class="project-name">${escapeHtml(project.name)}</h3>
          ${meta ? `<div class="project-meta">${escapeHtml(meta)}</div>` : ""}
        </div>
        <span class="badge ${badgeClass}">${escapeHtml(project.status)}</span>
      </div>
      ${spentLine}
      ${estimate}
      ${project.notes ? `<p class="project-notes">${escapeHtml(project.notes)}</p>` : ""}
    </section>`;
  }).join("");

  bindRenderedProjectEvents(container);
}

function bindRenderedProjectEvents(container) {
  container.querySelectorAll("[data-project-id]").forEach(card => {
    card.addEventListener("click", () => openProjectDialog(Number(card.dataset.projectId)));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openProjectDialog(Number(card.dataset.projectId));
      }
    });
  });
}

function projectStatusRank(project) {
  const status = (project.status || "").trim().toLowerCase();

  if (status === "in progress" || status === "active") return 0;
  if (status === "bid received" || status === "research" || status === "planned") return 1;
  if (status === "waiting" || status === "ordered") return 2;
  if (status === "complete") return 9;
  if (status === "cancelled") return 10;

  return 3;
}

function projectDateRank(project) {
  if (!project.targetDate) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(`${project.targetDate}T00:00:00`);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function renderMaintenance() {
  const container = document.querySelector("#maintenanceList");
  if (!container) return;

  const items = Array.isArray(state.data.maintenanceExpenses)
    ? state.data.maintenanceExpenses
    : [];

  if (!items.length) {
    container.innerHTML = `<div class="empty">No maintenance expenses yet.</div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const vendor = item.vendorName || "Vendor not recorded";
    const date = item.expenseDate ? formatDateOnly(item.expenseDate) : "Date unknown";
    const description = item.description || "Maintenance";

    return `<article class="maintenance-card">
      <div class="maintenance-card-main">
        <div>
          <strong class="maintenance-vendor-name">${escapeHtml(vendor)}</strong>
          <div class="maintenance-date">${escapeHtml(date)}</div>
        </div>
        <div class="maintenance-amount">${money.format(Number(item.amount) || 0)}</div>
      </div>
      <div class="maintenance-description">${escapeHtml(description)}</div>
    </article>`;
  }).join("");
}

function renderTasks() {
  const container = document.querySelector("#tasks");
  const tasks = sortedTasks(filteredTasks());

  const completeCount = state.data.tasks.filter(isComplete).length;
  const cancelledCount = state.data.tasks.filter(isCancelled).length;
  const progressCount = state.data.tasks.filter(isInProgress).length;
  document.querySelector("#taskStats").textContent = `${state.data.tasks.length} tasks · ${progressCount} in progress · ${completeCount} complete · ${cancelledCount} cancelled`;

  if (!tasks.length) {
    container.innerHTML = `<div class="empty">Nothing in this view. Damn, that feels good.</div>`;
    return;
  }

  if (state.sort === "smart") {
    container.innerHTML = renderSmartGroups(tasks);
  } else if (state.sort === "area") {
    container.innerHTML = renderAreaGroups(tasks);
  } else {
    container.innerHTML = tasks.map(renderTaskRow).join("");
  }

  bindRenderedTaskEvents(container);
}

function renderSmartGroups(tasks) {
  const groups = [
    ["In Progress", tasks.filter(isInProgress)],
    ["Next Up", tasks.filter(t => isTodo(t) && t.priority === "High")],
    ["Waiting / Ordered", tasks.filter(t => ["waiting", "ordered"].includes(statusKey(t)))],
    ["To Do", tasks.filter(t => isTodo(t) && t.priority !== "High" && t.priority !== "Low")],
    ["Later", tasks.filter(t => isTodo(t) && t.priority === "Low")],
    ["Completed", tasks.filter(isComplete)],
    ["Cancelled", tasks.filter(isCancelled)]
  ];

  return groups.filter(([, items]) => items.length)
    .map(([label, items]) => `<div class="task-group-label">${label}</div>${items.map(renderTaskRow).join("")}`)
    .join("");
}

function renderAreaGroups(tasks) {
  const grouped = new Map();

  tasks.forEach(task => {
    const labels = taskAreaValues(task);
    const label = labels.length ? [...labels].sort((a, b) => a.localeCompare(b))[0] : "No Area";
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(task);
  });

  return [...grouped.entries()]
    .sort(([a], [b]) => {
      if (a === "No Area") return 1;
      if (b === "No Area") return -1;
      return a.localeCompare(b);
    })
    .map(([label, items]) =>
      `<div class="task-group-label">${escapeHtml(label)}</div>${items.map(renderTaskRow).join("")}`)
    .join("");
}

function renderTaskRow(task) {
  const complete = isComplete(task);
  const cancelled = isCancelled(task);
  const inProgress = isInProgress(task);

  const area = taskAreaValues(task)
    .map(value => `<span class="task-pill">${escapeHtml(value)}</span>`)
    .join("");
  const project = task.projectName ? `<span class="task-pill">${escapeHtml(task.projectName)}</span>` : "";
  const contractor = task.contractorNeeded ? `<span class="task-pill contractor">Contractor</span>` : `<span class="task-pill">DIY</span>`;
  const priority = task.priority?.toLowerCase() === "high" ? `<span class="task-pill high">High priority</span>` : "";
  const statusPill = inProgress ? `<span class="task-pill in-progress">In Progress</span>` : (cancelled ? `<span class="task-pill cancelled">Cancelled</span>` : "");
  const estimate = task.estimatedCost != null ? `<span class="task-pill">${money.format(task.estimatedCost)} est.</span>` : "";

  const taskSpent = state.expenses
    .filter(expense => Number(expense.taskId) === Number(task.id))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  const spentLine = `<span class="task-spent ${taskSpent > 0 ? "has-spend" : "no-spend"}">${taskSpent > 0 ? moneyExact.format(taskSpent) : "—"}</span>`;

  return `<div class="task-row ${complete ? "completed" : ""} ${cancelled ? "cancelled" : ""} ${inProgress ? "in-progress" : ""}" data-task-id="${task.id}">
    <input class="task-check" type="checkbox" ${complete ? "checked" : ""} ${cancelled ? "disabled" : ""} aria-label="Mark ${escapeAttribute(task.title)} complete" data-task-id="${task.id}">
    <div class="task-main" data-edit-task-id="${task.id}" title="Click to edit">
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-sub">${statusPill}${area}${contractor}${priority}${project}${estimate}</div>
    </div>
    <div class="task-right">
      ${spentLine}
      <span class="task-status">${escapeHtml(task.status)}</span>
    </div>
  </div>`;
}

function bindRenderedTaskEvents(container) {
  container.querySelectorAll(".task-check").forEach(input => input.addEventListener("change", handleTaskToggle));
  container.querySelectorAll("[data-edit-task-id]").forEach(element => {
    element.addEventListener("click", () => {
      const id = Number(element.dataset.editTaskId);
      openTaskDialog(state.data.tasks.find(t => t.id === id));
    });
  });
}

function filteredTasks() {
  let tasks = state.data.tasks;

  switch (state.filter) {
    case "in-progress": tasks = tasks.filter(isInProgress); break;
    case "diy": tasks = tasks.filter(t => !t.contractorNeeded && !isComplete(t) && !isCancelled(t)); break;
    case "contractor": tasks = tasks.filter(t => t.contractorNeeded && !isComplete(t) && !isCancelled(t)); break;
    case "all": break;
    case "open":
    default: tasks = tasks.filter(t => !isComplete(t) && !isCancelled(t)); break;
  }

  if (state.area) {
    tasks = tasks.filter(t => taskAreaValues(t).includes(state.area));
  }

  return tasks;
}

function sortedTasks(tasks) {
  const list = [...tasks];

  switch (state.sort) {
    case "area":
      return list.sort((a, b) =>
        areaRank(a, b) ||
        terminalRank(a) - terminalRank(b) ||
        smartRank(a) - smartRank(b) ||
        dateRank(a) - dateRank(b) ||
        a.sortOrder - b.sortOrder);

    case "priority":
      return list.sort((a, b) => terminalRank(a) - terminalRank(b) || priorityRank(a) - priorityRank(b) || dateRank(a) - dateRank(b) || a.sortOrder - b.sortOrder);

    case "target-date":
      return list.sort((a, b) => terminalRank(a) - terminalRank(b) || dateRank(a) - dateRank(b) || priorityRank(a) - priorityRank(b) || a.sortOrder - b.sortOrder);

    case "manual":
      return list.sort((a, b) => terminalRank(a) - terminalRank(b) || a.sortOrder - b.sortOrder);

    case "smart":
    default:
      return list.sort((a, b) => smartRank(a) - smartRank(b) || dateRank(a) - dateRank(b) || priorityRank(a) - priorityRank(b) || a.sortOrder - b.sortOrder);
  }
}

function areaRank(a, b) {
  const aa = [...taskAreaValues(a)].sort((x, y) => x.localeCompare(y))[0] || "";
  const bb = [...taskAreaValues(b)].sort((x, y) => x.localeCompare(y))[0] || "";
  if (!aa && bb) return 1;
  if (aa && !bb) return -1;
  return aa.localeCompare(bb);
}

function smartRank(task) {
  if (isInProgress(task)) return 0;
  if (isTodo(task) && task.priority === "High") return 1;
  if (["waiting", "ordered"].includes(statusKey(task))) return 2;
  if (isTodo(task) && task.priority !== "Low") return 3;
  if (isTodo(task) && task.priority === "Low") return 4;
  if (isComplete(task)) return 5;
  if (isCancelled(task)) return 6;
  return 3;
}

function terminalRank(task) {
  if (isComplete(task)) return 10;
  if (isCancelled(task)) return 11;
  return 0;
}

function priorityRank(task) {
  switch ((task.priority || "").toLowerCase()) {
    case "high": return 0;
    case "normal": return 1;
    case "low": return 2;
    default: return 1;
  }
}

function dateRank(task) {
  if (!task.targetDate) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(`${task.targetDate}T00:00:00`);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function populateAreaControls() {
  const areas = [...new Set(
    state.data.tasks
      .flatMap(task => taskAreaValues(task))
      .map(value => value.trim())
      .filter(Boolean)
  )].sort((a, b) => a.localeCompare(b));

  const filter = document.querySelector("#areaFilter");
  const current = state.area;
  filter.innerHTML = `<option value="">All areas</option>` +
    areas.map(area => `<option value="${escapeAttribute(area)}">${escapeHtml(area)}</option>`).join("");
  filter.value = current;

  document.querySelector("#areaSuggestions").innerHTML =
    areas.map(area => `<option value="${escapeAttribute(area)}"></option>`).join("");
}


let activeProjectId = null;

function bindProjectDetails() {
  document.querySelector("#closeProjectDialog")?.addEventListener("click", closeProjectDialog);
  document.querySelector("#closeProjectDialogBottom")?.addEventListener("click", closeProjectDialog);
  document.querySelector("#addProjectDocumentButton")?.addEventListener("click", () => {
    document.querySelector("#projectDocumentFile")?.click();
  });
  document.querySelector("#projectDocumentFile")?.addEventListener("change", uploadProjectDocument);
  document.querySelector("#projectDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeProjectDialog();
  });
  document.querySelector("#projectDetailBody")?.addEventListener("click", handleProjectDetailClick);
}

async function openProjectDialog(projectId) {
  if (!projectId) return;

  activeProjectId = projectId;
  const dialog = document.querySelector("#projectDialog");
  const body = document.querySelector("#projectDetailBody");
  const message = document.querySelector("#projectDocumentMessage");

  body.innerHTML = `<div class="loading">Loading project…</div>`;
  message.textContent = "";
  dialog.showModal();

  await loadProjectDetails(projectId);
}

function closeProjectDialog() {
  document.querySelector("#projectDialog")?.close();
  activeProjectId = null;
  const file = document.querySelector("#projectDocumentFile");
  if (file) file.value = "";
}

async function loadProjectDetails(projectId) {
  const body = document.querySelector("#projectDetailBody");

  try {
    const response = await fetch(`/api/home/projects/${projectId}/details`, {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) throw new Error(await readError(response));

    const detail = await response.json();
    document.querySelector("#projectDialogTitle").textContent = detail.project.name;
    renderProjectDetails(detail);
  } catch (error) {
    console.error(error);
    body.innerHTML = `<div class="empty">${escapeHtml(error.message || "Could not load project details.")}</div>`;
  }
}

function renderProjectDetails(detail) {
  const body = document.querySelector("#projectDetailBody");
  const p = detail.project;
  const completed = p.completedAt ? new Date(p.completedAt).toLocaleDateString() : null;

  const children = (detail.children || []).length
    ? `<div class="project-detail-section">
        <h3>Included work</h3>
        <div class="project-child-list">
          ${detail.children.map(child =>
            `<span class="project-child-pill">${escapeHtml(child.name)} · ${escapeHtml(child.status)}</span>`
          ).join("")}
        </div>
      </div>`
    : "";

  const expenses = (detail.expenses || []).length
    ? `<div class="expense-list">
        ${detail.expenses.map(expense => {
          const vendor = expense.vendorName || expense.vendor || "Vendor not recorded";
          const date = expense.expenseDate ? formatDateOnly(expense.expenseDate) : "Date unknown";
          const sourceProject = expense.projectName && expense.projectName !== p.name
            ? ` · ${escapeHtml(expense.projectName)}`
            : "";
          return `<div class="expense-row">
            <div class="expense-main">
              <strong>${escapeHtml(expense.description)}</strong>
              <div class="expense-meta">${escapeHtml(vendor)} · ${date}${sourceProject}</div>
            </div>
            <div class="expense-amount">${money.format(expense.amount)}</div>
          </div>`;
        }).join("")}
      </div>`
    : `<div class="empty">No expenses tied to this project yet.</div>`;

  const attachments = renderProjectDocuments(detail.attachments || []);

  body.innerHTML = `
    <div class="project-detail-summary">
      <div class="project-detail-stat"><span>Actual spent</span><strong>${money.format(detail.actualSpent || 0)}</strong></div>
      <div class="project-detail-stat"><span>Status</span><strong>${escapeHtml(p.status)}</strong></div>
      <div class="project-detail-stat"><span>Documents</span><strong>${detail.documentCount || 0}</strong></div>
    </div>

    ${[p.purpose, p.contractorName, completed ? `Completed ${completed}` : null].filter(Boolean).length
      ? `<div class="project-meta">${escapeHtml([p.purpose, p.contractorName, completed ? `Completed ${completed}` : null].filter(Boolean).join(" · "))}</div>`
      : ""}

    ${p.notes ? `<p class="project-notes">${escapeHtml(p.notes)}</p>` : ""}
    ${children}

    <div class="project-detail-section">
      <h3>Expenses</h3>
      ${expenses}
    </div>

    <div class="project-detail-section">
      <h3>Receipts & documents</h3>
      ${attachments}
    </div>
  `;
}

function renderProjectDocuments(attachments) {
  if (!attachments.length) {
    return `<div class="empty">No receipts or project documents attached yet.</div>`;
  }

  return `<div class="document-grid">
    ${attachments.map(attachment => {
      const isImage = attachment.contentType?.startsWith("image/");
      const open = isImage
        ? `<button type="button" class="document-preview project-image-trigger"
             data-attachment-id="${attachment.id}"
             data-file-name="${escapeAttribute(attachment.fileName)}">
             <img src="/api/attachments/${attachment.id}/thumbnail" alt="${escapeAttribute(attachment.fileName)}">
           </button>`
        : `<a class="document-preview" href="/api/attachments/${attachment.id}" target="_blank" rel="noopener">
             <span class="document-file-icon">📄</span>
           </a>`;

      return `<div class="document-card">
        ${open}
        <div class="document-meta">
          <strong title="${escapeAttribute(attachment.fileName)}">${escapeHtml(attachment.fileName)}</strong>
          <span>${formatFileSize(attachment.fileSizeBytes)} · ${new Date(attachment.uploadedUtc).toLocaleDateString()}</span>
        </div>
        <button type="button" class="document-delete" data-delete-attachment-id="${attachment.id}" data-file-name="${escapeAttribute(attachment.fileName)}">Delete</button>
      </div>`;
    }).join("")}
  </div>`;
}

async function uploadProjectDocument() {
  const input = document.querySelector("#projectDocumentFile");
  const file = input.files?.[0];
  if (!file || !activeProjectId) return;

  const message = document.querySelector("#projectDocumentMessage");
  const formData = new FormData();
  formData.append("file", file);

  message.textContent = "Uploading…";

  try {
    const response = await fetch(`/api/home/projects/${activeProjectId}/attachments`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) throw new Error(await readError(response));

    message.textContent = "Uploaded.";
    input.value = "";
    await loadProjectDetails(activeProjectId);
  } catch (error) {
    console.error(error);
    message.textContent = error.message || "Upload failed.";
  }
}

async function handleProjectDetailClick(event) {
  const imageButton = event.target.closest(".project-image-trigger");
  if (imageButton) {
    openImageViewer(Number(imageButton.dataset.attachmentId), imageButton.dataset.fileName);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-attachment-id]");
  if (!deleteButton) return;

  const attachmentId = Number(deleteButton.dataset.deleteAttachmentId);
  const fileName = deleteButton.dataset.fileName || "this document";
  if (!attachmentId || !confirm(`Delete "${fileName}"?`)) return;

  const response = await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
  if (!response.ok) {
    showToast("Couldn't delete that document.");
    return;
  }

  await loadProjectDetails(activeProjectId);
  showToast("Document deleted.");
}

function bindImageViewer() {
  document.querySelector("#closeImageViewer")?.addEventListener("click", closeImageViewer);
  document.querySelector("#imageViewerDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeImageViewer();
  });
}

function openImageViewer(attachmentId, fileName) {
  if (!attachmentId) return;

  const dialog = document.querySelector("#imageViewerDialog");
  const image = document.querySelector("#imageViewerImage");
  const original = document.querySelector("#imageViewerOpenOriginal");

  document.querySelector("#imageViewerFileName").textContent = fileName || "Receipt";
  image.alt = fileName || "Receipt";
  image.src = `/api/attachments/${attachmentId}`;
  original.href = `/api/attachments/${attachmentId}`;

  dialog.showModal();
}

function closeImageViewer() {
  const dialog = document.querySelector("#imageViewerDialog");
  const image = document.querySelector("#imageViewerImage");
  if (image) image.removeAttribute("src");
  dialog?.close();
}

function formatDateOnly(value) {
  if (!value) return "Date unknown";
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? escapeHtml(value) : parsed.toLocaleDateString();
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadExpenses() {
  const container = document.querySelector("#expenses");
  if (!container || !state.data) return;

  try {
    const response = await fetch("/api/home/expenses", {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) throw new Error(await readError(response));

    state.expenses = await response.json();
    populateExpenseFilters();
    renderExpenses();
    renderTasks();

    const taskDialog = document.querySelector("#taskDialog");
    if (taskDialog?.open) {
      const taskId = Number(document.querySelector("#taskId")?.value || 0);
      const task = state.data?.tasks?.find(item => item.id === taskId) || null;
      renderTaskExpenses(task);
    }
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div class="empty">${escapeHtml(error.message || "Could not load expenses.")}</div>`;
  }
}

function renderExpenses() {
  const container = document.querySelector("#expenses");
  const stats = document.querySelector("#expenseStats");
  if (!container || !stats) return;

  const items = filteredExpenses();
  const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  stats.textContent = `${items.length} expense${items.length === 1 ? "" : "s"} · ${moneyExact.format(total)}`;

  if (!items.length) {
    container.innerHTML = `<div class="empty">No expenses match this view.</div>`;
    return;
  }

  container.innerHTML = items.map(expense => {
    const vendor = expense.vendorName || expense.vendor || "Vendor not recorded";
    const date = expense.expenseDate ? formatDateOnly(expense.expenseDate) : "Date unknown";
    const project = expense.projectName
      ? `<span class="expense-pill">${escapeHtml(expense.projectName)}</span>`
      : "";
    const task = expense.taskTitle
      ? `<span class="expense-pill">${escapeHtml(expense.taskTitle)}</span>`
      : "";
    const category = expense.category
      ? `<span class="expense-pill category">${escapeHtml(expense.category)}</span>`
      : "";
    const attachments = Array.isArray(expense.attachments) ? expense.attachments : [];
    const receiptBadge = attachments.length
      ? `<span class="expense-receipt-count">📎 ${attachments.length}</span>`
      : "";

    return `<article class="expense-card" data-edit-expense-id="${expense.id}" tabindex="0" role="button" aria-label="Edit ${escapeAttribute(expense.description)}">
      <div class="expense-card-date">${escapeHtml(date)}</div>
      <div class="expense-card-main">
        <strong>${escapeHtml(expense.description)}</strong>
        <div class="expense-card-vendor">${escapeHtml(vendor)}</div>
        <div class="expense-card-pills">${project}${task}${category}${receiptBadge}</div>
      </div>
      <div class="expense-card-amount">${moneyExact.format(Number(expense.amount) || 0)}</div>
    </article>`;
  }).join("");

  container.querySelectorAll("[data-edit-expense-id]").forEach(card => {
    const open = () => {
      const expense = state.expenses.find(item => item.id === Number(card.dataset.editExpenseId));
      if (expense) openExpenseDialog(expense);
    };

    card.addEventListener("click", open);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  });
}

function filteredExpenses() {
  let items = [...state.expenses];

  const query = state.expenseFilter.trim().toLowerCase();
  if (query) {
    items = items.filter(expense =>
      [
        expense.description,
        expense.vendorName,
        expense.vendor,
        expense.category,
        expense.projectName,
        expense.taskTitle,
        expense.expenseDate
      ].some(value => String(value || "").toLowerCase().includes(query)));
  }

  if (state.expenseProject) {
    items = items.filter(expense => String(expense.projectId ?? "") === state.expenseProject);
  }

  switch (state.expenseSort) {
    case "oldest":
      items.sort((a, b) => compareExpenseDates(a, b, true) || a.id - b.id);
      break;
    case "highest":
      items.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0) || b.id - a.id);
      break;
    case "lowest":
      items.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0) || b.id - a.id);
      break;
    case "newest":
    default:
      items.sort((a, b) => compareExpenseDates(a, b, false) || b.id - a.id);
      break;
  }

  return items;
}

function compareExpenseDates(a, b, ascending) {
  const aValue = a.expenseDate ? Date.parse(`${a.expenseDate}T00:00:00`) : null;
  const bValue = b.expenseDate ? Date.parse(`${b.expenseDate}T00:00:00`) : null;

  if (aValue == null && bValue == null) return 0;
  if (aValue == null) return 1;
  if (bValue == null) return -1;

  return ascending ? aValue - bValue : bValue - aValue;
}

function bindExpenseFilters() {
  document.querySelector("#expenseSearch")?.addEventListener("input", event => {
    state.expenseFilter = event.target.value;
    renderExpenses();
  });

  document.querySelector("#expenseProjectFilter")?.addEventListener("change", event => {
    state.expenseProject = event.target.value;
    renderExpenses();
  });

  document.querySelector("#expenseSort")?.addEventListener("change", event => {
    state.expenseSort = event.target.value;
    renderExpenses();
  });
}

function populateExpenseFilters() {
  const select = document.querySelector("#expenseProjectFilter");
  if (!select || !state.data) return;

  const current = state.expenseProject;
  const projects = [...state.data.projects].sort((a, b) => a.name.localeCompare(b.name));

  select.innerHTML = `<option value="">All projects</option>` +
    projects.map(project =>
      `<option value="${project.id}">${escapeHtml(project.name)}</option>`
    ).join("");

  select.value = current;
}


function bindExpenseNavigation() {
  const card = document.querySelector("#spentSummaryCard");
  const panel = document.querySelector(".expenses-panel");
  if (!card || !panel) return;

  const jump = () => {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    panel.classList.add("expense-panel-highlight");
    setTimeout(() => panel.classList.remove("expense-panel-highlight"), 1200);
  };

  card.addEventListener("click", jump);
  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      jump();
    }
  });
}

function bindExpenseEditor() {
  document.querySelector("#addExpenseButton")?.addEventListener("click", () => openExpenseDialog());
  document.querySelector("#closeExpenseDialog")?.addEventListener("click", closeExpenseDialog);
  document.querySelector("#cancelExpenseButton")?.addEventListener("click", closeExpenseDialog);
  document.querySelector("#expenseForm")?.addEventListener("submit", saveExpense);
  document.querySelector("#deleteExpenseButton")?.addEventListener("click", deleteExpense);
  document.querySelector("#expenseProject")?.addEventListener("change", () => populateExpenseTaskOptions(null));
  document.querySelector("#expenseTask")?.addEventListener("change", syncExpenseProjectFromTask);
  document.querySelector("#expenseReceiptFiles")?.addEventListener("change", handleExpenseReceiptSelection);
  document.querySelector("#expenseExistingReceipts")?.addEventListener("click", handleExpenseReceiptClick);
  document.querySelector("#expenseDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeExpenseDialog();
  });
}

function openExpenseDialog(expense = null, defaults = {}) {
  const dialog = document.querySelector("#expenseDialog");
  const isEdit = Boolean(expense);

  document.querySelector("#expenseDialogTitle").textContent = isEdit ? "Edit expense" : "Add expense";
  document.querySelector("#expenseId").value = expense?.id ?? "";
  document.querySelector("#expenseDate").value = expense?.expenseDate ?? "";
  document.querySelector("#expenseAmount").value = expense?.amount ?? "";
  document.querySelector("#expenseVendor").value = expense?.vendorName || expense?.vendor || "";
  document.querySelector("#expenseDescription").value = expense?.description ?? "";
  document.querySelector("#expenseCategory").value = expense?.category ?? "";
  document.querySelector("#expenseNotes").value = expense?.notes ?? "";
  document.querySelector("#expenseReceiptFiles").value = "";
  document.querySelector("#expenseReceiptSelection").textContent = "";

  const selectedProjectId = expense?.projectId ?? defaults.projectId ?? null;
  const selectedTaskId = expense?.taskId ?? defaults.taskId ?? null;
  populateExpenseProjectOptions(selectedProjectId);
  populateExpenseTaskOptions(selectedTaskId);

  document.querySelector("#deleteExpenseButton").hidden = !isEdit;
  renderExistingExpenseReceipts(expense?.attachments || []);
  clearExpenseError();

  dialog.showModal();
  setTimeout(() => document.querySelector("#expenseAmount")?.focus(), 0);
}

function closeExpenseDialog() {
  document.querySelector("#expenseDialog")?.close();
  clearExpenseError();
}

function populateExpenseProjectOptions(selectedProjectId) {
  const select = document.querySelector("#expenseProject");
  if (!select || !state.data) return;

  const projects = [...state.data.projects]
    .sort((a, b) => {
      const ap = a.parentProjectId == null ? 0 : 1;
      const bp = b.parentProjectId == null ? 0 : 1;
      return ap - bp || (a.parentProjectId ?? 0) - (b.parentProjectId ?? 0) || a.name.localeCompare(b.name);
    });

  select.innerHTML = [`<option value="">No project</option>`,
    ...projects.map(project => {
      const prefix = project.parentProjectId == null ? "" : "↳ ";
      return `<option value="${project.id}">${prefix}${escapeHtml(project.name)}</option>`;
    })
  ].join("");

  select.value = selectedProjectId == null ? "" : String(selectedProjectId);
}

function populateExpenseTaskOptions(selectedTaskId) {
  const select = document.querySelector("#expenseTask");
  const projectId = nullableNumber(document.querySelector("#expenseProject")?.value ?? "");
  if (!select || !state.data) return;

  let tasks = [...state.data.tasks];
  if (projectId != null) tasks = tasks.filter(task => task.projectId === projectId);

  tasks.sort((a, b) => (a.area || "").localeCompare(b.area || "") || a.title.localeCompare(b.title));

  select.innerHTML = [`<option value="">No task</option>`,
    ...tasks.map(task => {
      const area = task.area ? `${task.area} · ` : "";
      return `<option value="${task.id}">${escapeHtml(area + task.title)}</option>`;
    })
  ].join("");

  if (selectedTaskId != null && !tasks.some(task => task.id === selectedTaskId)) {
    const task = state.data.tasks.find(item => item.id === selectedTaskId);
    if (task) select.insertAdjacentHTML("beforeend", `<option value="${task.id}">${escapeHtml(task.title)}</option>`);
  }

  select.value = selectedTaskId == null ? "" : String(selectedTaskId);
}

function syncExpenseProjectFromTask() {
  const taskId = nullableNumber(document.querySelector("#expenseTask")?.value ?? "");
  if (taskId == null) return;

  const task = state.data.tasks.find(item => item.id === taskId);
  if (!task?.projectId) return;

  const projectSelect = document.querySelector("#expenseProject");
  if (projectSelect) {
    projectSelect.value = String(task.projectId);
    populateExpenseTaskOptions(taskId);
  }
}

async function handleExpenseReceiptSelection() {
  const input = document.querySelector("#expenseReceiptFiles");
  const message = document.querySelector("#expenseReceiptSelection");
  const files = [...(input?.files || [])];

  if (!files.length) {
    message.textContent = "";
    return;
  }

  const expenseId = Number(document.querySelector("#expenseId")?.value || 0);

  // Existing expense: upload immediately and show it in the receipt area.
  if (expenseId) {
    try {
      message.textContent = `Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`;
      input.disabled = true;

      await uploadExpenseReceipts(expenseId);
      input.value = "";

      await loadExpenses();

      const expense = state.expenses.find(item => item.id === expenseId);
      renderExistingExpenseReceipts(expense?.attachments || []);

      if (activeProjectId) await loadProjectDetails(activeProjectId);

      message.textContent = files.length === 1 ? "Receipt uploaded." : `${files.length} receipts uploaded.`;
      showToast(files.length === 1 ? "Receipt attached." : "Receipts attached.");
    } catch (error) {
      console.error(error);
      message.textContent = "";
      showExpenseError(error.message || "Couldn't upload that receipt.");
    } finally {
      input.disabled = false;
    }

    return;
  }

  // A brand-new expense does not have an Expense Id yet, which the attachment
  // record needs. Keep the files staged; saveExpense() will create the expense
  // and upload them immediately afterward.
  message.textContent = `${files.length} file${files.length === 1 ? "" : "s"} selected — it will attach when this new expense is saved.`;
}

function renderExistingExpenseReceipts(attachments) {
  const container = document.querySelector("#expenseExistingReceipts");
  if (!container) return;

  if (!attachments.length) {
    container.innerHTML = `<div class="empty compact">No receipt attached yet.</div>`;
    return;
  }

  container.innerHTML = `<div class="expense-receipt-grid">
    ${attachments.map(attachment => {
      const isImage = attachment.contentType?.startsWith("image/");
      const preview = isImage
        ? `<button type="button" class="expense-receipt-thumb" data-expense-view-attachment="${attachment.id}" data-file-name="${escapeAttribute(attachment.fileName)}">
             <img src="/api/attachments/${attachment.id}/thumbnail" alt="${escapeAttribute(attachment.fileName)}">
           </button>`
        : `<a class="expense-receipt-thumb file" href="/api/attachments/${attachment.id}" target="_blank" rel="noopener" onclick="event.stopPropagation()">📄</a>`;

      return `<div class="expense-receipt-item">
        ${preview}
        <div class="expense-receipt-meta">
          <strong>${escapeHtml(attachment.fileName)}</strong>
          <span>${formatFileSize(attachment.fileSizeBytes)}</span>
        </div>
        <button type="button" class="document-delete" data-expense-delete-attachment="${attachment.id}" data-file-name="${escapeAttribute(attachment.fileName)}">Delete</button>
      </div>`;
    }).join("")}
  </div>`;
}

async function handleExpenseReceiptClick(event) {
  const viewButton = event.target.closest("[data-expense-view-attachment]");
  if (viewButton) {
    event.preventDefault();
    openImageViewer(Number(viewButton.dataset.expenseViewAttachment), viewButton.dataset.fileName);
    return;
  }

  const deleteButton = event.target.closest("[data-expense-delete-attachment]");
  if (!deleteButton) return;

  event.preventDefault();
  const attachmentId = Number(deleteButton.dataset.expenseDeleteAttachment);
  const fileName = deleteButton.dataset.fileName || "this receipt";
  if (!attachmentId || !confirm(`Delete "${fileName}"?`)) return;

  try {
    const response = await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await readError(response));

    await loadExpenses();

    const expenseId = Number(document.querySelector("#expenseId")?.value || 0);
    const expense = state.expenses.find(item => item.id === expenseId);
    renderExistingExpenseReceipts(expense?.attachments || []);

    if (activeProjectId) await loadProjectDetails(activeProjectId);
    showToast("Receipt deleted.");
  } catch (error) {
    console.error(error);
    showExpenseError(error.message || "Couldn't delete that receipt.");
  }
}

async function saveExpense(event) {
  event.preventDefault();
  clearExpenseError();

  const id = document.querySelector("#expenseId").value;
  const amountText = document.querySelector("#expenseAmount").value.trim();

  const payload = {
    propertyId: state.data.property.id,
    projectId: nullableNumber(document.querySelector("#expenseProject").value),
    taskId: nullableNumber(document.querySelector("#expenseTask").value),
    description: document.querySelector("#expenseDescription").value.trim(),
    vendor: document.querySelector("#expenseVendor").value.trim() || null,
    amount: amountText === "" ? null : Number(amountText),
    expenseDate: document.querySelector("#expenseDate").value || null,
    category: document.querySelector("#expenseCategory").value.trim() || null,
    notes: document.querySelector("#expenseNotes").value.trim() || null
  };

  if (!payload.description) {
    showExpenseError("Description is required.");
    return;
  }

  if (payload.amount == null || !Number.isFinite(payload.amount) || payload.amount < 0) {
    showExpenseError("Enter a valid amount.");
    return;
  }

  const url = id ? `/api/home/expenses/${id}` : "/api/home/expenses";
  const method = id ? "PUT" : "POST";

  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(await readError(response));

    const saved = await response.json();
    const expenseId = Number(saved.id ?? id);
    await uploadExpenseReceipts(expenseId);

    closeExpenseDialog();
    await loadDashboard();

    if (activeProjectId) await loadProjectDetails(activeProjectId);
    showToast(id ? "Expense updated." : "Expense added.");
  } catch (error) {
    console.error(error);
    showExpenseError(error.message || "Couldn't save that expense.");
  }
}

async function uploadExpenseReceipts(expenseId) {
  const input = document.querySelector("#expenseReceiptFiles");
  const files = [...(input?.files || [])];
  if (!files.length) return;

  for (const file of files) {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`/api/home/expenses/${expenseId}/attachments`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) throw new Error(await readError(response));
  }
}

async function deleteExpense() {
  const id = Number(document.querySelector("#expenseId").value || 0);
  if (!id) return;

  const description = document.querySelector("#expenseDescription").value.trim() || "this expense";
  if (!confirm(`Delete "${description}" and its attached receipt(s)?`)) return;

  try {
    const response = await fetch(`/api/home/expenses/${id}`, {
      method: "DELETE",
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) throw new Error(await readError(response));

    closeExpenseDialog();
    await loadDashboard();

    if (activeProjectId) await loadProjectDetails(activeProjectId);
    showToast("Expense deleted.");
  } catch (error) {
    console.error(error);
    showExpenseError(error.message || "Couldn't delete that expense.");
  }
}

function showExpenseError(message) {
  const error = document.querySelector("#expenseFormError");
  error.textContent = message;
  error.hidden = false;
}

function clearExpenseError() {
  const error = document.querySelector("#expenseFormError");
  error.textContent = "";
  error.hidden = true;
}

function bindFilters() {
  document.querySelectorAll(".filter-btn").forEach(button => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.toggle("active", b === button));
      if (state.data) renderTasks();
    });
  });
}

function bindAreaFilter() {
  document.querySelector("#areaFilter").addEventListener("change", event => {
    state.area = event.target.value;
    if (state.data) renderTasks();
  });
}

function bindTaskSort() {
  const select = document.querySelector("#taskSort");
  select.value = state.sort;
  select.addEventListener("change", () => {
    state.sort = select.value;
    if (state.data) renderTasks();
  });
}

function bindTaskEditor() {
  document.querySelector("#addTaskButton").addEventListener("click", () => openTaskDialog());
  document.querySelector("#closeTaskDialog").addEventListener("click", closeTaskDialog);
  document.querySelector("#cancelTaskButton").addEventListener("click", closeTaskDialog);
  document.querySelector("#taskForm").addEventListener("submit", saveTask);
  document.querySelector("#deleteTaskButton").addEventListener("click", deleteTask);
  document.querySelector("#taskContractorNeeded").addEventListener("change", syncContractorField);
  document.querySelector("#addTaskAreaButton")?.addEventListener("click", addTaskAreaFromInput);
  document.querySelector("#taskAreaInput")?.addEventListener("keydown", handleTaskAreaKeydown);
  document.querySelector("#taskAreaTags")?.addEventListener("click", handleTaskAreaRemove);
  document.querySelector("#addTaskExpenseButton")?.addEventListener("click", addExpenseForCurrentTask);
  document.querySelector("#taskExpensesList")?.addEventListener("click", handleTaskExpenseClick);
  document.querySelector("#taskDialog").addEventListener("click", event => {
    if (event.target === event.currentTarget) closeTaskDialog();
  });
}

function openTaskDialog(task = null) {
  const dialog = document.querySelector("#taskDialog");
  const isEdit = Boolean(task);

  document.querySelector("#taskDialogTitle").textContent = isEdit ? "Edit task" : "Add task";
  document.querySelector("#taskId").value = task?.id ?? "";
  document.querySelector("#taskTitle").value = task?.title ?? "";
  setTaskAreaValues(task?.areas ?? (task?.area ? [task.area] : []));
  document.querySelector("#taskAreaInput").value = "";
  document.querySelector("#taskStatus").value = task?.status ?? "To Do";
  document.querySelector("#taskPriority").value = task?.priority ?? "Normal";
  document.querySelector("#taskEstimatedCost").value = task?.estimatedCost ?? "";
  document.querySelector("#taskTargetDate").value = task?.targetDate ?? "";
  document.querySelector("#taskContractorNeeded").checked = task?.contractorNeeded ?? false;
  document.querySelector("#taskContractorName").value = task?.contractorName ?? "";
  document.querySelector("#taskNotes").value = task?.notes ?? "";

  populateProjectOptions(task?.projectId ?? null);
  document.querySelector("#deleteTaskButton").hidden = !isEdit;
  clearTaskError();
  syncContractorField();
  renderTaskExpenses(task);

  dialog.showModal();
  setTimeout(() => document.querySelector("#taskTitle").focus(), 0);
}


let taskAreaDraft = [];

function taskAreaValues(task) {
  if (Array.isArray(task?.areas)) return task.areas.filter(Boolean);
  return task?.area ? [task.area] : [];
}

function setTaskAreaValues(values) {
  taskAreaDraft = [...new Set((values || [])
    .map(value => String(value || "").trim())
    .filter(Boolean))];
  taskAreaDraft.sort((a, b) => a.localeCompare(b));
  renderTaskAreaTags();
}

function getTaskAreaValues(commitInput = false) {
  if (commitInput) addTaskAreaFromInput();
  return [...taskAreaDraft];
}

function addTaskAreaFromInput() {
  const input = document.querySelector("#taskAreaInput");
  if (!input) return;

  const value = input.value.trim();
  if (!value) return;

  if (!taskAreaDraft.some(area => area.toLowerCase() === value.toLowerCase())) {
    taskAreaDraft.push(value);
    taskAreaDraft.sort((a, b) => a.localeCompare(b));
  }

  input.value = "";
  renderTaskAreaTags();
  input.focus();
}

function handleTaskAreaKeydown(event) {
  if (event.key === "Enter" || event.key === ",") {
    event.preventDefault();
    addTaskAreaFromInput();
  }
}

function handleTaskAreaRemove(event) {
  const button = event.target.closest("[data-remove-task-area]");
  if (!button) return;

  taskAreaDraft = taskAreaDraft.filter(area => area !== button.dataset.removeTaskArea);
  renderTaskAreaTags();
}

function renderTaskAreaTags() {
  const container = document.querySelector("#taskAreaTags");
  if (!container) return;

  container.innerHTML = taskAreaDraft.length
    ? taskAreaDraft.map(area =>
        `<span class="area-tag">
          ${escapeHtml(area)}
          <button type="button" data-remove-task-area="${escapeAttribute(area)}" aria-label="Remove ${escapeAttribute(area)}">×</button>
        </span>`
      ).join("")
    : `<span class="area-tag-empty">No rooms / areas selected yet.</span>`;
}

function renderTaskExpenses(task) {
  const section = document.querySelector("#taskExpensesSection");
  const list = document.querySelector("#taskExpensesList");
  const totalElement = document.querySelector("#taskExpenseTotal");
  const addButton = document.querySelector("#addTaskExpenseButton");
  if (!section || !list || !totalElement || !addButton) return;

  const taskId = Number(task?.id || document.querySelector("#taskId")?.value || 0);
  addButton.disabled = !taskId;

  if (!taskId) {
    totalElement.textContent = moneyExact.format(0);
    list.innerHTML = `<div class="empty compact">Save the task first, then expenses can be attached to it.</div>`;
    return;
  }

  const expenses = state.expenses
    .filter(expense => Number(expense.taskId) === taskId)
    .sort((a, b) => compareExpenseDates(a, b, false) || b.id - a.id);

  const total = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  totalElement.textContent = moneyExact.format(total);

  if (!expenses.length) {
    list.innerHTML = `<div class="empty compact">No expenses attached to this task yet.</div>`;
    return;
  }

  list.innerHTML = expenses.map(expense => {
    const vendor = expense.vendorName || expense.vendor || "Vendor not recorded";
    const date = expense.expenseDate ? formatDateOnly(expense.expenseDate) : "Date unknown";
    const receiptCount = Array.isArray(expense.attachments) ? expense.attachments.length : 0;
    const receipt = receiptCount ? ` · 📎 ${receiptCount}` : "";

    return `<button type="button" class="task-expense-row" data-task-expense-id="${expense.id}">
      <span class="task-expense-copy">
        <strong>${escapeHtml(expense.description)}</strong>
        <small>${escapeHtml(vendor)} · ${escapeHtml(date)}${receipt}</small>
      </span>
      <span class="task-expense-amount">${moneyExact.format(Number(expense.amount) || 0)}</span>
    </button>`;
  }).join("");
}

function addExpenseForCurrentTask() {
  const taskId = Number(document.querySelector("#taskId")?.value || 0);
  if (!taskId) return;

  const task = state.data?.tasks?.find(item => item.id === taskId);
  if (!task) return;

  openExpenseDialog(null, {
    taskId: task.id,
    projectId: task.projectId ?? null
  });
}

function handleTaskExpenseClick(event) {
  const row = event.target.closest("[data-task-expense-id]");
  if (!row) return;

  const expense = state.expenses.find(item => item.id === Number(row.dataset.taskExpenseId));
  if (expense) openExpenseDialog(expense);
}

function closeTaskDialog() {
  document.querySelector("#taskDialog").close();
  clearTaskError();
}

function populateProjectOptions(selectedProjectId) {
  const select = document.querySelector("#taskProject");
  select.innerHTML = [`<option value="">No project</option>`,
    ...state.data.projects.map(project => `<option value="${project.id}">${escapeHtml(project.name)}</option>`)
  ].join("");
  select.value = selectedProjectId == null ? "" : String(selectedProjectId);
}

function syncContractorField() {
  const needed = document.querySelector("#taskContractorNeeded").checked;
  document.querySelector("#contractorNameField").hidden = !needed;
  if (!needed) document.querySelector("#taskContractorName").value = "";
}

async function saveTask(event) {
  event.preventDefault();
  clearTaskError();

  const id = document.querySelector("#taskId").value;
  const estimatedText = document.querySelector("#taskEstimatedCost").value.trim();

  const payload = {
    propertyId: state.data.property.id,
    projectId: nullableNumber(document.querySelector("#taskProject").value),
    title: document.querySelector("#taskTitle").value.trim(),
    area: null,
    areas: getTaskAreaValues(true),
    status: document.querySelector("#taskStatus").value,
    priority: document.querySelector("#taskPriority").value,
    contractorNeeded: document.querySelector("#taskContractorNeeded").checked,
    contractorName: document.querySelector("#taskContractorName").value.trim() || null,
    estimatedCost: estimatedText === "" ? null : Number(estimatedText),
    targetDate: document.querySelector("#taskTargetDate").value || null,
    notes: document.querySelector("#taskNotes").value.trim() || null
  };

  if (!payload.title) {
    showTaskError("Task title is required.");
    return;
  }

  const url = id ? `/api/home/tasks/${id}` : "/api/home/tasks";
  const method = id ? "PUT" : "POST";

  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(await readError(response));

    closeTaskDialog();
    await loadDashboard();
    showToast(id ? "Punch-list item updated." : "Added to the punch list.");
  } catch (error) {
    console.error(error);
    showTaskError(error.message || "Couldn't save that task.");
  }
}

async function deleteTask() {
  const id = document.querySelector("#taskId").value;
  if (!id) return;

  const title = document.querySelector("#taskTitle").value.trim();
  if (!confirm(`Delete "${title}" from the punch list?`)) return;

  try {
    const response = await fetch(`/api/home/tasks/${id}`, { method: "DELETE", headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(await readError(response));

    closeTaskDialog();
    await loadDashboard();
    showToast("Removed from the punch list.");
  } catch (error) {
    console.error(error);
    showTaskError(error.message || "Couldn't delete that task.");
  }
}

async function handleTaskToggle(event) {
  const input = event.currentTarget;
  const id = Number(input.dataset.taskId);
  const completed = input.checked;
  input.disabled = true;

  try {
    const response = await fetch(`/api/home/tasks/${id}/complete`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ completed })
    });

    if (!response.ok) throw new Error(`Task update failed (${response.status})`);

    await loadDashboard();
    showToast(completed ? "Knocked off the punch list." : "Put back on the punch list.");
  } catch (error) {
    console.error(error);
    input.checked = !completed;
    input.disabled = false;
    showToast("Couldn't update that task.");
  }
}

function statusKey(task) { return (task.status || "").trim().toLowerCase(); }
function isComplete(task) { return statusKey(task) === "complete"; }
function isCancelled(task) { return statusKey(task) === "cancelled"; }
function isInProgress(task) { return statusKey(task) === "in progress"; }
function isTodo(task) { return statusKey(task) === "to do"; }
function nullableNumber(value) { return value === "" ? null : Number(value); }

function showTaskError(message) {
  const error = document.querySelector("#taskFormError");
  error.textContent = message;
  error.hidden = false;
}
function clearTaskError() {
  const error = document.querySelector("#taskFormError");
  error.textContent = "";
  error.hidden = true;
}
async function readError(response) {
  try {
    const body = await response.json();
    return body.message || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}
function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function escapeAttribute(value) { return escapeHtml(value); }
