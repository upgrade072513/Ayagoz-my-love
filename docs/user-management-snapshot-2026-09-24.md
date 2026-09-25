# User-management snapshot — 2026-09-24

Read-only snapshot taken before the invitation and administrator-safety refactor.

| User ID | Email | Role | Department ID | Managed blocks | Account status | Password configured |
|---:|---|---|---:|---|---|---|
| 1 | ayagoz.kulekeyeva@nu.edu.kz | admin | — | — | active | yes |
| 12390001 | akmaral.satibayeva@nu.edu.kz | manager | — | Блок А4 | active | no |

No legacy `user`, `viewer`, or `auditor` role values were present in the production snapshot. Existing `role`, `departmentId`, and `managedBlocks` values are preserved as the baseline for regression checks.

This file contains no password hashes, reset tokens, session tokens, or other authentication secrets.

Источник: read-only query of the Rental Management production database before the user-management refactor.

## Expected invariants

- User 1 remains an active `admin`.
- User 12390001 remains an active `manager` assigned to `Блок А4`.
- Password setup/reset changes only authentication fields and never role, department, or managed blocks.
- At least one active administrator remains at all times.
