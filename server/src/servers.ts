// The ddeploy servers this webddeploy manages. Phase 1 is one server, but
// every route and record already carries a server id, so adding servers
// is configuration (SERVERS), not a migration.
import type { ServerRef } from '@webddeploy/shared';
import { PollCoalescer, SwrCache } from './cache.ts';
import type { ServerEntry } from './config.ts';
import { CommandConnector, type Connector } from './ddeploy/connector.ts';
import { DdeployClient } from './ddeploy/client.ts';

export interface ManagedServer {
  ref: ServerRef;
  client: DdeployClient;
  cache: SwrCache;
  polls: PollCoalescer;
}

export class ServerRegistry {
  private servers = new Map<string, ManagedServer>();

  static fromConfig(entries: readonly ServerEntry[]): ServerRegistry {
    const reg = new ServerRegistry();
    for (const e of entries) reg.add({ id: e.id, name: e.name }, new CommandConnector(e.command));
    return reg;
  }

  add(ref: ServerRef, connector: Connector): ManagedServer {
    const s: ManagedServer = { ref, client: new DdeployClient(connector), cache: new SwrCache(), polls: new PollCoalescer() };
    this.servers.set(ref.id, s);
    return s;
  }

  get(id: string): ManagedServer | undefined {
    return this.servers.get(id);
  }

  list(): ServerRef[] {
    return [...this.servers.values()].map((s) => s.ref);
  }
}
