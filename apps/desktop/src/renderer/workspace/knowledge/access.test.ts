import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '../../../shared/funding.js';
import {
  CANNOT_APPROVE,
  CANNOT_CHANGE_DOCUMENTS,
  CANNOT_CHANGE_STATEMENTS,
  CANNOT_DRAFT,
  CANNOT_SETTLE,
  rolesWith,
} from './access.js';

describe('rolesWith', () => {
  it('names the roles the shared table gives a permission to', () => {
    expect(rolesWith('knowledge.manage')).toBe('Owners, admins and members');
    expect(rolesWith('profile.approve')).toBe('Owners and admins');
    expect(rolesWith('organization.manage')).toBe('Owners');
    expect(rolesWith('knowledge.read')).toBe('Owners, admins, members and viewers');
  });

  it('agrees with the table for the two permissions the Knowledge Hub checks', () => {
    expect(ROLE_PERMISSIONS.member).toContain('knowledge.manage');
    expect(ROLE_PERMISSIONS.member).not.toContain('profile.approve');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('knowledge.manage');
  });
});

describe('why a control is missing', () => {
  it('says who can do it instead', () => {
    expect(CANNOT_CHANGE_DOCUMENTS).toBe(
      'Your role can read this organization’s documents but cannot change them. Owners, admins and members can upload, replace and delete documents.',
    );
    expect(CANNOT_CHANGE_STATEMENTS).toContain('Owners, admins and members can add, edit and remove statements.');
    expect(CANNOT_APPROVE).toBe(
      'Your role cannot approve or reject statements. Owners and admins can.',
    );
    expect(CANNOT_SETTLE).toBe('Your role cannot settle a conflict. Owners and admins can.');
    expect(CANNOT_DRAFT).toBe('Your role cannot start a draft. Owners, admins and members can.');
  });
});
