// routes/member-directory.js
// Combined export of the two places a "current member" record lives:
// legacy_lifetime_members (the pre-digital roll) and membership_applications
// (approved digital applications). Legacy members are listed first, then
// newly accepted ones -- there's no combined JSON list endpoint, since the
// admin dashboard already has both halves loaded separately and just
// merges them client-side for the read-only "All Members" view; this
// route exists only because building an .xlsx file has to happen
// server-side.

const express = require('express');
const ExcelJS = require('exceljs');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const COLUMNS = [
    { header: 'Membership Number', key: 'membershipNumber', width: 20 },
    { header: 'Source', key: 'source', width: 10 },
    { header: 'Full Name', key: 'fullName', width: 32 },
    { header: 'Name with Initials', key: 'nameWithInitials', width: 24 },
    { header: 'Title', key: 'title', width: 10 },
    { header: 'NIC Number', key: 'nicNumber', width: 18 },
    { header: 'Date of Birth', key: 'dateOfBirth', width: 14 },
    { header: 'Sex', key: 'sex', width: 10 },
    { header: 'Marital Status', key: 'maritalStatus', width: 14 },
    { header: 'Mobile', key: 'mobileNumber', width: 16 },
    { header: 'Email', key: 'emailAddress', width: 28 },
    { header: 'Working Place', key: 'currentWorkingPlace', width: 28 },
    { header: 'Designation', key: 'designation', width: 20 },
    { header: 'Permanent Address', key: 'permanentAddress', width: 32 }
];

function legacyRowToExport(row) {
    return {
        membershipNumber: row.membership_number,
        source: 'Legacy',
        fullName: row.full_name,
        nameWithInitials: row.name_with_initials,
        title: row.title,
        nicNumber: row.nic_number,
        dateOfBirth: row.date_of_birth,
        sex: row.sex,
        maritalStatus: row.marital_status,
        mobileNumber: row.mobile_number,
        emailAddress: row.email_address,
        currentWorkingPlace: row.current_working_place,
        designation: row.designation,
        permanentAddress: row.permanent_address
    };
}

function newMemberRowToExport(row) {
    return {
        membershipNumber: row.membership_number,
        source: 'New',
        fullName: row.full_name,
        nameWithInitials: row.name_with_initials,
        title: row.title,
        nicNumber: row.nic_number,
        dateOfBirth: row.date_of_birth,
        sex: row.sex,
        maritalStatus: row.marital_status,
        mobileNumber: row.mobile_number,
        emailAddress: row.email_address,
        currentWorkingPlace: row.current_working_place,
        designation: row.designation,
        permanentAddress: row.permanent_address
    };
}

// GET /api/member-directory/export (admin only)
router.get('/export', requireAuth, async function (req, res, next) {
    try {
        // Matches the Member Directory -> All Active Members tab this
        // export is downloaded from: deactivated members are left out of
        // both.
        const [legacyResult, newResult] = await Promise.all([
            pool.query('SELECT * FROM legacy_lifetime_members WHERE is_active ORDER BY full_name ASC'),
            pool.query(
                "SELECT * FROM membership_applications WHERE application_status = 'approved' AND is_active ORDER BY full_name ASC"
            )
        ]);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Members');
        sheet.columns = COLUMNS;

        const headerRow = sheet.getRow(1);
        headerRow.eachCell(function (cell) {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D63' } };
        });

        legacyResult.rows.forEach((row) => sheet.addRow(legacyRowToExport(row)));
        newResult.rows.forEach((row) => sheet.addRow(newMemberRowToExport(row)));

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader('Content-Disposition', 'attachment; filename="slna-member-directory.xlsx"');

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        next(error);
    }
});

module.exports = router;
