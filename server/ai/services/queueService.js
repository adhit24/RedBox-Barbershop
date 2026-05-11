/**
 * Queue Service - Bull/Redis Queue Management
 */

const Queue = require('bull');

// Redis configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
};

// Create queues
const aiQueue = new Queue('ai-analysis', {
  redis: redisConfig,
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
});

const queueService = {
  
  // Add job to queue
  addJob: async (queueName, data) => {
    try {
      const job = await aiQueue.add(data);
      return job.id;
    } catch (error) {
      console.error('Queue add error:', error);
      throw error;
    }
  },

  // Get job status
  getJobStatus: async (jobId) => {
    try {
      const job = await aiQueue.getJob(jobId);
      if (!job) return null;

      return {
        id: job.id,
        state: await job.getState(),
        progress: job.progress,
        result: job.returnvalue,
        failedReason: job.failedReason
      };
    } catch (error) {
      console.error('Get job status error:', error);
      return null;
    }
  },

  // Get queue stats
  getStats: async () => {
    try {
      const [waiting, active, completed, failed] = await Promise.all([
        aiQueue.getWaitingCount(),
        aiQueue.getActiveCount(),
        aiQueue.getCompletedCount(),
        aiQueue.getFailedCount()
      ]);

      return { waiting, active, completed, failed };
    } catch (error) {
      console.error('Queue stats error:', error);
      return null;
    }
  },

  // Clean old jobs
  cleanOldJobs: async () => {
    try {
      await aiQueue.clean(24 * 3600 * 1000, 'completed'); // 24 hours
      await aiQueue.clean(7 * 24 * 3600 * 1000, 'failed'); // 7 days
    } catch (error) {
      console.error('Clean jobs error:', error);
    }
  }
};

module.exports = queueService;
