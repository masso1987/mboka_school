# User acceptance checklist

Run on a staging copy before each school goes live, with the school's own staff at the keyboard.
Each line states the expected result; tick it only when observed. The **Automated** column names the
regression test that guards the same behaviour (`apps/api/test/*.e2e-spec.ts`), so a failure seen in UAT
but not in CI means a test is missing.

Accounts needed: director, principal, teacher (assigned to one class), cashier/accountant, parent,
student, and a second school's director.

## Workflows (spec §5)

### A. Admission to enrollment — Students

| # | Step | Expected | Automated |
|---|---|---|---|
| A1 | Register an application, move it to accepted | Only allowed transitions are offered | `phase1` admissions transitions |
| A2 | Create the student with a guardian | Matricule generated; guardian reused for a sibling | `phase1` STD-006 |
| A3 | Create a student with the same name and birth date | Possible duplicate flagged; saved only once confirmed | `phase1` STD-012 |
| A4 | Enroll in a class, then try a second active enrollment for the same year | Second enrollment refused | `phase1` enrollment |
| A5 | Fee schedule applied to the class | One invoice per enrollment, even if applied twice | `finance` bills once |

### B. Daily attendance — Attendance

| # | Step | Expected | Automated |
|---|---|---|---|
| B1 | Teacher opens today's register for their class | Students of the class only; future dates refused | `phase1` register |
| B2 | Teacher opens another class's register | Refused | `phase1` scenario 2 |
| B3 | Mark an absence and save | Linked parents notified once that day | `community` ATT-006 |
| B4 | Change a saved mark | Reason required; correction audited | `phase1` ATT-005 |
| B5 | **Offline**: cut the network (browser devtools or airplane mode), take the register, save | "Offline" badge, "1 waiting"; the register stays on screen | manual |
| B6 | Reload the page while still offline | The saved copy of the register is shown with the offline notice | manual |
| B7 | Restore the network | Sent automatically (or with "Sync"); badge clears; server shows the register once | `phase1` scenario 8 |
| B8 | Sign out with an unsynchronised register | Warning with the count; confirming erases the local copy | manual |

### C. Assessment to report card — Grades

| # | Step | Expected | Automated |
|---|---|---|---|
| C1 | Create an assessment; enter marks; one above the maximum | Out-of-range mark refused | `grades` ranges |
| C2 | Close the tab mid-entry and reopen | "Draft restored" banner with the unsaved marks | manual |
| C3 | Import a CSV with one bad row | Nothing imported; the bad row is named | `grades` CSV |
| C4 | Submit; approve as the same user | Self-approval refused; another reviewer approves | `grades` approve |
| C5 | Generate and publish report cards; download the PDF; check the verification code publicly | Figures match the hand calculation; code verifies | `grades` term results, verify |

### D. Tuition payment — Finance

| # | Step | Expected | Automated |
|---|---|---|---|
| D1 | Cashier opens the register, takes a partial cash payment | Balance reduced; receipt issued | `finance` partial payment |
| D2 | Press "Record" twice quickly | One payment only | `finance` scenario 3 |
| D3 | Pay an XAF invoice in EUR | Converted at the rate in force on the payment date | `finance` cross-currency |
| D4 | Mobile Money: provider confirms twice | Confirmed once | `finance` callback repeats |
| D5 | Close the cash session with a wrong count | Gap reported | `finance` cash gap |

### E. Annual financial close — Finance

| # | Step | Expected | Automated |
|---|---|---|---|
| E1 | Close the period; try to post into it | Refused | `finance` closed period |
| E2 | Reverse a payment from the closed period | Reversal booked in the open period; closed figures unchanged | `finance` scenario 11 |
| E3 | Refund request approved by its requester | Refused | `finance` refunds |

### F. Academic year rollover — Academics

| # | Step | Expected | Automated |
|---|---|---|---|
| F1 | Record class-council decisions; open rollover preview to next year | Each student mapped; missing decisions or target classes listed as exceptions | `phase5` rollover preview |
| F2 | Commit while exceptions remain | Refused (`ROLLOVER_HAS_EXCEPTIONS`) | `phase5` |
| F3 | Resolve exceptions; commit | Students enrolled in the new year; graduates marked graduated | `phase5` |
| F4 | Commit again | Nothing duplicated (all "already enrolled") | `phase5` scenario 7 |

## Mandatory scenarios (spec §13.2)

| # | Scenario | Expected | Automated |
|---|---|---|---|
| 1 | Another school's student | 404, identical to an unknown id | `tenant-isolation` scenario 1, `phase1` hides students |
| 2 | Teacher edits marks outside their assignment | 403 | `grades` scenario 2, `phase1` scenario 2 |
| 3 | Same payment submitted twice | One payment (idempotency key) | `finance` scenario 3 |
| 4 | Provider repeats a callback | Confirmed once; unsigned or wrong amount rejected | `finance` callbacks |
| 5 | Report card regenerated after rules change | Published card unchanged and reproducible; new version only if content changes | `grades` scenario 5 |
| 6 | Transfer between classes or schools | Old enrollment closed, new one opened; transfer out keeps the record | `phase1` change class, transfer out |
| 7 | Year rolled over twice | No duplicate enrollment | `phase5` scenario 7 |
| 8 | Connectivity lost during attendance | Saved locally, sent once on return; conflicts reported, never overwritten | `phase1` scenario 8, conflict; UAT B5–B8 |
| 9 | Private document without permission | Report-card PDF of another child: 404; compensation: 403 | `community` parent/student isolation, compensation |
| 10 | Tenant suspended with queued work | All access blocked, data kept; queued e-mails stay pending (sending requires an active school) | `tenant-isolation` suspended |
| 11 | Reversal after period close | Booked in the open period | `finance` closed period |
| 12 | Import with duplicate matricules / invalid references | Rejected with the faulty rows named | `phase1` scenario 12, `grades` CSV |

## Security and operations

| # | Step | Expected | Automated |
|---|---|---|---|
| S1 | Platform admin signs in for the first time | Must set up two-factor authentication before anything else | `phase5` |
| S2 | Sign in with MFA; reuse the same code within 30 s on another device | Second use refused | `phase5` replay |
| S3 | Use a recovery code twice | Second use refused | `phase5` |
| S4 | Director turns on "Require two-factor for sensitive roles"; accountant without MFA opens the school | Asked to set up two-factor first | `phase5` |
| S5 | Change password | Other devices signed out | `phase5` |
| S6 | Account → Sessions → sign out another device | That device is signed out at its next request | `phase5` |
| S7 | Director exports school data | JSON file downloaded; audit entry with row counts; no password hashes | `phase5` export |
| S8 | Operator runs `scripts/restore-test.sh` on last night's backup | "restore-test: OK" | ops ([operations.md](operations.md)) |
