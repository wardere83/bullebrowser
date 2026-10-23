// Why a control is missing, for someone whose role does not allow it. The
// roles that may do a thing are read from the shared table, so these sentences
// stay true when the table changes. Main enforces the same table whatever the
// screen shows.

import { ROLE_PERMISSIONS, type OrgRole, type Permission } from '../../../shared/funding.js';
import { ROLE_LABELS } from '../organization.js';
import { listInWords } from './documents.js';

/** The roles that hold a permission, as the start of a sentence: "Owners, admins and members". */
export function rolesWith(permission: Permission): string {
  const names = (Object.keys(ROLE_PERMISSIONS) as OrgRole[])
    .filter((role) => ROLE_PERMISSIONS[role].includes(permission))
    .map((role) => `${ROLE_LABELS[role].toLowerCase()}s`);
  const listed = listInWords(names);
  return listed ? `${listed.charAt(0).toUpperCase()}${listed.slice(1)}` : 'Nobody';
}

/** Shown in place of the upload, replace and delete controls. */
export const CANNOT_CHANGE_DOCUMENTS = `Your role can read this organization’s documents but cannot change them. ${rolesWith('knowledge.manage')} can upload, replace and delete documents.`;

/** Shown in place of the controls that add, edit and remove statements. */
export const CANNOT_CHANGE_STATEMENTS = `Your role can read the profile but cannot change it. ${rolesWith('knowledge.manage')} can add, edit and remove statements.`;

/** Shown in place of the controls that approve and reject. */
export const CANNOT_APPROVE = `Your role cannot approve or reject statements. ${rolesWith('profile.approve')} can.`;

/** Shown in place of the choice that settles a conflict. */
export const CANNOT_SETTLE = `Your role cannot settle a conflict. ${rolesWith('profile.approve')} can.`;

/** Shown in place of the control that drafts a profile. */
export const CANNOT_DRAFT = `Your role cannot start a draft. ${rolesWith('knowledge.manage')} can.`;
