import { installBridge, setFlag } from './mainWorld';

/**
 * Main-world entry for Google Docs. Runs at `document_start`.
 *
 * Main-world content scripts have no access to `chrome.*`, so the extension id
 * cannot be read here. That turns out not to matter: the gate Google evaluates
 * is `flags.Pa("kix-ealct") || _docs_annotate_canvas_by_ext !== ""` — any
 * non-empty string opens it, and the value is recorded to telemetry rather than
 * checked against a list.
 *
 * A stable identifier is used rather than a borrowed one. Several projects in the
 * wild set Grammarly's extension id here, which works precisely because nothing
 * validates it; naming ourselves keeps Google's telemetry accurate and means a
 * future rule change is something we find out about honestly.
 */
const MR_CLIPPY_ID = 'mr-clippy-lorecraft-io';

setFlag(MR_CLIPPY_ID);
installBridge(MR_CLIPPY_ID);
