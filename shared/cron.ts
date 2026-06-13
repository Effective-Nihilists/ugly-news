import { cronTask, defineCronTasks } from 'ugly-app/shared';

export const cronTasks = defineCronTasks({
  dailyCleanup: cronTask({
    schedule: '0 3 * * *', // 3 AM UTC daily
    description: 'Delete completed todos older than 30 days',
  }),
});
