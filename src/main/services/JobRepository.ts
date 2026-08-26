import type { PersistedJob } from '../../contracts/job-lifecycle';

export interface JobRepository {
  create(job: PersistedJob): Promise<void>;
  get(jobId: string): Promise<PersistedJob | undefined>;
  update(job: PersistedJob): Promise<void>;
  delete(jobId: string): Promise<void>;
  list(): Promise<PersistedJob[]>;
}
