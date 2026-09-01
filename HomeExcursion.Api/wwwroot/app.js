const state = {
  data: null,
  filter: "open",
  area: "",
  sort: "smart"
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

document.addEventListener("DOMContentLoaded", () => {
  bindFilters();
  bindAreaFilter();
  bindTaskSort();
  bindTaskEditor();
  bindProjectDetails();
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
    const label = (task.area || "").trim() || "No Area";
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

  const area = task.area ? `<span class="task-pill">${escapeHtml(task.area)}</span>` : "";
  const project = task.projectName ? `<span class="task-pill">${escapeHtml(task.projectName)}</span>` : "";
  const contractor = task.contractorNeeded ? `<span class="task-pill contractor">Contractor</span>` : `<span class="task-pill">DIY</span>`;
  const priority = task.priority?.toLowerCase() === "high" ? `<span class="task-pill high">High priority</span>` : "";
  const statusPill = inProgress ? `<span class="task-pill in-progress">In Progress</span>` : (cancelled ? `<span class="task-pill cancelled">Cancelled</span>` : "");
  const estimate = task.estimatedCost != null ? `<span class="task-pill">${money.format(task.estimatedCost)} est.</span>` : "";

  return `<div class="task-row ${complete ? "completed" : ""} ${cancelled ? "cancelled" : ""} ${inProgress ? "in-progress" : ""}" data-task-id="${task.id}">
    <input class="task-check" type="checkbox" ${complete ? "checked" : ""} ${cancelled ? "disabled" : ""} aria-label="Mark ${escapeAttribute(task.title)} complete" data-task-id="${task.id}">
    <div class="task-main" data-edit-task-id="${task.id}" title="Click to edit">
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-sub">${statusPill}${area}${contractor}${priority}${project}${estimate}</div>
    </div>
    <span class="task-status">${escapeHtml(task.status)}</span>
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
    tasks = tasks.filter(t => (t.area || "").trim() === state.area);
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
  const aa = (a.area || "").trim();
  const bb = (b.area || "").trim();
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
      .map(t => (t.area || "").trim())
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
  document.querySelector("#taskArea").value = task?.area ?? "";
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

  dialog.showModal();
  setTimeout(() => document.querySelector("#taskTitle").focus(), 0);
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
    area: document.querySelector("#taskArea").value.trim() || null,
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
