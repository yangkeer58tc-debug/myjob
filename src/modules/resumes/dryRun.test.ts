import { describe, expect, it } from 'vitest';
import { runResumeDryRun } from './dryRun';

describe('runResumeDryRun', () => {
  it('returns summary for single resume input', () => {
    const input = `
姓名：赵六
邮箱：zhaoliu@example.com
电话：+86 139 0000 1111
有 4 年工作经验
`;
    const result = runResumeDryRun(input);
    expect(result.summary.total).toBe(1);
    expect(result.summary.withName).toBe(1);
    expect(result.summary.withEmail).toBe(1);
    expect(result.summary.withPhone).toBe(1);
    expect(result.summary.withWorkYears).toBe(1);
    expect(result.items[0].warnings.length).toBe(0);
  });

  it('supports multi-resume separators', () => {
    const input = `
John Doe
Email: john@example.com
---
No contact candidate
`;
    const result = runResumeDryRun(input);
    expect(result.summary.total).toBe(2);
    expect(result.items[1].warnings.length).toBeGreaterThan(0);
  });
});

