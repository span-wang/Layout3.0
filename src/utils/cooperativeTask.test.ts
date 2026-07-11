import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runCooperativeTask,
  type CooperativeTaskScheduler,
} from './cooperativeTask';

function createManualScheduler(): CooperativeTaskScheduler & {
  pendingCount: () => number;
  runNext: () => void;
} {
  let nextTaskId = 1;
  let now = 0;
  const tasks = new Map<number, () => void>();

  return {
    now: () => {
      now += 3;
      return now;
    },
    schedule: (callback) => {
      const taskId = nextTaskId;
      nextTaskId += 1;
      tasks.set(taskId, callback);
      return taskId;
    },
    cancel: (taskId) => {
      tasks.delete(taskId);
    },
    pendingCount: () => tasks.size,
    runNext: () => {
      const nextEntry = tasks.entries().next().value as [number, () => void] | undefined;
      assert(nextEntry, '应存在一个待运行批次');
      tasks.delete(nextEntry[0]);
      nextEntry[1]();
    },
  };
}

test('协作任务会分批执行并在批次之间让出主线程', () => {
  const scheduler = createManualScheduler();
  let completedResult: string | null = null;
  let completedSteps = 0;

  function* createTask(): Generator<void, string, void> {
    for (let index = 0; index < 6; index += 1) {
      completedSteps += 1;
      yield;
    }
    return '测量完成';
  }

  runCooperativeTask(createTask(), (result) => {
    completedResult = result;
  }, scheduler, 5);

  scheduler.runNext();
  assert(completedSteps > 0 && completedSteps < 6, '首批只应处理部分工作');
  assert.equal(completedResult, null);

  while (scheduler.pendingCount() > 0) {
    scheduler.runNext();
  }

  assert.equal(completedSteps, 6);
  assert.equal(completedResult, '测量完成');
});

test('取消协作任务会清除后续批次并关闭生成器', () => {
  const scheduler = createManualScheduler();
  let generatorClosed = false;
  let completionCalled = false;

  function* createTask(): Generator<void, void, void> {
    try {
      while (true) {
        yield;
      }
    } finally {
      generatorClosed = true;
    }
  }

  const cancel = runCooperativeTask(createTask(), () => {
    completionCalled = true;
  }, scheduler, 5);

  scheduler.runNext();
  cancel();

  assert.equal(scheduler.pendingCount(), 0);
  assert.equal(generatorClosed, true);
  assert.equal(completionCalled, false);
});
