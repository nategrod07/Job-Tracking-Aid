// Handshake-specific content script.
//
// Known limitation: Handshake often requires login/school affiliation, and
// its DOM structure is less publicly documented than LinkedIn/Indeed, so
// generic JSON-LD/meta extraction (from common.js) is doing most of the work
// here. Selectors may need tuning based on what you actually see on the page.

attachApplyListener('handshake');
