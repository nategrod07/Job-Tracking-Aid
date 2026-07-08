// No-AI resume/job matching: skill-dictionary + alias matching against job
// descriptions, scored by a simple importance heuristic, compared against
// resume text (itself matched alias-aware, not just literal substring), plus
// a fill-in-the-blank cover letter draft with a few selectable tones.
// Everything here is deterministic string processing over data in
// skills-data.js — no API calls, no cost, nothing leaves the browser.

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// canonical skill -> every surface form that should count as a match for it
// (the dictionary name itself, plus any aliases), longest-first so longer
// phrases aren't accidentally shadowed by a shorter one during scanning.
const SKILL_SURFACE_FORMS = buildSurfaceForms();

function buildSurfaceForms() {
  const bySkill = new Map();
  const addForm = (canonical, form) => {
    if (!bySkill.has(canonical)) bySkill.set(canonical, new Set());
    bySkill.get(canonical).add(form);
  };
  for (const canonical of SKILL_DICTIONARY) addForm(canonical, canonical);
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    addForm(canonical, canonical);
    for (const alias of aliases) addForm(canonical, alias);
  }
  const result = new Map();
  for (const [canonical, forms] of bySkill.entries()) {
    result.set(canonical, [...forms].sort((a, b) => b.length - a.length));
  }
  return result;
}

// Uses lookaround instead of \b: \b fails at either edge of a term that
// starts or ends on a non-word character (e.g. "C++", "C#", ".NET" would
// never match with a plain \b...\b pattern, since \b requires a word/non-word
// transition and the term's own edge character is already non-word).
// Lookaround only constrains the *surrounding* context, so it works
// uniformly regardless of the term's own first/last character.
function surfaceRegex(surface, flags) {
  return new RegExp(`(?<![A-Za-z0-9_])${escapeRegex(surface)}(?![A-Za-z0-9_])`, flags);
}

function textHasSkill(text, canonical) {
  const forms = SKILL_SURFACE_FORMS.get(canonical) || [canonical];
  return forms.some((form) => surfaceRegex(form, 'i').test(text));
}

// How far (in characters) around a match to look for "required" vs.
// "nice to have" language when scoring importance.
const SIGNAL_WINDOW = 120;
const HIGH_SIGNAL_PHRASES = [/required/i, /must have/i, /must possess/i, /minimum qualifications/i, /basic qualifications/i, /you have/i];
const LOW_SIGNAL_PHRASES = [/nice to have/i, /preferred/i, /\ba plus\b/i, /\bbonus\b/i, /ideally/i];

function scanSkillOccurrences(text, canonical) {
  const forms = SKILL_SURFACE_FORMS.get(canonical) || [canonical];
  let count = 0;
  let earliest = Infinity;
  let highSignal = false;
  let lowSignal = false;

  for (const form of forms) {
    const re = surfaceRegex(form, 'gi');
    let m;
    while ((m = re.exec(text))) {
      count++;
      if (m.index < earliest) earliest = m.index;
      const window = text.slice(Math.max(0, m.index - SIGNAL_WINDOW), Math.min(text.length, m.index + m[0].length + SIGNAL_WINDOW));
      if (!highSignal && HIGH_SIGNAL_PHRASES.some((p) => p.test(window))) highSignal = true;
      if (!lowSignal && LOW_SIGNAL_PHRASES.some((p) => p.test(window))) lowSignal = true;
      if (re.lastIndex === m.index) re.lastIndex++; // guard against zero-length matches looping forever
    }
  }
  return { count, earliest, highSignal, lowSignal };
}

// Heuristic 3-tier priority rather than a fake-precise percentage — this is
// still a heuristic, and a tier label is honest about that precision level.
function tierFromScore(occ) {
  if (occ.count === 0) return null;
  let score = Math.min(occ.count, 3);
  if (occ.earliest < 200) score += 1; // mentioned early (title/intro line)
  if (occ.highSignal) score += 2;
  if (occ.lowSignal) score -= 1;
  if (score >= 4) return 'High';
  if (score >= 2) return 'Medium';
  return 'Low';
}

// Pulls candidate keywords out of a job description: every dictionary/alias
// skill that appears at least once (scored and tiered), plus capitalized
// tokens that repeat and aren't already covered — catches specific
// tools/products no dictionary will ever fully enumerate.
function extractKeywords(jobDescription) {
  const text = jobDescription || '';
  const found = new Map(); // canonical/token -> tier

  for (const canonical of SKILL_SURFACE_FORMS.keys()) {
    const occ = scanSkillOccurrences(text, canonical);
    if (occ.count > 0) found.set(canonical, tierFromScore(occ));
  }

  const wordFreq = {};
  const tokens = text.match(/\b[A-Z][a-zA-Z0-9+.#]{2,}\b/g) || [];
  for (const w of tokens) wordFreq[w] = (wordFreq[w] || 0) + 1;

  const foundLower = new Set([...found.keys()].map((k) => k.toLowerCase()));
  for (const [word, count] of Object.entries(wordFreq)) {
    const lower = word.toLowerCase();
    if (count >= 2 && !STOPWORDS.has(lower) && !foundLower.has(lower)) {
      found.set(word, count >= 3 ? 'Medium' : 'Low');
    }
  }

  return found;
}

// Pulls out "X years of experience" style phrases (e.g. "5+ years",
// "3-5 years of experience", "3 to 5 years of Python experience"). This is
// informational context about the posting's stated requirement, not a
// present/missing skill — years-of-experience doesn't fit the "do I have
// this or not" framing, so it's kept separate from extractKeywords/
// matchKeywords rather than forced into that shape.
function extractExperienceRequirements(jobDescription) {
  const text = jobDescription || '';
  const pattern = /\b\d{1,2}\s*(?:\+|-|–|to)?\s*\d{0,2}\+?\s*years?\b[^.]{0,40}?experience\b/gi;
  const found = [];
  const seen = new Set();
  let m;
  while ((m = pattern.exec(text)) && found.length < 5) {
    const cleaned = m[0].replace(/\s+/g, ' ').trim();
    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      found.push(cleaned);
    }
  }
  return found;
}

const TIER_RANK = { High: 3, Medium: 2, Low: 1 };

// Compares job-description keywords against resume text; returns which are
// already present in the resume and which are missing, each carrying a
// priority tier and sorted High-to-Low so the highest-value gaps surface
// first. Resume-side matching is alias-aware for dictionary skills (so a
// resume saying "led a team" counts toward "Leadership" even though it
// doesn't contain that literal word), and falls back to plain substring
// matching for the frequency-based tokens that have no alias entry.
function matchKeywords(jobDescription, resumeText) {
  const keywords = extractKeywords(jobDescription);
  const resume = resumeText || '';
  const resumeLower = resume.toLowerCase();
  const present = [];
  const missing = [];

  for (const [keyword, tier] of keywords.entries()) {
    const inResume = SKILL_SURFACE_FORMS.has(keyword)
      ? textHasSkill(resume, keyword)
      : resumeLower.includes(keyword.toLowerCase());
    (inResume ? present : missing).push({ keyword, tier });
  }

  const byTierDesc = (a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier];
  present.sort(byTierDesc);
  missing.sort(byTierDesc);
  return { present, missing };
}

// Best-effort guess at the resume owner's name: the first short,
// title-cased line (most resumes lead with the name).
function guessNameFromResume(resumeText) {
  if (!resumeText) return null;
  const firstLine = resumeText.split('\n').map((l) => l.trim()).find(Boolean);
  if (!firstLine) return null;
  if (/^[A-Z][a-zA-Z.'-]+(\s+[A-Z][a-zA-Z.'-]+){1,3}$/.test(firstLine)) return firstLine;
  return null;
}

function listJoin(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// Builds an editable fill-in-the-blank cover letter draft. This is
// deliberately NOT meant to be sent as-is — the bracketed sections are
// prompts for you to fill in with real specifics, not filler to delete.
// `tone` picks between a few different phrasing styles; all of them share
// the same inputs (name, top matched/missing skills by priority) so quality
// depends only on the tone chosen, not on redoing the matching.
const COVER_LETTER_TONES = ['standard', 'enthusiastic', 'concise'];

function buildCoverLetterDraft(job, resumeText, match, tone) {
  const name = guessNameFromResume(resumeText) || '[Your Name]';
  const title = job.job_title || '[Job Title]';
  const company = job.company || '[Company]';
  const sameValue = job.location && job.work_mode && job.location.toLowerCase() === job.work_mode.toLowerCase();
  const locationClause = job.location ? ` in ${job.location}` : '';
  const modeClause = job.work_mode && !sameValue ? ` (${job.work_mode})` : '';

  const topPresent = (match.present || []).slice(0, 4).map((m) => m.keyword);
  const topMissing = (match.missing || []).slice(0, 3).map((m) => m.keyword);
  const matchedList = topPresent.length ? listJoin(topPresent) : 'relevant skills';
  const firstMatched = topPresent[0] || 'these skills';
  const isIntern = job.level === 'Intern' || job.employment_type === 'Internship';

  const ctx = { name, title, company, locationClause, modeClause, matchedList, firstMatched, topMissing, isIntern, term: job.term };
  const builders = { standard: buildStandardLetter, enthusiastic: buildEnthusiasticLetter, concise: buildConciseLetter };
  const build = builders[tone] || buildStandardLetter;
  return build(ctx);
}

function buildStandardLetter({ name, title, company, locationClause, modeClause, matchedList, firstMatched, topMissing, isIntern, term }) {
  let letter = `Dear Hiring Team,\n\n`;
  letter += `I am writing to apply for the ${title} position at ${company}${locationClause}${modeClause}. `;
  letter += isIntern
    ? `As a student actively building my skills in ${matchedList}, I'm excited about the opportunity to contribute to your team${term ? ` this ${term}` : ''}.\n\n`
    : `With experience in ${matchedList}, I believe I would bring real value to your team.\n\n`;
  letter += `[Add 1-2 sentences here about a specific project, internship, or course where you used ${firstMatched}, including a concrete result or outcome.]\n\n`;
  if (topMissing.length) {
    letter += `I'm also continuing to build skills in ${listJoin(topMissing)}, which I understand are valuable for this role. `;
    letter += `[Optional: mention relevant coursework, side projects, or your plan to grow here.]\n\n`;
  }
  letter += `Thank you for considering my application. I would welcome the opportunity to discuss how my background could contribute to ${company}.\n\n`;
  letter += `Sincerely,\n${name}`;
  return letter;
}

function buildEnthusiasticLetter({ name, title, company, locationClause, modeClause, matchedList, firstMatched, topMissing, term }) {
  let letter = `Dear Hiring Team,\n\n`;
  letter += `I was genuinely excited to see the ${title} opening at ${company}${locationClause}${modeClause} — it's exactly the kind of role I've been hoping to find. `;
  letter += `My background in ${matchedList} feels like a strong match for what you're looking for${term ? ` this ${term}` : ''}.\n\n`;
  letter += `[Add 1-2 sentences here about a specific project, internship, or course where you used ${firstMatched} — what made it exciting, and what came out of it?]\n\n`;
  if (topMissing.length) {
    letter += `I'm also eager to grow further in ${listJoin(topMissing)}, and would love the chance to develop those skills with your team. `;
    letter += `[Optional: mention relevant coursework, side projects, or why this role specifically excites you.]\n\n`;
  }
  letter += `I'd welcome the chance to talk more about how I could contribute to ${company} — thank you for your time and consideration.\n\n`;
  letter += `Sincerely,\n${name}`;
  return letter;
}

function buildConciseLetter({ name, title, company, locationClause, modeClause, matchedList, firstMatched, topMissing }) {
  let letter = `Dear Hiring Team,\n\n`;
  letter += `I'm applying for the ${title} role at ${company}${locationClause}${modeClause}. Relevant background: ${matchedList}.\n\n`;
  letter += `[Add 1-2 sentences on a specific project or result involving ${firstMatched}.]\n\n`;
  if (topMissing.length) {
    letter += `Also building: ${listJoin(topMissing)}.\n\n`;
  }
  letter += `Happy to discuss further.\n\n`;
  letter += `Sincerely,\n${name}`;
  return letter;
}

// Exposed for use by dashboard.js. In a plain (non-module) script these are
// just top-level function declarations already on `window`, so nothing
// further is needed — kept here as a readable manifest of the public API.
