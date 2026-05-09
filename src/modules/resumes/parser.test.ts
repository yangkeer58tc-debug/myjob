import { describe, expect, it } from 'vitest';
import { parseResumeText } from './parser';

describe('parseResumeText', () => {
  it('extracts basic fields from English resume text', () => {
    const text = `
John Doe
Location: Berlin, Germany
Email: john.doe@example.com
WhatsApp: +49 151 23456789
Phone: +49 30 123456

Summary
Senior software engineer with 7 years of experience building web applications.

Education
Technical University of Berlin, Master of Science, Computer Science
`;

    const r = parseResumeText(text);
    expect(r.name).toBe('John Doe');
    expect(r.country).toContain('Germany');
    expect(r.city).toContain('Berlin');
    expect(r.email).toBe('john.doe@example.com');
    expect(r.workYears).toBe(7);
    expect((r.introSummaryOriginal || '').length).toBeGreaterThan(10);
    expect(r.education && r.education.length).toBeGreaterThan(0);
  });

  it('extracts basic fields from Chinese resume text', () => {
    const text = `
姓名：张三
现居：上海，中国
邮箱：zhangsan@example.com
电话：+86 138 0013 8000

个人简介
有 5 年工作经验，专注于前端工程化与性能优化。

教育经历
复旦大学 本科 计算机科学
`;

    const r = parseResumeText(text);
    expect(r.name).toBe('张三');
    expect(r.city).toContain('上海');
    expect(r.country).toContain('中国');
    expect(r.email).toBe('zhangsan@example.com');
    expect(r.workYears).toBe(5);
    expect(r.education?.length ?? 0).toBeGreaterThan(0);
  });

  it('parses standardized CSV row format', () => {
    const text = `first_name,last_name,email,city,country,work_experience_years,education,summary
Ana,Silva,ana.silva@example.com,Lisbon,Portugal,6,"BSc Computer Science, University of Lisbon","Full-stack engineer focused on React and Node.js with strong delivery ownership."`;

    const r = parseResumeText(text);
    expect(r.name).toBe('Ana Silva');
    expect(r.email).toBe('ana.silva@example.com');
    expect(r.city).toBe('Lisbon');
    expect(r.country).toBe('Portugal');
    expect(r.workYears).toBe(6);
    expect(r.introSummaryOriginal).toContain('Full-stack engineer');
  });

  it('parses myjob-like tabular row with JSON columns', () => {
    const text = `user_id\tresume_id\tuser_name\tuser_concat\teducation_level\teducation_experience\twork_experience\twork_years\twork_industry\twork_skills\tpersonal_statement
1\tabc\tERICK DE LIMA NERY\t[{"value":"(75) 9 9289-0830","type":"phone"},{"value":"neryerick2000@gmail.com","type":"email"}]\tHigh school\t[{"subject":"High school","degree":"High school","is_completed":true}]\t[{"time_range":"2024-10 - 2025-08","position":"Motorista","company":"Duro na Queda"}]\t5-8年\tConstruction\tMOPP, Dirección defensiva\tI am seeking a position as a Heavy Vehicle Driver.`;

    const r = parseResumeText(text);
    expect(r.name).toBe('ERICK DE LIMA NERY');
    expect(r.email).toBe('neryerick2000@gmail.com');
    expect(r.phone).toContain('9289');
    expect(r.workYears).toBe(8);
    expect(r.education?.[0]?.degree).toBe('High school');
    expect(r.introSummaryOriginal).toContain('Heavy Vehicle Driver');
  });
});

