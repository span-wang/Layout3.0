import { safeStorage } from 'electron';
import type { CredentialCipher } from './ragflow-config-store';

export const electronSafeStorageCipher: CredentialCipher = {
  isAvailable: () => {
    if (!safeStorage.isEncryptionAvailable()) {
      return false;
    }
    // Linux 没有可用密钥环时会退化为明文 basic_text，不能用于持久化 RAGFlow 密钥。
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
  },
  encryptString: (value) => safeStorage.encryptString(value),
  decryptString: (value) => safeStorage.decryptString(value),
};
