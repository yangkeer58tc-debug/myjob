import { describe, expect, it } from 'vitest';
import { jobMatchesJobsTextSearch, jobsTextSearchOrFilter } from './jobSearchQuery';

describe('jobsTextSearchOrFilter', () => {
  it('wraps ilike patterns in double quotes for PostgREST', () => {
    const f = jobsTextSearchOrFilter('react');
    expect(f).toContain('title.ilike."%react%"');
    expect(f).toContain('b_name.ilike."%react%"');
    expect(f?.split(',').length).toBe(7);
  });

  it('quotes patterns that contain dots so or= is not misparsed', () => {
    const f = jobsTextSearchOrFilter('node v3.0');
    expect(f).toContain('.ilike."%node v3.0%"');
  });
});

describe('jobMatchesJobsTextSearch', () => {
  it('matches if any column contains the phrase (folded)', () => {
    expect(
      jobMatchesJobsTextSearch(
        { title: 'Vendedor', b_name: 'Acme SA', summary: 'Zona norte' },
        'acme',
      ),
    ).toBe(true);
    expect(
      jobMatchesJobsTextSearch({ title: 'Otro', b_name: 'X', summary: null }, 'acme'),
    ).toBe(false);
  });
});
