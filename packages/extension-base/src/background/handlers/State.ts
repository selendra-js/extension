// Copyright 2019-2022 @polkadot/extension-bg authors & contributors
// SPDX-License-Identifier: Apache-2.0

import type { MetadataDef, ProviderMeta } from '@polkadot/extension-inject/types';
import type { JsonRpcResponse, ProviderInterface, ProviderInterfaceCallback } from '@polkadot/rpc-provider/types';
import type { AccountJson, AuthorizeRequest, MetadataRequest, RequestAuthorizeTab, RequestRpcSend, RequestRpcSubscribe, RequestRpcUnsubscribe, RequestSign, ResponseRpcListProviders, ResponseSigning, SigningRequest } from '../types';

import { BehaviorSubject } from 'rxjs';

import { getId } from '@polkadot/extension-base/utils/getId';
import { addMetadata, knownMetadata } from '@polkadot/extension-chains';
import { knownGenesis } from '@polkadot/networks/defaults';
import settings from '@polkadot/ui-settings';
import { assert } from '@polkadot/util';

import { MetadataStore } from '../../stores';
import { withErrorLog } from './helpers';

interface Resolver<T> {
  reject: (error: Error) => void;
  resolve: (result: T) => void;
}

interface AuthRequest extends Resolver<AuthResponse> {
  id: string;
  idStr: string;
  request: RequestAuthorizeTab;
  url: string;
}

export type AuthUrls = Record<string, AuthUrlInfo>;

export type AuthorizedAccountsDiff = [url: string, authorizedAccounts: AuthUrlInfo['authorizedAccounts']][]

export interface AuthUrlInfo {
  count: number;
  id: string;
  // this is from pre-0.44.1
  isAllowed?: boolean;
  origin: string;
  url: string;
  authorizedAccounts: string[];
}

interface MetaRequest extends Resolver<boolean> {
  id: string;
  request: MetadataDef;
  url: string;
}

export interface AuthResponse {
  result: boolean;
  authorizedAccounts: string[];
}

// List of providers passed into constructor. This is the list of providers
// exposed by the extension.
type Providers = Record<string, {
  meta: ProviderMeta;
  // The provider is not running at init, calling this will instantiate the
  // provider.
  start: () => ProviderInterface;
}>

interface SignRequest extends Resolver<ResponseSigning> {
  account: AccountJson;
  id: string;
  request: RequestSign;
  url: string;
}

const NOTIFICATION_URL = chrome.extension.getURL('notification.html');

const POPUP_WINDOW_OPTS: chrome.windows.CreateData = {
  focused: true,
  height: 621,
  left: 150,
  top: 150,
  type: 'popup',
  url: NOTIFICATION_URL,
  width: 560
};

const NORMAL_WINDOW_OPTS: chrome.windows.CreateData = {
  focused: true,
  type: 'normal',
  url: NOTIFICATION_URL
};

export enum NotificationOptions {
  None,
  Normal,
  PopUp,
}

const AUTH_URLS_KEY = 'authUrls';
const DEFAULT_AUTH_ACCOUNTS = 'defaultAuthAccounts';

function extractMetadata (store: MetadataStore): void {
  store.allMap((map): void => {
    const knownEntries = Object.entries(knownGenesis);
    const defs: Record<string, { def: MetadataDef, index: number, key: string }> = {};
    const removals: string[] = [];

    Object
      .entries(map)
      .forEach(([key, def]): void => {
        const entry = knownEntries.find(([, hashes]) => hashes.includes(def.genesisHash));

        if (entry) {
          const [name, hashes] = entry;
          const index = hashes.indexOf(def.genesisHash);

          // flatten the known metadata based on the genesis index
          // (lower is better/newer)
          if (!defs[name] || (defs[name].index > index)) {
            if (defs[name]) {
              // remove the old version of the metadata
              removals.push(defs[name].key);
            }

            defs[name] = { def, index, key };
          }
        } else {
          // this is not a known entry, so we will just apply it
          defs[key] = { def, index: 0, key };
        }
      });

    removals.forEach((key) => store.remove(key));
    Object.values(defs).forEach(({ def }) => addMetadata(def));
  });
}

export default class State {
  readonly #authUrls: AuthUrls = {};

  readonly #authRequests: Record<string, AuthRequest> = {};

  readonly #metaStore = new MetadataStore();

  // Map of providers currently injected in tabs
  readonly #injectedProviders = new Map<chrome.runtime.Port, ProviderInterface>();

  readonly #metaRequests: Record<string, MetaRequest> = {};

  #notification = settings.notification;

  // Map of all providers exposed by the extension, they are retrievable by key
  readonly #providers: Providers;

  readonly #signRequests: Record<string, SignRequest> = {};

  #windows: number[] = [];

  #connectedTabsUrl: string[] = [];

  public readonly authSubject: BehaviorSubject<AuthorizeRequest[]> = new BehaviorSubject<AuthorizeRequest[]>([]);

  public readonly metaSubject: BehaviorSubject<MetadataRequest[]> = new BehaviorSubject<MetadataRequest[]>([]);

  public readonly signSubject: BehaviorSubject<SigningRequest[]> = new BehaviorSubject<SigningRequest[]>([]);

  public defaultAuthAccountSelection: string[] = [];

  constructor (providers: Providers = {}) {
    this.#providers = providers;

    extractMetadata(this.#metaStore);

    // retrieve previously set authorizations
    const authString = localStorage.getItem(AUTH_URLS_KEY) || '{}';
    const previousAuth = JSON.parse(authString) as AuthUrls;

    this.#authUrls = previousAuth;

    // retrieve previously set default auth accounts
    const defaultAuthString = localStorage.getItem(DEFAULT_AUTH_ACCOUNTS) || '[]';
    const previousDefaultAuth = JSON.parse(defaultAuthString) as string[];

    this.defaultAuthAccountSelection = previousDefaultAuth;
  }

  public get knownMetadata (): MetadataDef[] {
    return knownMetadata();
  }

  public get numAuthRequests (): number {
    return Object.keys(this.#authRequests).length;
  }

  public get numMetaRequests (): number {
    return Object.keys(this.#metaRequests).length;
  }

  public get numSignRequests (): number {
    return Object.keys(this.#signRequests).length;
  }

  public get allAuthRequests (): AuthorizeRequest[] {
    return Object
      .values(this.#authRequests)
      .map(({ id, request, url }): AuthorizeRequest => ({ id, request, url }));
  }

  public get allMetaRequests (): MetadataRequest[] {
    return Object
      .values(this.#metaRequests)
      .map(({ id, request, url }): MetadataRequest => ({ id, request, url }));
  }

  public get allSignRequests (): SigningRequest[] {
    return Object
      .values(this.#signRequests)
      .map(({ account, id, request, url }): SigningRequest => ({ account, id, request, url }));
  }

  public get authUrls (): AuthUrls {
    return this.#authUrls;
  }

  private popupClose (): void {
    this.#windows.forEach((id: number) =>
      withErrorLog(() => chrome.windows.remove(id))
    );
    this.#windows = [];
  }

  private popupOpen (): void {
    this.#notification !== 'extension' &&
      chrome.windows.create(
        this.#notification === 'window'
          ? NORMAL_WINDOW_OPTS
          : POPUP_WINDOW_OPTS,
        (window): void => {
          if (window) {
            this.#windows.push(window.id || 0);
          }
        });
  }

  private authComplete = (id: string, resolve: (resValue: AuthResponse) => void, reject: (error: Error) => void): Resolver<AuthResponse> => {
    const complete = (authorizedAccounts: string[] = []) => {
      const { idStr, request: { origin }, url } = this.#authRequests[id];

      this.#authUrls[this.stripUrl(url)] = {
        authorizedAccounts,
        count: 0,
        id: idStr,
        origin,
        url
      };

      this.saveCurrentAuthList();
      this.updateDefaultAuthAccounts(authorizedAccounts);
      delete this.#authRequests[id];
      this.updateIconAuth(true);
    };

    return {
      reject: (error: Error): void => {
        complete();
        reject(error);
      },
      resolve: ({ authorizedAccounts, result }: AuthResponse): void => {
        complete(authorizedAccounts);
        resolve({ authorizedAccounts, result });
      }
    };
  };

  public udateCurrentTabsUrl (urls: string[]) {
    const connectedTabs = urls.map((url) => {
      let strippedUrl = '';

      // the assert in stripUrl may throw for new tabs with "chrome://newtab/"
      try {
        strippedUrl = this.stripUrl(url);
      } catch (e) {
        console.error(e);
      }

      // return the stripped url only if this website is known
      return !!strippedUrl && this.authUrls[strippedUrl]
        ? strippedUrl
        : undefined;
    })
      .filter((value) => !!value) as string[];

    this.#connectedTabsUrl = connectedTabs;
  }

  public getConnectedTabsUrl () {
    return this.#connectedTabsUrl;
  }

  public deleteAuthRequest (requestId: string) {
    delete this.#authRequests[requestId];
    this.updateIconAuth(true);
  }

  private saveCurrentAuthList () {
    localStorage.setItem(AUTH_URLS_KEY, JSON.stringify(this.#authUrls));
  }

  private saveDefaultAuthAccounts () {
    localStorage.setItem(DEFAULT_AUTH_ACCOUNTS, JSON.stringify(this.defaultAuthAccountSelection));
  }

  public updateDefaultAuthAccounts (newList: string[]) {
    this.defaultAuthAccountSelection = newList;
    this.saveDefaultAuthAccounts();
  }

  private metaComplete = (id: string, resolve: (result: boolean) => void, reject: (error: Error) => void): Resolver<boolean> => {
    const complete = (): void => {
      delete this.#metaRequests[id];
      this.updateIconMeta(true);
    };

    return {
      reject: (error: Error): void => {
        complete();
        reject(error);
      },
      resolve: (result: boolean): void => {
        complete();
        resolve(result);
      }
    };
  };

  private signComplete = (id: string, resolve: (result: ResponseSigning) => void, reject: (error: Error) => void): Resolver<ResponseSigning> => {
    const complete = (): void => {
      delete this.#signRequests[id];
      this.updateIconSign(true);
    };

    return {
      reject: (error: Error): void => {
        complete();
        reject(error);
      },
      resolve: (result: ResponseSigning): void => {
        complete();
        resolve(result);
      }
    };
  };

  public stripUrl (url: string): string {
    assert(url && (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('ipfs:') || url.startsWith('ipns:')), `Invalid url ${url}, expected to start with http: or https: or ipfs: or ipns:`);

    const parts = url.split('/');

    return parts[2];
  }

  private updateIcon (shouldClose?: boolean): void {
    const authCount = this.numAuthRequests;
    const metaCount = this.numMetaRequests;
    const signCount = this.numSignRequests;
    const text = (
      authCount
        ? 'Auth'
        : metaCount
          ? 'Meta'
          : (signCount ? `${signCount}` : '')
    );

    withErrorLog(() => chrome.browserAction.setBadgeText({ text }));

    if (shouldClose && text === '') {
      this.popupClose();
    }
  }

  public removeAuthorization (url: string): AuthUrls {
    const entry = this.#authUrls[url];

    assert(entry, `The source ${url} is not known`);

    delete this.#authUrls[url];
    this.saveCurrentAuthList();

    return this.#authUrls;
  }

  private updateIconAuth (shouldClose?: boolean): void {
    this.authSubject.next(this.allAuthRequests);
    this.updateIcon(shouldClose);
  }

  private updateIconMeta (shouldClose?: boolean): void {
    this.metaSubject.next(this.allMetaRequests);
    this.updateIcon(shouldClose);
  }

  private updateIconSign (shouldClose?: boolean): void {
    this.signSubject.next(this.allSignRequests);
    this.updateIcon(shouldClose);
  }

  public updateAuthorizedAccounts (authorizedAccountDiff: AuthorizedAccountsDiff): void {
    authorizedAccountDiff.forEach(([url, authorizedAccountDiff]) => {
      this.#authUrls[url].authorizedAccounts = authorizedAccountDiff;
    });

    this.saveCurrentAuthList();
  }

  public async authorizeUrl (url: string, request: RequestAuthorizeTab): Promise<AuthResponse> {
    const idStr = this.stripUrl(url);

    // Do not enqueue duplicate authorization requests.
    const isDuplicate = Object
      .values(this.#authRequests)
      .some((request) => request.idStr === idStr);

    assert(!isDuplicate, `The source ${url} has a pending authorization request`);

    if (this.#authUrls[idStr]) {
      // this url was seen in the past
      assert(this.#authUrls[idStr].authorizedAccounts || this.#authUrls[idStr].isAllowed, `The source ${url} is not allowed to interact with this extension`);

      return {
        authorizedAccounts: [],
        result: false
      };
    }

    return new Promise((resolve, reject): void => {
      const id = getId();

      this.#authRequests[id] = {
        ...this.authComplete(id, resolve, reject),
        id,
        idStr,
        request,
        url
      };

      this.updateIconAuth();
      this.popupOpen();
    });
  }

  public ensureUrlAuthorized (url: string): boolean {
    const entry = this.#authUrls[this.stripUrl(url)];

    assert(entry, `The source ${url} has not been enabled yet`);

    return true;
  }

  public injectMetadata (url: string, request: MetadataDef): Promise<boolean> {
    return new Promise((resolve, reject): void => {
      const id = getId();

      this.#metaRequests[id] = {
        ...this.metaComplete(id, resolve, reject),
        id,
        request,
        url
      };

      this.updateIconMeta();
      this.popupOpen();
    });
  }

  public getAuthRequest (id: string): AuthRequest {
    return this.#authRequests[id];
  }

  public getMetaRequest (id: string): MetaRequest {
    return this.#metaRequests[id];
  }

  public getSignRequest (id: string): SignRequest {
    return this.#signRequests[id];
  }

  // List all providers the extension is exposing
  public rpcListProviders (): Promise<ResponseRpcListProviders> {
    return Promise.resolve(Object.keys(this.#providers).reduce((acc, key) => {
      acc[key] = this.#providers[key].meta;

      return acc;
    }, {} as ResponseRpcListProviders));
  }

  public rpcSend (request: RequestRpcSend, port: chrome.runtime.Port): Promise<JsonRpcResponse> {
    const provider = this.#injectedProviders.get(port);

    assert(provider, 'Cannot call pub(rpc.subscribe) before provider is set');

    return provider.send(request.method, request.params);
  }

  // Start a provider, return its meta
  public rpcStartProvider (key: string, port: chrome.runtime.Port): Promise<ProviderMeta> {
    assert(Object.keys(this.#providers).includes(key), `Provider ${key} is not exposed by extension`);

    if (this.#injectedProviders.get(port)) {
      return Promise.resolve(this.#providers[key].meta);
    }

    // Instantiate the provider
    this.#injectedProviders.set(port, this.#providers[key].start());

    // Close provider connection when page is closed
    port.onDisconnect.addListener((): void => {
      const provider = this.#injectedProviders.get(port);

      if (provider) {
        withErrorLog(() => provider.disconnect());
      }

      this.#injectedProviders.delete(port);
    });

    return Promise.resolve(this.#providers[key].meta);
  }

  public rpcSubscribe ({ method, params, type }: RequestRpcSubscribe, cb: ProviderInterfaceCallback, port: chrome.runtime.Port): Promise<number | string> {
    const provider = this.#injectedProviders.get(port);

    assert(provider, 'Cannot call pub(rpc.subscribe) before provider is set');

    return provider.subscribe(type, method, params, cb);
  }

  public rpcSubscribeConnected (_request: null, cb: ProviderInterfaceCallback, port: chrome.runtime.Port): void {
    const provider = this.#injectedProviders.get(port);

    assert(provider, 'Cannot call pub(rpc.subscribeConnected) before provider is set');

    cb(null, provider.isConnected); // Immediately send back current isConnected
    provider.on('connected', () => cb(null, true));
    provider.on('disconnected', () => cb(null, false));
  }

  public rpcUnsubscribe (request: RequestRpcUnsubscribe, port: chrome.runtime.Port): Promise<boolean> {
    const provider = this.#injectedProviders.get(port);

    assert(provider, 'Cannot call pub(rpc.unsubscribe) before provider is set');

    return provider.unsubscribe(request.type, request.method, request.subscriptionId);
  }

  public saveMetadata (meta: MetadataDef): void {
    this.#metaStore.set(meta.genesisHash, meta);

    addMetadata(meta);
  }

  public setNotification (notification: string): boolean {
    this.#notification = notification;

    return true;
  }

  public sign (url: string, request: RequestSign, account: AccountJson): Promise<ResponseSigning> {
    const id = getId();

    return new Promise((resolve, reject): void => {
      this.#signRequests[id] = {
        ...this.signComplete(id, resolve, reject),
        account,
        id,
        request,
        url
      };

      this.updateIconSign();
      this.popupOpen();
    });
  }
}
