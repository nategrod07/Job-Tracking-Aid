// Skill dictionary + alias/synonym table used by keywords.js for job/resume
// matching. Pure data, no logic — kept in its own file since this list is
// long and grows independently of the matching algorithm.
//
// SKILL_DICTIONARY: canonical skill names matched literally in job text.
// SKILL_ALIASES: canonical name -> other surface forms (abbreviations,
// synonyms, common inflections) that should count as the same skill. Every
// key here must also appear in SKILL_DICTIONARY. This is a curated,
// hand-authored map rather than automatic stemming — auditable and
// predictable, and specifically targets the paraphrasing gap naive
// substring matching misses (e.g. resume says "led a team of 5", job
// description says "Leadership").

const SKILL_DICTIONARY = [
  // Languages
  'Python', 'Java', 'JavaScript', 'TypeScript', 'C++', 'C', 'C#', 'SQL', 'R', 'Go', 'Swift', 'Kotlin',
  'Ruby', 'PHP', 'MATLAB', 'HTML', 'CSS', 'Scala', 'Rust', 'Perl', 'Objective-C', 'Dart', 'Bash',
  'PowerShell', 'VBA', 'Assembly', 'Julia',

  // Frontend
  'React', 'Angular', 'Vue', 'Next.js', 'Nuxt.js', 'Svelte', 'jQuery', 'Redux', 'Webpack', 'Vite',
  'Sass', 'Tailwind CSS', 'Bootstrap', 'Material UI', 'Responsive Design', 'Progressive Web Apps',
  'Storybook',

  // Backend & APIs
  'Node.js', 'Express.js', 'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', '.NET', 'ASP.NET',
  'Ruby on Rails', 'Laravel', 'Symfony', 'NestJS', 'GraphQL', 'REST API', 'gRPC', 'Microservices',
  'API Design', 'Serverless',

  // Cloud, DevOps & Infrastructure
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions',
  'GitLab CI', 'CircleCI', 'CI/CD', 'DevOps', 'Linux', 'Nginx', 'Apache', 'Helm', 'Prometheus',
  'Grafana', 'Datadog', 'Chef', 'Puppet', 'Infrastructure as Code', 'Site Reliability Engineering',
  'Git', 'Version Control',

  // Security
  'Cybersecurity', 'Network Security', 'Penetration Testing', 'Vulnerability Assessment',
  'Incident Response', 'Cryptography', 'Identity and Access Management', 'SIEM', 'Application Security',

  // Computer science fundamentals
  'Algorithms', 'Data Structures', 'Object-Oriented Programming', 'Design Patterns', 'System Design',
  'Concurrency', 'Distributed Systems', 'Operating Systems', 'Computer Networks',

  // Data, ML & analytics
  'Machine Learning', 'Deep Learning', 'TensorFlow', 'PyTorch', 'Keras', 'Scikit-learn', 'Pandas',
  'NumPy', 'Data Analysis', 'Data Science', 'Data Engineering', 'ETL', 'Data Pipelines',
  'Data Visualization', 'Data Warehousing', 'Big Data', 'Apache Spark', 'Hadoop', 'Kafka', 'Airflow',
  'dbt', 'Snowflake', 'Redshift', 'BigQuery', 'Databricks', 'Statistics', 'A/B Testing',
  'Natural Language Processing', 'Computer Vision', 'Neural Networks', 'Predictive Modeling',
  'Feature Engineering', 'MLOps', 'Artificial Intelligence', 'Generative AI', 'Large Language Models',

  // Databases
  'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'SQLite', 'Oracle Database', 'SQL Server', 'DynamoDB',
  'Cassandra', 'Elasticsearch', 'NoSQL', 'Database Design',

  // Design & product
  'Figma', 'Sketch', 'Adobe XD', 'Photoshop', 'Illustrator', 'InVision', 'UX Design', 'UI Design',
  'User Research', 'Wireframing', 'Prototyping', 'Design Systems', 'Product Management',
  'Product Design', 'Usability Testing', 'Accessibility', 'Information Architecture', 'Design Thinking',

  // Testing & QA
  'Unit Testing', 'Integration Testing', 'Selenium', 'Cypress', 'Jest', 'Mocha', 'Pytest', 'JUnit',
  'Test-Driven Development', 'Quality Assurance', 'Automated Testing', 'Manual Testing', 'Postman',
  'Regression Testing',

  // Business & methodology
  'Agile', 'Scrum', 'Kanban', 'Waterfall', 'Jira', 'Confluence', 'Project Management',
  'Stakeholder Management', 'Change Management', 'Six Sigma', 'Business Analysis',
  'Requirements Gathering', 'Risk Management', 'Budgeting', 'Forecasting', 'Cross-functional Collaboration',

  // Sales & marketing
  'SEO', 'SEM', 'Google Analytics', 'Content Marketing', 'Email Marketing', 'Social Media Marketing',
  'CRM', 'Salesforce', 'HubSpot', 'Lead Generation', 'Digital Marketing', 'Brand Strategy',
  'Copywriting', 'Market Research',

  // Business tools
  'Excel', 'PowerPoint', 'Word', 'SAP', 'NetSuite', 'QuickBooks', 'Tableau', 'Power BI', 'Looker',
  'Google Workspace', 'Slack', 'Notion', 'Asana', 'Trello',

  // Soft skills
  'Leadership', 'Communication', 'Teamwork', 'Problem-solving', 'Collaboration', 'Analytical Thinking',
  'Detail-oriented', 'Time Management', 'Adaptability', 'Creativity', 'Presentation Skills',
  'Negotiation', 'Critical Thinking', 'Mentoring', 'Public Speaking', 'Customer Service',
  'Conflict Resolution', 'Decision Making', 'Emotional Intelligence',

  // Certifications & credentials
  'PMP', 'CPA', 'CFA', 'CISSP', 'ITIL', 'AWS Certified Solutions Architect', 'Certified Scrum Master',
  'Six Sigma Black Belt', 'Google Analytics Certification'
];

const SKILL_ALIASES = {
  'JavaScript': ['js', 'javascript', 'ecmascript', 'es6', 'es2015'],
  'TypeScript': ['ts', 'typescript'],
  'Node.js': ['node', 'nodejs', 'node.js'],
  'React': ['reactjs', 'react.js'],
  'Vue': ['vuejs', 'vue.js'],
  'Angular': ['angularjs', 'angular.js'],
  'Next.js': ['nextjs'],
  '.NET': ['dotnet', 'dot net', '.net core', 'asp.net core'],
  'C++': ['cpp', 'c plus plus'],
  'C#': ['c sharp', 'csharp'],
  'Machine Learning': ['ml'],
  'Artificial Intelligence': ['ai'],
  'Natural Language Processing': ['nlp'],
  'Large Language Models': ['llm', 'llms', 'large language model'],
  'Kubernetes': ['k8s'],
  'CI/CD': ['continuous integration', 'continuous deployment', 'continuous delivery'],
  'Object-Oriented Programming': ['oop', 'object oriented programming'],
  'PostgreSQL': ['postgres', 'psql'],
  'REST API': ['rest', 'restful', 'restful api', 'rest apis'],
  'SEO': ['search engine optimization'],
  'SEM': ['search engine marketing'],
  'AWS': ['amazon web services'],
  'GCP': ['google cloud platform', 'google cloud'],
  'Azure': ['microsoft azure'],
  'Site Reliability Engineering': ['sre'],
  'Infrastructure as Code': ['iac'],
  'UX Design': ['ux', 'user experience', 'user experience design'],
  'UI Design': ['ui', 'user interface', 'user interface design'],
  'Quality Assurance': ['qa'],
  'Test-Driven Development': ['tdd'],
  'CRM': ['customer relationship management'],
  'Cybersecurity': ['cyber security', 'infosec', 'information security'],

  // Soft skills — hand-authored surface-form variants instead of real
  // stemming, so "led a team" or "managing stakeholders" still count as
  // Leadership/Project Management even though neither literally contains
  // the canonical word.
  'Leadership': ['led', 'leading', 'leader', 'led a team', 'team lead'],
  'Project Management': ['managed', 'managing', 'manager', 'management', 'project manager'],
  'Communication': ['communicating', 'communicated', 'communicate', 'communication skills'],
  'Collaboration': ['collaborating', 'collaborative', 'collaborated'],
  'Teamwork': ['team player', 'team-oriented', 'team oriented'],
  'Analytical Thinking': ['analytical', 'analyze', 'analyzed', 'analyzing', 'analysis'],
  'Problem-solving': ['problem solving', 'solved problems', 'troubleshooting'],
  'Detail-oriented': ['detail oriented', 'attention to detail'],
  'Critical Thinking': ['critical thinker'],
  'Presentation Skills': ['presenting', 'presentations'],
  'Adaptability': ['adaptable', 'flexibility', 'flexible'],
  'Data Analysis': ['data analytics', 'analyzing data']
};

const STOPWORDS = new Set([
  'the', 'and', 'of', 'to', 'a', 'in', 'for', 'is', 'on', 'that', 'by', 'this', 'with', 'you', 'your',
  'it', 'not', 'or', 'be', 'are', 'as', 'at', 'from', 'we', 'our', 'will', 'an', 'have', 'has', 'their',
  'they', 'can', 'may', 'all', 'about', 'more', 'other', 'into', 'than', 'then', 'when', 'what', 'which',
  'who', 'if', 'each', 'how', 'up', 'out', 'no', 'so', 'do', 'does', 'did', 'job', 'work', 'role', 'team',
  'company', 'apply', 'applicant', 'position', 'us', 'inc', 'llc',
  // Generic job-posting boilerplate that isn't actually a skill, even
  // though it's often capitalized and repeated (e.g. in the title header).
  'software', 'engineering', 'engineer', 'intern', 'internship', 'responsibilities', 'requirements',
  'experience', 'environment', 'required', 'preferred', 'plus', 'strong', 'skills', 'qualifications',
  'summary', 'description', 'about', 'join', 'looking', 'opportunity', 'candidate', 'candidates',
  'ability', 'including', 'years', 'knowledge', 'proficiency', 'ideal', 'excellent', 'great', 'passion',
  'passionate'
]);
