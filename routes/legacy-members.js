// routes/legacy-members.js
// Admin-only view/edit of the pre-digital lifetime membership roll
// (imported from a spreadsheet -- see db/import-legacy-members.js). These
// are already lifetime members by historical fact, so there's no
// approve/reject workflow here, just a searchable list and the ability to
// fill in details over time as they come in.

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// membershipNumber is deliberately not editable here -- it's the natural
// key tying this record back to the original spreadsheet and to the
// cross-table uniqueness check in routes/membership-applications.js.
const EDITABLE_FIELDS = [
    ['fullName', 'full_name'],
    ['nameWithInitials', 'name_with_initials'],
    ['title', 'title'],
    ['nicNumber', 'nic_number'],
    ['dateOfBirth', 'date_of_birth'],
    ['sex', 'sex'],
    ['maritalStatus', 'marital_status'],
    ['permanentAddress', 'permanent_address'],
    ['currentWorkingPlace', 'current_working_place'],
    ['officialAddress', 'official_address'],
    ['mobileNumber', 'mobile_number'],
    ['whatsappNumber', 'whatsapp_number'],
    ['residentialNumber', 'residential_number'],
    ['officeNumber', 'office_number'],
    ['emailAddress', 'email_address'],
    ['slncRegistrationNumber', 'slnc_registration_number'],
    ['slncRegistrationDate', 'slnc_registration_date'],
    ['designation', 'designation'],
    ['firstAppointmentDate', 'first_appointment_date'],
    ['firstAppointmentPlace', 'first_appointment_place'],
    ['nursingSchool', 'nursing_school'],
    ['batch', 'batch'],
    ['higherEducationalQualification', 'higher_educational_qualification'],
    ['adminNote', 'admin_note']
];

function cleanText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function toMemberJson(row) {
    return {
        id: row.id,
        membershipNumber: row.membership_number,
        fullName: row.full_name,
        nameWithInitials: row.name_with_initials,
        title: row.title,
        nicNumber: row.nic_number,
        dateOfBirth: row.date_of_birth,
        sex: row.sex,
        maritalStatus: row.marital_status,
        permanentAddress: row.permanent_address,
        currentWorkingPlace: row.current_working_place,
        officialAddress: row.official_address,
        mobileNumber: row.mobile_number,
        whatsappNumber: row.whatsapp_number,
        residentialNumber: row.residential_number,
        officeNumber: row.office_number,
        emailAddress: row.email_address,
        slncRegistrationNumber: row.slnc_registration_number,
        slncRegistrationDate: row.slnc_registration_date,
        designation: row.designation,
        firstAppointmentDate: row.first_appointment_date,
        firstAppointmentPlace: row.first_appointment_place,
        nursingSchool: row.nursing_school,
        batch: row.batch,
        higherEducationalQualification: row.higher_educational_qualification,
        adminNote: row.admin_note,
        sourceRowNo: row.source_row_no,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

// GET /api/legacy-members (admin only)
router.get('/', requireAuth, async function (req, res, next) {
    try {
        const result = await pool.query(
            'SELECT * FROM legacy_lifetime_members ORDER BY full_name ASC'
        );

        return res.json({
            success: true,
            members: result.rows.map(toMemberJson)
        });
    } catch (error) {
        return next(error);
    }
});

// POST /api/legacy-members (admin only) -- manually add a legacy member
// the original spreadsheet didn't include. Only membershipNumber and
// nameWithInitials are required (mirroring the two fields the spreadsheet
// always had); everything else is optional. If fullName is left blank,
// it's set to nameWithInitials so the NOT NULL full_name column always
// has something sensible.
router.post('/', requireAuth, async function (req, res, next) {
    try {
        const membershipNumber = cleanText(req.body.membershipNumber);
        const nameWithInitials = cleanText(req.body.nameWithInitials);

        if (!membershipNumber) {
            const error = new Error('Membership number is required.');
            error.statusCode = 400;
            throw error;
        }

        if (!nameWithInitials) {
            const error = new Error('Name with initials is required.');
            error.statusCode = 400;
            throw error;
        }

        const fullName = cleanText(req.body.fullName) || nameWithInitials;

        const columns = ['membership_number', 'full_name', 'name_with_initials'];
        const values = [membershipNumber, fullName, nameWithInitials];

        for (const [jsonKey, column] of EDITABLE_FIELDS) {
            if (jsonKey === 'fullName' || jsonKey === 'nameWithInitials') continue;
            if (!(jsonKey in req.body)) continue;

            let value = req.body[jsonKey];
            value = typeof value === 'string' ? cleanText(value) : value;
            value = value === '' ? null : value;

            if (jsonKey === 'sex' && value && !['Male', 'Female'].includes(value)) {
                const error = new Error('Sex must be Male or Female.');
                error.statusCode = 400;
                throw error;
            }

            columns.push(column);
            values.push(value);
        }

        const placeholders = values.map((_, i) => '$' + (i + 1)).join(', ');

        const result = await pool.query(
            `INSERT INTO legacy_lifetime_members (${columns.join(', ')})
             VALUES (${placeholders})
             RETURNING *`,
            values
        );

        return res.status(201).json({
            success: true,
            member: toMemberJson(result.rows[0])
        });
    } catch (error) {
        if (error.code === '23505') {
            error.statusCode = 400;
            error.message = 'That membership number is already in use by another legacy member.';
        }

        return next(error);
    }
});

// PATCH /api/legacy-members/:id (admin only) -- update any subset of the
// basic-info fields (not membershipNumber -- see EDITABLE_FIELDS above).
router.patch('/:id', requireAuth, async function (req, res, next) {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {
            const error = new Error('Unknown legacy member.');
            error.statusCode = 404;
            throw error;
        }

        const updates = [];
        const values = [];

        for (const [jsonKey, column] of EDITABLE_FIELDS) {
            if (!(jsonKey in req.body)) continue;

            let value = req.body[jsonKey];
            value = typeof value === 'string' ? cleanText(value) : value;
            value = value === '' ? null : value;

            if (jsonKey === 'sex' && value && !['Male', 'Female'].includes(value)) {
                const error = new Error('Sex must be Male or Female.');
                error.statusCode = 400;
                throw error;
            }

            if (jsonKey === 'fullName' && value === null) {
                const error = new Error('Full name is required.');
                error.statusCode = 400;
                throw error;
            }

            values.push(value);
            updates.push(`${column} = $${values.length}`);
        }

        if (!updates.length) {
            const error = new Error('No fields to update were provided.');
            error.statusCode = 400;
            throw error;
        }

        values.push(id);

        const result = await pool.query(
            `UPDATE legacy_lifetime_members
             SET ${updates.join(', ')}, updated_at = now()
             WHERE id = $${values.length}
             RETURNING *`,
            values
        );

        if (!result.rows.length) {
            const error = new Error('Unknown legacy member.');
            error.statusCode = 404;
            throw error;
        }

        return res.json({
            success: true,
            member: toMemberJson(result.rows[0])
        });
    } catch (error) {
        if (error.code === '23505') {
            error.statusCode = 400;
            error.message = 'That membership number is already in use by another legacy member.';
        }

        return next(error);
    }
});

module.exports = router;
