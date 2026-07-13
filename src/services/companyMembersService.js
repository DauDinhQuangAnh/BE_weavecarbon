const pool = require('../config/database');
const analyticsService = require('./analyticsService');
const authService = require('./authService');
const emailService = require('./emailService');
const { createAppError } = require('../utils/appError');
const logger = require('../utils/logger');

const pushAnalyticsEvent = async (client, eventIds, payload, scope) => {
    try {
        const event = await analyticsService.enqueueEvent(client, payload);
        if (event?.id) {
            eventIds.push(event.id);
        }
    } catch (error) {
        logger.error({ err: error }, `[companyMembersService] Failed to queue ${scope}`);
    }
};

class CompanyMembersService {
    /**
     * Get company members list
     */
    async getMembers(companyId, filters = {}) {
        const client = await pool.connect();
        try {
            let query = `
        SELECT 
          cm.id,
          cm.user_id,
          u.full_name,
          u.email,
          cm.role,
          cm.status,
          cm.last_login,
          cm.created_at
        FROM company_members cm
        INNER JOIN users u ON u.id = cm.user_id
        WHERE cm.company_id = $1
      `;

            const params = [companyId];
            let paramIndex = 2;

            // Apply filters
            if (filters.status) {
                query += ` AND cm.status = $${paramIndex}`;
                params.push(filters.status);
                paramIndex++;
            }

            if (filters.role) {
                query += ` AND cm.role = $${paramIndex}`;
                params.push(filters.role);
                paramIndex++;
            }

            query += ` ORDER BY cm.created_at DESC`;

            const result = await client.query(query, params);

            // Get meta info
            const metaQuery = `
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'active') as active,
          COUNT(*) FILTER (WHERE status = 'invited') as invited,
          COUNT(*) FILTER (WHERE status = 'disabled') as disabled
        FROM company_members
        WHERE company_id = $1
      `;
            const metaResult = await client.query(metaQuery, [companyId]);
            const meta = metaResult.rows[0];

            return {
                members: result.rows,
                meta: {
                    total: parseInt(meta.total),
                    active: parseInt(meta.active),
                    invited: parseInt(meta.invited),
                    disabled: parseInt(meta.disabled)
                }
            };
        } finally {
            client.release();
        }
    }

    /**
     * Create new member through email invite flow
     */
    async createMember(companyId, invitedBy, memberData) {
        const {
            email,
            full_name,
            role,
            send_notification_email,
            frontend_origin
        } = memberData;
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const normalizedFullName = String(full_name || '').trim();

        const client = await pool.connect();
        const analyticsEventIds = [];
        try {
            await client.query('BEGIN');

            const companyQuery = await client.query(
                'SELECT name FROM companies WHERE id = $1',
                [companyId]
            );

            if (companyQuery.rows.length === 0) {
                throw createAppError('Company not found', {
                    statusCode: 404,
                    code: 'COMPANY_NOT_FOUND'
                });
            }

            const company = companyQuery.rows[0];
            const existingQuery = `
        SELECT cm.id 
        FROM company_members cm
        INNER JOIN users u ON u.id = cm.user_id
        WHERE cm.company_id = $1 AND u.email = $2
      `;
            const existingResult = await client.query(existingQuery, [companyId, normalizedEmail]);

            if (existingResult.rows.length > 0) {
                throw createAppError('Email already exists in company', {
                    statusCode: 409,
                    code: 'DUPLICATE_MEMBER_EMAIL'
                });
            }

            const existingUser = await authService.getUserByEmail(normalizedEmail);
            const memberFullName = existingUser?.full_name || normalizedFullName;
            let userId;

            if (existingUser) {
                const existingRoles = Array.isArray(existingUser.roles) ? existingUser.roles : [];

                if (existingRoles.includes('b2c')) {
                    throw createAppError('This email is already registered as a B2C account and cannot be invited as a B2B sub-account.', {
                        statusCode: 409,
                        code: 'B2C_EMAIL_NOT_ALLOWED_FOR_B2B'
                    });
                }

                userId = existingUser.id;

                await client.query(
                    'UPDATE profiles SET company_id = $1 WHERE user_id = $2 AND company_id IS NULL',
                    [companyId, userId]
                );

                const roleCheck = await client.query(
                    'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
                    [userId, 'b2b']
                );

                if (roleCheck.rows.length === 0) {
                    await client.query(
                        'INSERT INTO user_roles (user_id, role, created_at) VALUES ($1, $2, NOW())',
                        [userId, 'b2b']
                    );
                }
            } else {
                const { user } = await authService.createInvitedCompanyUser({
                    client,
                    email: normalizedEmail,
                    fullName: normalizedFullName,
                    companyId
                });
                userId = user.id;
            }

            const memberQuery = `
        INSERT INTO company_members (
          company_id, user_id, role, status, invited_by, created_at, updated_at
        )
        VALUES ($1, $2, $3, 'invited', $4, NOW(), NOW())
        RETURNING id, user_id, role, status, created_at
      `;
            const memberResult = await client.query(memberQuery, [companyId, userId, role, invitedBy]);
            const member = memberResult.rows[0];

            await pushAnalyticsEvent(client, analyticsEventIds, {
                event_name: 'wc_member_invited',
                user_id: invitedBy,
                company_id: companyId,
                entity_type: 'company_member',
                entity_id: member.id,
                payload: {
                    member_role: role
                }
            }, 'wc_member_invited');

            await client.query('COMMIT');
            analyticsService.queuePendingDispatch(analyticsEventIds);

            if (send_notification_email) {
                const inviteToken = authService.generateCompanyInviteToken({
                    email: normalizedEmail,
                    companyId
                });
                emailService.sendCompanyInviteEmail(
                    normalizedEmail,
                    inviteToken,
                    memberFullName,
                    {
                        companyName: company.name,
                        frontendOrigin: frontend_origin || null
                    }
                ).catch((err) => logger.error({ err }, 'Failed to send company invite email'));
            }

            return {
                id: member.id,
                user_id: userId,
                email: normalizedEmail,
                full_name: memberFullName,
                role: member.role,
                status: member.status,
                created_at: member.created_at
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async resendInvite(companyId, memberId, options = {}) {
        const client = await pool.connect();
        try {
            const result = await client.query(
                `SELECT
                   cm.id,
                   cm.user_id,
                   cm.role,
                   cm.status,
                   u.email,
                   u.full_name,
                   c.name AS company_name
                 FROM company_members cm
                 JOIN users u ON u.id = cm.user_id
                 JOIN companies c ON c.id = cm.company_id
                 WHERE cm.company_id = $1 AND cm.id = $2
                 LIMIT 1`,
                [companyId, memberId]
            );

            const member = result.rows[0];
            if (!member) {
                throw createAppError('Member not found', {
                    statusCode: 404,
                    code: 'MEMBER_NOT_FOUND'
                });
            }

            if (member.status !== 'invited') {
                throw createAppError('Invite is only available for pending members', {
                    statusCode: 409,
                    code: 'INVITE_NOT_PENDING'
                });
            }

            const inviteToken = authService.generateCompanyInviteToken({
                email: member.email,
                companyId
            });
            const emailSent = await emailService.sendCompanyInviteEmail(
                member.email,
                inviteToken,
                member.full_name,
                {
                    companyName: member.company_name,
                    frontendOrigin: options.frontend_origin || null
                }
            );

            if (!emailSent) {
                throw createAppError('Failed to send invite email', {
                    statusCode: 502,
                    code: 'INVITE_EMAIL_SEND_FAILED'
                });
            }

            return {
                id: member.id,
                email: member.email,
                email_sent: emailSent
            };
        } finally {
            client.release();
        }
    }

    /**
     * Update member
     */
    async updateMember(companyId, memberId, userId, updateData) {
        const client = await pool.connect();
        const analyticsEventIds = [];
        try {
            await client.query('BEGIN');

            // Check if updating self
            const memberCheckQuery = `
        SELECT user_id, role 
        FROM company_members 
        WHERE id = $1 AND company_id = $2
      `;
            const memberCheckResult = await client.query(memberCheckQuery, [memberId, companyId]);

            if (memberCheckResult.rows.length === 0) {
                throw createAppError('Member not found', {
                    statusCode: 404,
                    code: 'MEMBER_NOT_FOUND'
                });
            }

            const targetMember = memberCheckResult.rows[0];

            // Cannot update self
            if (targetMember.user_id === userId) {
                throw createAppError('Cannot update your own membership', {
                    statusCode: 400,
                    code: 'CANNOT_UPDATE_SELF'
                });
            }

            // Cannot update admin role
            if (targetMember.role === 'admin') {
                throw createAppError('Cannot update admin members', {
                    statusCode: 400,
                    code: 'ADMIN_MEMBER_PROTECTED'
                });
            }

            // Update member
            const updates = [];
            const params = [];
            let paramIndex = 1;

            if (updateData.role) {
                updates.push(`role = $${paramIndex}`);
                params.push(updateData.role);
                paramIndex++;
            }

            if (updateData.status) {
                updates.push(`status = $${paramIndex}`);
                params.push(updateData.status);
                paramIndex++;
            }

            if (updates.length === 0) {
                throw createAppError('No fields to update', {
                    statusCode: 400,
                    code: 'NO_FIELDS_TO_UPDATE'
                });
            }

            updates.push(`updated_at = NOW()`);
            params.push(memberId, companyId);

            const query = `
        UPDATE company_members 
        SET ${updates.join(', ')}
        WHERE id = $${paramIndex} AND company_id = $${paramIndex + 1}
        RETURNING id, role, status, updated_at
      `;

            const result = await client.query(query, params);

            if (result.rows.length === 0) {
                throw createAppError('Failed to update member', {
                    statusCode: 400,
                    code: 'MEMBER_UPDATE_FAILED'
                });
            }

            const updatedMember = result.rows[0];
            if (updateData.role) {
                await pushAnalyticsEvent(client, analyticsEventIds, {
                    event_name: 'wc_member_role_changed',
                    user_id: userId,
                    company_id: companyId,
                    entity_type: 'company_member',
                    entity_id: memberId,
                    payload: {
                        previous_role: targetMember.role === 'editor' ? 'member' : targetMember.role,
                        next_role: updatedMember.role === 'editor' ? 'member' : updatedMember.role
                    }
                }, 'wc_member_role_changed');
            }

            if (updateData.status) {
                await pushAnalyticsEvent(client, analyticsEventIds, {
                    event_name: 'wc_member_disabled',
                    user_id: userId,
                    company_id: companyId,
                    entity_type: 'company_member',
                    entity_id: memberId,
                    payload: {
                        member_role: targetMember.role === 'editor' ? 'member' : targetMember.role,
                        status: updateData.status
                    }
                }, 'wc_member_disabled');
            }

            await client.query('COMMIT');
            analyticsService.queuePendingDispatch(analyticsEventIds);
            return result.rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Delete member
     */
    async deleteMember(companyId, memberId, userId) {
        const client = await pool.connect();
        const analyticsEventIds = [];
        try {
            await client.query('BEGIN');

            // Check if deleting self
            const memberCheckQuery = `
        SELECT user_id, role 
        FROM company_members 
        WHERE id = $1 AND company_id = $2
      `;
            const memberCheckResult = await client.query(memberCheckQuery, [memberId, companyId]);

            if (memberCheckResult.rows.length === 0) {
                throw createAppError('Member not found', {
                    statusCode: 404,
                    code: 'MEMBER_NOT_FOUND'
                });
            }

            const targetMember = memberCheckResult.rows[0];

            // Cannot delete self
            if (targetMember.user_id === userId) {
                throw createAppError('Cannot delete yourself', {
                    statusCode: 400,
                    code: 'CANNOT_DELETE_SELF'
                });
            }

            // Cannot delete admin
            if (targetMember.role === 'admin') {
                throw createAppError('Cannot delete admin members', {
                    statusCode: 400,
                    code: 'ADMIN_MEMBER_PROTECTED'
                });
            }

            // Delete member
            const deleteQuery = `
        DELETE FROM company_members 
        WHERE id = $1 AND company_id = $2
        RETURNING id
      `;
            const result = await client.query(deleteQuery, [memberId, companyId]);

            if (result.rows.length === 0) {
                throw createAppError('Failed to delete member', {
                    statusCode: 400,
                    code: 'MEMBER_DELETE_FAILED'
                });
            }

            await pushAnalyticsEvent(client, analyticsEventIds, {
                event_name: 'wc_member_removed',
                user_id: userId,
                company_id: companyId,
                entity_type: 'company_member',
                entity_id: memberId,
                payload: {
                    member_role: targetMember.role === 'editor' ? 'member' : targetMember.role
                }
            }, 'wc_member_removed');

            await client.query('COMMIT');
            analyticsService.queuePendingDispatch(analyticsEventIds);
            return true;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Check if user is admin of company
     */
    async isCompanyAdmin(userId, companyId) {
        const client = await pool.connect();
        try {
            const query = `
        SELECT role 
        FROM company_members 
        WHERE company_id = $1 AND user_id = $2 AND status = 'active'
      `;
            const result = await client.query(query, [companyId, userId]);

            if (result.rows.length === 0) {
                return false;
            }

            return result.rows[0].role === 'admin';
        } finally {
            client.release();
        }
    }

    /**
     * Check if user is member of company
     */
    async isCompanyMember(userId, companyId) {
        const client = await pool.connect();
        try {
            const query = `
        SELECT id 
        FROM company_members 
        WHERE company_id = $1 AND user_id = $2 AND status = 'active'
      `;
            const result = await client.query(query, [companyId, userId]);

            return result.rows.length > 0;
        } finally {
            client.release();
        }
    }
}

module.exports = new CompanyMembersService();
