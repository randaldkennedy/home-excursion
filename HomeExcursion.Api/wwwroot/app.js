const state = {
  data: null,
  filter: "open"
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

document.addEventListener("DOMContentLoaded", () => {
  bindFilters();
  loadDashboard();
});

async function loadDashboard() {
  try {
    const response = await fetch("/api/home/dashboard", {
      headers: { "Accept": "application/json" }
    });

    if (!response.ok) {
      throw new Error(`Dashboard request failed (${response.status})`);
    }

    state.data = await response.json();
    render();
  } catch (error) {
    console.error(error);
    document.querySelector("#tasks").innerHTML =
      `<div class="empty">Could not load Home Excursion.</div>`;
    document.querySelector("#projects").innerHTML =
      `<div class="empty">Could not load project data.</div>`;
    showToast("Couldn't load the dashboard.");
  }
}

function render() {
  renderHeader();
  renderSummary();
  renderProjects();
  renderTasks();
}

function renderHeader() {
  const { property, summary } = state.data;

  document.querySelector("#propertyName").textContent = property.name;
  document.querySelector("#propertyLocation").textContent =
    [property.city, property.state, property.postalCode].filter(Boolean).join(", ").replace(", " + property.postalCode, " " + property.postalCode);

  document.querySelector("#progressPercent").textContent =
    `${summary.progressPercent}%`;

  document.querySelector("#progressBar").style.width =
    `${summary.progressPercent}%`;
}

function renderSummary() {
  const s = state.data.summary;

  document.querySelector("#spent").textContent = money.format(s.spent);
  document.querySelector("#committed").textContent = money.format(s.committed);
  document.querySelector("#remaining").textContent = money.format(s.remainingEstimated);
  document.querySelector("#progressCount").textContent =
    `${s.completeItems} / ${s.totalItems}`;
}

function renderProjects() {
  const container = document.querySelector("#projects");
  const projects = state.data.projects;

  if (!projects.length) {
    container.innerHTML = `<div class="empty">No projects yet.</div>`;
    return;
  }

  container.innerHTML = projects.map(project => {
    const complete = project.status.toLowerCase() === "complete";
    const attention = !complete && project.status.toLowerCase() !== "planned";

    const badgeClass = complete ? "complete" : (attention ? "attention" : "");
    const cost = project.estimatedCost != null
      ? `<div class="project-cost">${money.format(project.estimatedCost)} estimated</div>`
      : "";

    const meta = [
      project.purpose,
      project.contractorName
    ].filter(Boolean).join(" · ");

    return `
      <section class="project-card">
        <div class="project-top">
          <div>
            <h3 class="project-name">${escapeHtml(project.name)}</h3>
            ${meta ? `<div class="project-meta">${escapeHtml(meta)}</div>` : ""}
          </div>
          <span class="badge ${badgeClass}">${escapeHtml(project.status)}</span>
        </div>
        ${cost}
        ${project.notes ? `<p class="project-notes">${escapeHtml(project.notes)}</p>` : ""}
      </section>`;
  }).join("");
}

function renderTasks() {
  const container = document.querySelector("#tasks");
  const tasks = filteredTasks();

  const completeCount = state.data.tasks.filter(isComplete).length;
  document.querySelector("#taskStats").textContent =
    `${completeCount} of ${state.data.tasks.length} punch-list items complete`;

  if (!tasks.length) {
    container.innerHTML = `<div class="empty">Nothing in this view. Damn, that feels good.</div>`;
    return;
  }

  container.innerHTML = tasks.map(task => {
    const complete = isComplete(task);
    const project = task.projectName
      ? `<span class="task-pill">${escapeHtml(task.projectName)}</span>`
      : "";

    const contractor = task.contractorNeeded
      ? `<span class="task-pill contractor">Contractor</span>`
      : `<span class="task-pill">DIY</span>`;

    const priority = task.priority?.toLowerCase() === "high"
      ? `<span class="task-pill high">High priority</span>`
      : "";

    return `
      <label class="task-row ${complete ? "completed" : ""}" data-task-id="${task.id}">
        <input
          class="task-check"
          type="checkbox"
          ${complete ? "checked" : ""}
          aria-label="Mark ${escapeAttribute(task.title)} complete"
          data-task-id="${task.id}">
        <div>
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-sub">
            ${contractor}
            ${priority}
            ${project}
          </div>
        </div>
        <span class="task-status">${escapeHtml(task.status)}</span>
      </label>`;
  }).join("");

  container.querySelectorAll(".task-check").forEach(input => {
    input.addEventListener("change", handleTaskToggle);
  });
}

function filteredTasks() {
  const tasks = state.data.tasks;

  switch (state.filter) {
    case "diy":
      return tasks.filter(t => !t.contractorNeeded && !isComplete(t));
    case "contractor":
      return tasks.filter(t => t.contractorNeeded && !isComplete(t));
    case "all":
      return tasks;
    case "open":
    default:
      return tasks.filter(t => !isComplete(t));
  }
}

function bindFilters() {
  document.querySelectorAll(".filter-btn").forEach(button => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;

      document.querySelectorAll(".filter-btn")
        .forEach(b => b.classList.toggle("active", b === button));

      if (state.data) {
        renderTasks();
      }
    });
  });
}

async function handleTaskToggle(event) {
  const input = event.currentTarget;
  const id = Number(input.dataset.taskId);
  const completed = input.checked;

  input.disabled = true;

  try {
    const response = await fetch(`/api/home/tasks/${id}/complete`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ completed })
    });

    if (!response.ok) {
      throw new Error(`Task update failed (${response.status})`);
    }

    const updated = await response.json();
    const task = state.data.tasks.find(t => t.id === id);

    task.status = updated.status;
    task.completedAt = updated.completedAt;

    // Recalculate the combined progress locally.
    const completedProjects = state.data.projects.filter(
      p => p.status.toLowerCase() === "complete").length;
    const completedTasks = state.data.tasks.filter(isComplete).length;

    state.data.summary.completedTaskCount = completedTasks;
    state.data.summary.completeItems = completedProjects + completedTasks;
    state.data.summary.progressPercent = Math.round(
      100 * state.data.summary.completeItems / state.data.summary.totalItems);

    renderHeader();
    renderSummary();
    renderTasks();

    showToast(completed ? "Knocked off the punch list." : "Put back on the punch list.");
  } catch (error) {
    console.error(error);
    input.checked = !completed;
    input.disabled = false;
    showToast("Couldn't update that task.");
  }
}

function isComplete(task) {
  return task.status?.toLowerCase() === "complete";
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 1800);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
