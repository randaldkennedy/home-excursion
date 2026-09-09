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
        <h3>Contractors & bids</h3>
        <button type="button" class="secondary-button" data-add-project-contractor>+ Add contractor</button>
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

  const hiddenHistoryCount = selected.length ? Math.max(0, contractors.length - selected.length) : 0;

  return `
    <div style="display:grid;gap:8px">
      <div style="display:grid;grid-template-columns:minmax(170px,1.4fr) minmax(125px,1fr) 120px 130px 105px 70px;gap:10px;padding:8px 10px;font-weight:700;border-bottom:1px solid #ddd">
        <div>Contractor</div>
        <div>Contact</div>
        <div>Phone</div>
        <div>Status</div>
        <div>Current bid</div>
        <div></div>
      </div>

      ${bidders.map(contractor => {
        const contractorContacts = contractor.vendorId
          ? contacts.filter(c => Number(c.vendorId) === Number(contractor.vendorId))
          : [];
        const primaryContact = contractorContacts.find(c => c.isPrimary) || contractorContacts[0] || null;
        const currentProposal = proposals.find(p =>
          Number(p.projectContractorId) === Number(contractor.id) && p.isCurrent
        );
        const bidAmount = currentProposal?.amount ?? contractor.bidAmount;
        const selectedBadge = contractor.isSelected
          ? `<span class="badge complete" style="margin-left:6px">Awarded</span>`
          : "";

        return `<div style="display:grid;grid-template-columns:minmax(170px,1.4fr) minmax(125px,1fr) 120px 130px 105px 70px;gap:10px;align-items:center;padding:10px;border-bottom:1px solid #e6e0d8">
          <div><strong>${escapeHtml(contractor.name)}</strong>${selectedBadge}</div>
          <div>${escapeHtml(primaryContact?.name || "—")}</div>
          <div>${escapeHtml(primaryContact?.phone || contractor.phone || "—")}</div>
          <div>${escapeHtml(contractor.status)}</div>
          <div><strong>${bidAmount != null ? money.format(Number(bidAmount)) : "—"}</strong></div>
          <div><button type="button" class="primary-button" style="padding:7px 12px" data-open-project-contractor="${contractor.id}">Open</button></div>
        </div>`;
      }).join("")}

      ${hiddenHistoryCount
        ? `<button type="button" class="secondary-button" data-show-project-bid-history style="justify-self:start;margin-top:6px">View ${hiddenHistoryCount} other bidder${hiddenHistoryCount === 1 ? "" : "s"} / history</button>`
        : ""}
    </div>`;
}

let activeProjectContractorDetailsId = null;
let activeProjectContractorDetailsTab = "overview";

function ensureProjectContractorDetailsDialog() {
  let dialog = document.querySelector("#projectContractorDetailsDialog");
  if (dialog) return dialog;

  dialog = document.createElement("dialog");
  dialog.id = "projectContractorDetailsDialog";
  dialog.className = "modal project-dialog";
  dialog.innerHTML = `
    <div class="modal-card"
         style="width:min(980px,calc(100vw - 32px));max-width:980px;padding:0;overflow:hidden">
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
           style="display:flex;gap:6px;padding:12px 20px;border-bottom:1px solid #e6e0d8;background:#faf7f2">
      </div>

      <div id="projectContractorDetailsBody"
           class="modal-body"
           style="padding:22px 26px;min-height:390px;max-height:62vh;overflow:auto">
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

function openProjectContractorDetails(contractorId, tab = "overview") {
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

  const contractorFiles = (detail.attachments || []).filter(a =>
    a.entityType === "ProjectContractor" &&
    Number(a.entityId) === Number(contractor.id)
  );

  const contacts = contractor.vendorId
    ? (detail.contacts || []).filter(c => Number(c.vendorId) === Number(contractor.vendorId))
    : [];

  const activities = (detail.activities || []).filter(
    a => Number(a.projectContractorId) === Number(contractor.id)
  );

  const tabDefs = [
    ["overview", "Overview"],
    ["contacts", `Contacts (${contacts.length})`],
    ["activity", `Activity (${activities.length})`],
    ["proposals", `Proposals (${(detail.proposals || []).filter(p => Number(p.projectContractorId) === Number(contractor.id)).length})`],
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
    body.innerHTML = renderProjectContractorProposalsTab(contractor, proposals);
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
        ${contractor.phone ? `<div>${escapeHtml(contractor.phone)}</div>` : ""}
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
          ${primaryContact.phone ? `<div style="margin-top:8px">${escapeHtml(primaryContact.phone)}</div>` : ""}
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
          ${contact.phone ? `<div style="margin-top:10px">${escapeHtml(contact.phone)}</div>` : ""}
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

function renderProjectContractorProposalsTab(contractor, proposals) {
  const sorted = [...proposals].sort((a, b) =>
    Number(b.isCurrent) - Number(a.isCurrent) ||
    String(b.receivedDate || "").localeCompare(String(a.receivedDate || "")) ||
    Number(b.id) - Number(a.id)
  );

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px">
      <div>
        <h3 style="margin:0">Proposal history</h3>
        <div class="expense-meta">Old bids stay here. One proposal is the current working bid.</div>
      </div>
      <button type="button" class="primary-button" data-add-project-contractor-proposal="${contractor.id}">+ Add proposal</button>
    </div>

    ${sorted.length ? `<div style="display:grid;gap:10px">
      ${sorted.map(proposal => `
        <article style="border:1px solid #e0d8ce;border-radius:12px;padding:14px;display:grid;grid-template-columns:1fr auto;gap:12px">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <strong>${proposal.amount != null ? money.format(Number(proposal.amount)) : "Amount not entered"}</strong>
              ${proposal.isCurrent ? `<span class="badge complete">Current</span>` : ""}
            </div>
            <div class="expense-meta">
              Received ${escapeHtml(formatDateOnly(proposal.receivedDate))}
              ${proposal.revisionLabel ? ` · ${escapeHtml(proposal.revisionLabel)}` : ""}
            </div>
            ${proposal.notes ? `<p class="project-notes">${escapeHtml(proposal.notes)}</p>` : ""}
          </div>
        </article>
      `).join("")}
    </div>` : `<div class="empty">No proposals received yet.</div>`}
  `;
}

function renderProjectContractorActivityTab(contractor, activities) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px">
      <div>
        <h3 style="margin:0">Activity</h3>
        <div class="expense-meta">Calls, emails, texts, meetings, walkthroughs, and notes.</div>
      </div>
      <button type="button"
              class="primary-button"
              data-add-project-contractor-activity="${contractor.id}">+ Log activity</button>
    </div>

    ${activities.length ? `<div class="expense-list">
      ${activities.map(activity => `
        <div class="expense-row">
          <div class="expense-main">
            <strong>${escapeHtml(activity.activityType)} · ${escapeHtml(activity.summary)}</strong>
            <div class="expense-meta">${new Date(activity.activityAt).toLocaleString()}</div>
            ${activity.notes ? `<div class="project-notes">${escapeHtml(activity.notes)}</div>` : ""}
          </div>
        </div>
      `).join("")}
    </div>` : `<div class="empty">No call / email history yet.</div>`}
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
        <div><div class="eyebrow">PROPOSAL / BID</div><h2 style="margin:.35rem 0 0">Add proposal</h2></div>
        <button type="button" class="modal-close" data-close-project-contractor-proposal aria-label="Close">×</button>
      </div>
      <div class="modal-body" style="display:grid;gap:14px;padding:22px 26px">
        <div id="projectContractorProposalError" class="form-error" hidden></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <label style="display:grid;gap:6px"><span>Received</span><input id="projectContractorProposalDate" type="date" required></label>
          <label style="display:grid;gap:6px"><span>Amount</span><input id="projectContractorProposalAmount" type="number" min="0" step="0.01"></label>
        </div>
        <label style="display:grid;gap:6px"><span>Revision / label</span><input id="projectContractorProposalRevision" maxlength="100" placeholder="Original, Revision 2, Added sheathing…"></label>
        <label style="display:grid;gap:6px"><span>Notes</span><textarea id="projectContractorProposalNotes" rows="4" maxlength="4000"></textarea></label>
        <label style="display:flex;align-items:center;gap:8px"><input id="projectContractorProposalCurrent" type="checkbox" checked><span>Make this the current working proposal</span></label>
      </div>
      <div class="modal-actions">
        <button type="button" class="secondary-button" data-close-project-contractor-proposal>Cancel</button>
        <button type="submit" class="primary-button">Save proposal</button>
      </div>
    </form>`;

  document.body.appendChild(dialog);
  dialog.querySelectorAll("[data-close-project-contractor-proposal]").forEach(b => b.addEventListener("click", () => dialog.close()));
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
    amount: amountValue === "" ? null : Number(amountValue),
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

    dialog.close();
    await loadProjectDetails(activeProjectId);
    activeProjectContractorDetailsTab = "proposals";
    refreshProjectContractorDetails();
    showToast("Proposal added.");
  } catch (err) {
    console.error(err);
    error.textContent = err.message || "Could not save proposal.";
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
              ${escapeHtml(contractor.phone || "No company phone")}
              ${primary?.name ? ` · ${escapeHtml(primary.name)}` : ""}
            </div>
          </div>
          <span class="badge">${(contractor.contacts || []).length} contact${(contractor.contacts || []).length === 1 ? "" : "s"}</span>
        </div>
        ${contractor.notes ? `<p class="project-notes">${escapeHtml(contractor.notes)}</p>` : ""}
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
