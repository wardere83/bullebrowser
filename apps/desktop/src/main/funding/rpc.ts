// The single door between the renderer and the funding platform.
//
// Every call arrives on one channel as (namespace, method, arguments). Before
// anything runs, this checks — in this order — that the call comes from the
// app's own window and top frame, that the method is one the shared table
// lists, that an organization is active when the call works on one, and that
// the user's role in that organization allows it. The organization a call
// works on is always the active one, resolved here in main: the renderer never
// names it, so it cannot reach another organization's material.
//
// Handlers return plain values or throw; the door turns both into an Outcome so
// that no stack trace, path or internal message can cross to the renderer.

import { type BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  FUNDING_METHODS,
  type FundingBridge,
  type FundingEvent,
  type FundingNamespace,
  type Organization,
  type Outcome,
  type Permission,
  type SessionInfo,
} from '../../shared/funding.js';
import { IPC } from '../../shared/ipc.js';
import { FundingError, toPublicError } from './errors.js';
import { isUuid } from './org-store.js';

export interface CallContext {
  /** The app window; native dialogs attach to it. */
  window: BrowserWindow;
  session: SessionInfo;
  /** The active organization, or null for the few calls that work without one. */
  organization: Organization | null;
}

type HandlerOf<Method> = Method extends (...args: infer Args) => Promise<Outcome<infer Value>>
  ? (context: CallContext, ...args: Args) => Value | Promise<Value>
  : never;

/** One handler for every method in the shared table; a missing one is a type error. */
export type FundingHandlers = {
  [N in FundingNamespace]: { [M in keyof FundingBridge[N]]: HandlerOf<FundingBridge[N][M]> };
};

/** What the door needs from the identity service. */
export interface IdentityGate {
  currentSession(): Promise<SessionInfo>;
  requireOrganization(): Promise<{ session: SessionInfo; organization: Organization }>;
  authorize(permission: Permission, organizationId?: string): Promise<void>;
}

/** Calls that make sense before any organization exists or is chosen. */
const WITHOUT_ORGANIZATION: Record<string, readonly string[]> = {
  identity: ['get', 'updateProfile', 'createOrganization', 'switchOrganization', 'can', 'assistant'],
  opportunities: ['sources', 'portals'],
  jobs: ['list', 'cancel'],
};

/** Calls whose first argument names the organization they act on. */
const NAMES_ORGANIZATION: Record<string, readonly string[]> = {
  identity: ['updateOrganization', 'deleteOrganization'],
};

const MAX_ARGUMENTS = 6;

function lookup(namespace: unknown, method: unknown): { namespace: FundingNamespace; method: string; permission: Permission | null } {
  if (typeof namespace !== 'string' || typeof method !== 'string' || !Object.hasOwn(FUNDING_METHODS, namespace)) {
    throw new FundingError('INVALID_INPUT', 'That request is not recognized.');
  }
  const table = FUNDING_METHODS[namespace as FundingNamespace] as Record<string, Permission | null>;
  if (!Object.hasOwn(table, method)) throw new FundingError('INVALID_INPUT', 'That request is not recognized.');
  return { namespace: namespace as FundingNamespace, method, permission: table[method] ?? null };
}

export async function dispatchFundingCall(
  deps: { window: BrowserWindow | null; handlers: FundingHandlers; identity: IdentityGate },
  event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  rawNamespace: unknown,
  rawMethod: unknown,
  rawArgs: unknown,
): Promise<Outcome<unknown>> {
  try {
    const { window } = deps;
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new FundingError('FORBIDDEN', 'This is only available in the app.');
    }
    const { namespace, method, permission } = lookup(rawNamespace, rawMethod);
    if (!Array.isArray(rawArgs) || rawArgs.length > MAX_ARGUMENTS) {
      throw new FundingError('INVALID_INPUT', 'That request is not recognized.');
    }

    const session = await deps.identity.currentSession();
    const needsOrganization = !WITHOUT_ORGANIZATION[namespace]?.includes(method);
    let organization: Organization | null = null;

    if (NAMES_ORGANIZATION[namespace]?.includes(method)) {
      const target = rawArgs[0];
      if (!isUuid(target)) throw new FundingError('INVALID_INPUT', 'That organization is not valid.');
      if (permission) await deps.identity.authorize(permission, target);
    } else if (needsOrganization) {
      ({ organization } = await deps.identity.requireOrganization());
      if (permission) await deps.identity.authorize(permission, organization.id);
    } else if (permission) {
      // A permission on a call that needs no organization still needs one to be checked against.
      ({ organization } = await deps.identity.requireOrganization());
      await deps.identity.authorize(permission, organization.id);
    } else if (session.organizationId) {
      organization = await deps.identity.requireOrganization().then(
        (active) => active.organization,
        () => null,
      );
    }

    const handler = (deps.handlers[namespace] as Record<string, (context: CallContext, ...args: unknown[]) => unknown>)[method];
    if (typeof handler !== 'function') throw new FundingError('INVALID_INPUT', 'That request is not recognized.');
    const value = await handler({ window, session, organization }, ...rawArgs);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: toPublicError(error) };
  }
}

/**
 * Registers the door. Safe to call again when the window is recreated: the
 * previous registration is replaced, and the current window is looked up on
 * every call rather than captured.
 */
export function registerFundingRpc(deps: {
  getWindow: () => BrowserWindow | null;
  handlers: FundingHandlers;
  identity: IdentityGate;
}): void {
  ipcMain.removeHandler(IPC.FUNDING_CALL);
  ipcMain.handle(IPC.FUNDING_CALL, (event, namespace: unknown, method: unknown, args: unknown) =>
    dispatchFundingCall(
      { window: deps.getWindow(), handlers: deps.handlers, identity: deps.identity },
      event,
      namespace,
      method,
      args,
    ),
  );
}

/** Tells the renderer that something changed. Does nothing once the window is gone. */
export function sendFundingEvent(window: BrowserWindow | null, event: FundingEvent): void {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  window.webContents.send(IPC.FUNDING_EVENT, event);
}

/** A handler helper: the active organization, or the error the user should see. */
export function organizationOf(context: CallContext): Organization {
  if (!context.organization) {
    throw new FundingError('ORGANIZATION_NOT_FOUND', 'Create or choose an organization first.');
  }
  return context.organization;
}
