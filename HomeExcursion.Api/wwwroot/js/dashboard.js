async function loadDashboard() {
  try {
    const response = await fetch("/api/home/dashboard", { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(`Dashboard request failed (${response.status})`);
    state.data = await response.json();
    populateAreaControls();
    render();
    await loadPurchases();
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
