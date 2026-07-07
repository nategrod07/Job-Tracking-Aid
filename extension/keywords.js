// No-AI resume/job matching: a curated skill dictionary plus frequency-based
// extraction of capitalized terms (to catch tool/product names not in the
// dictionary), compared against resume text with plain substring/word
// matching. Also builds a fill-in-the-blank cover letter draft. Everything
// here is deterministic string processing — no API calls, no cost.

const STOPWORDS = new Set([
  'the', 'and', 'of', 'to', 'a', 'in', 'for', 'is', 'on', 'that', 'by', 'this', 'with', 'you', 'your',
  'it', 'not', 'or', 'be', 'are', 'as', 'at', 'from', 'we', 'our', 'will', 'an', 'have', 'has', 'their',
  'they', 'can', 'may', 'all', 'about', 'more', 'other', 'into', 'than', 'then', 'when', 'what', 'which',
  'who', 'if', 'each', 'how', 'up', 'out', 'no', 'so', 'do', 'does', 'did', 'job', 'work', 'role', 'team',
  'company', 'apply', 'applicant', 'position', 'us', 'our', 'inc', 'llc',
  // Generic job-posting boilerplate that isn't actually a skill, even
  // though it's often capitalized and repeated (e.g. in the title header).
  'software', 'engineering', 'engineer', 'intern', 'internship', 'responsibilities', 'requirements',
  'experience', 'environment', 'required', 'preferred', 'plus', 'strong', 'skills', 'qualifications',
  'summary', 'description', 'about', 'join', 'looking', 'opportunity', 'candidate', 'candidates'
]);

const SKILL_DICTIONARY = [
  // Languages
  'Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C#', 'SQL', 'R', 'Go', 'Swift', 'Kotlin',
  'Ruby', 'PHP', 'MATLAB', 'HTML', 'CSS', 'Scala', 'Rust',
  // Frameworks / platforms / tools
  'React', 'Angular', 'Vue', 'Node.js', 'Django', 'Flask', 'Spring', '.NET', 'TensorFlow', 'PyTorch',
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Git', 'Linux', 'Excel', 'Tableau', 'Power BI',
  'Salesforce', 'Jira', 'Figma', 'Photoshop',
  // Concepts
  'Machine Learning', 'Data Analysis', 'Data Science', 'Cybersecurity', 'Cloud Computing', 'Agile',
  'Scrum', 'REST API', 'Microservices', 'CI/CD', 'DevOps', 'Object-Oriented Programming',
  'Algorithms', 'Data Structures', 'A/B Testing', 'ETL', 'Statistics',
  // Soft skills
  'Leadership', 'Communication', 'Teamwork', 'Problem-solving', 'Project Management', 'Collaboration',
  'Analytical', 'Detail-oriented', 'Time Management'
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pulls candidate keywords out of a job description: dictionary terms that
// literally appear, plus capitalized tokens/acronyms that repeat (catches
// specific tools/products the dictionary doesn't know about).
function extractKeywords(jobDescription) {
  const text = jobDescription || '';
  const found = new Set();

  for (const term of SKILL_DICTIONARY) {
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, 'i');
    if (re.test(text)) found.add(term);
  }

  const wordFreq = {};
  const tokens = text.match(/\b[A-Z][a-zA-Z0-9+.#]{2,}\b/g) || [];
  for (const w of tokens) {
    wordFreq[w] = (wordFreq[w] || 0) + 1;
  }
  for (const [word, count] of Object.entries(wordFreq)) {
    const lower = word.toLowerCase();
    if (count >= 2 && !STOPWORDS.has(lower) && ![...found].some((f) => f.toLowerCase() === lower)) {
      found.add(word);
    }
  }

  return Array.from(found);
}

// Compares job-description keywords against resume text; returns which are
// already present in the resume and which are missing.
function matchKeywords(jobDescription, resumeText) {
  const keywords = extractKeywords(jobDescription);
  const resumeLower = (resumeText || '').toLowerCase();
  const present = [];
  const missing = [];

  for (const kw of keywords) {
    if (resumeLower.includes(kw.toLowerCase())) present.push(kw);
    else missing.push(kw);
  }
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

// Builds an editable fill-in-the-blank cover letter draft. This is
// deliberately NOT meant to be sent as-is — the bracketed sections are
// prompts for you to fill in with real specifics.
function buildCoverLetterDraft(job, resumeText, match) {
  const name = guessNameFromResume(resumeText) || '[Your Name]';
  const title = job.job_title || '[Job Title]';
  const company = job.company || '[Company]';
  const sameValue = job.location && job.work_mode && job.location.toLowerCase() === job.work_mode.toLowerCase();
  const locationClause = job.location ? ` in ${job.location}` : '';
  const modeClause = job.work_mode && !sameValue ? ` (${job.work_mode})` : '';
  const matched = match.present.slice(0, 5);
  const missing = match.missing.slice(0, 3);
  const matchedList = matched.length ? matched.join(', ') : 'relevant skills';
  const firstMatched = matched[0] || 'these skills';

  let letter = `Dear Hiring Team,\n\n`;
  letter += `I am excited to apply for the ${title} position at ${company}${locationClause}${modeClause}. `;
  letter += `With experience in ${matchedList}, I believe I would bring real value to your team.\n\n`;
  letter += `[Add 1-2 sentences here about a specific project, internship, or course where you used ${firstMatched}, including a concrete result or outcome.]\n\n`;

  if (missing.length) {
    letter += `I'm also continuing to build skills in ${missing.join(', ')}, which I understand are valuable for this role. `;
    letter += `[Optional: mention relevant coursework, side projects, or your plan to grow here.]\n\n`;
  }

  letter += `Thank you for considering my application. I would welcome the opportunity to discuss how my background could contribute to ${company}.\n\n`;
  letter += `Sincerely,\n${name}`;

  return letter;
}

// Exposed for use by dashboard.js. In a plain (non-module) script these are
// just top-level function declarations already on `window`, so nothing
// further is needed — kept here as a readable manifest of the public API.
