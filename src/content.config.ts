import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const TODO = 'TODO: 내 확인 필요';

const projects = defineCollection({
  loader: glob({ pattern: '*/{en,ko}.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    summary: z.string().default(TODO),
    company: z.string().default(TODO),
    dataset: z.string().default(TODO),
    tags: z.array(z.string()).default([]),
    coverHue: z.number().min(0).max(360).default(0),
    order: z.number().default(99),
    status: z.enum(['planned', 'in-progress', 'done']).default('planned'),
    attribution: z.array(z.string()).default([]),
    links: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
  }),
});

export const collections = { projects };
