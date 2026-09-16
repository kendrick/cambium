import { describe } from 'vitest';

import { createInMemoryRecordStore } from './in-memory-record-store';
import { testRecordStoreContract } from './record-store-contract';

describe('createInMemoryRecordStore', () => {
	testRecordStoreContract(() => createInMemoryRecordStore());
});
