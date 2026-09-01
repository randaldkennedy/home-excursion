# Home Excursion purchase model

## Core rule

A **Purchase** is the receipt/transaction. A **PurchaseAllocation** explains where each dollar went.

Every purchase should eventually satisfy:

`Purchase.Total == Sum(PurchaseAllocation.Amount)`

but only allocations with `IsIncludedInHomeSpend = true` contribute to Home Excursion **Spent**.

## Allocation types

- `Task`
- `Project`
- `GeneralHome`
- `Maintenance`
- `TaxFee`
- `PersonalExcluded`
- `Unassigned`

`PersonalExcluded` uses `IsIncludedInHomeSpend = false`.

## Status workflow

- `Unreviewed` — captured, not reconciled
- `Needs Review` — partially allocated or needs attention
- `Verified` — reviewed and reconciled
- `Ignored` — receipt intentionally excluded

## Migration strategy

Legacy `home.Expenses` remains untouched through the transition. Each legacy row is copied to one Purchase plus one PurchaseAllocation using `LegacyExpenseId` as an idempotent mapping key. Existing Home attachment metadata is repointed from `Expense` to `Purchase` without moving/deleting blob files.

Only after the new reconciliation UI has been exercised and totals verified should the old Expense endpoints/table be retired.
