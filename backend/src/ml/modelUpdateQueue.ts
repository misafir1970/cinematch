import { ModelUpdateJob } from '@/types';

export class MLModelUpdateQueue {
  private jobs: ModelUpdateJob[] = [];
  private processing = false;

  async addUpdateJob(job: ModelUpdateJob): Promise<void> {
    // Timestamp ekle
    const jobWithTimestamp = {
      ...job,
      timestamp: new Date()
    };

    // Priority'ye göre sırala
    const priority = this.getPriorityValue(job.priority);
    
    // Insert at correct position based on priority
    let insertIndex = this.jobs.length;
    for (let i = 0; i < this.jobs.length; i++) {
      if (this.getPriorityValue(this.jobs[i].priority) < priority) {
        insertIndex = i;
        break;
      }
    }
    
    this.jobs.splice(insertIndex, 0, jobWithTimestamp);
    
    // Processing başlat
    if (!this.processing) {
      void this.processJobs();
    }
  }

  private getPriorityValue(priority: 'low' | 'medium' | 'high'): number {
    switch (priority) {
      case 'high': return 3;
      case 'medium': return 2;
      case 'low': return 1;
      default: return 1;
    }
  }

  private async processJobs(): Promise<void> {
    if (this.processing || this.jobs.length === 0) {
      return;
    }

    this.processing = true;

    while (this.jobs.length > 0) {
      const job = this.jobs.shift()!;
      
      try {
        await this.processJob(job);
      } catch (error) {
        console.error('Failed to process job:', error);
        // Job'ı geri queue'ya ekleyebiliriz veya dead letter queue'ya gönderebiliriz
      }
      
      // Small delay to prevent overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.processing = false;
  }

  private async processJob(job: ModelUpdateJob): Promise<void> {
    // TODO: Actual ML model update logic
    // Bu geçici implementation
    console.log(`Processing ML update job for user ${job.userId}, movie ${job.movieId}`);
    
    // Simulated processing time
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  getQueueLength(): number {
    return this.jobs.length;
  }

  isProcessing(): boolean {
    return this.processing;
  }
}