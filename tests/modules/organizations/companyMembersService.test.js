const { createAppError } = require('../../../src/utils/appError');
const {
  createCompanyMembersService
} = require('../../../src/modules/organizations/companyMembersService');

function createFixture(repositoryOverrides = {}) {
  const connection = { id: 'connection' };
  const transaction = { id: 'transaction' };
  const repository = {
    withConnection: jest.fn((work) => work(connection)),
    withTransaction: jest.fn((work) => work(transaction)),
    listMembers: jest.fn(),
    getMemberMeta: jest.fn(),
    findCompany: jest.fn(),
    findMembershipByEmail: jest.fn(),
    attachProfileToCompany: jest.fn(),
    hasB2BRole: jest.fn(),
    addB2BRole: jest.fn(),
    insertMember: jest.fn(),
    findInvite: jest.fn(),
    findMemberForMutation: jest.fn(),
    updateMember: jest.fn(),
    deleteMember: jest.fn(),
    findActiveRole: jest.fn(),
    hasActiveMembership: jest.fn(),
    ...repositoryOverrides
  };
  const analytics = {
    enqueueEvent: jest.fn().mockResolvedValue({ id: 'event-1' }),
    queuePendingDispatch: jest.fn()
  };
  const identity = {
    getUserByEmail: jest.fn(),
    createInvitedCompanyUser: jest.fn(),
    generateCompanyInviteToken: jest.fn().mockReturnValue('invite-token')
  };
  const email = { sendCompanyInviteEmail: jest.fn().mockResolvedValue(true) };
  const log = { error: jest.fn() };
  const service = createCompanyMembersService({
    repository,
    analytics,
    identity,
    email,
    appError: createAppError,
    log
  });

  return { service, repository, analytics, identity, email, log, connection, transaction };
}

describe('organizations company members service', () => {
  test('returns members with numeric metadata', async () => {
    const fixture = createFixture({
      listMembers: jest.fn().mockResolvedValue([{ id: 'member-1' }]),
      getMemberMeta: jest.fn().mockResolvedValue({
        total: '4', active: '2', invited: '1', disabled: '1'
      })
    });

    await expect(fixture.service.getMembers('company-1', { status: 'active' })).resolves.toEqual({
      members: [{ id: 'member-1' }],
      meta: { total: 4, active: 2, invited: 1, disabled: 1 }
    });
    expect(fixture.repository.listMembers).toHaveBeenCalledWith(
      fixture.connection,
      'company-1',
      { status: 'active' }
    );
  });

  test('invites an existing B2B-compatible user and dispatches analytics', async () => {
    const fixture = createFixture({
      findCompany: jest.fn().mockResolvedValue({ name: 'Example Co' }),
      findMembershipByEmail: jest.fn().mockResolvedValue(null),
      hasB2BRole: jest.fn().mockResolvedValue(false),
      insertMember: jest.fn().mockResolvedValue({
        id: 'member-1', role: 'editor', status: 'invited', created_at: 'now'
      })
    });
    fixture.identity.getUserByEmail.mockResolvedValue({
      id: 'user-1', full_name: 'Existing User', roles: []
    });

    await expect(fixture.service.createMember('company-1', 'admin-1', {
      email: ' Existing@Example.com ',
      full_name: 'Ignored Name',
      role: 'editor',
      send_notification_email: true,
      frontend_origin: 'https://app.example.com'
    })).resolves.toEqual({
      id: 'member-1',
      user_id: 'user-1',
      email: 'existing@example.com',
      full_name: 'Existing User',
      role: 'editor',
      status: 'invited',
      created_at: 'now'
    });

    expect(fixture.repository.attachProfileToCompany).toHaveBeenCalledWith(
      fixture.transaction,
      'company-1',
      'user-1'
    );
    expect(fixture.repository.addB2BRole).toHaveBeenCalledWith(fixture.transaction, 'user-1');
    expect(fixture.analytics.enqueueEvent).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({ event_name: 'wc_member_invited', entity_id: 'member-1' })
    );
    expect(fixture.analytics.queuePendingDispatch).toHaveBeenCalledWith(['event-1']);
    expect(fixture.email.sendCompanyInviteEmail).toHaveBeenCalledWith(
      'existing@example.com',
      'invite-token',
      'Existing User',
      { companyName: 'Example Co', frontendOrigin: 'https://app.example.com' }
    );
  });

  test('rejects an existing B2C account before inserting membership', async () => {
    const fixture = createFixture({
      findCompany: jest.fn().mockResolvedValue({ name: 'Example Co' }),
      findMembershipByEmail: jest.fn().mockResolvedValue(null)
    });
    fixture.identity.getUserByEmail.mockResolvedValue({
      id: 'user-1', full_name: 'Consumer', roles: ['b2c']
    });

    await expect(fixture.service.createMember('company-1', 'admin-1', {
      email: 'consumer@example.com', full_name: 'Consumer', role: 'member'
    })).rejects.toMatchObject({ code: 'B2C_EMAIL_NOT_ALLOWED_FOR_B2B', statusCode: 409 });
    expect(fixture.repository.insertMember).not.toHaveBeenCalled();
  });

  test('protects users from updating their own membership', async () => {
    const fixture = createFixture({
      findMemberForMutation: jest.fn().mockResolvedValue({ user_id: 'user-1', role: 'member' })
    });

    await expect(fixture.service.updateMember(
      'company-1',
      'member-1',
      'user-1',
      { status: 'disabled' }
    )).rejects.toMatchObject({ code: 'CANNOT_UPDATE_SELF', statusCode: 400 });
    expect(fixture.repository.updateMember).not.toHaveBeenCalled();
  });

  test('queues role-change analytics after a successful update', async () => {
    const fixture = createFixture({
      findMemberForMutation: jest.fn().mockResolvedValue({ user_id: 'user-2', role: 'editor' }),
      updateMember: jest.fn().mockResolvedValue({
        id: 'member-1', role: 'viewer', status: 'active'
      })
    });

    await expect(fixture.service.updateMember(
      'company-1',
      'member-1',
      'admin-1',
      { role: 'viewer' }
    )).resolves.toEqual({ id: 'member-1', role: 'viewer', status: 'active' });
    expect(fixture.analytics.enqueueEvent).toHaveBeenCalledWith(
      fixture.transaction,
      expect.objectContaining({
        event_name: 'wc_member_role_changed',
        payload: { previous_role: 'member', next_role: 'viewer' }
      })
    );
    expect(fixture.analytics.queuePendingDispatch).toHaveBeenCalledWith(['event-1']);
  });

  test('uses repository membership checks for authorization', async () => {
    const fixture = createFixture({
      findActiveRole: jest.fn().mockResolvedValue('admin'),
      hasActiveMembership: jest.fn().mockResolvedValue(true)
    });

    await expect(fixture.service.isCompanyAdmin('user-1', 'company-1')).resolves.toBe(true);
    await expect(fixture.service.isCompanyMember('user-1', 'company-1')).resolves.toBe(true);
    expect(fixture.repository.findActiveRole).toHaveBeenCalledWith(
      fixture.connection,
      'company-1',
      'user-1'
    );
  });
});
