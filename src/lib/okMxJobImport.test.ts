import { describe, expect, it } from 'vitest';
import {
  isJobsMissingMxFeedColumnError,
  mapMxCategoryPathToSiteCategory,
  resolveMxJobLocation,
  stripOptionalJobColumnFromPostgrestSchemaError,
} from '@/lib/okMxJobImport';

describe('stripOptionalJobColumnFromPostgrestSchemaError', () => {
  it('removes b_same_as when PostgREST reports schema cache miss', () => {
    const body: Record<string, unknown> = { id: '1', b_same_as: null, title: 'x' };
    const ok = stripOptionalJobColumnFromPostgrestSchemaError(
      "Could not find the 'b_same_as' column of 'jobs' in the schema cache",
      body,
    );
    expect(ok).toBe(true);
    expect('b_same_as' in body).toBe(false);
  });

  it('does not remove core columns', () => {
    const body: Record<string, unknown> = { id: '1', title: 'x' };
    expect(
      stripOptionalJobColumnFromPostgrestSchemaError(
        "Could not find the 'title' column of 'jobs' in the schema cache",
        body,
      ),
    ).toBe(false);
    expect(body.title).toBe('x');
  });
});

describe('isJobsMissingMxFeedColumnError', () => {
  it('detects missing external_source for export fallback', () => {
    expect(
      isJobsMissingMxFeedColumnError(
        "Could not find the 'external_source' column of 'jobs' in the schema cache",
      ),
    ).toBe(true);
    expect(isJobsMissingMxFeedColumnError('new row violates row-level security')).toBe(false);
  });
});

describe('mapMxCategoryPathToSiteCategory', () => {
  it('maps MX path second segment to site category ids', () => {
    expect(mapMxCategoryPathToSiteCategory('jobs,call-center-customer-service,cust-service-facing')).toBe(
      'call-center-customer-service',
    );
    expect(mapMxCategoryPathToSiteCategory('jobs,healthcare-medical,nursing')).toBe('healthcare-medical');
    expect(mapMxCategoryPathToSiteCategory('jobs,mfg-transport-logistics,couriers-drivers-postal')).toBe(
      'mfg-transport-logistics',
    );
    expect(mapMxCategoryPathToSiteCategory('jobs,sales,sales-reps-consultants')).toBe('sales');
    expect(mapMxCategoryPathToSiteCategory('jobs,retail-consumer-products,retail-assistants')).toBe('sales');
    expect(mapMxCategoryPathToSiteCategory('jobs,trades-services,electricians')).toBe('trades-services');
    expect(mapMxCategoryPathToSiteCategory('jobs,info-comm-technology,sales-pre-post')).toBe('trades-services');
  });
});

describe('resolveMxJobLocation', () => {
  it('uses addresscomponents when present', () => {
    const row = {
      addresscomponents:
        '[{"longText":"Mexico City","shortText":"México D.F.","types":["locality","political"]},{"longText":"Mexico City","shortText":"CDMX","types":["administrative_area_level_1","political"]},{"longText":"Mexico","shortText":"MX","types":["country","political"]}]',
      local_name: 'México',
      local_code: 'mexico',
      para: '',
    };
    const loc = resolveMxJobLocation(row);
    expect(loc).toContain('Mexico City');
  });

  it('falls back to México for placeholder local_name', () => {
    const row = {
      addresscomponents: '',
      local_name: 'mexico',
      local_code: 'mexico',
      para: '',
    };
    expect(resolveMxJobLocation(row)).toBe('México');
  });
});
