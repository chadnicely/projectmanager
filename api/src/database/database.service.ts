import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { MongoClient, Db, Collection, Document } from 'mongodb';
import * as path from 'path';

// Reads MONGO_URI/DB_NAME from the environment, falling back to the repo-root
// config.local.js (git-ignored) — same source the legacy server.js used.
function loadLocal(): { MONGO_URI?: string; DB_NAME?: string } {
  for (const p of ['..', '.']) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require(path.resolve(process.cwd(), p, 'config.local.js'));
    } catch {
      /* try next */
    }
  }
  return {};
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private client: MongoClient | null = null;
  private dbPromise: Promise<Db> | null = null;
  private readonly local = loadLocal();
  private readonly uri = process.env.MONGO_URI || this.local.MONGO_URI || '';
  private readonly dbName = process.env.DB_NAME || this.local.DB_NAME || 'projectmanager';

  db(): Promise<Db> {
    if (!this.uri) return Promise.reject(new Error('No MONGO_URI configured'));
    if (!this.dbPromise) {
      this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 8000 });
      this.dbPromise = this.client
        .connect()
        .then((c) => c.db(this.dbName))
        .catch((err) => {
          this.dbPromise = null; // allow retry
          throw err;
        });
    }
    return this.dbPromise;
  }

  async col<T extends Document = Document>(name: string): Promise<Collection<T>> {
    return (await this.db()).collection<T>(name);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close().catch(() => {});
  }
}
