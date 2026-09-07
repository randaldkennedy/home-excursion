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
  if (status === "approved" || status === "scheduled") return 1;
  if (status === "getting bids" || status === "bid received" || status === "research" || status === "planned") return 2;
  if (status === "waiting" || status === "on hold" || status === "ordered") return 3;
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
  document.querySelector("#addProjectButton")?.addEventListener("click", () => openProjectEditor());
  document.querySelector("#closeProjectDialog")?.addEventListener("click", closeProjectDialog);
  document.querySelector("#closeProjectDialogBottom")?.addEventListener("click", closeProjectDialog);
  document.querySelector("#editProjectButton")?.addEventListener("click", () => {
    if (!activeProjectId) return;
    const project = state.data?.projects?.find(p => Number(p.id) === Number(activeProjectId));
    if (project) openProjectEditor(project);
  });
  document.querySelector("#closeProjectEditorDialog")?.addEventListener("click", closeProjectEditor);
  document.querySelector("#cancelProjectButton")?.addEventListener("click", closeProjectEditor);
  document.querySelector("#projectForm")?.addEventListener("submit", saveProject);
  document.querySelector("#projectEditorDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeProjectEditor();
  });
  document.querySelector("#addProjectDocumentButton")?.addEventListener("click", () => {
    document.querySelector("#projectDocumentFile")?.click();
  });
  document.querySelector("#projectDocumentFile")?.addEventListener("change", uploadProjectDocument);
  document.querySelector("#projectDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closeProjectDialog();
  });
  document.querySelector("#projectDetailBody")?.addEventListener("click", handleProjectDetailClick);
  document.querySelector("#projectDetailBody")?.addEventListener("change", handleProjectDetailChange);
}

async function handleProjectDetailChange(event) {
  const select = event.target.closest("[data-project-status-select]");
  if (!select) return;

  const projectId = Number(select.dataset.projectStatusSelect);
  const project = state.data?.projects?.find(p => Number(p.id) === projectId);
  if (!project) return;

  const oldStatus = project.status;
  const newStatus = select.value;
  if (oldStatus === newStatus) return;

  select.disabled = true;

  try {
    const payload = {
      propertyId: state.data.property.id,
      parentProjectId: project.parentProjectId ?? null,
      name: project.name,
      status: newStatus,
      purpose: project.purpose || null,
      estimatedCost: project.estimatedCost ?? null,
      committedCost: project.committedCost ?? null,
      contractorName: project.contractorName || null,
      targetDate: project.targetDate || null,
      notes: project.notes || null
    };

    const response = await fetch(`/api/home/projects/${projectId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(await readError(response));

    await loadDashboard();
    await loadProjectDetails(projectId);
    showToast(`Project status: ${newStatus}`);
  } catch (error) {
    console.error(error);
    select.value = oldStatus;
    showToast(error.message || "Could not update project status.");
  } finally {
    select.disabled = false;
  }
}

function openProjectEditor(project = null) {
  const dialog = document.querySelector("#projectEditorDialog");
  const form = document.querySelector("#projectForm");
  if (!dialog || !form || !state.data?.property) return;

  form.reset();
  clearProjectFormError();

  const isEdit = !!project;
  document.querySelector("#projectEditorTitle").textContent =
    isEdit ? "Edit project" : "Add project";
  document.querySelector("#projectEditorId").value =
    isEdit ? String(project.id) : "";

  document.querySelector("#projectName").value = project?.name || "";
  document.querySelector("#projectStatus").value = project?.status || "Planned";
  document.querySelector("#projectPurpose").value = project?.purpose || "";
  document.querySelector("#projectEstimatedCost").value = project?.estimatedCost ?? "";
  document.querySelector("#projectCommittedCost").value = project?.committedCost ?? "";
  document.querySelector("#projectContractorName").value = project?.contractorName || "";
  document.querySelector("#projectTargetDate").value = project?.targetDate || "";
  document.querySelector("#projectNotes").value = project?.notes || "";

  populateProjectParentOptions(project?.id || null, project?.parentProjectId || null);

  if (document.querySelector("#projectDialog")?.open) {
    document.querySelector("#projectDialog").close();
  }

  dialog.showModal();
  window.setTimeout(() => document.querySelector("#projectName")?.focus(), 30);
}

function closeProjectEditor() {
  document.querySelector("#projectEditorDialog")?.close();
  clearProjectFormError();
}

function populateProjectParentOptions(editingProjectId, selectedParentId) {
  const select = document.querySelector("#projectParent");
  if (!select) return;

  const excludedIds = new Set();

  if (editingProjectId) {
    excludedIds.add(Number(editingProjectId));

    const childrenByParent = new Map();
    for (const project of state.data?.projects || []) {
      if (project.parentProjectId == null) continue;
      const parentId = Number(project.parentProjectId);
      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
      childrenByParent.get(parentId).push(Number(project.id));
    }

    const queue = [Number(editingProjectId)];
    while (queue.length) {
      const current = queue.shift();
      for (const childId of childrenByParent.get(current) || []) {
        if (excludedIds.has(childId)) continue;
        excludedIds.add(childId);
        queue.push(childId);
      }
    }
  }

  const options = (state.data?.projects || [])
    .filter(project => !excludedIds.has(Number(project.id)))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map(project =>
      `<option value="${project.id}">${escapeHtml(project.name)}</option>`
    )
    .join("");

  select.innerHTML = `<option value="">Top-level project</option>${options}`;
  select.value = selectedParentId ? String(selectedParentId) : "";
}

async function saveProject(event) {
  event.preventDefault();
  clearProjectFormError();

  const id = Number(document.querySelector("#projectEditorId")?.value || 0);
  const name = document.querySelector("#projectName")?.value.trim();

  if (!name) {
    showProjectFormError("Project name is required.");
    return;
  }

  const payload = {
    propertyId: state.data.property.id,
    parentProjectId: nullableProjectNumber(document.querySelector("#projectParent")?.value),
    name,
    status: document.querySelector("#projectStatus")?.value || "Planned",
    purpose: document.querySelector("#projectPurpose")?.value.trim() || null,
    estimatedCost: nullableProjectNumber(document.querySelector("#projectEstimatedCost")?.value),
    committedCost: nullableProjectNumber(document.querySelector("#projectCommittedCost")?.value),
    contractorName: document.querySelector("#projectContractorName")?.value.trim() || null,
    targetDate: document.querySelector("#projectTargetDate")?.value || null,
    notes: document.querySelector("#projectNotes")?.value.trim() || null
  };

  const button = document.querySelector("#saveProjectButton");
  if (button) {
    button.disabled = true;
    button.textContent = "Saving…";
  }

  try {
    const response = await fetch(
      id ? `/api/home/projects/${id}` : "/api/home/projects",
      {
        method: id ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok)
      throw new Error(await readError(response));

    const result = await response.json();
    const savedId = Number(result.id || id);

    closeProjectEditor();
    await loadDashboard();

    showToast(id ? "Project updated." : "Project created.");

    if (id && savedId) {
      await openProjectDialog(savedId);
    }
  } catch (error) {
    console.error(error);
    showProjectFormError(error.message || "Could not save project.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Save project";
    }
  }
}

function nullableProjectNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function showProjectFormError(message) {
  const error = document.querySelector("#projectFormError");
  if (!error) return;
  error.textContent = message;
  error.hidden = false;
}

function clearProjectFormError() {
  const error = document.querySelector("#projectFormError");
  if (!error) return;
  error.textContent = "";
  error.hidden = true;
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

  const allAttachments = detail.attachments || [];
  const projectPhotos = allAttachments.filter(a =>
    a.entityType === "HomeProject" && a.contentType?.startsWith("image/")
  );
  const documents = allAttachments.filter(a =>
    !(a.entityType === "HomeProject" && a.contentType?.startsWith("image/"))
  );

  const photos = renderProjectPhotos(projectPhotos);
  const attachments = renderProjectDocuments(documents);

  body.innerHTML = `
    <div class="project-detail-summary">
      <div class="project-detail-stat"><span>Actual spent</span><strong>${money.format(detail.actualSpent || 0)}</strong></div>
      <label class="project-detail-stat project-status-stat">
        <span>Status</span>
        <select class="project-detail-status-select" data-project-status-select="${p.id}">
          ${projectStatusOptions(p.status)}
        </select>
      </label>
      <div class="project-detail-stat"><span>Files</span><strong>${detail.documentCount || 0}</strong></div>
    </div>

    ${[p.purpose, p.contractorName, completed ? `Completed ${completed}` : null].filter(Boolean).length
      ? `<div class="project-meta">${escapeHtml([p.purpose, p.contractorName, completed ? `Completed ${completed}` : null].filter(Boolean).join(" · "))}</div>`
      : ""}

    ${p.notes ? `<p class="project-notes">${escapeHtml(p.notes)}</p>` : ""}
    ${children}

    <div class="project-detail-section">
      <div class="project-detail-section-head">
        <h3>Project photos</h3>
        <span>${projectPhotos.length} photo${projectPhotos.length === 1 ? "" : "s"}</span>
      </div>
      ${photos}
    </div>

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

function projectStatusOptions(selectedStatus) {
  const statuses = [
    "Planned",
    "Research",
    "Getting Bids",
    "Bid Received",
    "Approved",
    "Scheduled",
    "In Progress",
    "Waiting",
    "On Hold",
    "Ordered",
    "Complete",
    "Cancelled"
  ];

  return statuses.map(status =>
    `<option value="${escapeAttribute(status)}" ${status === selectedStatus ? "selected" : ""}>${escapeHtml(status)}</option>`
  ).join("");
}

function renderProjectPhotos(attachments) {
  if (!attachments.length) {
    return `<div class="empty project-photo-empty">No project photos yet. Add renderings, before/after shots, or progress photos.</div>`;
  }

  return `<div class="project-photo-grid">
    ${attachments.map(attachment => `
      <article class="project-photo-card">
        <button type="button"
                class="project-photo-trigger"
                data-attachment-id="${attachment.id}"
                data-file-name="${escapeAttribute(attachment.fileName)}"
                data-content-type="${escapeAttribute(attachment.contentType || "")}">
          <img src="/api/attachments/${attachment.id}/thumbnail"
               alt="${escapeAttribute(attachment.fileName)}">
        </button>
        <div class="project-photo-meta">
          <strong title="${escapeAttribute(attachment.fileName)}">${escapeHtml(attachment.fileName)}</strong>
          <button type="button"
                  class="document-delete"
                  data-delete-attachment-id="${attachment.id}"
                  data-file-name="${escapeAttribute(attachment.fileName)}">Delete</button>
        </div>
      </article>
    `).join("")}
  </div>`;
}

function renderProjectDocuments(attachments) {
  if (!attachments.length) {
    return `<div class="empty">No receipts or project documents attached yet.</div>`;
  }

  return `<div class="document-grid">
    ${attachments.map(attachment => {
      const isImage = attachment.contentType?.startsWith("image/");
      const isPdf = attachment.contentType === "application/pdf";
      const preview = isImage
        ? `<img src="/api/attachments/${attachment.id}/thumbnail" alt="${escapeAttribute(attachment.fileName)}">`
        : `<span class="document-file-icon">${isPdf ? "PDF" : "📄"}</span>`;

      return `<div class="document-card">
        <button type="button"
                class="document-preview project-file-trigger"
                data-attachment-id="${attachment.id}"
                data-file-name="${escapeAttribute(attachment.fileName)}"
                data-content-type="${escapeAttribute(attachment.contentType || "")}">
          ${preview}
        </button>
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
  const files = [...(input.files || [])];
  if (!files.length || !activeProjectId) return;

  const message = document.querySelector("#projectDocumentMessage");
  let uploaded = 0;

  try {
    for (const file of files) {
      message.textContent = `Uploading ${uploaded + 1} of ${files.length}…`;

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/home/projects/${activeProjectId}/attachments`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) throw new Error(await readError(response));
      uploaded++;
    }

    input.value = "";
    message.textContent = uploaded === 1 ? "Uploaded." : `${uploaded} files uploaded.`;
    await loadProjectDetails(activeProjectId);
    showToast(uploaded === 1 ? "Project file added." : `${uploaded} project files added.`);
  } catch (error) {
    console.error(error);
    message.textContent = error.message || "Upload failed.";
  }
}

async function handleProjectDetailClick(event) {
  const fileButton = event.target.closest(".project-photo-trigger, .project-file-trigger");
  if (fileButton) {
    openImageViewer(
      Number(fileButton.dataset.attachmentId),
      fileButton.dataset.fileName,
      fileButton.dataset.contentType || ""
    );
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
