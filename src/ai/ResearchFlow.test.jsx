import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ResearchFlow, { effortLabel } from './ResearchFlow.jsx';

const search = {type:'tool',name:'search_documents',phase:'end',status:'ok',step:1,input:{query:'Section 6 penalties'},resultCount:40,latencyMs:794,requestedTopK:40};
it('shows a connected query/result flow without a technical disclosure',()=>{
  const html=renderToStaticMarkup(<ResearchFlow steps={[search]} model={{requested:'model/a',served:'model/a'}} effort="low" timing={{total_ms:9000}} />);
  expect(html).toContain('ai-research-flow');
  expect(html).toContain('Section 6 penalties');
  expect(html).toContain('40 passages');
  expect(html).toContain('794 ms');
  expect(html).not.toContain('Technical details');
  expect(html).not.toContain('<dl');
});
it('only animates an active stage, and failed actions never claim returned passages',()=>{
  const live=renderToStaticMarkup(<ResearchFlow active steps={[{...search,phase:'start'}]} />);
  expect(live).toContain('ai-flow-step current');
  const failed=renderToStaticMarkup(<ResearchFlow steps={[{...search,status:'error'}]} />);
  expect(failed).toContain('Failed');
  expect(failed).not.toContain('40 passages');
  expect(failed).not.toContain('ai-flow-step current');
  expect(renderToStaticMarkup(<ResearchFlow steps={[{...search,status:'cancelled'}]} />)).toContain('Cancelled');
});
it('shows known durations instead of user-facing token counts',()=>{
  const html=renderToStaticMarkup(<ResearchFlow usage={{reasoning_tokens:840}} timing={{search_ms:794,reasoning_ms:6000,writing_ms:2300}} />);
  expect(html).not.toContain('reasoning tokens');
  expect(html).toContain('Searching');
  expect(html).toContain('794 ms');
  expect(html).toContain('Processing');
  expect(html).toContain('6.0 s');
  expect(html).toContain('Writing');
  expect(html).toContain('2.3 s');
  expect(html).not.toContain('Reasoning duration');
});
it('preserves measured zero and omits missing or invalid durations',()=>{
  const html=renderToStaticMarkup(<ResearchFlow timing={{search_ms:0,reasoning_ms:-1,writing_ms:null}} />);
  expect(html).toContain('Searching');expect(html).toContain('0 ms');
  expect(html).not.toContain('Processing');expect(html).not.toContain('Writing');
  expect(renderToStaticMarkup(<ResearchFlow usage={{reasoning_tokens:0}} />)).not.toContain('reasoning tokens');
  expect(renderToStaticMarkup(<ResearchFlow />)).not.toContain('ai-flow-timing');
});

it('labels the supported max effort rather than claiming it is unavailable', () => {
  expect(effortLabel('max', false)).toBe('Max');
  expect(effortLabel('max', true)).toBe('अधिकतम');
});
