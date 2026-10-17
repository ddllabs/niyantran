import { describe, expect, it } from 'vitest';
import { compareStates } from './stateComparison.js';
const r = (state, indicator, year, value) => ({ state, indicator, year, value, source_url: 'https://www.rbi.org.in/source' });
describe('exact and comparable handbook periods', () => {
  it('selected years show gaps rather than silently substituting an older indicator', () => {
    const rows = compareStates([r('Goa','A','2024',10), r('Goa','B','2023',4)], {year:'2024'});
    expect(rows.find(x=>x.indicator==='B')).toMatchObject({year:'2024',value:null,data_status:'No figure for selected year'});
    expect(rows.every(x=>x.year==='2024')).toBe(true);
  });
  it('a missing state is a labelled gap, and numeric figures alone are ranked', () => {
    const rows=compareStates([r('Goa','A','2024',10),r('Bihar','A','2023',4)],{year:'2024'});
    expect(rows.find(x=>x.state==='Bihar')).toMatchObject({value:null,data_status:'No figure for selected year'});
    expect(rows.find(x=>x.state==='Goa')).toMatchObject({rank:1,of:1});
  });
  it('an older observation never produces a year-on-year change across a gap', () => {
    const [row]=compareStates([r('Goa','A','2024',10),r('Goa','A','2022',4)]);
    expect(row.previous_value).toBeUndefined();
    expect(row.change_pct).toBeUndefined();
    expect(row.previous_status).toBe('Previous period unavailable');
  });
  it('financial years use the immediately preceding financial period', () => {
    const [row]=compareStates([r('Goa','A','2000-01',10),r('Goa','A','1999-00',5)]);
    expect(row).toMatchObject({previous_year:'1999-00',previous_value:5,change_pct:100});
  });
});
