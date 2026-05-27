# Analysis Results Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bottom analysis result drawer with a modal dialog while preserving result layer controls.

**Architecture:** Keep result state in `frontend/src/main.tsx`. Replace the bottom drawer markup with a modal controlled by `resultsOpen`, and update CSS from a grid bottom row to overlay dialog styles.

**Tech Stack:** React, TypeScript, CSS, Vite, node:test.

---

## File Structure

- Modify: `frontend/src/main.tsx`
  - Add modal open state, open/close behavior, result modal markup, and remove bottom drawer section.
- Modify: `frontend/src/styles.css`
  - Remove fixed bottom drawer layout assumptions and add modal overlay/dialog/result list styles.
- Modify: `frontend/src/cesiumHelpers.test.ts`
  - Add source regression tests for modal markup and removal of bottom drawer.

## Task 1: Add Regression Tests

**Files:**
- Modify: `frontend/src/cesiumHelpers.test.ts`

- [ ] **Step 1: Add modal source test**

Add this test:

```ts
test('analysis results render as a modal instead of a bottom drawer', () => {
  const mainSource = fs.readFileSync(path.resolve('src/main.tsx'), 'utf8');
  const cssSource = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');
  assert.ok(mainSource.includes('resultsOpen'));
  assert.ok(mainSource.includes('result-modal-backdrop'));
  assert.equal(mainSource.includes('className="result-drawer"'), false);
  assert.ok(cssSource.includes('.result-modal-backdrop'));
  assert.ok(cssSource.includes('.result-modal'));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
cd frontend
npm test
```

Expected: FAIL because modal state and classes do not exist yet.

## Task 2: Implement Result Modal

**Files:**
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Add labels and state**

Add `openResults` and `closeResults` labels. Add:

```ts
const [resultsOpen, setResultsOpen] = useState(false);
```

- [ ] **Step 2: Open modal after analysis completes**

In both analysis success branches, replace `setAnalysisTab('results')` with `setResultsOpen(true)`.

- [ ] **Step 3: Change results tab button behavior**

Keep the right-side results tab, but make it open the modal:

```tsx
<button type="button" className="secondary" onClick={() => setResultsOpen(true)}>{ui.results}</button>
```

- [ ] **Step 4: Replace drawer with modal**

Remove the `<section className="result-drawer">...</section>` and add conditional modal markup:

```tsx
{resultsOpen && (
  <div className="result-modal-backdrop" role="presentation" onClick={() => setResultsOpen(false)}>
    <section className="result-modal" role="dialog" aria-modal="true" aria-labelledby="analysis-results-title" onClick={(event) => event.stopPropagation()}>
      ...
    </section>
  </div>
)}
```

- [ ] **Step 5: Add Escape close effect**

Add a React effect that closes the modal on `Escape`.

## Task 3: Update Layout CSS

**Files:**
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Remove bottom row assumptions**

Change `.platform-app` to a single row and set sidebars/Cesium to `height: 100vh`.

- [ ] **Step 2: Replace drawer styles**

Replace `.result-drawer` and drawer-specific placement with `.result-modal-backdrop` and `.result-modal`.

- [ ] **Step 3: Keep result row styles**

Keep `.result-list`, `.result-row`, `.result-title`, `.mini-check`, and `.mini-range`, with mobile-friendly modal sizing.

## Task 4: Verify

**Files:**
- No direct edits.

- [ ] **Step 1: Run frontend tests**

Run:

```powershell
cd frontend
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run frontend build**

Run:

```powershell
cd frontend
npm run build
```

Expected: build exits with code 0.
