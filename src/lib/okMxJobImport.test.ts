import { describe, expect, it } from 'vitest';
import { mapMxCategoryPathToSiteCategory, resolveMxJobLocation } from '@/lib/okMxJobImport';

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
