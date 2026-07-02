# System 1 Estimate Tab Blueprint

## What the workbook actually is

`Master Estimate Sheet1.xlsx` is not just a price sheet. It is a full estimating engine with three major layers:

1. Material pricing and takeoff rows
2. Labor-hour calculations derived from those material rows
3. Final bid rollups for overhead, profit, fees, PE stamp, bond, and total bid

The workbook is a single sheet, `System 1`, with the main total driven by the top summary area and the material catalog living in rows `131-1155`.

## Current app state

- The job page already exposes an `Estimate` tab entry point.
- The current worktree version of `components/EstimateTab.tsx` is a placeholder.
- The repo also contains a recently removed estimate implementation in git history, including:
  - a workbook-backed estimate engine
  - estimate API routes
  - estimate revisions
  - PDF export
  - a Prisma-backed per-job estimate record

That removed implementation is the fastest path to rebuilding this feature because it already matches the workbook structure closely.

## Workbook breakdown

### 1. Project and top-level inputs

Rows `1-5` hold project metadata:

- date
- estimator
- project name
- system number
- location
- bid due date

These should map to a `project` section in the estimate draft.

### 2. Final pricing summary

Rows `7-123` are the estimating control center. Important cells:

- `F7` = material subtotal
- `F8` = sales tax amount
- `F9` = material inflation amount
- `F10` = total material cost
- `F98` = subtotal before overhead/profit
- `F99` = overhead dollars
- `F101` = profit dollars
- `F116` = subcontract/misc subtotal
- `F117` = subs markup
- `F119` = fees
- `F121` = PE stamp
- `F122` = bond
- `F123` = total cost / final estimate

If the client only needs the final number, `F123` is the number they should see.

### 3. Field labor is derived from material quantities

The field section is not manual-only. It uses workbook formulas tied to material rows.

Examples:

- Row `15` (`1"-2" Sch 40`) sums material rows `337, 338, 339, 340, 365, 366, 367, 368, 369`
- Row `22` (`1"-2" Thinwall`) sums material rows `347, 348, 349, 357, 358, 359, 376, 377, 378, 386, 387, 388`
- Row `39` (`Exposed`) pulls sprinkler count from material row `183`
- Row `40` (`Concealed`) pulls from row `260`
- Row `49` (`Riser Nipples`) pulls from rows `423-433`
- Row `55` (`Fire Pump`) is triggered from row `965`

This means your estimate tab should not treat labor as independent rows. Labor should be recomputed whenever mapped material quantities change.

### 4. CPVC labor is formula-driven too

Rows `31-36` calculate CPVC labor from many CPVC fitting rows in the material catalog.

Examples:

- `3/4 - 1 CPVC` uses 68 referenced material rows
- `1-1/4 CPVC` uses 36 rows
- `1-1/2 CPVC` uses 33 rows

This is another reason to keep the workbook logic in a calculation engine instead of rebuilding formulas manually in React.

### 5. Material catalog

Rows `131-1155` are the material catalog and takeoff table.

Major sections include:

- Exposed Sprinklers
- Attic Sprinklers
- Special Sprinklers
- Recessed Sprinklers
- Concealed Sprinklers
- Dry Sprinklers
- Pipe
- Riser Nipples and Tees
- Grooved Fittings
- Screwed Fittings
- Hanger Ring, Rod and C-clamp
- Backflow Devices
- Hose Equipment
- Misc. & Devices
- Pump Equipment
- CPVC

Each item row typically has:

- quantity cell
- description
- default unit price
- line total

The workbook material subtotal is `F1155 = SUM(F133:F1154)`.

## Best implementation model for this app

### Server-side estimate draft

Store one estimate draft per `(jobNumber, listNumber)` with sections like:

- `meta`
- `project`
- `inputs`
- `rates`
- `field`
- `shop`
- `design`
- `materials`
- `subsAndFees`
- `summary`
- `parity`
- `changeOrders`

The removed implementation already used this structure well.

### Visible estimate lines from job items

Build estimate lines from the job's real line items:

- part number
- description
- quantity needed
- manual quantity override
- database unit price
- manual unit price override
- mapped workbook row
- line total

This lets you keep the estimate tied to the actual job instead of typing the job twice.

### Workbook row mapping

Not every job line item will automatically match a workbook row cleanly, so each visible line needs:

- `candidateRowKeys`
- selected `workbookRowKey`
- mapping status: `resolved`, `unmapped`, `ambiguous`, `conflict`

That mapping layer is what connects your job parts to the workbook formulas.

### Pricing sources

Use this order:

1. Manual unit price override on the estimate line
2. Parts database cost
3. Workbook default price
4. Block export if no price is available

Your app already has part pricing APIs and part cost data, so this fits the existing system.

## Recommended architecture

### 1. Calculation engine

Use a workbook/formula engine on the server, not React formulas.

Best fit here:

- `HyperFormula`

Why:

- the removed implementation already used it
- the workbook is formula-heavy
- labor depends on material rows
- summary totals depend on many intermediate cells

### 2. Template layer

Create a `system1` template module that owns:

- workbook sheet snapshot
- row metadata
- material row definitions
- summary cell map
- field/shop/design input cell maps
- helper functions for mapping parts to workbook rows

### 3. Service layer

Create a service that:

- loads the job lines for one job/list
- creates a default estimate if none exists
- synchronizes estimate lines with current job items
- pulls pricing from the parts database
- computes the workbook output
- saves the draft and summary totals

### 4. API routes

Recommended routes:

- `GET /api/jobs/[jobNumber]/estimate`
- `PUT /api/jobs/[jobNumber]/estimate`
- `POST /api/jobs/[jobNumber]/estimate/recalculate`
- `GET /api/jobs/[jobNumber]/estimate/revisions`
- `POST /api/jobs/[jobNumber]/estimate/revisions`
- `POST /api/jobs/[jobNumber]/estimate/revisions/[revisionId]/restore`
- `GET /api/jobs/[jobNumber]/estimate/pdf`

### 5. UI split

Split the tab into two modes:

- `Estimate`
  - client-safe summary
  - final bid
  - material / labor / design / fees breakdown
  - export/share output
- `Settings`
  - workbook row mapping
  - manual overrides
  - rates
  - design / shop / field adjustments
  - revision management

## What the client should see

For client visibility, do not show the whole spreadsheet interface.

Show:

- project name
- job number / list
- final estimate value
- optional breakdown:
  - material
  - field labor
  - shop labor
  - design
  - subcontract / misc
  - fees
  - overhead
  - profit
- change orders, if used

The client-facing total should come from the computed summary `totalCost` which mirrors workbook cell `F123`.

## Practical implementation path

### Phase 1

Restore or recreate the non-UI estimate core first:

- estimate types
- `system1` template metadata
- HyperFormula compute engine
- estimate service
- API routes

### Phase 2

Restore the estimate tab UI for internal users:

- summary card
- material line mapping
- manual price overrides
- design / field / shop input sections
- parity blockers

### Phase 3

Add client-facing output:

- simplified estimate summary card
- printable/exportable PDF
- optional approval/change-order workflow

## Important implementation rules

- Only allow estimating against one specific list, not `All Lists`
- Recompute labor automatically from mapped material quantities
- Save estimate drafts separate from job line items
- Keep a revision history before restores or major edits
- Block export when price or workbook mapping is missing
- Show the client a clean final number, not workbook cells

## Best next step in this repo

The best next step is not to design this from zero. It is to reintroduce the removed estimate engine and API architecture, then adapt the current placeholder tab to use it.

That is the shortest path to:

- exact workbook parity
- final client-facing estimate total
- automatic material-to-labor rollups
- per-job saved estimates
