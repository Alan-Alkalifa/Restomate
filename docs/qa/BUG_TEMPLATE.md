# Bug report template

Copy into a PR comment or an HQ message. One bug per report.

## Severity

| Level | Definition | Examples | Action |
|---|---|---|---|
| **S1** | Data leak, permission bypass, payment error, or a blocker (milestone cannot proceed) | Org A user reads org B rows; cashier invites staff; secret in browser bundle; build broken on main | Message ALAN **immediately**; PR is FAIL |
| **S2** | Broken feature, no workaround on the main path | Invite link never accepts; onboarding fails for valid input | PR is FAIL |
| **S3** | Minor: works with a workaround, or wrong on an edge path | Wrong error message; slug check slow; mobile layout overflows | Fix before milestone exit; may merge by ALAN's call |
| **S4** | Cosmetic | Spacing, copy, icon | Backlog |

## Template

```
### [BUG] <short title>

- Severity (guess): S1 | S2 | S3 | S4
- Task / PR: MF-Txx / #<pr>
- Environment: local | commit <sha> | browser <name+version> | viewport <WxH>
- Test case ID: M0-...  (if any)

**User / role / restaurant**
<e.g. cashier@demo.local, Demo Restaurant (org A); attacker owner@other.local, Other Bistro (org B)>

**Steps to reproduce**
1.
2.
3.

**Expected**
<from acceptance criterion / PLAN / PROJECT section>

**Actual**
<what happened; exact error text, HTTP status, SQL error code>

**Evidence**
<logs, curl/psql output, screenshot path, trace file. NO secrets or real personal data>

**Notes**
<suspected area, if known. Do not propose or push a fix: QA does not change app code>
```
