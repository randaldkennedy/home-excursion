let projectLandingFilter = "all";
let projectLandingSort = "priority";

function renderProjects() {
  const container = document.querySelector("#projects");
  if (!container || !state.data?.projects) return;

  const allProjects = [...state.data.projects];
  let roots = allProjects.filter(project => project.parentProjectId == null);

  const normalize = value => String(value || "").trim().toLowerCase();
  const filterMatch = project => {
    const status = normalize(project.status);
    if (projectLandingFilter === "active")
      return !["complete", "closed", "cancelled"].includes(status);
    if (projectLandingFilter === "bids")
      return status === "getting bids" || status === "research";
    if (projectLandingFilter === "scheduled")
      return status === "scheduled" || status === "approved";
    if (projectLandingFilter === "complete")
      return status === "complete" || status === "closed";
    return true;
  };

  roots = roots.filter(filterMatch);

  const sorters = {
    name: (a, b) => (a.name || "").localeCompare(b.name || ""),
    date: (a, b) => projectDateRank(a) - projectDateRank(b) || (a.name || "").localeCompare(b.name || ""),
    cost: (a, b) => Number(b.estimatedCost || 0) - Number(a.estimatedCost || 0) || (a.name || "").localeCompare(b.name || ""),
    priority: (a, b) =>
      projectStatusRank(a) - projectStatusRank(b) ||
      projectDateRank(a) - projectDateRank(b) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      (a.name || "").localeCompare(b.name || "")
  };
  roots.sort(sorters[projectLandingSort] || sorters.priority);

  updateProjectLandingCounts(allProjects);

  document.querySelectorAll("[data-project-filter]").forEach(button => {
    const filter = button.dataset.projectFilter;
    let count = 0;
    if (filter === "all") count = allProjects.filter(p => p.parentProjectId == null).length;
    else if (filter === "active") count = allProjects.filter(p => p.parentProjectId == null && !["complete","closed","cancelled"].includes(normalize(p.status))).length;
    else if (filter === "bids") count = allProjects.filter(p => p.parentProjectId == null && ["getting bids","research"].includes(normalize(p.status))).length;
    else if (filter === "scheduled") count = allProjects.filter(p => p.parentProjectId == null && ["scheduled","approved"].includes(normalize(p.status))).length;
    else if (filter === "complete") count = allProjects.filter(p => p.parentProjectId == null && ["complete","closed"].includes(normalize(p.status))).length;
    const label = button.textContent.replace(/\s*\(\d+\)\s*$/, "");
    button.textContent = `${label} (${count})`;
    button.classList.toggle("active", filter === projectLandingFilter);
  });

  if (!roots.length) {
    container.innerHTML = `<div class="empty projects-empty">No projects match this filter.</div>`;
    return;
  }

  container.innerHTML = roots.map(project => {
    const status = project.status || "Planned";
    const statusClass = projectLandingStatusClass(status);
    const children = allProjects.filter(p => Number(p.parentProjectId) === Number(project.id));
    const spent = Number(project.actualSpent || 0);
    const estimate = project.estimatedCost != null ? Number(project.estimatedCost) : null;
    const target = project.targetDate ? formatDateOnly(project.targetDate) : null;
    const notes = String(project.notes || "").trim();
    const shortNotes = notes.length > 135 ? `${notes.slice(0, 132).trim()}…` : notes;

    const nextStep = target
      ? `<strong>${escapeHtml(projectLandingNextStep(status))}</strong><span>${escapeHtml(target)}</span>`
      : `<strong>${escapeHtml(projectLandingNextStep(status))}</strong><span>${escapeHtml(projectLandingNextStepSubtext(status))}</span>`;

    return `<article class="project-workspace-row" data-project-id="${project.id}">
      <div class="project-row-main">
        <div class="project-row-icon" aria-hidden="true">${projectLandingIcon(project)}</div>
        <div class="project-row-copy">
          <h3>${escapeHtml(project.name)}</h3>
          <div class="project-row-meta">
            ${project.purpose ? `<span>${escapeHtml(project.purpose)}</span>` : ""}
            ${children.length ? `<span>${children.length} included item${children.length === 1 ? "" : "s"}</span>` : ""}
          </div>
          ${shortNotes ? `<p>${escapeHtml(shortNotes)}</p>` : ""}
        </div>
      </div>

      <div class="project-row-stat">
        <span class="project-row-label">Status</span>
        <strong class="project-status-pill ${statusClass}">${escapeHtml(status)}</strong>
      </div>

      <div class="project-row-stat project-row-money">
        <span class="project-row-label">Estimated</span>
        <strong>${estimate != null ? money.format(estimate) : "—"}</strong>
        ${spent > 0 ? `<span>${money.format(spent)} spent</span>` : `<span>No posted spend</span>`}
      </div>

      <div class="project-row-stat project-row-next">
        <span class="project-row-label">Next step</span>
        ${nextStep}
      </div>

      <button class="project-open-btn" type="button" data-project-open="${project.id}">
        View project <span aria-hidden="true">→</span>
      </button>
    </article>`;
  }).join("");

  bindRenderedProjectEvents(container);
}

function updateProjectLandingCounts(projects) {
  const roots = projects.filter(p => p.parentProjectId == null);
  const normalized = p => String(p.status || "").trim().toLowerCase();
  const completed = roots.filter(p => ["complete", "closed"].includes(normalized(p))).length;
  const open = roots.filter(p => !["complete", "closed", "cancelled"].includes(normalized(p))).length;

  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = String(value);
  };
  setText("#openProjectCount", open);
  setText("#completedProjectCount", completed);
  setText("#totalProjectCount", roots.length);
  setText("#sidebarTaskCount", state.data?.summary?.totalItems ?? "");
}

function projectLandingStatusClass(status) {
  const value = String(status || "").trim().toLowerCase();
  if (["complete", "closed"].includes(value)) return "complete";
  if (["in progress"].includes(value)) return "in-progress";
  if (["getting bids", "research"].includes(value)) return "bids";
  if (["scheduled", "approved"].includes(value)) return "scheduled";
  if (["waiting", "on hold"].includes(value)) return "waiting";
  if (["cancelled"].includes(value)) return "cancelled";
  return "planned";
}

function projectLandingNextStep(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "getting bids") return "Review bids";
  if (value === "research") return "Find contractors";
  if (value === "scheduled") return "Project scheduled";
  if (value === "approved") return "Schedule work";
  if (value === "in progress") return "Work underway";
  if (value === "closing / punch list") return "Finish punch list";
  if (value === "waiting") return "Waiting";
  if (value === "on hold") return "Revisit project";
  if (value === "complete" || value === "closed") return "Completed";
  if (value === "cancelled") return "Cancelled";
  return "Define next step";
}

function projectLandingNextStepSubtext(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "getting bids") return "Compare contractor proposals";
  if (value === "research") return "Make the first call";
  if (value === "in progress") return "Track the work";
  if (value === "closing / punch list") return "Close remaining items";
  if (value === "complete" || value === "closed") return "No action needed";
  return "No target date set";
}

function projectLandingIcon(project) {
  const name = `${project.name || ""} ${project.purpose || ""}`.toLowerCase();
  if (name.includes("kitchen")) return "⌂";
  if (name.includes("paint")) return "▤";
  if (name.includes("landscap") || name.includes("yard")) return "♣";
  if (name.includes("window")) return "▦";
  if (name.includes("carpet") || name.includes("floor")) return "▥";
  if (name.includes("siding") || name.includes("exterior")) return "⌂";
  return "◆";
}

function bindProjectLandingControls() {
  document.querySelector("#projectLandingFilters")?.addEventListener("click", event => {
    const button = event.target.closest("[data-project-filter]");
    if (!button) return;
    projectLandingFilter = button.dataset.projectFilter || "all";
    renderProjects();
  });

  document.querySelector("#projectLandingSort")?.addEventListener("change", event => {
    projectLandingSort = event.target.value || "priority";
    renderProjects();
  });
}

function bindRenderedProjectEvents(container) {
  container.querySelectorAll("[data-project-id]").forEach(card => {
    card.addEventListener("click", event => {
      if (event.target.closest("button, a, input, select")) return;
      openProjectDialog(Number(card.dataset.projectId));
    });
  });

  container.querySelectorAll("[data-project-open]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      openProjectDialog(Number(button.dataset.projectOpen));
    });
  });
}

function projectStatusRank(project) {
  const status = (project.status || "").trim().toLowerCase();

  if (status === "in progress" || status === "active") return 0;
  if (status === "approved" || status === "scheduled") return 1;
  if (status === "getting bids" || status === "research" || status === "planned") return 2;
  if (status === "waiting" || status === "on hold" || status === "ordered") return 3;
  if (status === "closing / punch list") return 4;
  if (status === "closed" || status === "complete") return 9;
  if (status === "cancelled") return 10;

  return 3;
}

function projectDateRank(project) {
  if (!project.targetDate) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(`${project.targetDate}T00:00:00`);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

let activeProjectId = null;
let activeProjectContractorId = null;
let expandedProjectContractorIds = new Set();
let showHistoricalProjectBidders = false;

function bindProjectDetails() {
  bindProjectLandingControls();
  document.querySelector("#addProjectButton")?.addEventListener("click", () => openProjectEditor());
  document.querySelector("#addContractorButton")?.addEventListener("click", () => openContractorEditor());
  document.querySelector("#contractors")?.addEventListener("click", handleContractorListClick);
  loadContractors();
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
    contractorName: projectForPayloadContractorName(id),
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

function parseProjectCurrency(value) {
  if (value == null) return null;

  const cleaned = String(value)
    .replace(/[$,\s]/g, "")
    .trim();

  if (!cleaned) return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatProjectCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";

  return number.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatProjectPhone(value) {
  if (!value) return "";

  const raw = String(value).trim();
  const digits = raw.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;

  if (tenDigits.length !== 10) return raw;

  return `(${tenDigits.slice(0, 3)}) ${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}

function formatProjectActivityWhen(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function nullableProjectNumber(value) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function projectForPayloadContractorName(projectId) {
  if (!projectId) return null;
  const project = state.data?.projects?.find(p => Number(p.id) === Number(projectId));
  return project?.contractorName || null;
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
  showHistoricalProjectBidders = false;
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
  body._projectDetail = detail;
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
    a.entityType !== "ProjectContractor" &&
    !(a.entityType === "HomeProject" && a.contentType?.startsWith("image/"))
  );

  const photos = renderProjectPhotos(projectPhotos);
  const attachments = renderProjectDocuments(documents);
  const contractors = renderProjectContractors(detail.contractors || [], allAttachments);
  const selectedContractor = (detail.contractors || []).find(c => c.isSelected) || null;
  const detailMeta = [
    p.purpose,
    selectedContractor?.name || null,
    completed ? `Completed ${completed}` : null
  ].filter(Boolean);

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

    ${detailMeta.length
      ? `<div class="project-meta">${escapeHtml(detailMeta.join(" · "))}</div>`
      : ""}

    ${p.notes ? `<p class="project-notes">${escapeHtml(p.notes)}</p>` : ""}
    ${children}

    <div class="project-detail-section">
      <div class="project-detail-section-head">
        <h3>${["Planned", "Research", "Getting Bids"].includes(p.status) ? "Contractors contacted for bids" : "Contractors & bids"}</h3>
        <button type="button" class="secondary-button" data-add-project-contractor>
          ${["Planned", "Research", "Getting Bids"].includes(p.status) ? "+ Log contractor call" : "+ Add contractor"}
        </button>
      </div>
      ${contractors}
    </div>

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
    "Approved",
    "Scheduled",
    "In Progress",
    "Waiting",
    "On Hold",
    "Ordered",
    "Closing / Punch List",
    "Closed",
    "Complete",
    "Cancelled"
  ];

  return statuses.map(status =>
    `<option value="${escapeAttribute(status)}" ${status === selectedStatus ? "selected" : ""}>${escapeHtml(status)}</option>`
  ).join("");
}

function projectContractorStatusOptions(selectedStatus) {
  const statuses = [
    "Considering",
    "Contacted",
    "Callback Pending",
    "Appointment Scheduled",
    "Walkthrough Scheduled",
    "Awaiting Bid",
    "Bid Received",
    "Revision Requested",
    "Shortlisted",
    "Selected",
    "Declined",
    "No Response"
  ];

  return statuses.map(status =>
    `<option value="${escapeAttribute(status)}" ${status === selectedStatus ? "selected" : ""}>${escapeHtml(status)}</option>`
  ).join("");
}

function renderProjectContractors(contractors, attachments) {
  if (!contractors.length) {
    return `<div class="empty">No contractors associated with this project yet.</div>`;
  }

  const detail = document.querySelector("#projectDetailBody")?._projectDetail || {};
  const contacts = detail.contacts || [];
  const activities = detail.activities || [];
  const proposals = detail.proposals || [];

  const selected = contractors.filter(c => c.isSelected);
  const bidders = selected.length && !showHistoricalProjectBidders
    ? selected
    : contractors;

  const hiddenHistoryCount = selected.length
    ? Math.max(0, contractors.length - selected.length)
    : 0;

  return `
    <div class="bidder-grid">
      <div class="bidder-grid-header">
        <div>Contractor</div>
        <div>Contact</div>
        <div>Status</div>
        <div>Current bid</div>
        <div>Last contact</div>
        <div>Next appointment</div>
        <div></div>
      </div>

      ${bidders.map(contractor => {
        const contractorContacts = contractor.vendorId
          ? contacts.filter(c => Number(c.vendorId) === Number(contractor.vendorId))
          : [];
        const primaryContact =
          contractorContacts.find(c => c.isPrimary) ||
          contractorContacts[0] ||
          null;

        const currentProposal = proposals.find(p =>
          Number(p.projectContractorId) === Number(contractor.id) && p.isCurrent
        );

        const lastActivity =
          projectContractorLastContact(contractor.id, activities);
        const nextAppointment =
          projectContractorNextAppointment(contractor.id, activities);

        const bidAmount = currentProposal?.amount ?? contractor.bidAmount;
        const selectedBadge = contractor.isSelected
          ? `<span class="badge complete" style="margin-left:6px">Awarded</span>`
          : "";

        const phone = formatProjectPhone(primaryContact?.phone || contractor.phone || "");

        return `<div class="bidder-grid-row">
          <div class="bidder-name">
            <strong>${escapeHtml(contractor.name)}</strong>${selectedBadge}
          </div>

          <div class="bidder-contact">
            <strong>${escapeHtml(primaryContact?.name || "—")}</strong>
            <span>${escapeHtml(phone || "—")}</span>
          </div>

          <div><span class="badge">${escapeHtml(contractor.status)}</span></div>

          <div class="bidder-money">
            <strong>${bidAmount != null ? money.format(Number(bidAmount)) : "—"}</strong>
          </div>

          <div title="${lastActivity ? escapeAttribute(`${lastActivity.activityType || "Activity"}: ${lastActivity.summary || ""}`) : ""}">
            ${lastActivity ? escapeHtml(formatProjectActivityWhen(lastActivity.activityAt)) : "—"}
          </div>

          <div title="${nextAppointment ? escapeAttribute(nextAppointment.summary || "") : ""}">
            ${nextAppointment ? escapeHtml(formatProjectActivityWhen(nextAppointment.activityAt)) : "—"}
          </div>

          <div class="bidder-actions">
            <button type="button" class="secondary-button"
                    data-followup-project-contractor="${contractor.id}">Update</button>
            <button type="button" class="primary-button"
                    data-open-project-contractor="${contractor.id}">Open</button>
          </div>
        </div>`;
      }).join("")}

      ${hiddenHistoryCount
        ? `<button type="button" class="secondary-button" data-show-project-bid-history style="justify-self:start;margin:10px 12px">
            View ${hiddenHistoryCount} other bidder${hiddenHistoryCount === 1 ? "" : "s"} / history
          </button>`
        : ""}
    </div>`;
}

let activeProjectContractorDetailsId = null;
let activeProjectContractorDetailsTab = "activity";

function ensureProjectContractorDetailsDialog() {
  let dialog = document.querySelector("#projectContractorDetailsDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "projectContractorDetailsDialog";
  dialog.className = "modal project-dialog";
  dialog.innerHTML = `
    <div class="modal-card contractor-detail-card"
         style="width:min(900px,calc(100vw - 48px));max-width:900px;padding:0;overflow:hidden">
      <div class="modal-header"
           style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px">
        <div>
          <div class="eyebrow">CONTRACTOR / BID</div>
          <h2 id="projectContractorDetailsTitle" style="margin:.35rem 0 0">Contractor</h2>
        </div>
        <button type="button"
                class="modal-close"
                data-close-project-contractor-details
                aria-label="Close">×</button>
      </div>

      <div id="projectContractorDetailsTabs"
           class="contractor-detail-tabs"
           style="display:flex;flex-wrap:wrap;gap:6px;padding:12px 20px;border-bottom:1px solid #e6e0d8;background:#faf7f2">
      </div>

      <div id="projectContractorDetailsBody"
           class="modal-body contractor-detail-body"
           style="padding:22px 26px;min-height:390px;max-height:62vh;overflow-y:auto;overflow-x:hidden">
      </div>

      <div class="modal-actions"
           style="display:flex;justify-content:flex-end;gap:10px;padding:16px 26px">
        <button type="button"
                class="secondary-button"
                data-edit-current-project-contractor>Edit contractor</button>
        <button type="button"
                class="primary-button"
                data-close-project-contractor-details>Close</button>
      </div>
    </div>`;

  document.body.appendChild(dialog);

  dialog.querySelectorAll("[data-close-project-contractor-details]").forEach(button =>
    button.addEventListener("click", () => dialog.close())
  );

  dialog.querySelector("[data-edit-current-project-contractor]")?.addEventListener("click", () => {
    const contractor = currentProjectContractorDetailsData();
    if (!contractor) return;
    dialog.close();
    openProjectContractorEditor(contractor);
  });

  dialog.addEventListener("click", handleProjectContractorDetailsClick);

  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });

  return dialog;
}

function currentProjectContractorDetailsData() {
  const detail = document.querySelector("#projectDetailBody")?._projectDetail;
  return detail?.contractors?.find(
    c => Number(c.id) === Number(activeProjectContractorDetailsId)
  ) || null;
}

function openProjectContractorDetails(contractorId, tab = "activity") {
  activeProjectContractorDetailsId = Number(contractorId);
  activeProjectContractorDetailsTab = tab;

  const dialog = ensureProjectContractorDetailsDialog();
  renderProjectContractorDetails();
  if (!dialog.open) dialog.showModal();
}

function refreshProjectContractorDetails() {
  const dialog = document.querySelector("#projectContractorDetailsDialog");
  if (!dialog?.open || !activeProjectContractorDetailsId) return;
  renderProjectContractorDetails();
}

function renderProjectContractorDetails() {
  const dialog = ensureProjectContractorDetailsDialog();
  const detail = document.querySelector("#projectDetailBody")?._projectDetail || {};
  const contractor = currentProjectContractorDetailsData();
  const body = dialog.querySelector("#projectContractorDetailsBody");
  const tabs = dialog.querySelector("#projectContractorDetailsTabs");

  if (!contractor) {
    body.innerHTML = `<div class="empty">Contractor not found.</div>`;
    return;
  }

  const contractorProposalIds = (detail.proposals || [])
    .filter(p => Number(p.projectContractorId) === Number(contractor.id))
    .map(p => Number(p.id));

  const contractorFiles = (detail.attachments || []).filter(a =>
    (a.entityType === "ProjectContractor" &&
     Number(a.entityId) === Number(contractor.id)) ||
    (a.entityType === "ProjectContractorProposal" &&
     contractorProposalIds.includes(Number(a.entityId)))
  );

  const contacts = contractor.vendorId
    ? (detail.contacts || []).filter(c => Number(c.vendorId) === Number(contractor.vendorId))
    : [];

  const activities = (detail.activities || []).filter(
    a => Number(a.projectContractorId) === Number(contractor.id)
  );

  const tabDefs = [
    ["activity", `Activity (${activities.length})`],
    ["overview", "Overview"],
    ["contacts", `Contacts (${contacts.length})`],
    ["proposals", `Bids (${(detail.proposals || []).filter(p => Number(p.projectContractorId) === Number(contractor.id)).length})`],
    ["files", `Files (${contractorFiles.length})`],
    ["notes", "Notes"]
  ];

  tabs.innerHTML = tabDefs.map(([key, label]) => `
    <button type="button"
            data-contractor-details-tab="${key}"
            class="${activeProjectContractorDetailsTab === key ? "primary-button" : "secondary-button"}"
            style="padding:7px 12px">
      ${escapeHtml(label)}
    </button>
  `).join("");

  dialog.querySelector("#projectContractorDetailsTitle").textContent = contractor.name;

  if (activeProjectContractorDetailsTab === "contacts") {
    body.innerHTML = renderProjectContractorContactsTab(contractor, contacts);
    return;
  }

  if (activeProjectContractorDetailsTab === "activity") {
    body.innerHTML = renderProjectContractorActivityTab(contractor, activities);
    return;
  }

  if (activeProjectContractorDetailsTab === "proposals") {
    const proposals = (detail.proposals || []).filter(
      p => Number(p.projectContractorId) === Number(contractor.id)
    );
    body.innerHTML = renderProjectContractorProposalsTab(contractor, proposals, detail.attachments || []);
    return;
  }

  if (activeProjectContractorDetailsTab === "files") {
    body.innerHTML = renderProjectContractorFilesTab(contractor, contractorFiles);
    return;
  }

  if (activeProjectContractorDetailsTab === "notes") {
    body.innerHTML = renderProjectContractorNotesTab(contractor);
    return;
  }

  body.innerHTML = renderProjectContractorOverviewTab(contractor, contacts, activities, contractorFiles);
}

function renderProjectContractorOverviewTab(contractor, contacts, activities, files) {
  const primaryContact = contacts.find(c => c.isPrimary) || contacts[0] || null;
  const lastActivity = activities[0] || null;
  const bid = contractor.bidAmount != null ? money.format(Number(contractor.bidAmount)) : "No bid yet";
  const address = [
    contractor.address1,
    contractor.address2,
    [contractor.city, contractor.state, contractor.postalCode].filter(Boolean).join(" ")
  ].filter(Boolean);

  return `
    <div class="project-detail-summary" style="margin-bottom:18px">
      <div class="project-detail-stat"><span>Status</span><strong>${escapeHtml(contractor.status)}</strong></div>
      <div class="project-detail-stat"><span>Bid</span><strong>${escapeHtml(bid)}</strong></div>
      <div class="project-detail-stat"><span>Files</span><strong>${files.length}</strong></div>
    </div>

    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px">
      <section style="border:1px solid #e0d8ce;border-radius:12px;padding:16px">
        <div class="eyebrow">COMPANY</div>
        <h3 style="margin:6px 0 12px">${escapeHtml(contractor.name)}</h3>
        ${contractor.phone ? `<div>${escapeHtml(formatProjectPhone(contractor.phone))}</div>` : ""}
        ${contractor.email ? `<div>${escapeHtml(contractor.email)}</div>` : ""}
        ${contractor.website ? `<div>${escapeHtml(contractor.website)}</div>` : ""}
        ${address.length ? `<div style="margin-top:10px">${address.map(x => escapeHtml(x)).join("<br>")}</div>` : ""}
        ${contractor.vendorNotes ? `<p class="project-notes" style="margin-top:12px">${escapeHtml(contractor.vendorNotes)}</p>` : ""}
      </section>

      <section style="border:1px solid #e0d8ce;border-radius:12px;padding:16px">
        <div class="eyebrow">PRIMARY CONTACT</div>
        ${primaryContact ? `
          <h3 style="margin:6px 0 8px">${escapeHtml(primaryContact.name)}</h3>
          ${primaryContact.title ? `<div class="expense-meta">${escapeHtml(primaryContact.title)}</div>` : ""}
          ${primaryContact.phone ? `<div style="margin-top:8px">${escapeHtml(formatProjectPhone(primaryContact.phone))}</div>` : ""}
          ${primaryContact.email ? `<div>${escapeHtml(primaryContact.email)}</div>` : ""}
        ` : `<div class="empty" style="margin-top:10px">No named contact yet.</div>`}

        <div class="eyebrow" style="margin-top:20px">LAST ACTIVITY</div>
        ${lastActivity ? `
          <strong style="display:block;margin-top:6px">${escapeHtml(lastActivity.activityType)} · ${escapeHtml(lastActivity.summary)}</strong>
          <div class="expense-meta">${new Date(lastActivity.activityAt).toLocaleString()}</div>
        ` : `<div class="empty" style="margin-top:10px">No activity yet.</div>`}
      </section>
    </div>

    ${contractor.isSelected ? `<div style="margin-top:16px"><span class="badge complete">Awarded / selected contractor</span></div>` : ""}
  `;
}

function renderProjectContractorContactsTab(contractor, contacts) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px">
      <div>
        <h3 style="margin:0">Contacts</h3>
        <div class="expense-meta">People you call, text, or email at ${escapeHtml(contractor.name)}.</div>
      </div>
      <button type="button"
              class="primary-button"
              data-add-project-contractor-contact="${contractor.id}">+ Add contact</button>
    </div>

    ${contacts.length ? `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px">
      ${contacts.map(contact => `
        <article style="border:1px solid #e0d8ce;border-radius:12px;padding:14px">
          <div style="display:flex;justify-content:space-between;gap:10px">
            <div>
              <strong>${escapeHtml(contact.name)}</strong>
              ${contact.title ? `<div class="expense-meta">${escapeHtml(contact.title)}</div>` : ""}
            </div>
            ${contact.isPrimary ? `<span class="badge">Primary</span>` : ""}
          </div>
          ${contact.phone ? `<div style="margin-top:10px">${escapeHtml(formatProjectPhone(contact.phone))}</div>` : ""}
          ${contact.email ? `<div>${escapeHtml(contact.email)}</div>` : ""}
          ${contact.notes ? `<p class="project-notes">${escapeHtml(contact.notes)}</p>` : ""}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">
            <button type="button"
                    class="secondary-button"
                    data-edit-project-contractor-contact="${contact.id}"
                    data-contractor-id="${contractor.id}">Edit</button>
            <button type="button"
                    class="document-delete"
                    data-delete-project-contractor-contact="${contact.id}"
                    data-contractor-id="${contractor.id}">Delete</button>
          </div>
        </article>
      `).join("")}
    </div>` : `<div class="empty">No named contacts yet.</div>`}
  `;
}

function renderProjectContractorProposalsTab(contractor, proposals, attachments) {
  const sorted = [...proposals].sort((a, b) =>
    Number(b.isCurrent) - Number(a.isCurrent) ||
    String(b.receivedDate || "").localeCompare(String(a.receivedDate || "")) ||
    Number(b.id) - Number(a.id)
  );

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px">
      <div>
        <h3 style="margin:0">Bid history</h3>
        <div class="expense-meta">Old bids stay here. One bid is the current working bid.</div>
      </div>
      <button type="button" class="primary-button" data-add-project-contractor-proposal="${contractor.id}">+ Add bid</button>
    </div>

    ${sorted.length ? `<div style="display:grid;gap:10px">
      ${sorted.map(proposal => {
        const bidFiles = (attachments || []).filter(a =>
          a.entityType === "ProjectContractorProposal" &&
          Number(a.entityId) === Number(proposal.id)
        );

        return `
          <article class="bid-history-card">
            <div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <strong>${proposal.amount != null ? money.format(Number(proposal.amount)) : "Amount not entered"}</strong>
                ${proposal.isCurrent ? `<span class="badge complete">Current</span>` : ""}
              </div>
              <div class="expense-meta">
                Received ${escapeHtml(formatDateOnly(proposal.receivedDate))}
                ${proposal.revisionLabel ? ` · ${escapeHtml(proposal.revisionLabel)}` : ""}
              </div>
              ${proposal.notes ? `<p class="project-notes">${escapeHtml(proposal.notes)}</p>` : ""}
            </div>

            <div class="bid-history-files">
              ${bidFiles.length
                ? bidFiles.map(file => `
                    <button type="button"
                            class="bid-file-link project-contractor-file-trigger"
                            data-attachment-id="${file.id}"
                            data-file-name="${escapeAttribute(file.fileName)}"
                            data-content-type="${escapeAttribute(file.contentType || "")}">
                      📎 ${escapeHtml(file.fileName)}
                    </button>
                  `).join("")
                : `<span class="expense-meta">No file attached</span>`}
            </div>
          </article>`;
      }).join("")}
    </div>` : `<div class="empty">No bids received yet.</div>`}
  `;
}
function renderProjectContractorActivityTab(contractor, activities) {
  const detail = document.querySelector("#projectDetailBody")?._projectDetail || {};
  const proposals = (detail.proposals || []).filter(
    p => Number(p.projectContractorId) === Number(contractor.id)
  );

  const regularActivities = [...activities]
    .filter(a => a.activityType !== "Estimate")
    .map(activity => ({
      kind: "activity",
      id: activity.id,
      activityAt: activity.activityAt,
      type: activity.activityType || "Note",
      summary: activity.summary || "Activity"
    }));

  const bidActivities = proposals.map(proposal => ({
    kind: "bid",
    id: proposal.id,
    activityAt: `${proposal.receivedDate}T12:00:00`,
    type: "Bid",
    summary: [
      "Bid received",
      proposal.amount != null ? money.format(Number(proposal.amount)) : null,
      proposal.revisionLabel || null
    ].filter(Boolean).join(" · ")
  }));

  const rows = [...regularActivities, ...bidActivities]
    .sort((a, b) => new Date(b.activityAt || 0) - new Date(a.activityAt || 0));

  return `
    <div class="contractor-activity-heading">
      <div>
        <h3>Activity</h3>
        <div class="expense-meta">Calls, emails, appointments, bids, walkthroughs and notes.</div>
      </div>
      <button type="button"
              class="primary-button"
              data-add-project-contractor-activity="${contractor.id}">+ Log activity</button>
    </div>

    ${rows.length ? `
      <div class="contractor-activity-grid">
        <div class="contractor-activity-grid-head">
          <div>Date / time</div>
          <div>Type</div>
          <div>Summary</div>
        </div>

        ${rows.map(row => `
          <button type="button"
                  class="contractor-activity-row"
                  ${row.kind === "bid"
                    ? `data-view-project-contractor-bid="${row.id}"`
                    : `data-view-project-contractor-activity="${row.id}"`}>
            <span>${escapeHtml(formatProjectActivityWhen(row.activityAt))}</span>
            <span>${escapeHtml(row.type)}</span>
            <strong>${escapeHtml(row.summary)}</strong>
          </button>
        `).join("")}
      </div>
    ` : `<div class="empty">No contractor activity yet.</div>`}
  `;
}
function renderProjectContractorFilesTab(contractor, files) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px">
      <div>
        <h3 style="margin:0">Files & renderings</h3>
        <div class="expense-meta">Estimates, proposals, renderings, plans, and other contractor-specific documents.</div>
      </div>
      <button type="button"
              class="primary-button"
              data-add-contractor-file="${contractor.id}">+ Add files</button>
    </div>

    ${files.length ? `<div class="document-grid">
      ${files.map(attachment => {
        const isImage = attachment.contentType?.startsWith("image/");
        const isPdf = attachment.contentType === "application/pdf";
        const preview = isImage
          ? `<img src="/api/attachments/${attachment.id}/thumbnail" alt="${escapeAttribute(attachment.fileName)}">`
          : `<span class="document-file-icon">${isPdf ? "PDF" : "📄"}</span>`;

        return `<div class="document-card">
          <button type="button"
                  class="document-preview project-contractor-file-trigger"
                  data-attachment-id="${attachment.id}"
                  data-file-name="${escapeAttribute(attachment.fileName)}"
                  data-content-type="${escapeAttribute(attachment.contentType || "")}">
            ${preview}
          </button>
          <div class="document-meta">
            <strong title="${escapeAttribute(attachment.fileName)}">${escapeHtml(attachment.fileName)}</strong>
            <span>${formatFileSize(attachment.fileSizeBytes)} · ${new Date(attachment.uploadedUtc).toLocaleDateString()}</span>
          </div>
          <button type="button"
                  class="document-delete"
                  data-delete-attachment-id="${attachment.id}"
                  data-file-name="${escapeAttribute(attachment.fileName)}">Delete</button>
        </div>`;
      }).join("")}
    </div>` : `<div class="empty">No files attached to this contractor yet.</div>`}
  `;
}

function renderProjectContractorNotesTab(contractor) {
  const bid = contractor.bidAmount != null ? money.format(Number(contractor.bidAmount)) : "No bid yet";

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:18px">
      <div>
        <div class="eyebrow">PROJECT / BID</div>
        <h3 style="margin:6px 0">${escapeHtml(contractor.name)}</h3>
        <div><strong>Status:</strong> ${escapeHtml(contractor.status)}</div>
        <div><strong>Bid:</strong> ${escapeHtml(bid)}</div>
      </div>
      <button type="button"
              class="secondary-button"
              data-edit-project-contractor="${contractor.id}">Edit bid / contractor</button>
    </div>

    <div class="project-detail-section" style="margin-top:20px">
      <h3>Bid notes</h3>
      ${contractor.notes
        ? `<p class="project-notes">${escapeHtml(contractor.notes)}</p>`
        : `<div class="empty">No bid notes yet.</div>`}
    </div>
  `;
}

async function handleProjectContractorDetailsClick(event) {
  const tabButton = event.target.closest("[data-contractor-details-tab]");
  if (tabButton) {
    activeProjectContractorDetailsTab = tabButton.dataset.contractorDetailsTab;
    renderProjectContractorDetails();
    return;
  }

  const addContactButton = event.target.closest("[data-add-project-contractor-contact]");
  if (addContactButton) {
    openProjectContractorContactEditor(Number(addContactButton.dataset.addProjectContractorContact));
    return;
  }

  const editContactButton = event.target.closest("[data-edit-project-contractor-contact]");
  if (editContactButton) {
    const contractorId = Number(editContactButton.dataset.contractorId);
    const contactId = Number(editContactButton.dataset.editProjectContractorContact);
    const detail = document.querySelector("#projectDetailBody")?._projectDetail;
    const contact = detail?.contacts?.find(c => Number(c.id) === contactId);
    if (contact) openProjectContractorContactEditor(contractorId, contact);
    return;
  }

  const deleteContactButton = event.target.closest("[data-delete-project-contractor-contact]");
  if (deleteContactButton) {
    await deleteProjectContractorContact(
      Number(deleteContactButton.dataset.contractorId),
      Number(deleteContactButton.dataset.deleteProjectContractorContact)
    );
    refreshProjectContractorDetails();
    return;
  }

  const activityButton = event.target.closest("[data-add-project-contractor-activity]");
  if (activityButton) {
    openProjectContractorActivityEditor(Number(activityButton.dataset.addProjectContractorActivity));
    return;
  }

  const proposalButton = event.target.closest("[data-add-project-contractor-proposal]");
  if (proposalButton) {
    openProjectContractorProposalEditor(Number(proposalButton.dataset.addProjectContractorProposal));
    return;
  }

  const addFilesButton = event.target.closest("[data-add-contractor-file]");
  if (addFilesButton) {
    chooseProjectContractorFiles(Number(addFilesButton.dataset.addContractorFile));
    return;
  }

  const editContractorButton = event.target.closest("[data-edit-project-contractor]");
  if (editContractorButton) {
    const contractor = currentProjectContractorDetailsData();
    if (!contractor) return;
    document.querySelector("#projectContractorDetailsDialog")?.close();
    openProjectContractorEditor(contractor);
    return;
  }

  const fileButton = event.target.closest(".project-contractor-file-trigger");
  if (fileButton) {
    openImageViewer(
      Number(fileButton.dataset.attachmentId),
      fileButton.dataset.fileName,
      fileButton.dataset.contentType || ""
    );
    return;
  }

  const deleteFileButton = event.target.closest("[data-delete-attachment-id]");
  if (deleteFileButton) {
    const attachmentId = Number(deleteFileButton.dataset.deleteAttachmentId);
    const fileName = deleteFileButton.dataset.fileName || "this document";
    if (!attachmentId || !confirm(`Delete "${fileName}"?`)) return;

    const response = await fetch(`/api/attachments/${attachmentId}`, { method: "DELETE" });
    if (!response.ok) {
      showToast("Couldn't delete that document.");
      return;
    }

    await loadProjectDetails(activeProjectId);
    refreshProjectContractorDetails();
    showToast("Document deleted.");
  }
}

let activeProjectContractorContactId = null;
let activeProjectContractorContactContractorId = null;
let activeProjectContractorActivityContractorId = null;

function ensureProjectContractorContactDialog() {
  let dialog = document.querySelector("#projectContractorContactDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "projectContractorContactDialog";
  dialog.className = "modal project-dialog";
  dialog.innerHTML = `
    <form id="projectContractorContactForm" class="modal-card" method="dialog"
          style="width:min(560px,calc(100vw - 32px));max-width:560px;padding:0;overflow:hidden">
      <div class="modal-header">
        <div><div class="eyebrow">CONTRACTOR CONTACT</div><h2 id="projectContractorContactDialogTitle" style="margin:.35rem 0 0">Add contact</h2></div>
        <button type="button" class="modal-close" data-close-project-contractor-contact aria-label="Close">×</button>
      </div>
      <div class="modal-body" style="display:grid;gap:14px;padding:22px 26px">
        <div id="projectContractorContactError" class="form-error" hidden></div>
        <label style="display:grid;gap:6px"><span>Name</span><input id="projectContractorContactName" maxlength="200" required></label>
        <label style="display:grid;gap:6px"><span>Title / role</span><input id="projectContractorContactTitleField" maxlength="120"></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <label style="display:grid;gap:6px"><span>Phone</span><input id="projectContractorContactPhone" maxlength="50"></label>
          <label style="display:grid;gap:6px"><span>Email</span><input id="projectContractorContactEmail" type="email" maxlength="254"></label>
        </div>
        <label style="display:grid;gap:6px"><span>Notes</span><textarea id="projectContractorContactNotes" rows="3" maxlength="2000"></textarea></label>
        <label style="display:flex;gap:8px;align-items:center"><input id="projectContractorContactPrimary" type="checkbox"><span>Primary contact</span></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary-button" data-close-project-contractor-contact>Cancel</button>
        <button type="submit" class="primary-button">Save contact</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close-project-contractor-contact]").forEach(b => b.addEventListener("click", () => dialog.close()));
  dialog.querySelector("#projectContractorContactForm")?.addEventListener("submit", saveProjectContractorContact);
  return dialog;
}

function openProjectContractorContactEditor(contractorId, contact = null) {
  const dialog = ensureProjectContractorContactDialog();
  activeProjectContractorContactContractorId = contractorId;
  activeProjectContractorContactId = contact?.id ? Number(contact.id) : null;
  dialog.querySelector("#projectContractorContactDialogTitle").textContent = contact ? "Edit contact" : "Add contact";
  dialog.querySelector("#projectContractorContactName").value = contact?.name || "";
  dialog.querySelector("#projectContractorContactTitleField").value = contact?.title || "";
  dialog.querySelector("#projectContractorContactPhone").value = contact?.phone || "";
  dialog.querySelector("#projectContractorContactEmail").value = contact?.email || "";
  dialog.querySelector("#projectContractorContactNotes").value = contact?.notes || "";
  dialog.querySelector("#projectContractorContactPrimary").checked = contact?.isPrimary === true;
  dialog.showModal();
}

async function saveProjectContractorContact(event) {
  event.preventDefault();
  const dialog = ensureProjectContractorContactDialog();
  const error = dialog.querySelector("#projectContractorContactError");
  const name = dialog.querySelector("#projectContractorContactName")?.value.trim();
  if (!name) { error.textContent = "Contact name is required."; error.hidden = false; return; }

  const payload = {
    name,
    title: dialog.querySelector("#projectContractorContactTitleField")?.value.trim() || null,
    phone: dialog.querySelector("#projectContractorContactPhone")?.value.trim() || null,
    email: dialog.querySelector("#projectContractorContactEmail")?.value.trim() || null,
    notes: dialog.querySelector("#projectContractorContactNotes")?.value.trim() || null,
    isPrimary: dialog.querySelector("#projectContractorContactPrimary")?.checked === true
  };

  let url;

  if (dialog._globalContactMode) {
    const vendorId = Number(activeGlobalContactVendorId || 0);
    if (!vendorId) {
      error.textContent = "Contractor record not found.";
      error.hidden = false;
      return;
    }
    url = activeGlobalContactId
      ? `/api/home/contractors/${vendorId}/contacts/${activeGlobalContactId}`
      : `/api/home/contractors/${vendorId}/contacts`;
  } else {
    const projectDetail = document.querySelector("#projectDetailBody")?._projectDetail;
    const projectContractor = projectDetail?.contractors?.find(
      c => Number(c.id) === Number(activeProjectContractorContactContractorId)
    );
    const vendorId = Number(projectContractor?.vendorId || 0);
    if (!vendorId) {
      error.textContent = "This project contractor is not linked to a contractor record.";
      error.hidden = false;
      return;
    }

    url = activeProjectContractorContactId
      ? `/api/home/contractors/${vendorId}/contacts/${activeProjectContractorContactId}`
      : `/api/home/contractors/${vendorId}/contacts`;
  }

  try {
    const response = await fetch(url, {
      method: (dialog._globalContactMode ? activeGlobalContactId : activeProjectContractorContactId) ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await readError(response));
    const wasGlobal = dialog._globalContactMode === true;
    const wasEdit = wasGlobal ? !!activeGlobalContactId : !!activeProjectContractorContactId;
    dialog.close();

    if (wasGlobal) {
      dialog._globalContactMode = false;
      await loadContractors();
      const contractor = contractorDirectory.find(c => Number(c.id) === Number(activeGlobalContactVendorId));
      renderGlobalContractorContacts(contractor);
      activeGlobalContactId = null;
    } else {
      await loadProjectDetails(activeProjectId);
      refreshProjectContractorDetails();
    }

    showToast(wasEdit ? "Contact updated." : "Contact added.");
  } catch (err) {
    console.error(err);
    error.textContent = err.message || "Could not save contact.";
    error.hidden = false;
  }
}

async function deleteProjectContractorContact(contractorId, contactId) {
  if (!confirm("Delete this contact?")) return;
  const detail = document.querySelector("#projectDetailBody")?._projectDetail;
  const contractor = detail?.contractors?.find(c => Number(c.id) === Number(contractorId));
  const vendorId = Number(contractor?.vendorId || 0);
  if (!vendorId) { showToast("Contractor record not found."); return; }
  const response = await fetch(`/api/home/contractors/${vendorId}/contacts/${contactId}`, { method: "DELETE" });
  if (!response.ok) { showToast(await readError(response)); return; }
  await loadProjectDetails(activeProjectId);
  refreshProjectContractorDetails();
  showToast("Contact deleted.");
}



function ensureProjectContractorBidDetailDialog() {
  let dialog = document.querySelector("#projectContractorBidDetailDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "projectContractorBidDetailDialog";
  dialog.className = "modal project-dialog";
  dialog.innerHTML = `
    <div class="modal-card activity-detail-card" style="width:min(620px,calc(100vw - 64px));max-width:620px;padding:0;overflow:hidden">
      <div class="modal-header">
        <div>
          <div class="eyebrow">BID HISTORY</div>
          <h2 style="margin:.35rem 0 0">Bid details</h2>
        </div>
        <button type="button" class="modal-close" data-close-bid-detail aria-label="Close">×</button>
      </div>

      <div class="modal-body activity-detail-body" style="display:grid;gap:14px;padding:22px 26px">
        <div class="activity-detail-grid">
          <div><span>Received</span><strong id="bidDetailWhen">—</strong></div>
          <div><span>Amount</span><strong id="bidDetailAmount">—</strong></div>
        </div>

        <div class="activity-detail-section">
          <span>Bid / revision</span>
          <strong id="bidDetailRevision">—</strong>
        </div>

        <div class="activity-detail-section">
          <span>Notes</span>
          <div id="bidDetailNotes" class="project-notes">—</div>
        </div>

        <div class="activity-detail-section">
          <span>File</span>
          <div id="bidDetailFiles">No file attached.</div>
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="primary-button" data-close-bid-detail>Close</button>
      </div>
    </div>`;

  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close-bid-detail]").forEach(button =>
    button.addEventListener("click", () => dialog.close())
  );
  return dialog;
}

function openProjectContractorBidDetail(proposalId) {
  const detail = document.querySelector("#projectDetailBody")?._projectDetail;
  if (!detail) return;

  const proposal = (detail.proposals || []).find(p => Number(p.id) === Number(proposalId));
  if (!proposal) return;

  const files = (detail.attachments || []).filter(a =>
    a.entityType === "ProjectContractorProposal" &&
    Number(a.entityId) === Number(proposal.id)
  );

  const dialog = ensureProjectContractorBidDetailDialog();
  dialog.querySelector("#bidDetailWhen").textContent = formatDateOnly(proposal.receivedDate);
  dialog.querySelector("#bidDetailAmount").textContent =
    proposal.amount != null ? money.format(Number(proposal.amount)) : "Amount not entered";
  dialog.querySelector("#bidDetailRevision").textContent = proposal.revisionLabel || "Original bid";
  dialog.querySelector("#bidDetailNotes").textContent = proposal.notes || "No additional notes.";

  dialog.querySelector("#bidDetailFiles").innerHTML = files.length
    ? files.map(file => `
        <button type="button"
                class="bid-file-link project-contractor-file-trigger"
                data-attachment-id="${file.id}"
                data-file-name="${escapeAttribute(file.fileName)}"
                data-content-type="${escapeAttribute(file.contentType || "")}">
          📎 ${escapeHtml(file.fileName)}
        </button>
      `).join("")
    : `<span class="expense-meta">No file attached.</span>`;

  dialog.showModal();
}

function ensureProjectContractorActivityDetailDialog() {
  let dialog = document.querySelector("#projectContractorActivityDetailDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "projectContractorActivityDetailDialog";
  dialog.className = "modal project-dialog";
  dialog.innerHTML = `
    <div class="modal-card activity-detail-card" style="width:min(620px,calc(100vw - 64px));max-width:620px;padding:0;overflow:hidden">
      <div class="modal-header">
        <div>
          <div class="eyebrow">CONTRACTOR HISTORY</div>
          <h2 style="margin:.35rem 0 0">Activity details</h2>
        </div>
        <button type="button" class="modal-close" data-close-activity-detail aria-label="Close">×</button>
      </div>

      <div class="modal-body activity-detail-body" style="display:grid;gap:14px;padding:22px 26px">
        <div class="activity-detail-grid">
          <div><span>Type</span><strong id="activityDetailType">—</strong></div>
          <div><span>Date / time</span><strong id="activityDetailWhen">—</strong></div>
        </div>

        <div class="activity-detail-section">
          <span>Summary</span>
          <strong id="activityDetailSummary">—</strong>
        </div>

        <div class="activity-detail-section">
          <span>Details</span>
          <div id="activityDetailNotes" class="project-notes">—</div>
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="primary-button" data-close-activity-detail>Close</button>
      </div>
    </div>`;

  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close-activity-detail]").forEach(button =>
    button.addEventListener("click", () => dialog.close())
  );

  return dialog;
}

function openProjectContractorActivityDetail(activityId) {
  const detail = document.querySelector("#projectDetailBody")?._projectDetail;
  if (!detail) return;

  const activity = (detail.activities || []).find(a => Number(a.id) === Number(activityId));
  if (!activity) return;

  const dialog = ensureProjectContractorActivityDetailDialog();
  dialog.querySelector("#activityDetailType").textContent = activity.activityType || "Note";
  dialog.querySelector("#activityDetailWhen").textContent = new Date(activity.activityAt).toLocaleString();
  dialog.querySelector("#activityDetailSummary").textContent = activity.summary || "Activity";
  dialog.querySelector("#activityDetailNotes").textContent = activity.notes || "No additional details.";
  dialog.showModal();
}

function ensureProjectContractorActivityDialog() {
  let dialog = document.querySelector("#projectContractorActivityDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "projectContractorActivityDialog";
  dialog.className = "modal project-dialog";
  dialog.innerHTML = `
    <form id="projectContractorActivityForm" class="modal-card" method="dialog"
          style="width:min(600px,calc(100vw - 32px));max-width:600px;padding:0;overflow:hidden">
      <div class="modal-header">
        <div><div class="eyebrow">CONTRACTOR HISTORY</div><h2 style="margin:.35rem 0 0">Log call / note</h2></div>
        <button type="button" class="modal-close" data-close-project-contractor-activity aria-label="Close">×</button>
      </div>
      <div class="modal-body" style="display:grid;gap:14px;padding:22px 26px">
        <div id="projectContractorActivityError" class="form-error" hidden></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <label style="display:grid;gap:6px"><span>Type</span>
            <select id="projectContractorActivityType">
              <option>Called</option><option>Email</option><option>Text</option><option>Meeting</option><option>Walkthrough</option><option>Estimate</option><option>Note</option>
            </select>
          </label>
          <label style="display:grid;gap:6px"><span>Date / time</span><input id="projectContractorActivityAt" type="datetime-local"></label>
        </div>
        <label style="display:grid;gap:6px"><span>Summary</span><input id="projectContractorActivitySummary" maxlength="300" required></label>
        <label style="display:grid;gap:6px"><span>Details</span><textarea id="projectContractorActivityNotes" rows="5" maxlength="4000"></textarea></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary-button" data-close-project-contractor-activity>Cancel</button>
        <button type="submit" class="primary-button">Save history</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close-project-contractor-activity]").forEach(b => b.addEventListener("click", () => dialog.close()));
  dialog.querySelector("#projectContractorActivityForm")?.addEventListener("submit", saveProjectContractorActivity);
  return dialog;
}

function openProjectContractorActivityEditor(contractorId) {
  const dialog = ensureProjectContractorActivityDialog();
  activeProjectContractorActivityContractorId = contractorId;
  const now = new Date();
  const offset = now.getTimezoneOffset();
  dialog.querySelector("#projectContractorActivityAt").value = new Date(now.getTime() - offset * 60000).toISOString().slice(0, 16);
  dialog.querySelector("#projectContractorActivitySummary").value = "";
  dialog.querySelector("#projectContractorActivityNotes").value = "";
  dialog.querySelector("#projectContractorActivityType").value = "Called";
  dialog.showModal();
}

async function saveProjectContractorActivity(event) {
  event.preventDefault();
  const dialog = ensureProjectContractorActivityDialog();
  const error = dialog.querySelector("#projectContractorActivityError");
  const summary = dialog.querySelector("#projectContractorActivitySummary")?.value.trim();
  if (!summary) { error.textContent = "Summary is required."; error.hidden = false; return; }

  const payload = {
    activityType: dialog.querySelector("#projectContractorActivityType")?.value || "Note",
    activityAt: dialog.querySelector("#projectContractorActivityAt")?.value || null,
    summary,
    notes: dialog.querySelector("#projectContractorActivityNotes")?.value.trim() || null
  };

  try {
    const response = await fetch(`/api/home/projects/${activeProjectId}/contractors/${activeProjectContractorActivityContractorId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await readError(response));
    dialog.close();
    await loadProjectDetails(activeProjectId);
    refreshProjectContractorDetails();
    showToast("History added.");
  } catch (err) {
    console.error(err);
    error.textContent = err.message || "Could not save history.";
    error.hidden = false;
  }
}

let activeProjectContractorProposalContractorId = null;


function parseProposalCurrency(value) {
  const normalized = String(value || "").replace(/[$,\s]/g, "").trim();
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function formatProposalCurrency(value) {
  const amount = parseProposalCurrency(value);
  if (amount == null) return "";
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function ensureProjectContractorProposalDialog() {
  let dialog = document.querySelector("#projectContractorProposalDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "projectContractorProposalDialog";
  dialog.className = "modal project-dialog";
  dialog.innerHTML = `
    <form id="projectContractorProposalForm" class="modal-card" method="dialog"
          style="width:min(580px,calc(100vw - 32px));max-width:580px;padding:0;overflow:hidden">
      <div class="modal-header">
        <div><div class="eyebrow">BID</div><h2 style="margin:.35rem 0 0">Add bid</h2></div>
        <button type="button" class="modal-close" data-close-project-contractor-proposal aria-label="Close">×</button>
      </div>
      <div class="modal-body" style="display:grid;gap:14px;padding:22px 26px">
        <div id="projectContractorProposalError" class="form-error" hidden></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <label style="display:grid;gap:6px"><span>Received</span><input id="projectContractorProposalDate" type="date" required></label>
          <label style="display:grid;gap:6px"><span>Amount</span><input id="projectContractorProposalAmount" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00"></label>
        </div>
        <label style="display:grid;gap:6px"><span>Bid / revision</span><input id="projectContractorProposalRevision" maxlength="100" placeholder="Bid #0288, Revision 2, Added sheathing…"></label>
        <label style="display:grid;gap:6px"><span>Notes</span><textarea id="projectContractorProposalNotes" rows="4" maxlength="4000"></textarea></label>

        <label style="display:grid;gap:6px">
          <span>Bid file</span>
          <input id="projectContractorProposalFile" type="file" accept="application/pdf,image/*">
          <small class="expense-meta">Optional. PDF or image, up to 20 MB.</small>
        </label>

        <label style="display:flex;align-items:center;gap:8px"><input id="projectContractorProposalCurrent" type="checkbox" checked><span>Make this the current working bid</span></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary-button" data-close-project-contractor-proposal>Cancel</button>
        <button type="submit" class="primary-button">Save bid</button>
      </div>
    </form>`;

  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close-project-contractor-proposal]").forEach(b => b.addEventListener("click", () => dialog.close()));

  const amountInput = dialog.querySelector("#projectContractorProposalAmount");
  amountInput?.addEventListener("focus", () => {
    const amount = parseProposalCurrency(amountInput.value);
    amountInput.value = amount == null ? "" : amount.toFixed(2);
    amountInput.select();
  });
  amountInput?.addEventListener("blur", () => {
    amountInput.value = formatProposalCurrency(amountInput.value);
  });

  dialog.querySelector("#projectContractorProposalForm")?.addEventListener("submit", saveProjectContractorProposal);
  return dialog;
}

function openProjectContractorProposalEditor(contractorId) {
  activeProjectContractorProposalContractorId = Number(contractorId);
  const dialog = ensureProjectContractorProposalDialog();
  dialog.querySelector("#projectContractorProposalDate").value = new Date().toISOString().slice(0, 10);
  dialog.querySelector("#projectContractorProposalAmount").value = "";
  dialog.querySelector("#projectContractorProposalRevision").value = "";
  dialog.querySelector("#projectContractorProposalNotes").value = "";
  dialog.querySelector("#projectContractorProposalFile").value = "";
  dialog.querySelector("#projectContractorProposalCurrent").checked = true;
  dialog.querySelector("#projectContractorProposalError").hidden = true;
  dialog.showModal();
}

async function saveProjectContractorProposal(event) {
  event.preventDefault();
  const dialog = ensureProjectContractorProposalDialog();
  const error = dialog.querySelector("#projectContractorProposalError");
  const receivedDate = dialog.querySelector("#projectContractorProposalDate")?.value;
  if (!receivedDate) {
    error.textContent = "Received date is required.";
    error.hidden = false;
    return;
  }

  const amountValue = dialog.querySelector("#projectContractorProposalAmount")?.value;
  const payload = {
    receivedDate,
    revisionLabel: dialog.querySelector("#projectContractorProposalRevision")?.value.trim() || null,
    amount: amountValue === "" ? null : parseProposalCurrency(amountValue),
    notes: dialog.querySelector("#projectContractorProposalNotes")?.value.trim() || null,
    isCurrent: dialog.querySelector("#projectContractorProposalCurrent")?.checked === true
  };

  try {
    const response = await fetch(
      `/api/home/projects/${activeProjectId}/contractors/${activeProjectContractorProposalContractorId}/proposals`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) throw new Error(await readError(response));

    const createdBid = await response.json();
    const proposalId = Number(createdBid.id || 0);
    const proposalFile = dialog.querySelector("#projectContractorProposalFile")?.files?.[0] || null;

    if (proposalFile && proposalId) {
      const formData = new FormData();
      formData.append("file", proposalFile);

      const uploadResponse = await fetch(
        `/api/home/projects/${activeProjectId}/contractors/${activeProjectContractorProposalContractorId}/proposals/${proposalId}/attachment`,
        {
          method: "POST",
          body: formData
        }
      );

      if (!uploadResponse.ok)
        throw new Error(await readError(uploadResponse));
    }

    dialog.close();
    await loadProjectDetails(activeProjectId);
    activeProjectContractorDetailsTab = "proposals";
    refreshProjectContractorDetails();
    showToast(proposalFile ? "Bid and file added." : "Bid added.");
  } catch (err) {
    console.error(err);
    error.textContent = err.message || "Could not save bid.";
    error.hidden = false;
  }
}

let contractorDirectory = [];
let activeContractorVendorId = null;
let contractorEditorReturn = null;

async function loadContractors() {
  const container = document.querySelector("#contractors");

  try {
    const response = await fetch("/api/home/contractors", {
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw new Error(await readError(response));

    contractorDirectory = await response.json();
    renderContractorDirectory();
    return contractorDirectory;
  } catch (error) {
    console.error(error);
    if (container) container.innerHTML = `<div class="empty">${escapeHtml(error.message || "Could not load contractors.")}</div>`;
    return contractorDirectory;
  }
}

function renderContractorDirectory() {
  const container = document.querySelector("#contractors");
  if (!container) return;

  if (!contractorDirectory.length) {
    container.innerHTML = `<div class="empty">No contractors yet. Add the first company you call.</div>`;
    return;
  }

  container.innerHTML = contractorDirectory
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .map(contractor => {
      const primary = (contractor.contacts || []).find(c => c.isPrimary) || contractor.contacts?.[0];
      return `<section class="project-card" role="button" tabindex="0" data-contractor-vendor-id="${contractor.id}">
        <div class="project-top">
          <div>
            <h3 class="project-name">${escapeHtml(contractor.name)}</h3>
            <div class="project-meta">
              ${escapeHtml(formatProjectPhone(contractor.phone) || "No company phone")}
              ${primary?.name ? ` · ${escapeHtml(primary.name)}` : ""}
            </div>
          </div>
          <span class="badge">${(contractor.contacts || []).length} contact${(contractor.contacts || []).length === 1 ? "" : "s"}</span>
        </div>
      </section>`;
    }).join("");
}

function handleContractorListClick(event) {
  const card = event.target.closest("[data-contractor-vendor-id]");
  if (!card) return;
  const contractor = contractorDirectory.find(c => Number(c.id) === Number(card.dataset.contractorVendorId));
  if (contractor) openContractorEditor(contractor);
}

function ensureContractorEditor() {
  let dialog = document.querySelector("#contractorDirectoryDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "contractorDirectoryDialog";
  dialog.className = "modal project-dialog";
  dialog.innerHTML = `
    <form id="contractorDirectoryForm" class="modal-card" method="dialog"
          style="width:min(760px,calc(100vw - 32px));max-width:760px;padding:0;overflow:hidden">
      <div class="modal-header" style="display:flex;justify-content:space-between;gap:18px">
        <div>
          <div class="eyebrow">CONTRACTOR DIRECTORY</div>
          <h2 id="contractorDirectoryTitle" style="margin:.35rem 0 0">Add contractor</h2>
        </div>
        <button type="button" class="modal-close" data-close-contractor-directory aria-label="Close">×</button>
      </div>

      <div class="modal-body" style="display:grid;gap:16px;padding:22px 26px">
        <div id="contractorDirectoryError" class="form-error" hidden></div>

        <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:14px">
          <label style="display:grid;gap:6px"><span>Company name</span><input id="contractorDirectoryName" maxlength="200" required></label>
          <label style="display:grid;gap:6px"><span>Company phone</span><input id="contractorDirectoryPhone" maxlength="50" type="tel"></label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <label style="display:grid;gap:6px"><span>Email</span><input id="contractorDirectoryEmail" maxlength="254" type="email"></label>
          <label style="display:grid;gap:6px"><span>Website</span><input id="contractorDirectoryWebsite" maxlength="500"></label>
        </div>

        <label style="display:grid;gap:6px"><span>Address</span><input id="contractorDirectoryAddress1" maxlength="250"></label>
        <div style="display:grid;grid-template-columns:1.4fr .6fr .7fr;gap:14px">
          <label style="display:grid;gap:6px"><span>City</span><input id="contractorDirectoryCity" maxlength="100"></label>
          <label style="display:grid;gap:6px"><span>State</span><input id="contractorDirectoryState" maxlength="50"></label>
          <label style="display:grid;gap:6px"><span>ZIP</span><input id="contractorDirectoryPostalCode" maxlength="20"></label>
        </div>

        <label style="display:grid;gap:6px"><span>Company notes</span><textarea id="contractorDirectoryNotes" rows="3" maxlength="4000"></textarea></label>

        <section id="contractorDirectoryContactsSection" style="border-top:1px solid #e6e0d8;padding-top:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
            <div><strong>Contacts</strong><div class="expense-meta">People at this company.</div></div>
            <button type="button" class="secondary-button" data-add-global-contractor-contact>+ Add contact</button>
          </div>
          <div id="contractorDirectoryContacts" style="display:grid;gap:8px;margin-top:12px"></div>
        </section>
      </div>

      <div class="modal-actions" style="display:flex;justify-content:flex-end;gap:10px;padding:16px 26px">
        <button type="button" class="secondary-button" data-close-contractor-directory>Cancel</button>
        <button type="submit" class="primary-button" id="saveContractorDirectoryButton">Save contractor</button>
      </div>
    </form>`;

  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close-contractor-directory]").forEach(b =>
    b.addEventListener("click", () => dialog.close())
  );
  dialog.querySelector("#contractorDirectoryForm")?.addEventListener("submit", saveContractorDirectory);
  dialog.querySelector("[data-add-global-contractor-contact]")?.addEventListener("click", () => {
    if (!activeContractorVendorId) {
      const error = dialog.querySelector("#contractorDirectoryError");
      error.textContent = "Save the contractor first, then add named contacts.";
      error.hidden = false;
      return;
    }
    openGlobalContractorContactEditor(activeContractorVendorId);
  });
  dialog.querySelector("#contractorDirectoryContacts")?.addEventListener("click", event => {
    const edit = event.target.closest("[data-edit-global-contact]");
    if (!edit) return;
    const contractor = contractorDirectory.find(c => Number(c.id) === Number(activeContractorVendorId));
    const contact = contractor?.contacts?.find(c => Number(c.id) === Number(edit.dataset.editGlobalContact));
    if (contact) openGlobalContractorContactEditor(activeContractorVendorId, contact);
  });

  return dialog;
}

function openContractorEditor(contractor = null, returnOptions = null) {
  contractorEditorReturn = returnOptions;
  activeContractorVendorId = contractor?.id ? Number(contractor.id) : null;
  const dialog = ensureContractorEditor();

  dialog.querySelector("#contractorDirectoryTitle").textContent = contractor ? "Edit contractor" : "Add contractor";
  dialog.querySelector("#contractorDirectoryName").value = contractor?.name || "";
  dialog.querySelector("#contractorDirectoryPhone").value = contractor?.phone || "";
  dialog.querySelector("#contractorDirectoryEmail").value = contractor?.email || "";
  dialog.querySelector("#contractorDirectoryWebsite").value = contractor?.website || "";
  dialog.querySelector("#contractorDirectoryAddress1").value = contractor?.address1 || "";
  dialog.querySelector("#contractorDirectoryCity").value = contractor?.city || "";
  dialog.querySelector("#contractorDirectoryState").value = contractor?.state || "";
  dialog.querySelector("#contractorDirectoryPostalCode").value = contractor?.postalCode || "";
  dialog.querySelector("#contractorDirectoryNotes").value = contractor?.notes || "";

  const error = dialog.querySelector("#contractorDirectoryError");
  error.hidden = true;
  error.textContent = "";

  renderGlobalContractorContacts(contractor);
  dialog.showModal();
  window.setTimeout(() => dialog.querySelector("#contractorDirectoryName")?.focus(), 30);
}

function renderGlobalContractorContacts(contractor) {
  const container = ensureContractorEditor().querySelector("#contractorDirectoryContacts");
  const contacts = contractor?.contacts || [];
  container.innerHTML = contacts.length
    ? contacts.map(c => `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid #eee">
        <div><strong>${escapeHtml(c.name)}</strong>${c.title ? ` · ${escapeHtml(c.title)}` : ""}<div class="expense-meta">${escapeHtml(c.phone || c.email || "")}</div></div>
        <button type="button" class="secondary-button" data-edit-global-contact="${c.id}">Edit</button>
      </div>`).join("")
    : `<div class="empty compact">No named contacts yet.</div>`;
}

async function saveContractorDirectory(event) {
  event.preventDefault();
  const dialog = ensureContractorEditor();
  const error = dialog.querySelector("#contractorDirectoryError");
  const name = dialog.querySelector("#contractorDirectoryName")?.value.trim();
  if (!name) {
    error.textContent = "Company name is required.";
    error.hidden = false;
    return;
  }

  const payload = {
    name,
    phone: dialog.querySelector("#contractorDirectoryPhone")?.value.trim() || null,
    email: dialog.querySelector("#contractorDirectoryEmail")?.value.trim() || null,
    website: dialog.querySelector("#contractorDirectoryWebsite")?.value.trim() || null,
    address1: dialog.querySelector("#contractorDirectoryAddress1")?.value.trim() || null,
    address2: null,
    city: dialog.querySelector("#contractorDirectoryCity")?.value.trim() || null,
    state: dialog.querySelector("#contractorDirectoryState")?.value.trim() || null,
    postalCode: dialog.querySelector("#contractorDirectoryPostalCode")?.value.trim() || null,
    notes: dialog.querySelector("#contractorDirectoryNotes")?.value.trim() || null
  };

  const button = dialog.querySelector("#saveContractorDirectoryButton");
  button.disabled = true;
  button.textContent = "Saving…";

  try {
    const response = await fetch(
      activeContractorVendorId ? `/api/home/contractors/${activeContractorVendorId}` : "/api/home/contractors",
      {
        method: activeContractorVendorId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(payload)
      }
    );
    if (!response.ok) throw new Error(await readError(response));

    const result = await response.json();
    const newVendorId = Number(result.id || activeContractorVendorId);
    const returnToProjectId = contractorEditorReturn?.associateWithProjectId || null;

    dialog.close();
    contractorEditorReturn = null;
    await loadContractors();

    if (returnToProjectId && newVendorId) {
      const previousProjectId = activeProjectId;
      activeProjectId = Number(returnToProjectId);
      await loadProjectDetails(activeProjectId);
      const created = contractorDirectory.find(v => Number(v.id) === newVendorId);
      await openProjectContractorEditor({
        id: null,
        vendorId: newVendorId,
        status: "Considering",
        bidAmount: null,
        notes: null,
        isSelected: false,
        name: created?.name || ""
      });
      const select = document.querySelector("#projectContractorVendorId");
      if (select) select.value = String(newVendorId);
      activeProjectContractorId = null;
    }

    showToast(activeContractorVendorId ? "Contractor updated." : "Contractor added.");
  } catch (err) {
    console.error(err);
    error.textContent = err.message || "Could not save contractor.";
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Save contractor";
  }
}

let activeGlobalContactVendorId = null;
let activeGlobalContactId = null;

function openGlobalContractorContactEditor(vendorId, contact = null) {
  activeGlobalContactVendorId = Number(vendorId);
  activeGlobalContactId = contact?.id ? Number(contact.id) : null;

  const dialog = ensureProjectContractorContactDialog();
  dialog.querySelector("#projectContractorContactDialogTitle").textContent = contact ? "Edit contact" : "Add contact";
  dialog.querySelector("#projectContractorContactName").value = contact?.name || "";
  dialog.querySelector("#projectContractorContactTitleField").value = contact?.title || "";
  dialog.querySelector("#projectContractorContactPhone").value = contact?.phone || "";
  dialog.querySelector("#projectContractorContactEmail").value = contact?.email || "";
  dialog.querySelector("#projectContractorContactNotes").value = contact?.notes || "";
  dialog.querySelector("#projectContractorContactPrimary").checked = contact?.isPrimary === true;

  dialog._globalContactMode = true;
  dialog.showModal();
}



function projectContractorLastContact(contractorId, activities) {
  const now = Date.now();

  return (activities || [])
    .filter(a => Number(a.projectContractorId) === Number(contractorId))
    .map(a => ({ activity: a, when: new Date(a.activityAt || 0) }))
    .filter(x => !Number.isNaN(x.when.getTime()) && x.when.getTime() <= now)
    .sort((a, b) => b.when - a.when)[0]?.activity || null;
}

function projectContractorNextAppointment(contractorId, activities) {
  const now = Date.now();

  return (activities || [])
    .filter(a =>
      Number(a.projectContractorId) === Number(contractorId) &&
      ["Meeting", "Walkthrough"].includes(a.activityType))
    .map(a => ({ activity: a, when: new Date(a.activityAt || 0) }))
    .filter(x => !Number.isNaN(x.when.getTime()) && x.when.getTime() > now)
    .sort((a, b) => a.when - b.when)[0]?.activity || null;
}

function localProjectDateTimeValue(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

let followupProjectContractorId = null;

function ensureProjectContractorFollowupDialog() {
  let dialog = document.querySelector("#projectContractorFollowupDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "projectContractorFollowupDialog";
  dialog.className = "modal project-dialog";

  dialog.innerHTML = `
    <form id="projectContractorFollowupForm" class="modal-card" method="dialog"
          style="width:min(680px,calc(100vw - 32px));max-width:680px;padding:0;overflow:hidden">
      <div class="modal-header">
        <div>
          <div class="eyebrow">CONTRACTOR FOLLOW-UP</div>
          <h2 id="followupContractorTitle" style="margin:.35rem 0 0">Update contractor</h2>
        </div>
        <button type="button" class="modal-close" data-close-followup aria-label="Close">×</button>
      </div>

      <div class="modal-body" style="display:grid;gap:16px;padding:22px 26px">
        <div id="followupError" class="form-error" hidden></div>

        <fieldset style="border:0;padding:0;margin:0;display:grid;gap:10px">
          <legend style="font-weight:800;margin-bottom:4px">What happened?</legend>
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px">
            <label><input type="radio" name="followupType" value="callback" checked> They called me back</label>
            <label><input type="radio" name="followupType" value="outbound"> I called them</label>
            <label><input type="radio" name="followupType" value="voicemail"> Left voicemail</label>
            <label><input type="radio" name="followupType" value="appointment"> Appointment scheduled</label>
            <label><input type="radio" name="followupType" value="email"> Email</label>
            <label><input type="radio" name="followupType" value="text"> Text</label>
          </div>
        </fieldset>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <label style="display:grid;gap:6px">
            <span>Person</span>
            <input id="followupPerson" maxlength="200" placeholder="Optional">
          </label>
          <label style="display:grid;gap:6px">
            <span>Contact date/time</span>
            <input id="followupContactedAt" type="datetime-local">
          </label>
        </div>

        <div id="followupAppointmentFields" hidden
             style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <label style="display:grid;gap:6px">
            <span>Appointment date/time</span>
            <input id="followupAppointmentAt" type="datetime-local">
          </label>
          <label style="display:grid;gap:6px">
            <span>Appointment type</span>
            <select id="followupAppointmentType">
              <option value="Meeting">Estimate appointment</option>
              <option value="Walkthrough">Walkthrough</option>
            </select>
          </label>
        </div>

        <label style="display:grid;gap:6px">
          <span>Notes</span>
          <textarea id="followupNotes" rows="5" maxlength="4000"
                    placeholder="Estimator will call back, appointment Thursday at 10, asked about HardiePlank, etc."></textarea>
        </label>
      </div>

      <div class="modal-actions">
        <button type="button" class="secondary-button" data-close-followup>Cancel</button>
        <button type="submit" class="primary-button" id="saveFollowupButton">Save update</button>
      </div>
    </form>`;

  document.body.appendChild(dialog);

  dialog.querySelectorAll("[data-close-followup]").forEach(button =>
    button.addEventListener("click", () => dialog.close())
  );

  dialog.querySelectorAll('input[name="followupType"]').forEach(input => {
    input.addEventListener("change", () => {
      const isAppointment =
        dialog.querySelector('input[name="followupType"]:checked')?.value === "appointment";
      const fields = dialog.querySelector("#followupAppointmentFields");
      if (fields) fields.hidden = !isAppointment;
    });
  });

  dialog.querySelector("#projectContractorFollowupForm")
    ?.addEventListener("submit", saveProjectContractorFollowup);

  return dialog;
}

function openProjectContractorFollowup(contractorId) {
  const detail = document.querySelector("#projectDetailBody")?._projectDetail;
  const contractor = (detail?.contractors || [])
    .find(c => Number(c.id) === Number(contractorId));

  if (!contractor) return;

  followupProjectContractorId = contractor.id;

  const dialog = ensureProjectContractorFollowupDialog();
  dialog.querySelector("#projectContractorFollowupForm")?.reset();
  dialog.querySelector("#followupContractorTitle").textContent = contractor.name;
  dialog.querySelector("#followupContactedAt").value = localProjectDateTimeValue(new Date());
  dialog.querySelector("#followupAppointmentAt").value = "";
  dialog.querySelector("#followupAppointmentFields").hidden = true;

  const contacts = detail.contacts || [];
  const contractorContacts = contractor.vendorId
    ? contacts.filter(c => Number(c.vendorId) === Number(contractor.vendorId))
    : [];
  const primary = contractorContacts.find(c => c.isPrimary) || contractorContacts[0];
  dialog.querySelector("#followupPerson").value = primary?.name || "";

  const error = dialog.querySelector("#followupError");
  error.hidden = true;
  error.textContent = "";

  dialog.showModal();
}

async function saveProjectContractorFollowup(event) {
  event.preventDefault();

  const detail = document.querySelector("#projectDetailBody")?._projectDetail;
  const contractor = (detail?.contractors || [])
    .find(c => Number(c.id) === Number(followupProjectContractorId));

  if (!contractor || !activeProjectId) return;

  const dialog = ensureProjectContractorFollowupDialog();
  const error = dialog.querySelector("#followupError");
  const saveButton = dialog.querySelector("#saveFollowupButton");

  const type = dialog.querySelector('input[name="followupType"]:checked')?.value || "callback";
  const person = dialog.querySelector("#followupPerson")?.value.trim() || null;
  const contactedAt = dialog.querySelector("#followupContactedAt")?.value || null;
  const appointmentAt = dialog.querySelector("#followupAppointmentAt")?.value || null;
  const appointmentType = dialog.querySelector("#followupAppointmentType")?.value || "Meeting";
  const notes = dialog.querySelector("#followupNotes")?.value.trim() || null;

  if (type === "appointment" && !appointmentAt) {
    error.textContent = "Pick the appointment date/time.";
    error.hidden = false;
    return;
  }

  error.hidden = true;
  saveButton.disabled = true;
  saveButton.textContent = "Saving…";

  try {
    let activityType = "Called";
    let summary = "Called";

    if (type === "callback")
      summary = person ? `Called back — spoke with ${person}` : "Called back";
    else if (type === "outbound")
      summary = person ? `Called — spoke with ${person}` : "Called";
    else if (type === "voicemail")
      summary = "Left voicemail";
    else if (type === "email") {
      activityType = "Email";
      summary = person ? `Email — ${person}` : "Email";
    }
    else if (type === "text") {
      activityType = "Text";
      summary = person ? `Text — ${person}` : "Text";
    }
    else if (type === "appointment")
      summary = person ? `Scheduled appointment with ${person}` : "Scheduled appointment";

    const contactResponse = await fetch(
      `/api/home/projects/${activeProjectId}/contractors/${contractor.id}/activities`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          activityType,
          activityAt: contactedAt,
          summary,
          notes
        })
      }
    );

    if (!contactResponse.ok) throw new Error(await readError(contactResponse));

    let nextStatus = contractor.status || "Contacted";

    if (type === "appointment") {
      const appointmentResponse = await fetch(
        `/api/home/projects/${activeProjectId}/contractors/${contractor.id}/activities`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            activityType: appointmentType,
            activityAt: appointmentAt,
            summary: appointmentType === "Walkthrough" ? "Bid walkthrough" : "Bid appointment",
            notes
          })
        }
      );

      if (!appointmentResponse.ok) throw new Error(await readError(appointmentResponse));

      nextStatus = appointmentType === "Walkthrough"
        ? "Walkthrough Scheduled"
        : "Appointment Scheduled";
    }
    else if (["Considering", "Callback Pending"].includes(contractor.status)) {
      nextStatus = "Contacted";
    }

    if (nextStatus !== contractor.status) {
      const updateResponse = await fetch(
        `/api/home/projects/${activeProjectId}/contractors/${contractor.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            vendorId: contractor.vendorId,
            status: nextStatus,
            bidAmount: contractor.bidAmount ?? null,
            notes: contractor.notes || null,
            isSelected: contractor.isSelected === true
          })
        }
      );

      if (!updateResponse.ok) throw new Error(await readError(updateResponse));
    }

    dialog.close();
    await loadProjectDetails(activeProjectId);
    showToast("Contractor update saved.");
  } catch (err) {
    console.error(err);
    error.textContent = err.message || "Could not save contractor update.";
    error.hidden = false;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save update";
  }
}

let quickBidderProjectId = null;

function ensureQuickBidderDialog() {
  let dialog = document.querySelector("#quickBidderDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "quickBidderDialog";
  dialog.className = "modal project-dialog";
  dialog.innerHTML = `
    <form id="quickBidderForm" class="modal-card" method="dialog"
          style="width:min(680px,calc(100vw - 32px));max-width:680px;padding:0;overflow:hidden">
      <div class="modal-header">
        <div>
          <div class="eyebrow">BID CONTACT</div>
          <h2 style="margin:.35rem 0 0">Log contractor call</h2>
        </div>
        <button type="button" class="modal-close" data-close-quick-bidder aria-label="Close">×</button>
      </div>

      <div class="modal-body" style="display:grid;gap:16px;padding:22px 26px">
        <div id="quickBidderError" class="form-error" hidden></div>

        <div style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(180px,.75fr);gap:14px">
          <label style="display:grid;gap:6px">
            <span>Company name *</span>
            <input id="quickBidderName" maxlength="200" required autocomplete="organization"
                   placeholder="First Texas Siding and Windows">
          </label>

          <label style="display:grid;gap:6px">
            <span>Phone</span>
            <input id="quickBidderPhone" maxlength="50" type="tel" autocomplete="tel"
                   placeholder="(832) 680-5500">
          </label>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <label style="display:grid;gap:6px">
            <span>Person spoken with</span>
            <input id="quickBidderPerson" maxlength="200" placeholder="Optional">
          </label>

          <label style="display:grid;gap:6px">
            <span>Website</span>
            <input id="quickBidderWebsite" maxlength="500" placeholder="Optional">
          </label>
        </div>

        <label style="display:grid;gap:6px;max-width:320px">
          <span>Contacted</span>
          <input id="quickBidderContactedAt" type="datetime-local">
        </label>

        <label style="display:grid;gap:6px">
          <span>Call notes</span>
          <textarea id="quickBidderNotes" rows="4" maxlength="4000"
                    placeholder="Left voicemail, estimator will call back, appointment Thursday at 10, etc."></textarea>
        </label>

        <div style="padding:11px 13px;border:1px solid #eadfd7;border-radius:10px;background:#fbf7f2;color:#6b625e;font-size:.82rem;line-height:1.4">
          One save adds the company to your contractor directory, associates it with this project,
          records the call, and moves the project into <strong>Getting Bids</strong>.
        </div>
      </div>

      <div class="modal-actions">
        <button type="button" class="secondary-button" data-close-quick-bidder>Cancel</button>
        <button type="submit" class="primary-button" id="saveQuickBidderButton">Add to bid list</button>
      </div>
    </form>`;

  document.body.appendChild(dialog);

  dialog.querySelectorAll("[data-close-quick-bidder]").forEach(button =>
    button.addEventListener("click", () => dialog.close())
  );

  const phoneInput = dialog.querySelector("#quickBidderPhone");
  phoneInput?.addEventListener("blur", () => {
    phoneInput.value = formatProjectPhone(phoneInput.value);
  });

  dialog.querySelector("#quickBidderForm")?.addEventListener("submit", saveQuickBidder);

  return dialog;
}

async function openQuickBidderEditor() {
  if (!activeProjectId) return;

  quickBidderProjectId = activeProjectId;
  await loadContractors();

  const dialog = ensureQuickBidderDialog();
  dialog.querySelector("#quickBidderForm")?.reset();

  const now = new Date();
  const offset = now.getTimezoneOffset();
  dialog.querySelector("#quickBidderContactedAt").value =
    new Date(now.getTime() - offset * 60000).toISOString().slice(0, 16);

  const error = dialog.querySelector("#quickBidderError");
  error.hidden = true;
  error.textContent = "";

  dialog.showModal();
  window.setTimeout(() => dialog.querySelector("#quickBidderName")?.focus(), 30);
}

async function saveQuickBidder(event) {
  event.preventDefault();

  const dialog = ensureQuickBidderDialog();
  const error = dialog.querySelector("#quickBidderError");
  const button = dialog.querySelector("#saveQuickBidderButton");

  const name = dialog.querySelector("#quickBidderName")?.value.trim();
  const phone = dialog.querySelector("#quickBidderPhone")?.value.trim() || null;
  const person = dialog.querySelector("#quickBidderPerson")?.value.trim() || null;
  const website = dialog.querySelector("#quickBidderWebsite")?.value.trim() || null;
  const contactedAt = dialog.querySelector("#quickBidderContactedAt")?.value || null;
  const notes = dialog.querySelector("#quickBidderNotes")?.value.trim() || null;

  if (!name) {
    error.textContent = "Company name is required.";
    error.hidden = false;
    return;
  }

  error.hidden = true;
  button.disabled = true;
  button.textContent = "Saving…";

  try {
    await loadContractors();

    // Reuse an existing contractor when the company name already matches.
    let vendor = contractorDirectory.find(v =>
      String(v.name || "").trim().toLowerCase() === name.toLowerCase()
    );

    let vendorId = Number(vendor?.id || 0);

    if (!vendorId) {
      const createResponse = await fetch("/api/home/contractors", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          email: null,
          website,
          address1: null,
          address2: null,
          city: null,
          state: null,
          postalCode: null,
          notes: null
        })
      });

      if (!createResponse.ok) throw new Error(await readError(createResponse));
      const created = await createResponse.json();
      vendorId = Number(created.id || 0);

      if (!vendorId)
        throw new Error("Contractor was created but no contractor id was returned.");

      await loadContractors(true);
      vendor = contractorDirectory.find(v => Number(v.id) === vendorId) || null;
    }

    const detail = document.querySelector("#projectDetailBody")?._projectDetail;
    const alreadyLinked = (detail?.contractors || []).find(c => Number(c.vendorId) === vendorId);

    let projectContractorId = Number(alreadyLinked?.id || 0);

    if (!projectContractorId) {
      const associateResponse = await fetch(
        `/api/home/projects/${quickBidderProjectId}/contractors`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            vendorId,
            status: "Contacted",
            bidAmount: null,
            notes: null,
            isSelected: false
          })
        }
      );

      if (!associateResponse.ok) throw new Error(await readError(associateResponse));
      const association = await associateResponse.json();
      projectContractorId = Number(association.id || 0);
    } else if (String(alreadyLinked.status || "").toLowerCase() === "considering") {
      const updateResponse = await fetch(
        `/api/home/projects/${quickBidderProjectId}/contractors/${projectContractorId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            vendorId,
            status: "Contacted",
            bidAmount: alreadyLinked.bidAmount ?? null,
            notes: alreadyLinked.notes || null,
            isSelected: alreadyLinked.isSelected === true
          })
        }
      );
      if (!updateResponse.ok) throw new Error(await readError(updateResponse));
    }

    if (!projectContractorId)
      throw new Error("Could not determine the project contractor record.");

    if (person) {
      const existingPerson = (vendor?.contacts || []).find(c =>
        String(c.name || "").trim().toLowerCase() === person.toLowerCase()
      );

      if (!existingPerson) {
        const contactResponse = await fetch(`/api/home/contractors/${vendorId}/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            name: person,
            title: null,
            phone: null,
            email: null,
            notes: null,
            isPrimary: (vendor?.contacts || []).length === 0
          })
        });

        if (!contactResponse.ok) throw new Error(await readError(contactResponse));
      }
    }

    const activitySummary = person
      ? `Called ${name} — spoke with ${person}`
      : `Called ${name}`;

    const activityResponse = await fetch(
      `/api/home/projects/${quickBidderProjectId}/contractors/${projectContractorId}/activities`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({
          activityType: "Called",
          activityAt: contactedAt,
          summary: activitySummary,
          notes
        })
      }
    );

    if (!activityResponse.ok) throw new Error(await readError(activityResponse));

    await moveProjectToGettingBids(quickBidderProjectId);

    dialog.close();
    await loadContractors(true);
    await loadDashboard();
    await loadProjectDetails(quickBidderProjectId);
    showToast(`${name} added to the bid list.`);
  } catch (err) {
    console.error(err);
    error.textContent = err.message || "Could not log this contractor call.";
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Add to bid list";
  }
}

async function moveProjectToGettingBids(projectId) {
  const project = state.data?.projects?.find(p => Number(p.id) === Number(projectId));
  if (!project) return;

  const current = String(project.status || "").trim().toLowerCase();
  if (!["planned", "research"].includes(current)) return;

  const response = await fetch(`/api/home/projects/${projectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      propertyId: state.data.property.id,
      parentProjectId: project.parentProjectId ?? null,
      name: project.name,
      status: "Getting Bids",
      purpose: project.purpose || null,
      estimatedCost: project.estimatedCost ?? null,
      committedCost: project.committedCost ?? null,
      contractorName: project.contractorName || null,
      targetDate: project.targetDate || null,
      notes: project.notes || null
    })
  });

  if (!response.ok) throw new Error(await readError(response));
}

function ensureProjectContractorEditor() {
  let dialog = document.querySelector("#projectContractorDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "projectContractorDialog";
  dialog.className = "modal project-dialog";
  dialog.innerHTML = `
    <form id="projectContractorForm" class="modal-card" method="dialog"
          style="width:min(620px,calc(100vw - 32px));max-width:620px;padding:0;overflow:hidden">
      <div class="modal-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:18px">
        <div>
          <div class="eyebrow">PROJECT CONTRACTOR</div>
          <h2 id="projectContractorTitle" style="margin:.35rem 0 0">Associate contractor</h2>
        </div>
        <button type="button" class="modal-close" id="closeProjectContractorDialog" aria-label="Close">×</button>
      </div>

      <div class="modal-body" style="display:grid;gap:18px;padding:22px 26px">
        <div id="projectContractorError" class="form-error" hidden></div>

        <label style="display:grid;gap:6px">
          <span>Contractor / company</span>
          <select id="projectContractorVendorId" required></select>
        </label>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <label style="display:grid;gap:6px">
            <span>Status for this project</span>
            <select id="projectContractorStatus"></select>
          </label>

          <label style="display:grid;gap:6px">
            <span>Current bid amount</span>
            <input id="projectContractorBidAmount" type="text" inputmode="decimal" autocomplete="off" placeholder="$0.00">
          </label>
        </div>

        <label style="display:grid;gap:6px">
          <span>Project-specific notes</span>
          <textarea id="projectContractorNotes" rows="5" maxlength="2000"
                    placeholder="Anything about this contractor's involvement in this project…"></textarea>
        </label>

        <label style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid #ddd;border-radius:10px">
          <input id="projectContractorSelected" type="checkbox" style="margin-top:3px">
          <span>
            <strong style="display:block">Awarded / selected contractor</strong>
            <small style="display:block;margin-top:2px;opacity:.75">
              Once awarded, the other bidders become project history instead of cluttering the active job.
            </small>
          </span>
        </label>
      </div>

      <div class="modal-actions" style="display:flex;justify-content:space-between;gap:10px;padding:16px 26px">
        <button type="button" class="secondary-button" id="newContractorFromProjectButton">+ New contractor</button>
        <div style="display:flex;gap:10px">
          <button type="button" class="secondary-button" id="cancelProjectContractorButton">Cancel</button>
          <button type="submit" class="primary-button" id="saveProjectContractorButton">Associate contractor</button>
        </div>
      </div>
    </form>`;

  document.body.appendChild(dialog);

  dialog.querySelector("#closeProjectContractorDialog")?.addEventListener("click", closeProjectContractorEditor);
  dialog.querySelector("#cancelProjectContractorButton")?.addEventListener("click", closeProjectContractorEditor);
  dialog.querySelector("#projectContractorForm")?.addEventListener("submit", saveProjectContractor);
  dialog.querySelector("#newContractorFromProjectButton")?.addEventListener("click", () => {
    dialog.close();
    openContractorEditor(null, { associateWithProjectId: activeProjectId });
  });

  const bidInput = dialog.querySelector("#projectContractorBidAmount");
  bidInput?.addEventListener("focus", () => {
    const amount = parseProjectCurrency(bidInput.value);
    bidInput.value = amount == null ? "" : amount.toFixed(2);
    bidInput.select();
  });
  bidInput?.addEventListener("blur", () => {
    const amount = parseProjectCurrency(bidInput.value);
    bidInput.value = amount == null ? "" : formatProjectCurrency(amount);
  });

  return dialog;
}

async function openProjectContractorEditor(contractor = null) {
  if (!activeProjectId) return;

  if (!contractor) {
    await openQuickBidderEditor();
    return;
  }

  await loadContractors();
  const dialog = ensureProjectContractorEditor();
  activeProjectContractorId = contractor?.id ? Number(contractor.id) : null;

  const select = dialog.querySelector("#projectContractorVendorId");
  const linkedVendorIds = new Set(
    (document.querySelector("#projectDetailBody")?._projectDetail?.contractors || [])
      .filter(c => !contractor || Number(c.id) !== Number(contractor.id))
      .map(c => Number(c.vendorId))
      .filter(Boolean)
  );

  const choices = contractorDirectory
    .filter(v => !linkedVendorIds.has(Number(v.id)) || Number(v.id) === Number(contractor?.vendorId))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  select.innerHTML = `<option value="">Choose contractor…</option>` +
    choices.map(v => `<option value="${v.id}">${escapeHtml(v.name)}${v.phone ? ` · ${escapeHtml(v.phone)}` : ""}</option>`).join("");

  select.value = contractor?.vendorId ? String(contractor.vendorId) : "";
  select.disabled = !!contractor;

  dialog.querySelector("#projectContractorTitle").textContent =
    contractor ? "Edit project contractor" : "Associate contractor";
  dialog.querySelector("#projectContractorStatus").innerHTML =
    projectContractorStatusOptions(contractor?.status || "Considering");
  dialog.querySelector("#projectContractorBidAmount").value =
    contractor?.bidAmount != null ? formatProjectCurrency(Number(contractor.bidAmount)) : "";
  dialog.querySelector("#projectContractorNotes").value = contractor?.notes || "";
  dialog.querySelector("#projectContractorSelected").checked = contractor?.isSelected === true;

  const error = dialog.querySelector("#projectContractorError");
  error.hidden = true;
  error.textContent = "";

  const saveButton = dialog.querySelector("#saveProjectContractorButton");
  saveButton.textContent = contractor ? "Save project relationship" : "Associate contractor";

  dialog.showModal();
}

function closeProjectContractorEditor() {
  const dialog = document.querySelector("#projectContractorDialog");
  if (dialog) {
    const select = dialog.querySelector("#projectContractorVendorId");
    if (select) select.disabled = false;
    dialog.close();
  }
  activeProjectContractorId = null;
}

async function saveProjectContractor(event) {
  event.preventDefault();

  const dialog = ensureProjectContractorEditor();
  const error = dialog.querySelector("#projectContractorError");
  const vendorId = Number(dialog.querySelector("#projectContractorVendorId")?.value || 0);

  if (!vendorId) {
    error.textContent = "Choose a contractor.";
    error.hidden = false;
    return;
  }

  const isSelected = dialog.querySelector("#projectContractorSelected")?.checked === true;
  const status = isSelected
    ? "Selected"
    : (dialog.querySelector("#projectContractorStatus")?.value || "Considering");

  const payload = {
    vendorId,
    status,
    bidAmount: parseProjectCurrency(dialog.querySelector("#projectContractorBidAmount")?.value),
    notes: dialog.querySelector("#projectContractorNotes")?.value.trim() || null,
    isSelected
  };

  const button = dialog.querySelector("#saveProjectContractorButton");
  button.disabled = true;
  button.textContent = "Saving…";

  try {
    const url = activeProjectContractorId
      ? `/api/home/projects/${activeProjectId}/contractors/${activeProjectContractorId}`
      : `/api/home/projects/${activeProjectId}/contractors`;

    const response = await fetch(url, {
      method: activeProjectContractorId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(await readError(response));

    const wasEdit = !!activeProjectContractorId;
    closeProjectContractorEditor();
    await loadDashboard();
    await loadProjectDetails(activeProjectId);
    showToast(wasEdit ? "Project contractor updated." : "Contractor associated with project.");
  } catch (err) {
    console.error(err);
    error.textContent = err.message || "Could not save project contractor.";
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = activeProjectContractorId ? "Save project relationship" : "Associate contractor";
  }
}

async function deleteProjectContractor(contractorId) {
  if (!activeProjectId || !contractorId) return;

  const detail = document.querySelector("#projectDetailBody")?._projectDetail;
  const contractor = detail?.contractors?.find(c => Number(c.id) === Number(contractorId));
  const name = contractor?.name || "this contractor";

  if (!confirm(`Delete "${name}" and its attached files?`)) return;

  try {
    const response = await fetch(
      `/api/home/projects/${activeProjectId}/contractors/${contractorId}`,
      { method: "DELETE" }
    );

    if (!response.ok) throw new Error(await readError(response));

    await loadDashboard();
    await loadProjectDetails(activeProjectId);
    showToast("Contractor deleted.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not delete contractor.");
  }
}

function chooseProjectContractorFiles(contractorId) {
  if (!activeProjectId || !contractorId) return;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,application/pdf";
  input.multiple = true;
  input.addEventListener("change", async () => {
    const files = [...(input.files || [])];
    if (!files.length) return;

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(
          `/api/home/projects/${activeProjectId}/contractors/${contractorId}/attachments`,
          {
            method: "POST",
            body: formData
          }
        );

        if (!response.ok) throw new Error(await readError(response));
      }

      await loadProjectDetails(activeProjectId);
      activeProjectContractorDetailsTab = "files";
      refreshProjectContractorDetails();
      showToast(files.length === 1 ? "Contractor file added." : `${files.length} contractor files added.`);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not upload contractor file.");
    }
  });

  input.click();
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
  const followupButton = event.target.closest("[data-followup-project-contractor]");
  if (followupButton) {
    openProjectContractorFollowup(Number(followupButton.dataset.followupProjectContractor));
    return;
  }

  const bidDetailButton = event.target.closest("[data-view-project-contractor-bid]");
  if (bidDetailButton) {
    openProjectContractorBidDetail(Number(bidDetailButton.dataset.viewProjectContractorBid));
    return;
  }

  const activityDetailButton = event.target.closest("[data-view-project-contractor-activity]");
  if (activityDetailButton) {
    openProjectContractorActivityDetail(Number(activityDetailButton.dataset.viewProjectContractorActivity));
    return;
  }

  const openContractorButton = event.target.closest("[data-open-project-contractor]");
  if (openContractorButton) {
    openProjectContractorDetails(Number(openContractorButton.dataset.openProjectContractor));
    return;
  }

  const addContractorButton = event.target.closest("[data-add-project-contractor]");
  if (addContractorButton) {
    openProjectContractorEditor();
    return;
  }

  const historyButton = event.target.closest("[data-show-project-bid-history]");
  if (historyButton) {
    showHistoricalProjectBidders = true;
    const detail = document.querySelector("#projectDetailBody")?._projectDetail;
    if (detail) renderProjectDetails(detail);
    return;
  }

  const addContactButton = event.target.closest("[data-add-project-contractor-contact]");
  if (addContactButton) {
    openProjectContractorContactEditor(Number(addContactButton.dataset.addProjectContractorContact));
    return;
  }

  const editContactButton = event.target.closest("[data-edit-project-contractor-contact]");
  if (editContactButton) {
    const contractorId = Number(editContactButton.dataset.contractorId);
    const contactId = Number(editContactButton.dataset.editProjectContractorContact);
    const detail = document.querySelector("#projectDetailBody")?._projectDetail;
    const contact = detail?.contacts?.find(c => Number(c.id) === contactId);
    if (contact) openProjectContractorContactEditor(contractorId, contact);
    return;
  }

  const deleteContactButton = event.target.closest("[data-delete-project-contractor-contact]");
  if (deleteContactButton) {
    await deleteProjectContractorContact(
      Number(deleteContactButton.dataset.contractorId),
      Number(deleteContactButton.dataset.deleteProjectContractorContact)
    );
    return;
  }

  const addActivityButton = event.target.closest("[data-add-project-contractor-activity]");
  if (addActivityButton) {
    openProjectContractorActivityEditor(Number(addActivityButton.dataset.addProjectContractorActivity));
    return;
  }

  const editContractorButton = event.target.closest("[data-edit-project-contractor]");
  if (editContractorButton) {
    const contractorId = Number(editContractorButton.dataset.editProjectContractor);
    const detail = editContractorButton.closest("#projectDetailBody")?._projectDetail;
    const contractor = detail?.contractors?.find(c => Number(c.id) === contractorId);
    if (contractor) openProjectContractorEditor(contractor);
    return;
  }

  const deleteContractorButton = event.target.closest("[data-delete-project-contractor]");
  if (deleteContractorButton) {
    await deleteProjectContractor(Number(deleteContractorButton.dataset.deleteProjectContractor));
    return;
  }

  const addContractorFileButton = event.target.closest("[data-add-contractor-file]");
  if (addContractorFileButton) {
    const contractorId = Number(addContractorFileButton.dataset.addContractorFile);
    chooseProjectContractorFiles(contractorId);
    return;
  }

  const fileButton = event.target.closest(".project-photo-trigger, .project-file-trigger, .project-contractor-file-trigger");
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
