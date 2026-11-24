// routes/member-directory.js
// Excel export of the Member Directory, from the members table (every
// member: approved applications, manual entries and the legacy lifetime
// roll). Takes the same filters as the directory list, so the download
// matches what's on screen:
//   GET /api/member-directory/export?state=&category=&record=&q=
// With no state, deactivated members are left out (as before).

const express = require('express');
const ExcelJS = require('exceljs');
const M = require('../lib/membership');
const { requireAuth } = require('../middleware/auth');
const { loadMembers, filterByState } = require('./membership-members');

const router = express.Router();

const COLUMNS = [
    { header: 'Membership Number', key: 'membershipNumber', width: 20 },
    { header: 'Category', key: 'categoryLabel', width: 22 },
    { header: 'Status', key: 'stateLabel', width: 14 },
    { header: 'Member Since', key: 'joinedOn', width: 14 },
    { header: 'Valid Until', key: 'validUntil', width: 14 },
    { header: 'Record', key: 'record', width: 12 },
    { header: 'Full Name', key: 'fullName', width: 32 },
    { header: 'Name with Initials', key: 'nameWithInitials', width: 24 },
    { header: 'Title', key: 'title', width: 10 },
    { header: 'NIC Number', key: 'nicNumber', width: 18 },
    { header: 'Date of Birth', key: 'dateOfBirth', width: 14 },
    { header: 'Sex', key: 'sex', width: 10 },
    { header: 'Marital Status', key: 'maritalStatus', width: 14 },
    { header: 'Mobile', key: 'mobileNumber', width: 16 },
    { header: 'Email', key: 'emailAddress', width: 28 },
    { header: 'Working Place / Nursing School', key: 'currentWorkingPlace', width: 30 },
    { header: 'Designation', key: 'designation', width: 20 },
    { header: 'Permanent Address', key: 'permanentAddress', width: 32 }
];

const RECORD_LABELS = { legacy: 'Legacy', manual: 'Manually added', application: 'Online' };

// GET /api/member-directory/export (admin only)
router.get('/export', requireAuth, async function (req, res, next) {
    try {
        const settings = await M.loadSettings();
        const members = filterByState(await loadMembers(req.query, settings), String(req.query.state || ''))
            .sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')));

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Members');
        sheet.columns = COLUMNS;

        sheet.getRow(1).eachCell(function (cell) {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D63' } };
        });

        members.forEach((m) => sheet.addRow({
            ...m,
            validUntil: m.category === 'LT' ? 'Lifetime' : m.validUntil,
            record: RECORD_LABELS[m.source] || m.source
        }));

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
