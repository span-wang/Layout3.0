export interface CooperativeTaskScheduler {
  now: () => number;
  schedule: (callback: () => void) => number;
  cancel: (taskId: number) => void;
}

const browserTaskScheduler: CooperativeTaskScheduler = {
  now: () => performance.now(),
  schedule: (callback) => window.setTimeout(callback, 0),
  cancel: (taskId) => window.clearTimeout(taskId),
};

/**
 * 把生成器任务切成多个短批次。每个批次结束后浏览器都能先处理点击、聚焦和键盘事件。
 */
export function runCooperativeTask<TResult>(
  task: Generator<void, TResult, void>,
  onComplete: (result: TResult) => void,
  scheduler: CooperativeTaskScheduler = browserTaskScheduler,
  timeSliceMs = 8,
): () => void {
  let scheduledTaskId: number | null = null;
  let isCancelled = false;
  let isCompleted = false;

  const scheduleNextSlice = () => {
    scheduledTaskId = scheduler.schedule(runNextSlice);
  };

  const runNextSlice = () => {
    scheduledTaskId = null;
    if (isCancelled) {
      return;
    }

    const sliceStartedAt = scheduler.now();
    let step = task.next();

    while (!step.done && scheduler.now() - sliceStartedAt < Math.max(1, timeSliceMs)) {
      step = task.next();
    }

    if (step.done) {
      isCompleted = true;
      onComplete(step.value);
      return;
    }

    scheduleNextSlice();
  };

  scheduleNextSlice();

  return () => {
    if (isCancelled || isCompleted) {
      return;
    }

    isCancelled = true;
    if (scheduledTaskId !== null) {
      scheduler.cancel(scheduledTaskId);
    }
    // 触发生成器 finally，及时释放尚未完成的 DOM Range 等临时资源。
    task.return(undefined as never);
  };
}
