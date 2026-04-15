# Task Plan

## Goal

Fix the README use-case visual so it renders reliably on GitHub, then update the existing docs commit with the corrected asset and README reference.

## Assumptions

- GitHub's SVG rendering is not trustworthy enough for this text-heavy asset because font metrics and layout are causing copy to overlap.
- A raster asset is the safest fix for a README hero/supporting graphic that must look identical across GitHub clients.
- The rest of the README structure is fine; only the problematic visual and its reference need to change.

## Success Criteria

- [x] The README no longer references the broken SVG asset.
- [x] A stable replacement visual is added under `docs/readme/`.
- [x] The new image is visually verified locally before commit.
- [x] The fix is committed and pushed to GitHub.
- [x] `tasks/todo.md` reflects the final state of the work.

## Execution Plan

- [x] Step 1 -> verify: Confirmed the current README reference and the GitHub-specific failure mode of the SVG visual, where text layout overflowed across cards.
- [x] Step 2 -> verify: Generated a raster replacement at `docs/readme/use-cases.png` from a controlled browser-rendered layout.
- [x] Step 3 -> verify: Updated the README to reference the PNG asset and removed the fragile SVG from the active docs path.
- [x] Step 4 -> verify: Previewed the replacement image locally, committed the fix, and pushed it to GitHub.

## Review

- The GitHub rendering issue came from the text-heavy SVG relying on live font metrics and layout behavior that did not hold up in GitHub's renderer.
- Replacing it with a PNG locks the layout and makes the README visual deterministic across GitHub surfaces.
- Verification completed locally by previewing the generated PNG and running `npm run build`.
- The PNG-based fix has been committed and pushed.
