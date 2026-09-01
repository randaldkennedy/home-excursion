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
