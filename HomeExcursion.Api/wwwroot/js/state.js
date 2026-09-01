const state = {
  data: null,
  expenses: [],
  expenseFilter: "",
  expenseProject: "",
  expenseSort: "newest",
  filter: "open",
  area: "",
  sort: "smart"
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const moneyExact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
