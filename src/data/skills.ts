// S6 스킬 목록(여기 한 곳에만 정의). 그룹 이름은 i18n `skillGroups.<id>`.
// icon: simple-icons slug(About.astro가 빌드 때 SVG path와 브랜드 색을 인라인). mark: 로고가 없는 항목의 이니셜/기호 칸.
export interface Skill { name: string; icon?: string; mark?: string }

export const SKILL_GROUPS: { id: 'data' | 'frontend' | 'tools' | 'ai'; items: Skill[] }[] = [
  {
    id: 'data',
    items: [
      { name: 'Python', icon: 'python' },
      { name: 'Pandas', icon: 'pandas' },
      { name: 'NumPy', icon: 'numpy' },
      { name: 'scikit-learn', icon: 'scikitlearn' },
      { name: 'SQL', mark: 'SQL' },
      { name: 'SQLite', icon: 'sqlite' },
      { name: 'Tableau', mark: 'Tb' },
      { name: 'Matplotlib', mark: 'Mp' },
      { name: 'Seaborn', mark: 'Sb' },
      { name: 'Jupyter', icon: 'jupyter' },
      { name: 'Excel', mark: 'Xl' },
      { name: 'Statistics', mark: 'σ' },
      { name: 'EDA & Data Cleaning', mark: 'EDA' },
      { name: 'Hypothesis-Driven Analysis', mark: 'H₀' },
      { name: 'Business Case Analysis', mark: 'BC' },
      { name: 'Product Thinking', mark: 'PT' },
    ],
  },
  {
    id: 'frontend',
    items: [
      { name: 'React', icon: 'react' },
      { name: 'TypeScript', icon: 'typescript' },
      { name: 'JavaScript', icon: 'javascript' },
      { name: 'HTML', icon: 'html5' },
      { name: 'CSS', icon: 'css' },
      { name: 'Sass', icon: 'sass' },
      { name: 'Tailwind CSS', icon: 'tailwindcss' },
      { name: 'Vite', icon: 'vite' },
      { name: 'Bun', icon: 'bun' },
      { name: 'Webpack', icon: 'webpack' },
      { name: 'TanStack Query', icon: 'reactquery' }, // simple-icons 이름은 "React Query"(TanStack Query 로고)
      { name: 'Zustand', mark: 'Zu' },
      { name: 'Jotai', mark: 'Jt' },
      { name: 'Recoil', icon: 'recoil' },
      { name: 'Axios', icon: 'axios' },
      { name: 'WebSocket', mark: 'WS' },
      { name: 'Jest', icon: 'jest' },
      { name: 'Storybook', icon: 'storybook' },
      { name: 'Figma', icon: 'figma' },
      { name: 'Performance Optimization', mark: 'PO' },
    ],
  },
  {
    id: 'tools',
    items: [
      { name: 'Git', icon: 'git' },
      { name: 'GitHub', icon: 'github' },
      { name: 'GitHub Actions', icon: 'githubactions' },
      { name: 'AWS', mark: 'AWS' },
      { name: 'Slack', mark: 'Sl' },
      { name: 'Notion', icon: 'notion' },
      { name: 'Jira', icon: 'jira' },
    ],
  },
  { id: 'ai', items: [{ name: 'Claude Code', icon: 'claudecode' }, { name: 'Cursor', icon: 'cursor' }] },
];
