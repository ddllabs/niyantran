import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ResearchFlow from './ResearchFlow.jsx';

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
it('shows measured reasoning tokens including zero, never inventing a count or prose',()=>{
  const render=usage=>renderToStaticMarkup(<ResearchFlow usage={usage} />);
  expect(render({reasoning_tokens:840})).toContain('840 reasoning tokens');
  expect(render({reasoning_tokens:0})).toContain('0 reasoning tokens');
  expect(render(null)).not.toContain('reasoning tokens');
  expect(render({reasoning_tokens:-1})).not.toContain('reasoning tokens');
});
