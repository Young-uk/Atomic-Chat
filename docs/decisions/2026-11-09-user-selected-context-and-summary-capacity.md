# User-selected context and proportional summary capacity

Status: accepted

## Problem

Strata's application controls and settings validator rejected contexts above 64K. Its separate summary bank also had a fixed 1.3 GB budget. Dstar's application controls imposed 512K and its summary adapter rejected payloads above 4 GiB. These policy ceilings prevented users from choosing a context that their hardware could accommodate.

## Decision

Keep the saved/default context at 65,536 tokens. Accept explicit larger contexts in both engine controls up to the native signed-position representation bound, reserving the existing 8K task headroom and 128 cells for padding. Retain each engine's existing minimum and actual resource/allocation checks.

Strata's summary-bank allowance retains the validated 1.3 GB base through 64K and increases by 14,208 bytes per extra context token. This coefficient covers the twelve native mutable attention layers; the base retains fixed recurrent state and descriptor/alignment margin. The native bank still measures actual allocation and checks current memory admission. The qualification script validates the derived allowance and restores both baseline context and baseline allowance before checking immutable 64K runtime pins. Projected context and bank allowance are fingerprinted together.

Dstar's summary adapter uses source validity and destination context capacity, with native copy/load validation, instead of an independent 4 GiB payload ceiling. The existing summary output budget, foreground scheduling and disk retention policy remain independent of context selection.

## Validation

Use model-free tests for UI values above the former caps, settings persistence, integer overflow rejection, derived bank capacity and a mocked payload above 4 GiB. Verify multiple projected contexts in the actual GUI launch environments. Build and run the application and native regression checks. Do not start a large-context model or change the user's saved 64K selection as a test; hardware inference validation remains user-driven.
