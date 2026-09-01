function bindPurchaseEditor() {
  document.querySelector("#addPurchaseButton")?.addEventListener("click", () => openPurchaseDialog());
  document.querySelector("#closePurchaseDialog")?.addEventListener("click", closePurchaseDialog);
  document.querySelector("#cancelPurchaseButton")?.addEventListener("click", closePurchaseDialog);
  document.querySelector("#purchaseForm")?.addEventListener("submit", savePurchase);
  document.querySelector("#deletePurchaseButton")?.addEventListener("click", deletePurchase);
  document.querySelector("#verifyPurchaseButton")?.addEventListener("click", verifyPurchase);
  document.querySelector("#addAllocationButton")?.addEventListener("click", () => addAllocationRow());
  document.querySelector("#purchaseAllocations")?.addEventListener("click", handleAllocationClick);
  document.querySelector("#purchaseAllocations")?.addEventListener("change", handleAllocationChange);
  document.querySelector("#purchaseTotal")?.addEventListener("input", updateReconciliation);
  document.querySelector("#purchaseReceiptFiles")?.addEventListener("change", handlePurchaseReceiptSelection);
  document.querySelector("#purchaseExistingReceipts")?.addEventListener("click", handlePurchaseReceiptClick);
  document.querySelector("#saveDuplicateAnywayButton")?.addEventListener("click", () => savePurchase(null, true));
  document.querySelector("#purchaseDialog")?.addEventListener("click", event => {
    if (event.target === event.currentTarget) closePurchaseDialog();
  });
}

function bindPurchaseFilters() {
  document.querySelector("#purchaseSearch")?.addEventListener("input", event => {
    state.purchaseFilter = event.target.value.trim().toLowerCase();
    renderPurchases();
  });
  document.querySelector("#purchaseStatusFilter")?.addEventListener("change", event => {
    state.purchaseStatus = event.target.value;
    renderPurchases();
  });
  document.querySelector("#purchaseSort")?.addEventListener("change", event => {
    state.purchaseSort = event.target.value;
    renderPurchases();
  });
  document.querySelector("#purchases")?.addEventListener("click", event => {
    const row = event.target.closest("[data-purchase-id]");
    if (!row) return;
    const purchase = state.purchases.find(item => item.id === Number(row.dataset.purchaseId));
    if (purchase) openPurchaseDialog(purchase);
  });
}

function bindPurchaseNavigation() {
  const card = document.querySelector("#spentSummaryCard");
  const panel = document.querySelector(".purchases-panel");
  if (!card || !panel) return;
  const jump = () => panel.scrollIntoView({ behavior: "smooth", block: "start" });
  card.addEventListener("click", jump);
  card.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); jump(); }
  });
}

async function loadPurchases() {
  try {
    const response = await fetch("/api/home/purchases", { headers: { "Accept": "application/json" } });
    if (!response.ok) throw new Error(await readError(response));
    state.purchases = await response.json();
    rebuildPurchaseAllocations();
    renderPurchases();
    renderTasks();
    const dialog = document.querySelector("#taskDialog");
    if (dialog?.open) {
      const taskId = Number(document.querySelector("#taskId")?.value || 0);
      renderTaskExpenses(state.data?.tasks?.find(t => t.id === taskId) || null);
    }
  } catch (error) {
    console.error(error);
    const container = document.querySelector("#purchases");
    if (container) container.innerHTML = `<div class="empty">${escapeHtml(error.message || "Could not load purchases.")}</div>`;
  }
}

function rebuildPurchaseAllocations() {
  state.purchaseAllocations = state.purchases.flatMap(purchase =>
    (purchase.allocations || []).map(allocation => ({ ...allocation, purchaseId: purchase.id, purchase }))
  );
}

function renderPurchases() {
  const container = document.querySelector("#purchases");
  const stats = document.querySelector("#purchaseStats");
  if (!container || !stats) return;

  let rows = [...state.purchases];
  if (state.purchaseStatus) {
    if (state.purchaseStatus === "Unassigned") rows = rows.filter(p => p.hasUnassigned);
    else rows = rows.filter(p => p.status === state.purchaseStatus);
  }
  if (state.purchaseFilter) {
    rows = rows.filter(p => {
      const haystack = [p.vendorName, p.vendor, p.purchaseDate, p.status, ...(p.allocations || []).flatMap(a => [a.description, a.category, a.projectName, a.taskTitle])]
        .filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(state.purchaseFilter);
    });
  }
  rows.sort(comparePurchaseRows);

  const needsReview = state.purchases.filter(p => p.status !== "Verified" && p.status !== "Ignored").length;
  const homeSpend = state.purchases.reduce((sum, p) => sum + Number(p.homeSpend || 0), 0);
  stats.textContent = `${state.purchases.length} purchases · ${needsReview} need review · ${moneyExact.format(homeSpend)} Home spend`;

  if (!rows.length) {
    container.innerHTML = `<div class="empty">No purchases in this view.</div>`;
    return;
  }

  container.innerHTML = rows.map(p => {
    const vendor = p.vendorName || p.vendor || "Vendor not recorded";
    const date = p.purchaseDate ? formatDateOnly(p.purchaseDate) : "Date unknown";
    const difference = Number(p.difference || 0);
    const statusClass = p.status === "Verified" ? "verified" : "review";
    const allocationSummary = (p.allocations || []).slice(0, 3).map(a => a.description).join(" · ");
    const extra = (p.allocations || []).length > 3 ? ` · +${p.allocations.length - 3} more` : "";
    const receipt = (p.attachments || []).length ? `📎 ${(p.attachments || []).length}` : "No receipt";
    return `<article class="purchase-row" data-purchase-id="${p.id}">
      <div class="purchase-date">${escapeHtml(date)}</div>
      <div class="purchase-main">
        <div class="purchase-title-line"><strong>${escapeHtml(vendor)}</strong><span class="purchase-status ${statusClass}">${escapeHtml(p.status)}</span></div>
        <div class="purchase-allocation-summary">${escapeHtml(allocationSummary || "Unassigned")}${escapeHtml(extra)}</div>
        <div class="purchase-meta">${receipt}${Math.abs(difference) > .004 ? ` · Difference ${moneyExact.format(difference)}` : ""}</div>
      </div>
      <div class="purchase-amount">${moneyExact.format(Number(p.total) || 0)}</div>
    </article>`;
  }).join("");
}

function comparePurchaseRows(a, b) {
  switch (state.purchaseSort) {
    case "oldest": return comparePurchaseDates(a, b);
    case "highest": return Number(b.total) - Number(a.total);
    case "lowest": return Number(a.total) - Number(b.total);
    default: return comparePurchaseDates(b, a) || b.id - a.id;
  }
}

function comparePurchaseDates(a, b) {
  const aa = a?.purchaseDate ? Date.parse(`${a.purchaseDate}T00:00:00`) : 0;
  const bb = b?.purchaseDate ? Date.parse(`${b.purchaseDate}T00:00:00`) : 0;
  return aa - bb;
}

let allocationDraft = [];
let allocationSequence = 0;

function openPurchaseDialog(purchase = null, defaults = {}) {
  const isEdit = Boolean(purchase);
  document.querySelector("#purchaseDialogTitle").textContent = isEdit ? "Reconcile purchase" : "Add purchase";
  document.querySelector("#purchaseId").value = purchase?.id ?? "";
  document.querySelector("#purchaseDate").value = purchase?.purchaseDate ?? new Date().toISOString().slice(0, 10);
  document.querySelector("#purchaseTotal").value = purchase?.total ?? "";
  document.querySelector("#purchaseSubtotal").value = purchase?.subtotal ?? "";
  document.querySelector("#purchaseTax").value = purchase?.tax ?? "";
  document.querySelector("#purchaseVendor").value = purchase?.vendorName || purchase?.vendor || "";
  document.querySelector("#purchaseNotes").value = purchase?.notes ?? "";
  document.querySelector("#purchaseStatusBadge").textContent = purchase?.status || "New";
  document.querySelector("#deletePurchaseButton").hidden = !isEdit;
  document.querySelector("#verifyPurchaseButton").hidden = !isEdit || purchase?.status === "Verified";
  document.querySelector("#purchaseReceiptFiles").value = "";
  document.querySelector("#purchaseReceiptSelection").textContent = "";
  hideDuplicateWarning();
  clearPurchaseError();

  allocationDraft = (purchase?.allocations || []).map(a => ({ ...a, _key: ++allocationSequence }));
  if (!allocationDraft.length) {
    allocationDraft.push(newAllocation(defaults));
  }
  renderAllocationRows();
  renderPurchaseReceipts(purchase?.attachments || []);
  updateReconciliation();
  document.querySelector("#purchaseDialog").showModal();
}

function newAllocation(defaults = {}) {
  const taskId = defaults.taskId ?? null;
  const projectId = defaults.projectId ?? null;
  return {
    _key: ++allocationSequence,
    id: null,
    projectId,
    taskId,
    amount: "",
    description: taskId ? (state.data?.tasks?.find(t => t.id === taskId)?.title || "") : "",
    category: "",
    allocationType: taskId ? "Task" : (projectId ? "Project" : "Unassigned"),
    isIncludedInHomeSpend: true,
    notes: ""
  };
}

function addAllocationRow(defaults = {}) {
  allocationDraft.push(newAllocation(defaults));
  renderAllocationRows();
  updateReconciliation();
}

function renderAllocationRows() {
  const container = document.querySelector("#purchaseAllocations");
  container.innerHTML = allocationDraft.map((a, index) => {
    const typeOptions = [
      ["Task","Task"], ["Project","Project"], ["GeneralHome","General Home"], ["Maintenance","Maintenance"],
      ["TaxFee","Tax / Fees"], ["PersonalExcluded","Personal / Excluded"], ["Unassigned","Unassigned"]
    ].map(([value,label]) => `<option value="${value}" ${a.allocationType === value ? "selected" : ""}>${label}</option>`).join("");
    return `<div class="allocation-row" data-allocation-key="${a._key}">
      <div class="allocation-row-top">
        <strong>Allocation ${index + 1}</strong>
        <button type="button" class="icon-btn allocation-remove" data-remove-allocation="${a._key}" aria-label="Remove allocation">×</button>
      </div>
      <div class="allocation-grid">
        <label class="field"><span>Type</span><select data-allocation-field="allocationType">${typeOptions}</select></label>
        <label class="field"><span>Amount</span><input data-allocation-field="amount" type="number" min="0" step="0.01" value="${escapeAttribute(a.amount ?? "")}" placeholder="0.00"></label>
        <label class="field field-wide"><span>Description</span><input data-allocation-field="description" maxlength="300" value="${escapeAttribute(a.description || "")}" placeholder="What was this money for?"></label>
        <label class="field"><span>Project</span><select data-allocation-field="projectId">${projectOptions(a.projectId)}</select></label>
        <label class="field"><span>Task</span><select data-allocation-field="taskId">${taskOptions(a.taskId, a.projectId)}</select></label>
        <label class="field field-wide"><span>Category</span><input data-allocation-field="category" maxlength="60" value="${escapeAttribute(a.category || "")}" placeholder="Materials, Tools, Paint…"></label>
      </div>
    </div>`;
  }).join("");
}

function projectOptions(selected) {
  return [`<option value="">No project</option>`, ...[...(state.data?.projects || [])]
    .sort((a,b) => a.name.localeCompare(b.name))
    .map(p => `<option value="${p.id}" ${Number(selected) === p.id ? "selected" : ""}>${escapeHtml(p.name)}</option>`)].join("");
}

function taskOptions(selected, projectId) {
  let tasks = [...(state.data?.tasks || [])];
  if (projectId) tasks = tasks.filter(t => Number(t.projectId) === Number(projectId));
  return [`<option value="">No task</option>`, ...tasks.sort((a,b) => a.title.localeCompare(b.title)).map(t => {
    const areas = taskAreaValues(t).join(", ");
    const label = areas ? `${areas} · ${t.title}` : t.title;
    return `<option value="${t.id}" ${Number(selected) === t.id ? "selected" : ""}>${escapeHtml(label)}</option>`;
  })].join("");
}

function handleAllocationClick(event) {
  const remove = event.target.closest("[data-remove-allocation]");
  if (!remove) return;
  allocationDraft = allocationDraft.filter(a => a._key !== Number(remove.dataset.removeAllocation));
  if (!allocationDraft.length) allocationDraft.push(newAllocation());
  renderAllocationRows();
  updateReconciliation();
}

function handleAllocationChange(event) {
  const field = event.target.dataset.allocationField;
  if (!field) return;
  const row = event.target.closest("[data-allocation-key]");
  const allocation = allocationDraft.find(a => a._key === Number(row.dataset.allocationKey));
  if (!allocation) return;

  let value = event.target.value;
  if (["projectId","taskId"].includes(field)) value = value ? Number(value) : null;
  allocation[field] = value;

  if (field === "allocationType") {
    allocation.isIncludedInHomeSpend = value !== "PersonalExcluded";
    if (value !== "Task") allocation.taskId = null;
    if (!["Task","Project"].includes(value)) allocation.projectId = null;
    renderAllocationRows();
  } else if (field === "projectId") {
    allocation.taskId = null;
    renderAllocationRows();
  } else if (field === "taskId" && value) {
    const task = state.data.tasks.find(t => t.id === value);
    if (task?.projectId) allocation.projectId = task.projectId;
    allocation.allocationType = "Task";
    if (!allocation.description) allocation.description = task?.title || "";
    renderAllocationRows();
  }
  updateReconciliation();
}

function updateReconciliation() {
  const total = Number(document.querySelector("#purchaseTotal")?.value || 0);
  const allocated = allocationDraft.reduce((sum,a) => sum + Number(a.amount || 0), 0);
  const home = allocationDraft.filter(a => a.allocationType !== "PersonalExcluded" && a.isIncludedInHomeSpend !== false)
    .reduce((sum,a) => sum + Number(a.amount || 0), 0);
  const excluded = allocated - home;
  const difference = total - allocated;
  document.querySelector("#reconcileReceiptTotal").textContent = moneyExact.format(total);
  document.querySelector("#reconcileAllocated").textContent = moneyExact.format(allocated);
  document.querySelector("#reconcileHomeSpend").textContent = moneyExact.format(home);
  document.querySelector("#reconcileExcluded").textContent = moneyExact.format(excluded);
  const differenceElement = document.querySelector("#reconcileDifference");
  differenceElement.textContent = moneyExact.format(difference);
  differenceElement.classList.toggle("balanced", Math.abs(difference) < .005);
  differenceElement.classList.toggle("unbalanced", Math.abs(difference) >= .005);
}

function collectPurchasePayload(allowPossibleDuplicate = false) {
  return {
    propertyId: state.data.property.id,
    vendorId: null,
    vendor: document.querySelector("#purchaseVendor").value.trim() || null,
    purchaseDate: document.querySelector("#purchaseDate").value || null,
    subtotal: nullableNumber(document.querySelector("#purchaseSubtotal").value),
    tax: nullableNumber(document.querySelector("#purchaseTax").value),
    total: Number(document.querySelector("#purchaseTotal").value || 0),
    notes: document.querySelector("#purchaseNotes").value.trim() || null,
    allowPossibleDuplicate,
    allocations: allocationDraft.map(a => ({
      id: a.id || null,
      projectId: a.projectId || null,
      taskId: a.taskId || null,
      amount: Number(a.amount || 0),
      description: String(a.description || "").trim(),
      category: String(a.category || "").trim() || null,
      allocationType: a.allocationType || "Unassigned",
      isIncludedInHomeSpend: a.allocationType === "PersonalExcluded" ? false : a.isIncludedInHomeSpend !== false,
      notes: a.notes || null
    }))
  };
}

async function savePurchase(event, allowPossibleDuplicate = false) {
  event?.preventDefault?.();
  clearPurchaseError();
  hideDuplicateWarning();
  const id = Number(document.querySelector("#purchaseId").value || 0);
  const payload = collectPurchasePayload(allowPossibleDuplicate);

  try {
    const response = await fetch(id ? `/api/home/purchases/${id}` : "/api/home/purchases", {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(payload)
    });

    if (response.status === 409) {
      const body = await response.json();
      if (body.possibleDuplicate) { showDuplicateWarning(body.duplicates || []); return; }
      throw new Error(body.message || "Purchase could not be saved.");
    }
    if (!response.ok) throw new Error(await readError(response));

    const saved = await response.json();
    const purchaseId = id || Number(saved.id);
    await uploadStagedPurchaseReceipts(purchaseId);
    await loadDashboard();
    closePurchaseDialog();
    showToast("Purchase saved.");
  } catch (error) {
    console.error(error);
    showPurchaseError(error.message || "Could not save purchase.");
  }
}

async function verifyPurchase() {
  const id = Number(document.querySelector("#purchaseId").value || 0);
  if (!id) return;
  try {
    const response = await fetch(`/api/home/purchases/${id}/verify`, { method: "POST", headers: { "Accept":"application/json" } });
    if (!response.ok) throw new Error(await readError(response));
    await loadDashboard();
    closePurchaseDialog();
    showToast("Receipt verified.");
  } catch (error) { showPurchaseError(error.message); }
}

async function deletePurchase() {
  const id = Number(document.querySelector("#purchaseId").value || 0);
  if (!id || !confirm("Delete this purchase and its receipt attachments?")) return;
  try {
    const response = await fetch(`/api/home/purchases/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error(await readError(response));
    await loadDashboard(); closePurchaseDialog(); showToast("Purchase deleted.");
  } catch (error) { showPurchaseError(error.message); }
}

function showDuplicateWarning(duplicates) {
  const box = document.querySelector("#purchaseDuplicateWarning");
  const list = document.querySelector("#purchaseDuplicateList");
  list.innerHTML = duplicates.map(d => `<button type="button" class="duplicate-purchase" data-existing-purchase="${d.id}">
    <strong>${escapeHtml(d.level)} match</strong> · ${escapeHtml(d.vendor || "Vendor unknown")} · ${d.purchaseDate ? formatDateOnly(d.purchaseDate) : "Date unknown"} · ${moneyExact.format(Number(d.total) || 0)}
  </button>`).join("");
  list.querySelectorAll("[data-existing-purchase]").forEach(button => button.addEventListener("click", () => {
    const existing = state.purchases.find(p => p.id === Number(button.dataset.existingPurchase));
    if (existing) openPurchaseDialog(existing);
  }));
  box.hidden = false;
}
function hideDuplicateWarning() { const box=document.querySelector("#purchaseDuplicateWarning"); if(box) box.hidden=true; }

async function handlePurchaseReceiptSelection() {
  const input = document.querySelector("#purchaseReceiptFiles");
  const message = document.querySelector("#purchaseReceiptSelection");
  const files = [...(input.files || [])];
  if (!files.length) { message.textContent=""; return; }
  const id = Number(document.querySelector("#purchaseId").value || 0);
  if (!id) { message.textContent = `${files.length} file${files.length===1?"":"s"} selected — attaches when purchase is saved.`; return; }
  try {
    message.textContent = "Uploading…";
    await uploadPurchaseReceipts(id, files);
    input.value="";
    await loadPurchases();
    const purchase=state.purchases.find(p=>p.id===id);
    renderPurchaseReceipts(purchase?.attachments || []);
    message.textContent = "Receipt uploaded.";
  } catch(error) { showPurchaseError(error.message); }
}

async function uploadStagedPurchaseReceipts(id) {
  const input=document.querySelector("#purchaseReceiptFiles");
  const files=[...(input?.files || [])];
  if(files.length) await uploadPurchaseReceipts(id, files);
}
async function uploadPurchaseReceipts(id, files) {
  for (const file of files) {
    const formData=new FormData(); formData.append("file",file);
    const response=await fetch(`/api/home/purchases/${id}/attachments`,{method:"POST",body:formData});
    if(!response.ok) throw new Error(await readError(response));
  }
}

function renderPurchaseReceipts(attachments) {
  const container=document.querySelector("#purchaseExistingReceipts");
  if(!attachments.length){container.innerHTML=`<div class="empty compact">No receipt attached yet.</div>`;return;}
  container.innerHTML=attachments.map(a=>{
    const image=(a.contentType||"").startsWith("image/");
    return `<div class="expense-receipt-card" data-attachment-id="${a.id}">
      ${image ? `<button type="button" class="expense-receipt-preview" data-view-purchase-receipt="${a.id}"><img src="/api/attachments/${a.id}/thumbnail" alt=""></button>` : `<a class="expense-receipt-document" href="/api/attachments/${a.id}" target="_blank">PDF</a>`}
      <div class="expense-receipt-info"><strong>${escapeHtml(a.fileName)}</strong><small>${formatFileSize(a.fileSizeBytes)}</small></div>
      <button type="button" class="attachment-delete" data-delete-purchase-receipt="${a.id}">×</button>
    </div>`;
  }).join("");
}

async function handlePurchaseReceiptClick(event) {
  const view=event.target.closest("[data-view-purchase-receipt]");
  if(view){ const attachmentId=Number(view.dataset.viewPurchaseReceipt); const p=state.purchases.find(x=>(x.attachments||[]).some(a=>a.id===attachmentId)); const a=p?.attachments.find(a=>a.id===attachmentId); if(a) openImageViewer(a); return; }
  const del=event.target.closest("[data-delete-purchase-receipt]");
  if(!del) return;
  const id=Number(del.dataset.deletePurchaseReceipt);
  if(!confirm("Delete this receipt attachment?")) return;
  const response=await fetch(`/api/attachments/${id}`,{method:"DELETE"});
  if(!response.ok){showPurchaseError(await readError(response));return;}
  const purchaseId=Number(document.querySelector("#purchaseId").value||0);
  await loadPurchases();
  renderPurchaseReceipts(state.purchases.find(p=>p.id===purchaseId)?.attachments||[]);
}

function closePurchaseDialog(){document.querySelector("#purchaseDialog")?.close();clearPurchaseError();hideDuplicateWarning();}
function showPurchaseError(message){const e=document.querySelector("#purchaseFormError");e.textContent=message;e.hidden=false;}
function clearPurchaseError(){const e=document.querySelector("#purchaseFormError");if(e){e.textContent="";e.hidden=true;}}
function nullableNumber(value){return value===""||value==null?null:Number(value);}
