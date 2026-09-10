const PROPERTY_STORAGE_KEY = "homeExcursion.selectedPropertyId";

let propertyDirectory = [];
let activeHouseEditorId = null;
let houseFilter = "all";
let houseSort = "name";
let houseWorkspaceBound = false;
let homeAccessBound = false;

function selectedPropertyId() {
  const value = Number(localStorage.getItem(PROPERTY_STORAGE_KEY) || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function setSelectedPropertyId(propertyId) {
  if (propertyId)
    localStorage.setItem(PROPERTY_STORAGE_KEY, String(propertyId));
  else
    localStorage.removeItem(PROPERTY_STORAGE_KEY);
}

async function loadDashboard(propertyId = selectedPropertyId()) {
  try {
    bindHouseWorkspace();

    const query = propertyId ? `?propertyId=${encodeURIComponent(propertyId)}` : "";
    const response = await fetch(`/api/home/dashboard${query}`, {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) throw new Error(`Dashboard request failed (${response.status})`);

    state.data = await response.json();
    setSelectedPropertyId(state.data.property.id);

    populateAreaControls();
    render();
    await Promise.all([
      loadPurchases(),
      loadProperties()
    ]);
  } catch (error) {
    console.error(error);
    const tasks = document.querySelector("#tasks");
    const projects = document.querySelector("#projects");
    if (tasks) tasks.innerHTML = `<div class="empty">Could not load Home Excursion.</div>`;
    if (projects) projects.innerHTML = `<div class="empty">Could not load project data.</div>`;
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
  const propertyName = document.querySelector("#propertyName");
  const propertyLocation = document.querySelector("#propertyLocation");
  const progressPercent = document.querySelector("#progressPercent");
  const progressBar = document.querySelector("#progressBar");

  if (propertyName) propertyName.textContent = property.name;
  const location = [property.city, property.state].filter(Boolean).join(", ");
  if (propertyLocation)
    propertyLocation.textContent = [property.address1, location, property.postalCode].filter(Boolean).join(" · ");

  if (progressPercent) progressPercent.textContent = `${summary.progressPercent}%`;
  if (progressBar) progressBar.style.width = `${summary.progressPercent}%`;
}

function renderSummary() {
  const s = state.data.summary;
  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node) node.textContent = value;
  };

  setText("#spent", money.format(Number(s.spent) || 0));
  setText("#maintenance", money.format(Number(s.maintenance) || 0));
  setText("#committed", money.format(Number(s.committed) || 0));
  setText("#estimated", money.format(Number(s.estimated) || 0));
  setText("#progressCount", `${s.completeItems} / ${s.totalItems}`);
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

/* ============================================================
   Houses / Property workspace
   ============================================================ */

function bindHouseWorkspace() {
  if (houseWorkspaceBound) return;
  houseWorkspaceBound = true;

  document.querySelectorAll("[data-workspace-view]").forEach(button => {
    button.addEventListener("click", () =>
      showWorkspaceView(button.dataset.workspaceView || "houses"));
  });

  document.querySelector("#addHouseButton")?.addEventListener("click", () => openHouseEditor(null));
  document.querySelector("#houseSearch")?.addEventListener("input", renderHouses);
  document.querySelector("#houseSort")?.addEventListener("change", event => {
    houseSort = event.target.value || "name";
    renderHouses();
  });

  document.querySelector("#projectHouseSelector")?.addEventListener("change", async event => {
    const propertyId = Number(event.target.value || 0);
    if (!propertyId) return;
    await activateHouse(propertyId, true);
    showWorkspaceView("projects");
  });

  document.querySelector("#taskHouseSelector")?.addEventListener("change", async event => {
    const propertyId = Number(event.target.value || 0);
    if (!propertyId) return;
    await activateHouse(propertyId, true);
    showWorkspaceView("tasks");
  });

  document.querySelector("#expenseHouseSelector")?.addEventListener("change", async event => {
    const propertyId = Number(event.target.value || 0);
    if (!propertyId) return;
    await activateHouse(propertyId, true);
    showWorkspaceView("expenses");
  });

  document.querySelector("#houseFilters")?.addEventListener("click", event => {
    const button = event.target.closest("[data-house-filter]");
    if (!button) return;
    houseFilter = button.dataset.houseFilter || "all";
    renderHouses();
  });

  document.querySelector("#housesList")?.addEventListener("click", event => {
    const card = event.target.closest("[data-house-id]");
    if (!card) return;
    selectHouse(Number(card.dataset.houseId));
  });

  document.querySelector("#houseDetailPane")?.addEventListener("click", handleHouseDetailClick);
  document.querySelector("#houseDetailPane")?.addEventListener("submit", saveHouse);
  document.querySelector("#housePhotoFile")?.addEventListener("change", uploadHousePhoto);
}

function showWorkspaceView(view) {
  const views = {
    houses: document.querySelector("#housesWorkspaceView"),
    projects: document.querySelector("#projectsWorkspaceView"),
    tasks: document.querySelector("#tasksWorkspaceView"),
    expenses: document.querySelector("#expensesWorkspaceView"),
    access: document.querySelector("#accessWorkspaceView")
  };

  Object.entries(views).forEach(([key, element]) => {
    if (element) element.hidden = key !== view;
  });

  document.querySelectorAll("[data-workspace-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.workspaceView === view);
  });

  if (view === "access") {
    bindHomeAccessWorkspace();
    loadHomeAccessMembers();
  }
}

async function loadProperties() {
  const response = await fetch("/api/home/properties", {
    headers: { "Accept": "application/json" }
  });

  if (!response.ok)
    throw new Error(await readError(response));

  propertyDirectory = await response.json();

  const selectedId = selectedPropertyId();
  if (!activeHouseEditorId && selectedId)
    activeHouseEditorId = selectedId;

  renderHouses();
  renderWorkspaceHouseSelectors();

  if (activeHouseEditorId) {
    const property = propertyDirectory.find(p => Number(p.id) === Number(activeHouseEditorId));
    if (property) renderHouseDetail(property);
  }
}

function renderWorkspaceHouseSelectors() {
  const currentId = Number(selectedPropertyId() || state.data?.property?.id || 0);
  const activeProperties = propertyDirectory.filter(p => p.isActive);

  const options = activeProperties.map(property =>
    `<option value="${property.id}" ${Number(property.id) === currentId ? "selected" : ""}>
      ${escapeHtml(property.name)}
    </option>`
  ).join("");

  ["#projectHouseSelector", "#taskHouseSelector", "#expenseHouseSelector"].forEach(selector => {
    const select = document.querySelector(selector);
    if (!select) return;
    select.innerHTML = options;
    select.disabled = activeProperties.length <= 1;
  });
}


function renderHouses() {
  const container = document.querySelector("#housesList");
  if (!container) return;

  const search = (document.querySelector("#houseSearch")?.value || "").trim().toLowerCase();
  let properties = [...propertyDirectory];

  if (houseFilter === "active")
    properties = properties.filter(p => p.isActive);
  else if (houseFilter === "inactive")
    properties = properties.filter(p => !p.isActive);

  if (search) {
    properties = properties.filter(p =>
      [p.name, p.address1, p.city, p.state, p.postalCode]
        .some(value => String(value || "").toLowerCase().includes(search))
    );
  }

  properties.sort((a, b) => {
    if (houseSort === "newest")
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    return (a.name || "").localeCompare(b.name || "");
  });

  const counts = {
    all: propertyDirectory.length,
    active: propertyDirectory.filter(p => p.isActive).length,
    inactive: propertyDirectory.filter(p => !p.isActive).length
  };

  document.querySelectorAll("[data-house-filter]").forEach(button => {
    const filter = button.dataset.houseFilter;
    const base = filter === "all" ? "All" : filter === "active" ? "Active" : "Inactive";
    button.textContent = `${base} (${counts[filter] ?? 0})`;
    button.classList.toggle("active", filter === houseFilter);
  });

  if (!properties.length) {
    container.innerHTML = `<div class="empty houses-empty">No houses match this view.</div>`;
    return;
  }

  const selectedId = Number(activeHouseEditorId || selectedPropertyId() || 0);

  container.innerHTML = properties.map(property => {
    const photo = property.photoAttachmentId
      ? `<img src="/api/attachments/${property.photoAttachmentId}/thumbnail" alt="${escapeAttribute(property.name)}">`
      : `<div class="house-card-photo-placeholder">⌂</div>`;

    const locality = [property.city, property.state].filter(Boolean).join(", ");
    const addressLine = [property.address1, locality, property.postalCode].filter(Boolean).join(" · ");
    const selected = Number(property.id) === selectedId;

    return `<article class="house-card ${selected ? "selected" : ""}" data-house-id="${property.id}">
      <div class="house-card-photo">${photo}</div>
      <div class="house-card-copy">
        <div class="house-card-title-row">
          <h3>${escapeHtml(property.name)}</h3>
          <span class="house-status-pill ${property.isActive ? "active" : "inactive"}">
            ${property.isActive ? "Active" : "Inactive"}
          </span>
        </div>
        <p>${escapeHtml(addressLine || "Address not set")}</p>
        <div class="house-card-meta">
          ${Number(property.id) === Number(selectedPropertyId())
            ? `<span class="house-primary-pill">★ Current property</span>`
            : `<span>Open to manage</span>`}
        </div>
      </div>
    </article>`;
  }).join("");
}

function selectHouse(propertyId) {
  activeHouseEditorId = propertyId;
  const property = propertyDirectory.find(p => Number(p.id) === Number(propertyId));
  if (!property) return;
  renderHouses();
  renderHouseDetail(property);
}

function openHouseEditor(property) {
  activeHouseEditorId = property?.id ? Number(property.id) : null;
  renderHouseDetail(property || {
    id: null,
    name: "",
    address1: "",
    city: "",
    state: "TX",
    postalCode: "",
    isActive: true,
    photoAttachmentId: null
  }, true);
}

function renderHouseDetail(property, forceEdit = false) {
  const pane = document.querySelector("#houseDetailPane");
  if (!pane) return;

  const isNew = !property.id;
  const photo = property.photoAttachmentId
    ? `<img src="/api/attachments/${property.photoAttachmentId}" alt="${escapeAttribute(property.name || "Property photo")}">`
    : `<div class="house-hero-placeholder"><span>⌂</span><small>No property photo yet</small></div>`;

  const locality = [property.city, property.state].filter(Boolean).join(", ");
  const fullAddress = [property.address1, locality, property.postalCode].filter(Boolean).join(", ");
  const current = property.id && Number(property.id) === Number(selectedPropertyId());

  pane.innerHTML = `
    <div class="house-detail-hero">
      ${photo}
      ${property.id ? `<button type="button" class="house-photo-change" data-house-change-photo>📷 Change photo</button>` : ""}
    </div>

    <div class="house-detail-heading">
      <div>
        <div class="house-title-line">
          <h2>${escapeHtml(property.name || "New House")}</h2>
          <span class="house-status-pill ${property.isActive ? "active" : "inactive"}">
            ${property.isActive ? "Active" : "Inactive"}
          </span>
        </div>
        <p>${escapeHtml(fullAddress || "Add the property address below.")}</p>
      </div>
      ${property.id
        ? `<button type="button" class="secondary-btn" data-house-use ${current ? "disabled" : ""}>
            ${current ? "✓ Current property" : "Use this house"}
          </button>`
        : ""}
    </div>

    <div class="house-detail-tabs">
      <button type="button" class="active">⌂ Overview</button>
      <button type="button" disabled>▦ Details</button>
      <button type="button" disabled>$ Financial</button>
      <button type="button" disabled>☷ Notes</button>
      <button type="button" disabled>⌕ Documents</button>
    </div>

    <form id="houseForm" class="house-form">
      <input type="hidden" id="houseId" value="${property.id ?? ""}">

      <section class="house-basic-card">
        <div class="house-section-heading">
          <div>
            <span class="section-kicker">${isNew ? "NEW PROPERTY" : "BASIC INFORMATION"}</span>
            <h3>${isNew ? "Add a house" : "Basic Information"}</h3>
          </div>
        </div>

        <div class="house-fields-grid">
          <label class="field field-wide">
            <span>Name *</span>
            <input id="houseName" maxlength="200" required value="${escapeAttribute(property.name || "")}" placeholder="Mom's House">
          </label>

          <label class="field field-wide">
            <span>Address *</span>
            <input id="houseAddress1" maxlength="250" required value="${escapeAttribute(property.address1 || "")}" placeholder="123 Main Street">
          </label>

          <label class="field">
            <span>City</span>
            <input id="houseCity" maxlength="100" value="${escapeAttribute(property.city || "")}" placeholder="Conroe">
          </label>

          <label class="field house-state-field">
            <span>State</span>
            <input id="houseState" maxlength="50" value="${escapeAttribute(property.state || "TX")}" placeholder="TX">
          </label>

          <label class="field">
            <span>ZIP</span>
            <input id="housePostalCode" maxlength="20" value="${escapeAttribute(property.postalCode || "")}" placeholder="77301">
          </label>

          <label class="check-field house-active-field">
            <input id="houseIsActive" type="checkbox" ${property.isActive ? "checked" : ""}>
            <span><strong>Active house</strong><small>Keep it available in Home Excursion.</small></span>
          </label>
        </div>
      </section>

      <aside class="house-side-stack">
        <section class="house-quick-facts">
          <h3>Quick Facts</h3>
          <div><span>⌂</span><strong>Status</strong><em>${property.isActive ? "Active" : "Inactive"}</em></div>
          <div><span>⌖</span><strong>City</strong><em>${escapeHtml(locality || "—")}</em></div>
          <div><span>★</span><strong>Current property</strong><em>${current ? "Yes" : "No"}</em></div>
          <div><span>▦</span><strong>Property details</strong><em>Build from here</em></div>
        </section>

        <section class="house-photo-card">
          <h3>Property Photo</h3>
          <div class="house-photo-preview">
            ${property.photoAttachmentId
              ? `<img src="/api/attachments/${property.photoAttachmentId}/thumbnail" alt="">`
              : `<div class="house-photo-mini-placeholder">⌂</div>`}
            <div>
              ${property.id
                ? `<button type="button" class="secondary-btn" data-house-change-photo>📷 ${property.photoAttachmentId ? "Change" : "Add"} photo</button>`
                : `<small>Save the house first, then add a photo.</small>`}
            </div>
          </div>
        </section>
      </aside>

      <div id="houseFormError" class="form-error house-form-error" hidden></div>

      <footer class="house-form-actions">
        ${property.id ? `<button type="button" class="secondary-btn" data-house-open-projects>Open projects</button>` : `<span></span>`}
        <div>
          ${!isNew ? `<button type="button" class="secondary-btn" data-house-cancel>Cancel</button>` : ""}
          <button type="submit" class="primary-btn">${isNew ? "Add house" : "Save changes"}</button>
        </div>
      </footer>
    </form>
  `;
}

async function handleHouseDetailClick(event) {
  const propertyId = Number(document.querySelector("#houseId")?.value || activeHouseEditorId || 0);

  if (event.target.closest("[data-house-change-photo]")) {
    if (!propertyId) return;
    activeHouseEditorId = propertyId;
    const input = document.querySelector("#housePhotoFile");
    if (input) {
      input.value = "";
      input.click();
    }
    return;
  }

  if (event.target.closest("[data-house-use]")) {
    if (!propertyId) return;
    await activateHouse(propertyId, true);
    return;
  }

  if (event.target.closest("[data-house-open-projects]")) {
    if (!propertyId) return;
    await activateHouse(propertyId, true);
    showWorkspaceView("projects");
    return;
  }

  if (event.target.closest("[data-house-cancel]")) {
    const property = propertyDirectory.find(p => Number(p.id) === propertyId);
    if (property) renderHouseDetail(property);
  }
}

async function activateHouse(propertyId, reload = true) {
  setSelectedPropertyId(propertyId);
  activeHouseEditorId = propertyId;
  if (reload)
    await loadDashboard(propertyId);
  else {
    renderHouses();
    renderWorkspaceHouseSelectors();
  }
}

async function saveHouse(event) {
  if (event.target.id !== "houseForm") return;
  event.preventDefault();

  const id = Number(document.querySelector("#houseId")?.value || 0);
  const error = document.querySelector("#houseFormError");
  const payload = {
    name: document.querySelector("#houseName")?.value.trim() || "",
    address1: document.querySelector("#houseAddress1")?.value.trim() || "",
    city: document.querySelector("#houseCity")?.value.trim() || null,
    state: document.querySelector("#houseState")?.value.trim() || null,
    postalCode: document.querySelector("#housePostalCode")?.value.trim() || null,
    isActive: document.querySelector("#houseIsActive")?.checked !== false
  };

  if (!payload.name || !payload.address1) {
    if (error) {
      error.textContent = "Name and street address are required.";
      error.hidden = false;
    }
    return;
  }

  try {
    const response = await fetch(id ? `/api/home/properties/${id}` : "/api/home/properties", {
      method: id ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error(await readError(response));
    const result = await response.json();
    const savedId = Number(result.id || id);

    activeHouseEditorId = savedId;
    if (!id) setSelectedPropertyId(savedId);

    await loadDashboard(savedId);
    showToast(id ? "House updated." : "House added.");
  } catch (err) {
    console.error(err);
    if (error) {
      error.textContent = err.message || "Could not save the house.";
      error.hidden = false;
    }
  }
}

async function uploadHousePhoto(event) {
  const file = event.target.files?.[0];
  const propertyId = Number(activeHouseEditorId || 0);
  if (!file || !propertyId) return;

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`/api/home/properties/${propertyId}/photo`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) throw new Error(await readError(response));

    await loadProperties();
    showToast("Property photo updated.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not upload property photo.");
  } finally {
    event.target.value = "";
  }
}


/* ============================================================
   Household access
   ============================================================ */

function bindHomeAccessWorkspace() {
  if (homeAccessBound) return;
  homeAccessBound = true;

  document.querySelector("#homeAccessForm")?.addEventListener("submit", addHomeAccessMember);
  document.querySelector("#homeAccessMembers")?.addEventListener("click", async event => {
    const button = event.target.closest("[data-remove-home-member]");
    if (!button) return;

    const userId = Number(button.dataset.removeHomeMember || 0);
    const email = button.dataset.memberEmail || "this account";
    if (!userId) return;

    if (!confirm(`Remove Home access for ${email}?`)) return;

    button.disabled = true;
    try {
      const response = await fetch(`/api/home/access/members/${userId}`, {
        method: "DELETE",
        headers: { "Accept": "application/json" }
      });

      if (!response.ok)
        throw new Error(await readError(response));

      showHomeAccessMessage(`Removed Home access for ${email}.`, false);
      await loadHomeAccessMembers();
    } catch (error) {
      console.error(error);
      showHomeAccessMessage(error.message || "Couldn't remove Home access.", true);
      button.disabled = false;
    }
  });
}

async function loadHomeAccessMembers() {
  const container = document.querySelector("#homeAccessMembers");
  if (!container) return;

  container.innerHTML = `<div class="loading">Loading household members…</div>`;

  try {
    const response = await fetch("/api/home/access", {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok)
      throw new Error(await readError(response));

    const data = await response.json();
    const members = Array.isArray(data.members) ? data.members : [];

    if (!members.length) {
      container.innerHTML = `<div class="empty">No household members found.</div>`;
      return;
    }

    container.innerHTML = members.map(member => {
      const displayName = member.givenName || member.email || "Household member";
      const isYou = member.isCurrentUser === true;

      return `<article class="access-member-row">
        <div class="access-member-avatar">${escapeHtml((displayName || "?").trim().charAt(0).toUpperCase() || "?")}</div>
        <div class="access-member-copy">
          <div class="access-member-title">
            <strong>${escapeHtml(displayName)}</strong>
            ${isYou ? `<span class="house-primary-pill">You</span>` : ""}
          </div>
          <span>${escapeHtml(member.email || "")}</span>
        </div>
        <div class="access-member-role">${escapeHtml(member.role || "Member")}</div>
        <div class="access-member-action">
          ${isYou
            ? `<span class="access-owner-note">Protected</span>`
            : `<button type="button"
                       class="secondary-btn"
                       data-remove-home-member="${member.userId}"
                       data-member-email="${escapeAttribute(member.email || "")}">
                 Remove access
               </button>`}
        </div>
      </article>`;
    }).join("");
  } catch (error) {
    console.error(error);
    container.innerHTML = `<div class="empty">Could not load household access.</div>`;
    showHomeAccessMessage(error.message || "Couldn't load household access.", true);
  }
}

async function addHomeAccessMember(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const emailInput = form.querySelector("#homeAccessEmail");
  const button = form.querySelector('button[type="submit"]');
  const email = (emailInput?.value || "").trim();

  if (!email) return;

  button.disabled = true;
  showHomeAccessMessage("", false, true);

  try {
    const response = await fetch("/api/home/access/members", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ email })
    });

    if (!response.ok)
      throw new Error(await readError(response));

    emailInput.value = "";
    showHomeAccessMessage(`${email} now has Home access.`, false);
    await loadHomeAccessMembers();
  } catch (error) {
    console.error(error);
    showHomeAccessMessage(error.message || "Couldn't add household member.", true);
  } finally {
    button.disabled = false;
  }
}

function showHomeAccessMessage(message, isError = false, hide = false) {
  const node = document.querySelector("#homeAccessMessage");
  if (!node) return;

  if (hide || !message) {
    node.hidden = true;
    node.textContent = "";
    node.classList.remove("error");
    return;
  }

  node.hidden = false;
  node.textContent = message;
  node.classList.toggle("error", isError);
}
