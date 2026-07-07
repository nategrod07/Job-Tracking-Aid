// LinkedIn-specific content script.
// LinkedIn's class names change frequently, so JSON-LD / generic extraction
// (from common.js) is the primary path. This file just wires up the listener.
//
// Known limitation: LinkedIn's "Easy Apply" opens a modal that can span
// multiple steps. This captures the moment you click "Easy Apply" or "Apply",
// not necessarily final submission of a multi-step Easy Apply modal.

attachApplyListener('linkedin');
