# Home Excursion — Project Contractors / Bidding / Project Lifecycle Handoff

Last updated: 2026-09-08 late evening  
Current branch: `feature/project-contractors`

## Why this file exists

This file is the detailed handoff so work can resume tomorrow without reconstructing tonight from chat history.

The important design correction tonight was this:

> **Contractors are global reusable companies. Projects are separate. A ProjectContractor is the project-specific relationship between one project and one contractor.**

The project has its own overall status. The contractor-on-that-project has its own status, activity, proposals/bids, and eventual awarded/selected state.

That distinction is now the core architecture and should not be blurred again.

---

# 1. Real-world workflow we are building for

The workflow was defined using Randy's mother's upcoming siding project as the concrete example.

## Procurement / bidding phase

Example: Momma's siding project.

1. Create the project.
2. Search Google Maps for siding installers.
3. Call 2–4 contractors.
4. As each contractor is contacted:
   - create the contractor/company once
   - capture company name and phone
   - optionally capture the person spoken to
   - record what was discussed
5. Contractor often says the “real guy” will call back.
6. When they call back:
   - quickly find that contractor narrowed to the current project
   - log the call
   - record discussion
   - likely record an appointment / walkthrough date
7. Contractor later sends a proposal/bid, usually by email.
8. Attach that bid to the specific contractor + project relationship.
9. Contractor may revise the bid several times.
   - old proposal remains history
   - new proposal becomes current
10. Repeat for several contractors.
11. Eventually one contractor is selected.

## After award / execution phase

Once one contractor is selected:

- the project is no longer primarily a bidding comparison screen
- the selected contractor becomes the active contractor
- non-selected bidders become historical information
- normal project management becomes:
  - scope
  - schedule
  - deadline
  - budget
  - additional costs
  - change orders later
  - activity / communication
  - progress
  - completion

## Closure phase

Project closure will have its own punch list.

Closure items have their own statuses, currently:

- Planned
- In Progress
- Waiting
- Complete
- Cancelled

The project should not truly close until all remaining closure items are either Complete or Cancelled.

We explicitly did **not** settle on a project status named “Substantially Complete.” Randy does not like that phrase. Do not reintroduce it without discussion.

---

# 2. Data model decisions

## Global Contractor / Vendor

`Vendor` is the reusable company / contractor record.

Durable company-level data belongs here:

- company name
- phone
- email
- website
- address
- company notes
- active flag
- `IsContractor`
- reusable named contacts

Important: `Vendor` is also used for purchase/receipt merchants, so **not every Vendor is a contractor**.

We fixed that tonight with:

```csharp
public bool IsContractor { get; set; }
```

Contractor directory should query only:

```text
IsActive == true
AND IsContractor == true
```

## VendorContact

Reusable company contacts belong globally to the contractor/vendor.

Example:

- Exclusive Remodeling
  - Amine Rama
  - Operations Manager
  - phone
  - email
  - primary flag

Contacts should **not** be stored as project-specific records unless a future need proves otherwise.

## HomeProject

Project status answers:

> Where is this project overall?

Examples discussed / currently supported include:

- Planned
- Research
- Getting Bids
- Approved
- Scheduled
- In Progress
- Waiting
- On Hold
- Ordered
- Closing / Punch List
- Closed
- Complete
- Cancelled

Important architectural correction:

**`Bid Received` does NOT belong on the project.**

That is contractor-specific.

Randy specifically said:

> The status of Getting Bids belongs on the project.  
> The status of Bid received belongs on the contractor for that project.

## ProjectContractor

This is the key association table.

It represents:

```text
Project <-> Contractor
```

Project-specific data belongs here:

- ProjectId
- VendorId
- project-specific status
- current working bid amount
- project-specific notes
- awarded / selected flag
- sort order
- timestamps

Legacy snapshot fields `Name` and `Phone` are still present for compatibility, but Vendor should be treated as the source of truth.

Statuses currently include:

- Considering
- Contacted
- Callback Pending
- Appointment Scheduled
- Walkthrough Scheduled
- Awaiting Bid
- Bid Received
- Revision Requested
- Shortlisted
- Selected
- Declined
- No Response

These statuses describe the relationship with that contractor for that one project.

## ProjectContractorActivity

This replaced the earlier fuzzy `VendorActivity`.

Activity now belongs directly to the ProjectContractor relationship.

That was an important fix.

Fields:

- ProjectContractorId
- ActivityType
- ActivityAt
- Summary
- Notes
- CreatedAt

Examples:

```text
Called 9/9 2:00 PM — talked about XYZ
Called back — appointment Thursday at 10:00
Email — revised bid coming
Walkthrough — reviewed damaged sheathing
```

Activity types currently normalize around things like:

- Called
- Email
- Text
- Meeting
- Walkthrough
- Estimate
- Note

## ProjectContractorProposal

Added tonight because revised proposals are normal and should be structured.

Fields:

- ProjectContractorId
- ReceivedDate
- RevisionLabel
- Amount
- Notes
- IsCurrent
- CreatedAt
- UpdatedAt

Behavior:

- multiple proposals can exist for one contractor/project
- one proposal can be current
- when a proposal is current, its amount becomes the working `ProjectContractor.BidAmount`
- old proposals remain historical

This should become the real source of bid revision history.

## ProjectClosureItem

Added tonight for project closure punch list.

Fields:

- ProjectId
- Description
- Status
- DueDate
- Notes
- SortOrder
- CreatedAt
- CompletedAt

Statuses currently:

- Planned
- In Progress
- Waiting
- Complete
- Cancelled

---

# 3. Migrations and database state

The project contractor work is on:

```text
feature/project-contractors
```

A backend checkpoint was committed tonight:

```text
304e9a1 Refactor contractor project lifecycle
```

Do not assume later UI / contractor flag work is committed yet.

## Existing migrations on branch

Earlier contractor work created:

```text
20260908213936_AddProjectContractors
20260908215958_AddProjectContractorPhone
20260909005911_AddVendorContactsAndActivity
```

Tonight created:

```text
20260909020921_RefactorProjectContractorLifecycle
20260909023216_AddVendorContractorFlag
```

### Important migration safety work

`RefactorProjectContractorLifecycle` originally wanted to drop `VendorActivities`.

It was manually patched so it:

1. creates `ProjectContractorActivities`
2. verifies all old VendorActivities can map to a ProjectContractor
3. copies the data
4. throws and aborts if any row cannot be mapped
5. only then drops `VendorActivities`

That migration applied successfully locally.

The output showed:

```text
Applying migration '20260909020921_RefactorProjectContractorLifecycle'
...
Done.
```

So local DB currently has:

- home.ProjectContractorActivities
- home.ProjectContractorProposals
- home.ProjectClosureItems
- old home.VendorActivities removed

### AddVendorContractorFlag migration

Added:

```text
Vendor.IsContractor bit not null default false
```

The migration was manually patched to mark any Vendor already referenced by ProjectContractors as contractor:

```sql
UPDATE v
SET v.[IsContractor] = 1
FROM [home].[Vendors] v
WHERE EXISTS (
    SELECT 1
    FROM [home].[ProjectContractors] pc
    WHERE pc.[VendorId] = v.[Id]
);
```

However, after applying / refreshing, the contractor list was empty.

Inspection showed:

```text
Id  ProjectId  Name                  VendorId  VendorName              IsContractor
1   5          Exclusive Remodeling  6         Exclusive Remodeling    0
2   5          DWR                   NULL      NULL                    NULL
```

So the migration backfill did not produce the expected local values.

Manual cleanup was performed:

```sql
UPDATE home.Vendors
SET IsContractor = 1
WHERE Id IN (1, 6);

UPDATE home.ProjectContractors
SET VendorId = 1
WHERE Id = 2;
```

Vendor lookup had shown:

```text
Id  Name                         Phone         IsContractor
1   DoingWhat'sRight Interiors   281-419-4144 0
```

After manual repair, contractor directory displayed correctly:

- DoingWhat'sRight Interiors
- Exclusive Remodeling

This local repair is done.

Before production deployment, review whether the `AddVendorContractorFlag` migration will correctly flag production-linked rows. It should in principle, but local behavior was odd. Do not blindly assume the migration is enough without inspecting prod-equivalent data.

---

# 4. Existing contractor test data

## Kitchen Remodel project

Project is still in:

```text
Getting Bids
```

### Exclusive Remodeling

Current relationship:

- Project: Kitchen Remodel
- Contractor: Exclusive Remodeling
- Bid shown: `$35,838`
- Status shown in UI: `Considering`
- 5 files existed from prior work
- company phone displayed as raw digits in some UI places
- primary contact:
  - Amine Rama
- historical activity exists from previous work
- proposal history structure now exists, but older attached estimate may not yet be represented as a `ProjectContractorProposal` row unless manually added later

Old estimate details from earlier work:
- Estimate #3627
- dated 09/08/2026
- total $35,838
- Exclusive Remodeling
- 26103 I-45 N ste 103-A, Spring TX 77380
- 832-663-9926
- info@exclusiveremodeling.com

### DWR

Global contractor/vendor:

```text
DoingWhat'sRight Interiors
281-419-4144
```

ProjectContractor row was originally named `DWR` with VendorId NULL.

Tonight manually repaired:

```text
ProjectContractor Id 2 -> VendorId 1
```

### Happy House

Created as a test contractor tonight using the new global Contractor flow.

Displayed as:

```text
Happy House
2813632010
```

Then a named contact was added:

```text
Bubba Rednext
```

The contractor card showed:

```text
Happy House
2813632010 · Bubba Rednext
1 contact
```

A company-level note `Contacted.` was also entered.

That exposed an important UX / modeling point:

**“Contacted” should not be a company-level permanent note.**
That belongs to the project-specific ProjectContractor status/activity.

Global contractor card should ideally show durable info only:
- company name
- phone
- primary contact
- maybe website/address

Do not surface temporary project-state notes prominently in the global contractor list.

Happy House was then associated to Kitchen Remodel.

On the Kitchen Remodel project screen it appeared as:

```text
Happy House
Contact: Bubba Rednext
Phone: 2813462680
Status: Considering
Current bid: $14
```

The `$14` was test data and not meaningful.

---

# 5. Current UI state

Two UI files were replaced tonight:

```text
HomeExcursion.Api/wwwroot/index.html
HomeExcursion.Api/wwwroot/js/projects.js
```

Remember Randy's browser issue:

> When sending JS back, always append `.txt` to the downloadable file.

So future JS output should be named something like:

```text
projects.js.txt
```

and Randy renames/copies it back to `projects.js`.

## New Contractors panel

A new global Contractors panel was added below Projects in the left column.

Screenshot result after filtering worked:

```text
WHO WE CALL
Contractors
+ Add contractor

DoingWhat'sRight Interiors
281-419-4144
0 contacts

Exclusive Remodeling
(832)663-9926 · Amine Rama
1 contact

Happy House
2813632010 · Bubba Rednext
1 contact
```

This direction was accepted.

## Global Add Contractor flow

Works.

Randy successfully created Happy House.

Current global contractor editor includes more than the minimum:
- company name
- phone
- email
- website
- address
- city/state/zip
- notes
- named contacts after save

Real-world first-use workflow often only needs:
- name
- phone
- who spoke to
- note

We can simplify/sequence later, but functionality is there.

## Named contacts

Works.

Randy added Bubba Rednext to Happy House.

Global contact endpoints now use:

```text
/api/home/contractors/{vendorId}/contacts
```

rather than project-nested contact endpoints.

## Project contractor association

Works.

Kitchen Remodel now shows three contractors:

- Exclusive Remodeling
- DoingWhat'sRight Interiors
- Happy House

The project screen correctly displays:

```text
Contractor
Contact
Phone
Status
Current bid
Open
```

No need to re-enter company/contact data when associating to project.

This is the key design success tonight.

## Current project dialog screenshot state

Kitchen Remodel modal showed:

```text
Actual spent: $0
Status: Getting Bids
Files: 5

Resale Improvement · Exclusive Remodeling
Bid received. Flooring was not listed in the estimate...
```

Then:

```text
Contractors & bids

Exclusive Remodeling
Amine Rama
8326639926
Considering
$35,838
Open

DoingWhat'sRight Interiors
—
281-419-4144
Considering
—
Open

Happy House
Bubba Rednext
2813462680
Considering
$14
Open
```

Randy said:

> I'm liking where this is going. UI needs a lot of work, but I'm liking the general direction.

That is the current acceptance point.

---

# 6. Known UI / behavior problems to fix next

These are the next items, in roughly the right order.

## A. Remove stale project-level contractor display during bidding

Kitchen Remodel still shows:

```text
Resale Improvement · Exclusive Remodeling
```

above the Contractors & bids section.

That comes from legacy `HomeProject.ContractorName`.

While project is in `Getting Bids`, this is misleading because no contractor has been awarded yet.

Desired behavior:

- during bidding: do not show `HomeProject.ContractorName`
- after award: selected/awarded contractor can be shown prominently
- ideally long-term the selected ProjectContractor is authoritative, not a free-text project field

Do not rush database removal of `ContractorName` yet; just stop surfacing it incorrectly.

## B. Project status cleanup

We already removed `Bid Received` from the project dropdown in the new UI.

Keep this separation:

Project:
- Getting Bids

ProjectContractor:
- Bid Received

Need verify all status lists in both HTML and JS stay aligned.

## C. Phone formatting

Current project table shows some raw numbers:

```text
8326639926
2813462680
```

Need format consistently, e.g.:

```text
(832) 663-9926
(281) 346-2680
```

Do not alter stored value unless there is a reason. Prefer formatting for display.

## D. Contractor bidding table polish

Current table direction is good, styling is rough.

Need:
- cleaner spacing
- status as a nicer badge or compact control
- bid right-aligned / visually stronger
- Open action styled better
- maybe row hover/click behavior
- no ugly overflow/horizontal scroll

The previous over-wide grid was bad and should not return.

## E. Add Last Contact / Next Appointment

This is the most useful next functional improvement.

Randy's real workflow depends on quickly answering:

- When did I last talk to them?
- What did we discuss?
- When are they coming out?

Current ProjectContractorActivity can derive last contact.

Need decide whether appointment should be:
1. an activity with date/time and type, or
2. a first-class ProjectContractor field / scheduled event

For tomorrow's practical workflow, likely add enough UI to show:

```text
Last contact
Next appointment
```

without overengineering.

Could derive last contact from latest ProjectContractorActivity.

Appointment may deserve explicit structure later because it is future-facing, not history.

Do not casually stuff future appointment semantics into old activity history without thinking it through.

## F. Proposal history UI

A Proposals tab was added in `projects.js`.

Need test it.

Current backend supports:

```text
POST /projects/{id}/contractors/{contractorId}/proposals
PUT ...
DELETE ...
```

Proposal UI currently allows adding:
- received date
- amount
- revision label
- notes
- IsCurrent

Need eventually attach proposal PDF specifically to proposal or at minimum tie an attachment clearly to the contractor/proposal.

Right now contractor files are still attached to ProjectContractor generally.

The agreed goal is:

```text
Original proposal
Revision 2
Revision 3 - current
```

Old bid remains visible historically.

## G. Award behavior

Once `IsSelected == true`:

- project screen should show selected contractor as active
- other bidders should disappear from normal project view
- historical bidders remain available under something like:

```text
View 2 other bidders / history
```

A first implementation exists in JS, but it needs proper testing.

Also ensure only one contractor is selected per project.

## H. Global contractor list should show durable info only

Current global card can show `Vendor.Notes`.

Happy House showed:

```text
Contacted.
```

That is not ideal.

Global contractor card should not prominently surface transient project-state notes.

Keep global card closer to:
- company
- phone
- primary contact
- maybe website/address

Project-specific status and discussions belong inside ProjectContractor context.

## I. UI style classes are mixed

The app already uses:

```text
primary-btn
secondary-btn
```

but some dynamic contractor UI uses:

```text
primary-button
secondary-button
modal-header
modal-close
```

These came from earlier JS-generated dialogs.

The screens work, but visual consistency is poor.

Eventually normalize to Home Excursion's existing visual language rather than keeping ad hoc inline styles everywhere.

Do not spend a whole day on CSS before the workflow is right.

---

# 7. Project closure next steps

Backend exists, UI does not.

Need future project detail section for closure / punch list.

Likely visible when project reaches a closing-type state.

Closure item fields:

- description
- status
- due date
- notes

Statuses:

- Planned
- In Progress
- Waiting
- Complete
- Cancelled

Desired rule discussed:

> project closes only when all remaining closure items are Complete or Cancelled

No enforcement exists yet.

Do not implement hard enforcement until UI and exact project closure statuses are settled.

Randy explicitly does not like `Substantially Complete`.

---

# 8. Multi-property / Momma's property

This is the next major feature after contractor/project workflow is stable enough.

Randy's mother owns a nearby rental property.

First likely project:

```text
Exterior / Siding Replacement
```

The siding is in bad shape and likely needs HardiePlank/new siding around much of the house.

This should be a second `Property`, not a project under Randy's current house.

Current dashboard still selects the first active property:

```csharp
.Where(p => p.IsActive)
.OrderBy(p => p.Id)
.FirstOrDefaultAsync(...)
```

So multi-property is not ready yet.

Planned next branch after contractor work:

```text
feature/multi-property
```

Minimum scope:
- property selector
- selected property context
- persist selected property in browser
- projects/tasks/purchases load for selected property
- add/edit property
- create Momma's property
- create siding project

Do not overbuild ownership/accounting.

"Momma won't wait" was the reason to get contractor/bidding workflow useful quickly.

---

# 9. Files / branch / git state reminders

## Branch

```text
feature/project-contractors
```

## Known committed checkpoint

```text
304e9a1 Refactor contractor project lifecycle
```

That commit includes backend lifecycle refactor.

## Likely uncommitted after that checkpoint

At minimum tonight's later work likely includes:

- Vendor.IsContractor changes
- AddVendorContractorFlag migration + designer + snapshot
- current `index.html`
- current `projects.js`
- possibly other modified backend files from contractor filtering

Before doing anything destructive tomorrow, run:

```powershell
git status --short
```

and inspect.

Do not assume everything after commit `304e9a1` is committed.

## Production

None of tonight's contractor lifecycle work should be considered deployed to production yet.

Do not merge/deploy until:
- local UI accepted
- contractor creation tested
- contacts tested
- project association tested
- activity tested
- proposal history tested enough
- selected/award behavior tested
- migrations reviewed
- build clean
- branch checkpointed

---

# 10. First thing to do tomorrow

Do not redesign from scratch.

Start with current working local UI.

Recommended first sequence:

1. `git status --short`
2. Launch local Home Excursion and confirm current screen still matches tonight:
   - Contractors list contains DWR, Exclusive, Happy House
   - Kitchen Remodel has three associated contractors
3. Fix stale project meta:
   - hide `HomeProject.ContractorName` while status is Getting Bids / before award
4. Add display phone formatting
5. Add Last Contact to the project contractor summary
6. Decide minimal Next Appointment representation
7. Polish contractor grid only enough to make it comfortable
8. Test `Open` contractor details:
   - Overview
   - Contacts
   - Activity
   - Proposals
   - Files
   - Notes
9. Test add activity
10. Test add proposal / revised proposal / current proposal
11. Test awarding one contractor and confirm other bidders become history
12. Only after that, checkpoint commit
13. Then move toward multi-property / Momma's siding project

---

# 11. Critical design principles not to lose

## Contractor vs project

Never recreate contractor/company data inside project UI.

Global contractor:
- reusable company data

ProjectContractor:
- relationship for one project

## Status ownership

Project:
- `Getting Bids`

ProjectContractor:
- `Bid Received`

Do not cross those again.

## Bid history

Old proposal stays historical.

New proposal can become current.

Do not overwrite history.

## After award

Losing bidders should not clutter normal project management.

Keep history accessible, not prominent.

## Closure

Completion includes closure punch list.

Do not equate “work looks done” with “project closed.”

## Home Excursion product philosophy

Home Excursion exists to help Randy get real work done:

> Get the house ready. Control spending. Get it sold. Move on.

Do not turn contractor management into an overbuilt CRM.

Build only what helps with actual calls, bids, appointments, project execution, and closure.

---

# 12. One practical UX idea for tomorrow morning

The best procurement-phase project screen probably wants to feel like this:

```text
Kitchen Remodel
Status: Getting Bids

Contractors / Bidders
---------------------------------------------------------------
Exclusive Remodeling
Amine Rama · (832) 663-9926
Bid Received · $35,838
Last contact: Sep 8, 8:04 PM
Next appointment: —
[Open]

DoingWhat'sRight Interiors
281-419-4144
Considering
Last contact: —
Next appointment: —
[Open]

Happy House
Bubba Rednext · (281) 346-2680
Considering · $14 test bid
Last contact: —
Next appointment: —
[Open]
---------------------------------------------------------------
+ Add contractor
```

Then opening one contractor gives a focused detail screen:

```text
Overview
Contacts
Activity
Proposals
Files
Notes
```

After award, the project view should change emphasis:

```text
Selected Contractor
Exclusive Remodeling
$35,838
Scheduled / In Progress

[Open contractor]

View other bidders / bid history
```

That is the direction Randy liked tonight.

---

# 13. Randy interaction / workflow reminders

- Randy prefers direct action over explanation.
- When he says “Prompt = stop talking and get to work,” modify the files.
- One step at a time when running migrations/builds.
- Do not dump a giant checklist on him unless he asks.
- JS replacements must be downloadable as `.js.txt`, not plain `.js`.
- Current work is real-life-driven, not a hobby CRM.
- He likes the current architectural direction and wants UI polish next, not another model reset.
