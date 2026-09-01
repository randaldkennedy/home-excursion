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
