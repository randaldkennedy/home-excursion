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
