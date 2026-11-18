// S6 스킬 목록(여기 한 곳에만 정의). 그룹 이름은 i18n `skillGroups.<id>`.
export const SKILL_GROUPS = [
  {
    id: 'data',
    items: ['Python', 'Pandas', 'NumPy', 'scikit-learn', 'SQL', 'SQLite', 'Tableau', 'Matplotlib', 'Seaborn', 'Jupyter', 'Excel', 'Statistics', 'EDA & Data Cleaning', 'Hypothesis-Driven Analysis', 'Business Case Analysis', 'Product Thinking'],
  },
  {
    id: 'frontend',
    items: ['React', 'TypeScript', 'JavaScript', 'HTML', 'CSS', 'Sass', 'Tailwind CSS', 'Vite', 'Bun', 'Webpack', 'TanStack Query', 'Zustand', 'Jotai', 'Recoil', 'Axios', 'WebSocket', 'Jest', 'Storybook', 'Figma', 'Performance Optimization'],
  },
  { id: 'tools', items: ['Git', 'GitHub', 'GitHub Actions', 'AWS', 'Slack', 'Notion', 'Jira'] },
  { id: 'ai', items: ['Claude Code', 'Cursor'] },
] as const;
