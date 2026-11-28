import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobActions } from './DriveJobsDrawer.jsx';
import { cancelIndexJob, setIndexingBillingDeployedForTesting } from './fileManagerService.js';
import { supabase } from '../lib/supabaseClient.js';

const render = (status) =>
  renderToStaticMarkup(
    <JobActions job={{ id: 'j1', file_id: 'f1', status }} isBusy={false} onRetry={() => {}} onCancel={() => {}} />
  );

describe('DriveJobsDrawer JobActions', () => {
  it('offers Cancel for a queued job', () => {
    expect(render('queued')).toContain('Cancel');
  });

  it('offers no Cancel for a running job (the database refuses it)', () => {
    expect(render('running')).not.toContain('Cancel');
  });

  it('offers Retry, not Cancel, for a failed job', () => {
    const html = render('failed');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Cancel');
  });
});

describe('cancelIndexJob server refusal', () => {
  afterEach(() => {
    setIndexingBillingDeployedForTesting(false);
    vi.restoreAllMocks();
  });

  it('turns job_running into a clear message', async () => {
    setIndexingBillingDeployedForTesting(true);
    vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
      data: null,
      error: { message: 'job_running: the job has started; a started job runs to the end and is billed' },
    });
    await expect(cancelIndexJob('j1', 'f1')).rejects.toThrow(/already started.*only queued jobs can be cancelled/);
  });
});
