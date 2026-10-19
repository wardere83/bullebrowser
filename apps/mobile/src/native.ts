import { Capacitor, registerPlugin } from '@capacitor/core';
import type { ConnectorDefinition, TabSummary } from '@bullebrowser/agent-core';

export interface MobileState {
  browsing: boolean;
  files: boolean;
  externalApps: boolean;
  enabledConnectors: string[];
  customConnectors: ConnectorDefinition[];
  hasKeyAnthropic: boolean;
  hasKeyOpenai: boolean;
}
export interface NativeMobile {
  getState(): Promise<MobileState>;
  setAccess(input: {
    capability: 'browsing' | 'files' | 'externalApps';
    enabled: boolean;
  }): Promise<void>;
  setConnectors(input: { enabled: string[]; custom: ConnectorDefinition[] }): Promise<void>;
  setKey(input: { provider: 'anthropic' | 'openai'; key: string }): Promise<void>;
  requestModel(input: {
    provider: 'anthropic' | 'openai';
    body: string;
    requestId: string;
  }): Promise<{ status: number; body: string }>;
  cancelModel(input: { requestId: string }): Promise<void>;
  browser(input: {
    action: string;
    tabId?: string;
    url?: string;
    script?: string;
  }): Promise<{ tabs?: TabSummary[]; tab?: TabSummary; value?: unknown }>;
  viewport(input: {
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
  }): Promise<void>;
  clearBrowserData(): Promise<void>;
  openExternal(input: { url: string }): Promise<void>;
}
export const Mobile = registerPlugin<NativeMobile>('MobileAgent');
export const isNative = Capacitor.isNativePlatform();
