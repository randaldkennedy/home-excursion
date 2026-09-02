async function loadAccountIdentity() {
  const response = await fetch("/api/auth/me", {
    credentials: "same-origin",
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(`Could not load signed-in user (${response.status}).`);
  }

  const account = await response.json();
  const name = account.givenName || account.email || "Account";
  const initial = (account.givenName || account.email || "?").trim().charAt(0).toUpperCase();

  document.getElementById("accountName").textContent = name;
  document.getElementById("accountPopoverName").textContent = name;
  document.getElementById("accountEmail").textContent = account.email || "";
  document.getElementById("accountInitial").textContent = initial || "?";
}

function bindAccountMenu() {
  const menu = document.getElementById("accountMenu");
  const button = document.getElementById("accountButton");
  const popover = document.getElementById("accountPopover");

  if (!menu || !button || !popover) return;

  const close = () => {
    popover.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = popover.hidden;
    popover.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));
  });

  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target)) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindFilters();
  bindAreaFilter();
  bindTaskSort();
  bindTaskEditor();
  bindProjectDetails();
  bindPurchaseEditor();
  bindPurchaseFilters();
  bindPurchaseNavigation();
  bindImageViewer();
  bindAccountMenu();

  loadAccountIdentity().catch(error => {
    console.error("Could not load account identity.", error);
  });

  loadDashboard();
});
