// routes/event-registrations.js
const express = require('express');
const path = require('path');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const router = express.Router();
const db = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { uploadEventPayment } = require('../middleware/upload');
const { getPrivateObject, isNotFoundError } = require('../lib/r2');
const { sendMail, SECRETARY_EMAIL, ADMIN_LOGIN_URL, CONTACT_LINE } = require('../lib/mail');

const RECEIPT_STORAGE_PREFIX = 'event-registrations/';

const REGISTRANT_TYPES = new Set(['Member', 'Non-Member']);
const PAY_BY_OPTIONS = new Set(['Organization', 'Individual']);
const REGISTRATION_STATUSES = new Set(['Pending', 'Confirmed', 'Rejected']);
const EXPORT_STATUS_FILTERS = new Set(['Pending', 'Confirmed', 'Rejected']);
const EXPORT_STATUS_SORT_ORDER = { Confirmed: 0, Pending: 1, Rejected: 2 };

const EXPORT_COLUMNS = [
  { key: '#', label: '#', width: 30 },
  { key: 'registrant_type', label: 'Registering As', width: 70 },
  { key: 'membership_number', label: 'Membership #', width: 65 },
  { key: 'nic', label: 'NIC', width: 65 },
  { key: 'full_name', label: 'Name', width: 90 },
  { key: 'slnc_registration_number', label: 'SLNC Reg. No.', width: 65 },
  { key: 'email', label: 'Email', width: 110 },
  { key: 'mobile', label: 'Mobile', width: 65 },
  { key: 'certificate_issue_name', label: 'Certificate Issue Name', width: 90 },
  { key: 'postal_address', label: 'Postal Address', width: 120 },
  { key: 'workplace', label: 'Workplace', width: 80 },
  { key: 'workplace_address', label: 'Workplace Address', width: 120 },
  { key: 'pay_by', label: 'Pay By', width: 55 },
  { key: 'paid_amount', label: 'Paid Amount (LKR)', width: 55 },
  { key: 'status', label: 'Status', width: 70 }
];

function slugify(text) {
  return String(text || 'event')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'event';
}

function formatFeeForExport(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : '0.00';
}

function exportCellValue(key, registration, index) {
  if (key === '#') return String(index + 1);
  if (key === 'paid_amount') return formatFeeForExport(registration.paid_amount);
  if (key === 'membership_number') return registration.membership_number || '—';

  const value = registration[key];
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function sortRegistrationsForExport(rows) {
  return rows.slice().sort(function (a, b) {
    const orderA = EXPORT_STATUS_SORT_ORDER[a.status] === undefined ? 3 : EXPORT_STATUS_SORT_ORDER[a.status];
    const orderB = EXPORT_STATUS_SORT_ORDER[b.status] === undefined ? 3 : EXPORT_STATUS_SORT_ORDER[b.status];

    if (orderA !== orderB) return orderA - orderB;

    return new Date(a.created_at) - new Date(b.created_at);
  });
}

async function fetchRegistrationsForExport(category, eventId, status) {
  const conditions = ['event_category = $1', 'event_id = $2'];
  const values = [category, eventId];

  if (status !== 'All') {
    conditions.push('status = $' + (values.length + 1));
    values.push(status);
  }

  const sql = `
    SELECT *
    FROM event_registrations
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at ASC
  `;

  const result = await db.query(sql, values);
  let rows = result.rows.map(normaliseRegistration);

  if (status === 'All') {
    rows = sortRegistrationsForExport(rows);
  }

  return rows;
}

// Receipts live in the private R2 bucket, so what gets stored is the bare
// object key (not a public URL) -- served later through the authenticated
// GET /:id/receipt route below.
function receiptUploadUrl(file) {
  return file ? file.key : null;
}

function normaliseRegistration(row) {
  if (!row) return null;

  return {
    id: row.id,
    event_category: row.event_category,
    event_id: row.event_id,
    event_title: row.event_title,
    event_date: row.event_date,
    registrant_type: row.registrant_type,
    paid_amount: row.paid_amount === null ? null : Number(row.paid_amount),
    membership_number: row.membership_number,
    nic: row.nic,
    full_name: row.full_name,
    slnc_registration_number: row.slnc_registration_number,
    email: row.email,
    mobile: row.mobile,
    certificate_issue_name: row.certificate_issue_name,
    postal_address: row.postal_address,
    workplace: row.workplace,
    workplace_address: row.workplace_address,
    pay_by: row.pay_by,
    receipt_url: row.receipt_url,
    receipt_filename: row.receipt_filename,
    status: row.status,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function findEvent(category, id) {
  const table = category === 'other' ? 'events' : 'cpd_events';
  const where = category === 'other' ? 'id = $1 AND category = \'other\'' : 'id = $1';
  const cpdColumns = category === 'other' ? '' : ', member_fee, non_member_fee, audience';

  const result = await db.query(
    `SELECT id, title, event_date${cpdColumns} FROM ${table} WHERE ${where}`,
    [id]
  );

  return result.rows[0] || null;
}

function isValidAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return false;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0;
}

// A CPD event with fee_type 'free' (both fees 0) has nothing to pay for
// anyone; 'free_for_members' has nothing to pay only for a Member
// registrant (a Non-Member still pays the non_member_fee); and any "other"
// category event has no fee columns at all, so it's always free. Whichever
// case applies, pay_by / paid_amount / the receipt upload are all skipped
// rather than required.
function isFreeRegistration(category, event, registrantType) {
  if (category !== 'cpd') {
    return true;
  }

  const fee = registrantType === 'Member'
      ? Number(event.member_fee)
      : Number(event.non_member_fee);

  return fee <= 0;
}

function validateRegistrationInput(body, isFree) {
  if (!body.event_id || !/^\d+$/.test(String(body.event_id))) {
    return { error: 'A valid event_id is required.' };
  }

  const required = [
    'registrant_type',
    'nic',
    'full_name',
    'email',
    'mobile',
    'certificate_issue_name',
    'postal_address',
    'workplace',
    'workplace_address'
  ];

  if (!isFree) {
    required.push('pay_by');
  }

  for (const field of required) {
    if (!String(body[field] || '').trim()) {
      return { error: field + ' is required.' };
    }
  }

  if (!REGISTRANT_TYPES.has(body.registrant_type)) {
    return { error: 'registrant_type must be "Member" or "Non-Member".' };
  }

  if (body.registrant_type === 'Member' && !String(body.membership_number || '').trim()) {
    return { error: 'Membership Number is required for members.' };
  }

  if (!isFree) {
    if (!PAY_BY_OPTIONS.has(body.pay_by)) {
      return { error: 'pay_by must be "Organization" or "Individual".' };
    }

    if (!isValidAmount(body.paid_amount)) {
      return { error: 'A valid paid_amount of 0 or more is required.' };
    }
  }

  return {};
}

function formatRegistrationEventDate(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function sendRegistrationReceivedEmail(registration) {
  return sendMail({
    to: registration.email,
    subject: `SLNA Event Registration Received - ${registration.event_title}`,
    text:
        `Dear ${registration.full_name},\n\n` +
        `Thank you for registering for "${registration.event_title}"` +
        (registration.event_date ? ` on ${formatRegistrationEventDate(registration.event_date)}` : '') +
        '.\n\n' +
        'Your registration has been received and is awaiting confirmation ' +
        'by the SLNA office' +
        (registration.paid_amount > 0 ? ' (including verification of your payment receipt)' : '') +
        '. You will receive another email once it has been reviewed.\n\n' +
        'Regards,\nSLNA'
  });
}

function sendSecretaryNewRegistrationEmail(registration) {
  if (!SECRETARY_EMAIL) return Promise.resolve({ sent: false });

  return sendMail({
    to: SECRETARY_EMAIL,
    subject: `New Event Registration - ${registration.event_title}`,
    text:
        `A new registration was submitted for "${registration.event_title}"` +
        (registration.event_date ? ` on ${formatRegistrationEventDate(registration.event_date)}` : '') +
        '.\n\n' +
        `Registrant: ${registration.full_name} (${registration.registrant_type})\n` +
        `Email: ${registration.email}\n` +
        `Mobile: ${registration.mobile}\n\n` +
        'Please log in to the staff admin dashboard to review and confirm ' +
        `this registration:\n${ADMIN_LOGIN_URL}\n\n` +
        'Regards,\nSLNA Website'
  });
}

function sendRegistrationConfirmedEmail(registration) {
  return sendMail({
    to: registration.email,
    subject: `Your SLNA Event Registration Has Been Confirmed - ${registration.event_title}`,
    text:
        `Dear ${registration.full_name},\n\n` +
        `Your registration for "${registration.event_title}"` +
        (registration.event_date ? ` on ${formatRegistrationEventDate(registration.event_date)}` : '') +
        ' has been confirmed.\n\n' +
        'We look forward to your participation.\n\n' +
        'Regards,\nSLNA'
  });
}

function sendRegistrationRejectedEmail(registration) {
  return sendMail({
    to: registration.email,
    subject: `Your SLNA Event Registration Could Not Be Confirmed - ${registration.event_title}`,
    text:
        `Dear ${registration.full_name},\n\n` +
        `We're sorry to let you know that your registration for ` +
        `"${registration.event_title}" could not be confirmed.\n\n` +
        `Reason: ${registration.rejection_reason}\n\n` +
        'If you believe this is a mistake or wish to register again after ' +
        'addressing the reason above, please submit a new registration for ' +
        'this event.\n\n' +
        `${CONTACT_LINE}\n\n` +
        'Regards,\nSLNA'
  });
}

// Submit an event registration with a bank receipt upload (PUBLIC)
router.post(
  '/',
  uploadEventPayment.single('receipt'),
  async function (req, res) {
    const category = req.body.event_category === 'other' ? 'other' : 'cpd';

    if (!req.body.event_id || !/^\d+$/.test(String(req.body.event_id))) {
      return res.status(400).json({ error: 'A valid event_id is required.' });
    }

    try {
      const event = await findEvent(category, req.body.event_id);

      if (!event) {
        return res.status(404).json({ error: 'The event for this registration could not be found.' });
      }

      const isFree = isFreeRegistration(category, event, req.body.registrant_type);
      const validation = validateRegistrationInput(req.body, isFree);

      if (validation.error) {
        return res.status(400).json({ error: validation.error });
      }

      if (category === 'cpd' && event.audience === 'Members Only' && req.body.registrant_type !== 'Member') {
        return res.status(400).json({ error: 'This event is open to SLNA members only.' });
      }

      if (!isFree && !req.file) {
        return res.status(400).json({ error: 'A bank receipt file is required.' });
      }

      if (!isFree && category === 'cpd') {
        const expectedFee = req.body.registrant_type === 'Member'
            ? Number(event.member_fee)
            : Number(event.non_member_fee);

        const paidAmount = Number(req.body.paid_amount);

        if (Math.abs(paidAmount - expectedFee) > 0.01) {
          return res.status(400).json({
            error: 'Paid amount must match the ' + req.body.registrant_type +
                ' fee of LKR ' + expectedFee.toFixed(2) + ' for this event.'
          });
        }
      }

      const sql = `
        INSERT INTO event_registrations (
          event_category,
          event_id,
          event_title,
          event_date,
          registrant_type,
          paid_amount,
          membership_number,
          nic,
          full_name,
          slnc_registration_number,
          email,
          mobile,
          certificate_issue_name,
          postal_address,
          workplace,
          workplace_address,
          pay_by,
          receipt_url,
          receipt_filename,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW(), NOW()
        )
        RETURNING *
      `;

      const values = [
        category,
        event.id,
        event.title,
        event.event_date,
        req.body.registrant_type.trim(),
        isFree ? 0 : Number(req.body.paid_amount),
        req.body.registrant_type === 'Member' ? req.body.membership_number.trim() : null,
        req.body.nic.trim(),
        req.body.full_name.trim(),
        String(req.body.slnc_registration_number || '').trim() || null,
        req.body.email.trim(),
        req.body.mobile.trim(),
        req.body.certificate_issue_name.trim(),
        req.body.postal_address.trim(),
        req.body.workplace.trim(),
        req.body.workplace_address.trim(),
        isFree ? null : req.body.pay_by.trim(),
        isFree ? null : receiptUploadUrl(req.file),
        isFree ? null : req.file.originalname
      ];

      const result = await db.query(sql, values);
      const registration = normaliseRegistration(result.rows[0]);

      sendRegistrationReceivedEmail(registration);
      sendSecretaryNewRegistrationEmail(registration);

      return res.status(201).json({
        message: 'Registration submitted.',
        registration
      });
    } catch (error) {
      console.error('Could not save event registration:', error);
      return res.status(500).json({ error: 'Could not submit the registration.' });
    }
  }
);

// List registrations for a specific event (admin)
router.get('/', requireAuth, async function (req, res) {
  const category = req.query.category === 'other' ? 'other' : 'cpd';
  const eventId = req.query.event_id;

  const conditions = ['event_category = $1'];
  const values = [category];

  if (eventId) {
    conditions.push('event_id = $' + (values.length + 1));
    values.push(eventId);
  }

  const sql = `
    SELECT *
    FROM event_registrations
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
  `;

  try {
    const result = await db.query(sql, values);
    return res.json(result.rows.map(normaliseRegistration));
  } catch (error) {
    console.error('Could not load event registrations:', error);
    return res.status(500).json({ error: 'Could not load registrations.' });
  }
});

// GET /api/event-registrations/counts?category=cpd
// Per-event registration counts for the admin summary table, without
// pulling every registration row just to display how many there are.
router.get('/counts', requireAuth, async function (req, res) {
  const category = req.query.category === 'other' ? 'other' : 'cpd';

  const sql = `
    SELECT event_id, COUNT(*)::int AS count
    FROM event_registrations
    WHERE event_category = $1
    GROUP BY event_id
  `;

  try {
    const result = await db.query(sql, [category]);
    return res.json(result.rows);
  } catch (error) {
    console.error('Could not load registration counts:', error);
    return res.status(500).json({ error: 'Could not load registration counts.' });
  }
});

// Export registrations for an event as a PDF table (admin)
router.get('/export/pdf', requireAuth, async function (req, res) {
  const category = req.query.category === 'other' ? 'other' : 'cpd';
  const eventId = req.query.event_id;
  const status = EXPORT_STATUS_FILTERS.has(req.query.status) ? req.query.status : 'All';

  if (!eventId || !/^\d+$/.test(String(eventId))) {
    return res.status(400).json({ error: 'A valid event_id is required.' });
  }

  try {
    const event = await findEvent(category, eventId);

    if (!event) {
      return res.status(404).json({ error: 'The event for this export could not be found.' });
    }

    const registrations = await fetchRegistrationsForExport(category, eventId, status);
    const filename = 'registrations-' + slugify(event.title) + '-' + status.toLowerCase() + '.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

    const doc = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 24 });
    doc.pipe(res);

    const left = doc.page.margins.left;
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    const headerHeight = 24;
    const rowHeight = 22;

    doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor('#073f73')
        .text(event.title + ' — Registrations (' + status + ')', left, doc.page.margins.top);

    let y = doc.y + 12;

    function drawHeaderRow() {
      let x = left;

      EXPORT_COLUMNS.forEach(function (col) {
        doc.rect(x, y, col.width, headerHeight).fill('#0b3d63');
        x += col.width;
      });

      x = left;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff');

      EXPORT_COLUMNS.forEach(function (col) {
        doc.text(col.label, x + 3, y + 7, {
          width: col.width - 6,
          height: headerHeight - 6,
          ellipsis: true
        });
        x += col.width;
      });

      y += headerHeight;
    }

    drawHeaderRow();

    registrations.forEach(function (registration, index) {
      if (y + rowHeight > pageBottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeaderRow();
      }

      let x = left;

      EXPORT_COLUMNS.forEach(function (col) {
        doc.rect(x, y, col.width, rowHeight).stroke('#cccccc');
        x += col.width;
      });

      x = left;
      doc.font('Helvetica').fontSize(7).fillColor('#111111');

      EXPORT_COLUMNS.forEach(function (col) {
        doc.text(exportCellValue(col.key, registration, index), x + 3, y + 6, {
          width: col.width - 6,
          height: rowHeight - 6,
          ellipsis: true
        });
        x += col.width;
      });

      y += rowHeight;
    });

    doc.end();
  } catch (error) {
    console.error('Could not generate the registrations PDF export:', error);

    if (!res.headersSent) {
      res.status(500).json({ error: 'Could not generate the PDF export.' });
    } else {
      res.end();
    }
  }
});

// Export registrations for an event as an Excel workbook (admin)
router.get('/export/excel', requireAuth, async function (req, res) {
  const category = req.query.category === 'other' ? 'other' : 'cpd';
  const eventId = req.query.event_id;
  const status = EXPORT_STATUS_FILTERS.has(req.query.status) ? req.query.status : 'All';

  if (!eventId || !/^\d+$/.test(String(eventId))) {
    return res.status(400).json({ error: 'A valid event_id is required.' });
  }

  try {
    const event = await findEvent(category, eventId);

    if (!event) {
      return res.status(404).json({ error: 'The event for this export could not be found.' });
    }

    const registrations = await fetchRegistrationsForExport(category, eventId, status);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Registrations');

    sheet.columns = EXPORT_COLUMNS.map(function (col) {
      return { header: col.label, key: col.key, width: Math.max(10, Math.round(col.width / 6)) };
    });

    const headerRow = sheet.getRow(1);
    headerRow.eachCell(function (cell) {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B3D63' } };
    });

    registrations.forEach(function (registration, index) {
      const rowValues = {};

      EXPORT_COLUMNS.forEach(function (col) {
        rowValues[col.key] = exportCellValue(col.key, registration, index);
      });

      sheet.addRow(rowValues);
    });

    const filename = 'registrations-' + slugify(event.title) + '-' + status.toLowerCase() + '.xlsx';

    res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Could not generate the registrations Excel export:', error);

    if (!res.headersSent) {
      res.status(500).json({ error: 'Could not generate the Excel export.' });
    } else {
      res.end();
    }
  }
});

// Update a registration's review status (admin: confirm/reject a payment)
router.patch('/:id/status', requireAuth, async function (req, res) {
  const status = String(req.body.status || '').trim();

  if (!REGISTRATION_STATUSES.has(status)) {
    return res.status(400).json({
      error: 'status must be "Pending", "Confirmed", or "Rejected".'
    });
  }

  const rejectionReason = String(req.body.rejectionReason || '').trim();

  if (status === 'Rejected' && !rejectionReason) {
    return res.status(400).json({
      error: 'A rejection reason is required when rejecting a registration.'
    });
  }

  try {
    const result = await db.query(
      `UPDATE event_registrations
       SET status = $1,
           rejection_reason = CASE WHEN $1 = 'Rejected' THEN $3 ELSE NULL END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, req.params.id, rejectionReason || null]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Registration not found.' });
    }

    const registration = normaliseRegistration(result.rows[0]);

    if (status === 'Confirmed') {
      sendRegistrationConfirmedEmail(registration);
    } else if (status === 'Rejected') {
      sendRegistrationRejectedEmail(registration);
    }

    return res.json({
      message: 'Registration status updated.',
      registration
    });
  } catch (error) {
    console.error('Could not update registration status:', error);
    return res.status(500).json({ error: 'Could not update the registration status.' });
  }
});

// Stream a registration's bank receipt from the private R2 bucket (admin only).
router.get('/:id/receipt', requireAuth, async function (req, res, next) {
  try {
    const result = await db.query(
      'SELECT receipt_url, receipt_filename FROM event_registrations WHERE id = $1',
      [req.params.id]
    );

    if (!result.rows.length || !result.rows[0].receipt_url) {
      return res.status(404).json({ error: 'Receipt not found.' });
    }

    const { receipt_url: storageKey, receipt_filename: filename } = result.rows[0];

    if (!storageKey.startsWith(RECEIPT_STORAGE_PREFIX) || storageKey.includes('..')) {
      return res.status(400).json({ error: 'Invalid stored receipt path.' });
    }

    let object;
    try {
      object = await getPrivateObject(storageKey);
    } catch (error) {
      if (isNotFoundError(error)) {
        return res.status(404).json({ error: 'The receipt file could not be found.' });
      }
      throw error;
    }

    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (object.ContentType) res.setHeader('Content-Type', object.ContentType);
    res.setHeader('Content-Disposition', 'inline; filename="' + (filename || 'receipt') + '"');

    return object.Body.pipe(res);
  } catch (error) {
    console.error('Could not load registration receipt:', error);
    return next(error);
  }
});

module.exports = router;
