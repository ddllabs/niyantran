# Mandatory CI for merges and deployments

> **Status: Living.** Authorized 2026-10-21.

## Current state and problem
GitHub Actions runs Build and tests and SQL fixtures (disposable Postgres) on
pushes and pull requests. main has no protection. Vercel builds independently.
The latest audit found passing CI but no enforcement.

## Outcome and acceptance
Require both existing GitHub Actions jobs, from the GitHub Actions app, on
up-to-date pull requests before main merges, including administrators. Block
force pushes and deletion. No additional human review requirement is introduced.
Use native Vercel project checks for the exact deployed commit in Preview and
Production. Vercel API currently supports deployment-alias blocking only, so
builds run in parallel but domain assignment waits for CI. Missing, pending, cancelled
or failed CI must not release a deployment. Verify API readback and an isolated
Preview execution; keep the existing Production deployment and keys unchanged.

## Scope and exclusions
GitHub main protection, Vercel project CI checks, CI policy comments, and agent
workflow documentation only. No application, billing, database, environment,
credential or Production release changes. Preserve task/razorpay-plan. Native
provider limitations must be reported rather than hidden behind bypasses.
