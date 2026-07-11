import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RagflowIngestionConfigStore, type CredentialCipher } from './ragflow-config-store';
import { RegistryError } from './types';

const testCipher: CredentialCipher = {
  isAvailable: () => true,
  encryptString: (value) => Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`),
  decryptString: (value) => Buffer.from(value.toString().slice('sealed:'.length), 'base64').toString(),
};

test('PH3-13C2 入库配置只落安全密文，普通字段可回读且空密钥更新会保留原密钥', async () => {
  const root = await mkdtemp(join(tmpdir(), 'layout3-ragflow-config-'));
  const configPath = join(root, 'ragflow-ingestion.json');
  try {
    const store = new RagflowIngestionConfigStore(configPath, testCipher, () => new Date('2026-07-11T00:00:00.000Z'));
    assert.equal((await store.getStatus()).configured, false);
    const status = await store.save({
      baseUrl: 'http://127.0.0.1:9380/',
      apiKey: 'secret-key-value',
      stagingDatasetId: 'dataset-staging-c2',
      indexGeneration: 'staging-v1',
    });
    assert.deepEqual(status, {
      configured: true,
      baseUrl: 'http://127.0.0.1:9380',
      stagingDatasetId: 'dataset-staging-c2',
      indexGeneration: 'staging-v1',
      hasApiKey: true,
    });
    const source = await readFile(configPath, 'utf8');
    assert.equal(source.includes('secret-key-value'), false);
    assert.equal((await store.getPrivateConfig()).apiKey, 'secret-key-value');
    assert.deepEqual(
      await store.resolveDatasetReadConfig({ baseUrl: 'http://127.0.0.1:9382' }),
      { baseUrl: 'http://127.0.0.1:9382', apiKey: 'secret-key-value' },
    );
    assert.deepEqual(
      await store.resolveDatasetReadConfig({ baseUrl: 'http://127.0.0.1:9382', apiKey: 'temporary-key' }),
      { baseUrl: 'http://127.0.0.1:9382', apiKey: 'temporary-key' },
    );

    await store.save({
      baseUrl: 'http://127.0.0.1:9381',
      stagingDatasetId: 'dataset-staging-c2',
      indexGeneration: 'staging-v2',
    });
    assert.equal((await store.getPrivateConfig()).apiKey, 'secret-key-value');
    assert.deepEqual(await store.getProtectedDatasetIds(), ['dataset-staging-c2']);
    await store.assertStagingDataset('dataset-staging-c2');
    await assert.rejects(
      store.assertStagingDataset('dataset-production'),
      (error) => error instanceof RegistryError && error.code === 'REMOTE_AUTH_CONFIG',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('PH3-13C2 安全存储不可用或配置非法时失败关闭', async () => {
  const root = await mkdtemp(join(tmpdir(), 'layout3-ragflow-config-fail-'));
  try {
    const unavailable = new RagflowIngestionConfigStore(join(root, 'config.json'), {
      ...testCipher,
      isAvailable: () => false,
    });
    await assert.rejects(
      unavailable.save({
        baseUrl: 'http://127.0.0.1:9380',
        apiKey: 'key',
        stagingDatasetId: 'dataset-staging-c2',
        indexGeneration: 'staging-v1',
      }),
      (error) => error instanceof RegistryError && error.code === 'REMOTE_AUTH_CONFIG',
    );

    const store = new RagflowIngestionConfigStore(join(root, 'config.json'), testCipher);
    await assert.rejects(
      store.save({
        baseUrl: 'file:///tmp/ragflow',
        apiKey: 'key',
        stagingDatasetId: 'dataset/staging',
        indexGeneration: '',
      }),
      (error) => error instanceof RegistryError && error.code === 'REMOTE_AUTH_CONFIG',
    );
    await assert.rejects(
      store.resolveDatasetReadConfig({ baseUrl: 'http://127.0.0.1:9380' }),
      (error) => error instanceof RegistryError && error.code === 'REMOTE_AUTH_CONFIG',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
