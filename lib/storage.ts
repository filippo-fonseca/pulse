import Pulse, { State } from './';
import { defineConfig, isFunction, isAsync } from './utils';

export interface StorageConfig {
  type: 'custom' | 'localStorage';
  prefix: string;
  async?: boolean;
  get?: any;
  set?: any;
  remove?: any;
}

export default class Storage {
  public config: StorageConfig;
  private storageReady: boolean = false;
  public persistedState: Set<State> = new Set();

  constructor(private instance: () => Pulse, config: StorageConfig) {
    this.config = defineConfig(config, {
      prefix: 'pulse',
      type: 'localStorage'
    });

    // assume if user provided get, set or remove methods that the storage type is custom
    if (config.get || config.set || config.remove) {
      this.config.type = 'custom';
    }

    if (this.localStorageAvailable() && this.config.type === 'localStorage') {
      this.config.get = localStorage.getItem.bind(localStorage);
      this.config.set = localStorage.setItem.bind(localStorage);
      this.config.remove = localStorage.removeItem.bind(localStorage);
      this.storageReady = true;
    } else {
      // Local storage not available, fallback to custom.
      this.config.type = 'custom';
      // ensuring all required storage properties are set
      if (isFunction(config.get) && isFunction(config.set) && isFunction(config.remove)) {
        // if asynchronous and developer did not explicitly define so, check
        if (this.config.async === undefined && isAsync(config.get)) this.config.async = true;
        this.storageReady = true;
      } else {
        console.warn('Pulse Error: Persistent storage not configured, check get, set and remove methods', config);
        this.storageReady = false;
      }
    }
  }

  public get(key: string) {
    if (!this.storageReady) return;
    if (this.config.async) {
      return new Promise((resolve, reject) => {
        this.config
          .get(this.getKey(key))
          .then(res => {
            // if result is not JSON for some reason, return it.
            if (typeof res !== 'string') return resolve(res);

            resolve(JSON.parse(res));
          })
          .catch(reject);
      });
    } else {
      try {
        return JSON.parse(this.config.get(this.getKey(key)));
      } catch (e) {
        return undefined;
      }
    }
  }

  public set(key: string, value: any) {
    if (!this.storageReady) return;
    this.config.set(this.getKey(key), JSON.stringify(value));
  }

  public remove(key: string) {
    if (!this.storageReady) return;
    this.config.remove(this.getKey(key));
  }

  private getKey(key: string) {
    return `_${this.config.prefix}_${key}`;
  }

  private localStorageAvailable() {
    try {
      localStorage.setItem('_', '_');
      localStorage.removeItem('_');
      return true;
    } catch (e) {
      return false;
    }
  }
}

// used by State and Selector to persist value inside storage
export function persistValue(state: State, key: string) {
  const storage = state.instance().storage;
  // validation
  if (!key && state.name) {
    key = state.name;
  } else if (!key) {
    console.warn('Pulse Persist Error: No key provided');
  } else {
    state.name = key;
  }
  // add ref to state instance inside storage
  storage.persistedState.add(state);

  // handle the value
  const handle = (storageVal: any) => {
    // if no storage value found, set current value in storage
    if (storageVal === null) storage.set(state.name, state.getPersistableValue());
    // if Selector, select current storage value
    else if (typeof state['select'] === 'function' && (typeof storageVal === 'string' || typeof storageVal === 'number')) state['select'](storageVal);
    // otherwise just ingest the storage value so that the State updates
    else state.instance().runtime.ingest(state, storageVal);
  };
  // Check if promise, then handle value
  if (storage.config.async) storage.get(state.name).then((value: any) => handle(value));
  // non promise
  else handle(storage.get(state.name));
}
