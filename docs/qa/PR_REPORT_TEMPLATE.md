# PR verification report template

Post as a PR comment, then call `set_my_status` / message ALAN per the HQ rules.
S1 findings are also sent to ALAN directly, without waiting for the report.

```
## QA report: [MF-Txx] <title> (#<pr>)

**Verdict: PASS | FAIL**
Commit tested: <sha>   Date: <yyyy-mm-dd>   Tester: REYKI
Environment: local, `supabase db reset` run: yes/no

### 1. Automated checks
| Check | Result | Notes |
|---|---|---|
| pnpm typecheck | pass/fail | |
| pnpm lint | pass/fail | |
| pnpm test | pass/fail | n passed / n failed |
| pnpm build | pass/fail | |
| supabase db reset | pass/fail/n.a. | |
| supabase test db | pass/fail/n.a. | n tests |
| Playwright | pass/fail/n.a. | |

### 2. Acceptance criteria
| # | Criterion (from task) | Test case ID | Result | Notes |
|---|---|---|---|---|

### 3. Manual exploration
Users/restaurants used: <list>. What was tried, one line each.

### 4. Security checklist (docs/qa/M0-test-plan.md §7)
Mark each item pass / fail / n.a. Only list n.a. with a reason.

### 5. Quality
Loading / empty / error states · mobile width (~400px) · keyboard & focus · Rupiah formatting.

### 6. Not tested
<anything skipped and why>

### 7. Bugs
| ID | Title | Severity | Status |
|---|---|---|---|
(link each to a full report using docs/qa/BUG_TEMPLATE.md)
```

Rules: FAIL if any acceptance criterion fails, any S1/S2 is open, or any automated check fails.
If a check cannot run (for example Docker unavailable), say so under "Not tested"; never mark it pass.
