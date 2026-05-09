import { describe, expect, it } from 'vitest';
import { buildResumeImportDraft, buildResumeImportDraftFromRow } from './importer';

describe('resumes importer', () => {
  it('builds import draft from plain text', () => {
    const text = `
姓名：王五
现居：深圳，中国
邮箱：wangwu@example.com
有 6 年工作经验，擅长前端与性能优化。
`;
    const draft = buildResumeImportDraft(text);
    expect(draft.full_name).toBe('王五');
    expect(draft.email).toBe('wangwu@example.com');
    expect(draft.work_years).toBe(6);
    expect(draft.source_text.trim().length).toBeGreaterThan(10);
  });

  it('builds import draft from row fields when source exists', () => {
    const row = {
      profile_summary: 'Senior engineer with 8 years of experience and strong backend focus.',
    };
    const draft = buildResumeImportDraftFromRow(row);
    expect(draft).not.toBeNull();
    expect(draft?.work_years).toBe(8);
  });
});

