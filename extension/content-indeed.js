// Indeed-specific content script.
//
// Known limitation: many Indeed listings redirect off-site to the employer's
// own application system when you click Apply. This script still logs the
// click and whatever job details are on the Indeed page at that moment
// (title/company/location), even if you're then taken elsewhere to finish
// applying. It cannot see what happens after the redirect.

attachApplyListener('indeed');
