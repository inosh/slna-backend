const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');

const pool = require('../db/pool');

const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const PRIVATE_UPLOADS_ROOT = path.join(
    __dirname,
    '..',
    'private-uploads'
);

const PRIVATE_UPLOAD_ROOT = path.join(
    PRIVATE_UPLOADS_ROOT,
    'membership-applications'
);

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const allowedMimeTypes = {
    paymentReceipt: [
        'application/pdf',
        'image/jpeg',
        'image/png'
    ],

    idPhoto: [
        'image/jpeg',
        'image/png'
    ],

    signaturePhoto: [
        'image/jpeg',
        'image/png'
    ]
};

function ensureUploadDirectory() {
    fs.mkdirSync(PRIVATE_UPLOAD_ROOT, {
        recursive: true,
        mode: 0o750
    });
}

function cleanText(value) {
    return typeof value === 'string'
        ? value.trim()
        : '';
}

function safeDownloadFilenamePart(value, fallback) {
    const cleaned = cleanText(value)
        .replace(/\./g, '')
        .replace(/\s+/g, '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    return cleaned || fallback;
}

function getFileExtension(filename, fallbackExtension) {
    const extension = path.extname(filename || '')
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, '');

    return extension || fallbackExtension;
}

function createIdApplicationFilename(application) {
    const membershipNumber = safeDownloadFilenamePart(
        application.membership_number,
        'NoMembershipNumber'
    );

    const nameWithInitials = safeDownloadFilenamePart(
        application.name_with_initials,
        application.full_name
    );

    return (
        membershipNumber +
        '-' +
        nameWithInitials +
        '-ID-Application.pdf'
    );
}

function createIdPhotoFilename(application, originalFilename) {
    const membershipNumber = safeDownloadFilenamePart(
        application.membership_number,
        'NoMembershipNumber'
    );

    const nameWithInitials = safeDownloadFilenamePart(
        application.name_with_initials,
        application.full_name
    );

    const extension = getFileExtension(
        originalFilename,
        '.jpg'
    );

    return (
        membershipNumber +
        '-' +
        nameWithInitials +
        '-ID-Photo' +
        extension
    );
}

function formatPdfDate(value) {
    if (!value) {
        return '';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return `${day}/${month}/${year}`;
}

function pdfText(value) {
    if (value === null || value === undefined) {
        return '';
    }

    return String(value);
}

function drawPdfField(doc, label, value, options = {}) {
    const x = options.x || 50;
    const y = options.y || doc.y;
    const labelWidth = options.labelWidth || 180;
    const valueWidth = options.valueWidth || 315;
    const rowHeight = options.rowHeight || 28;

    doc
        .lineWidth(0.5)
        .strokeColor('#222222')
        .rect(x, y, labelWidth, rowHeight)
        .stroke()
        .rect(x + labelWidth, y, valueWidth, rowHeight)
        .stroke();

    doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#111111')
        .text(label, x + 8, y + 9, {
            width: labelWidth - 16,
            lineBreak: false
        });

    doc
        .font('Helvetica')
        .fontSize(9)
        .text(pdfText(value), x + labelWidth + 8, y + 9, {
            width: valueWidth - 16,
            lineBreak: false
        });

    return y + rowHeight;
}

function drawPdfFullWidthField(
    doc,
    label,
    value,
    options = {}
) {
    const x = options.x || 50;
    const y = options.y || doc.y;
    const labelWidth = options.labelWidth || 180;
    const valueWidth = options.valueWidth || 315;
    const rowHeight = options.rowHeight || 36;

    doc
        .lineWidth(0.5)
        .strokeColor('#222222')
        .rect(x, y, labelWidth, rowHeight)
        .stroke()
        .rect(x + labelWidth, y, valueWidth, rowHeight)
        .stroke();

    doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(label, x + 8, y + 9, {
            width: labelWidth - 16
        });

    doc
        .font('Helvetica')
        .fontSize(9)
        .text(pdfText(value), x + labelWidth + 8, y + 9, {
            width: valueWidth - 16
        });

    return y + rowHeight;
}

function safeDate(value) {
    if (!value) {
        return null;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return value;
}

function safeOriginalFilename(filename) {
    const baseName = path.basename(filename || 'upload');

    const cleanedName = baseName
        .replace(/\s+/g, '-')
        .replace(/[^a-zA-Z0-9._-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    return cleanedName || 'upload';
}

function makeStoredFilename(file) {
    const timestamp = Date.now();
    const randomPart = crypto.randomBytes(8).toString('hex');
    const originalName = safeOriginalFilename(file.originalname);

    return `${timestamp}-${randomPart}-${originalName}`;
}

function privateStorageKey(file) {
    return `membership-applications/${file.filename}`;
}

function normaliseReferenceNumber(value) {
    return cleanText(value).toUpperCase();
}

function getPrivateFilePath(storageKey) {
    if (!storageKey || typeof storageKey !== 'string') {
        return null;
    }

    const privateRoot = path.resolve(PRIVATE_UPLOADS_ROOT);
    const filePath = path.resolve(privateRoot, storageKey);

    // Prevent path traversal such as ../../.env.
    if (!filePath.startsWith(privateRoot + path.sep)) {
        return null;
    }

    return filePath;
}

function applicationToAdminJson(application) {
    return {
        id: application.id,

        referenceNumber: application.reference_number,
        membershipType: application.membership_type,
        applicationStatus: application.application_status,
        membershipNumber: application.membership_number,

        idApplicationStatus: application.id_application_status,
        idApplicationCreatedAt: application.id_application_created_at,
        idApplicationCreatedBy: application.id_application_created_by,

        fullName: application.full_name,
        nameWithInitials: application.name_with_initials,
        title: application.title,

        nicNumber: application.nic_number,
        dateOfBirth: application.date_of_birth,
        sex: application.sex,
        maritalStatus: application.marital_status,

        permanentAddress: application.permanent_address,
        currentWorkingPlace: application.current_working_place,
        officialAddress: application.official_address,

        mobileNumber: application.mobile_number,
        whatsappNumber: application.whatsapp_number,
        residentialNumber: application.residential_number,
        officeNumber: application.office_number,
        emailAddress: application.email_address,

        slncRegistrationNumber:
        application.slnc_registration_number,

        slncRegistrationDate:
        application.slnc_registration_date,

        designation: application.designation,

        firstAppointmentDate:
        application.first_appointment_date,

        firstAppointmentPlace:
        application.first_appointment_place,

        nursingSchool: application.nursing_school,
        batch: application.batch,

        higherEducationalQualification:
        application.higher_educational_qualification,

        paymentReference: application.payment_reference,
        transferDate: application.transfer_date,

        statusNote: application.status_note,
        adminNote: application.admin_note,

        submittedAt: application.created_at,
        reviewedAt: application.reviewed_at,
        approvedAt: application.approved_at,
        rejectedAt: application.rejected_at,
        updatedAt: application.updated_at
    };
}

const storage = multer.diskStorage({
    destination: function (req, file, callback) {
        ensureUploadDirectory();
        callback(null, PRIVATE_UPLOAD_ROOT);
    },

    filename: function (req, file, callback) {
        callback(null, makeStoredFilename(file));
    }
});

const upload = multer({
    storage,

    limits: {
        fileSize: MAX_FILE_SIZE,
        files: 3
    },

    fileFilter: function (req, file, callback) {
        const allowedTypes = allowedMimeTypes[file.fieldname];

        if (!allowedTypes) {
            return callback(
                new Error('Unexpected upload field.')
            );
        }

        if (!allowedTypes.includes(file.mimetype)) {
            return callback(
                new Error(
                    `Invalid file type for ${file.fieldname}.`
                )
            );
        }

        return callback(null, true);
    }
});

function deleteUploadedFiles(files) {
    if (!files) {
        return;
    }

    Object.values(files)
        .flat()
        .forEach(function (file) {
            if (file && file.path) {
                fs.unlink(file.path, function () {});
            }
        });
}

function createReferenceNumber() {
    const date = new Date();

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const randomPart = crypto
        .randomBytes(4)
        .toString('hex')
        .toUpperCase();

    return `SLNA-LT-${year}${month}${day}-${randomPart}`;
}

async function createUniqueReferenceNumber() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const referenceNumber = createReferenceNumber();

        const result = await pool.query(
            `
                SELECT 1
                FROM membership_applications
                WHERE reference_number = $1
            `,
            [referenceNumber]
        );

        if (result.rowCount === 0) {
            return referenceNumber;
        }
    }

    throw new Error(
        'Could not generate a unique application reference number.'
    );
}

function validationError(message, details) {
    const error = new Error(message);

    error.statusCode = 400;
    error.details = details || null;

    return error;
}

function validateRequiredFields(body) {
    const requiredFields = [
        ['fullName', 'Full name is required.'],
        ['nameWithInitials', 'Name with initials is required.'],
        ['title', 'Title is required.'],
        ['nicNumber', 'National ID number is required.'],
        ['dateOfBirth', 'Date of birth is required.'],
        ['sex', 'Sex is required.'],
        ['maritalStatus', 'Marital status is required.'],
        ['permanentAddress', 'Permanent address is required.'],
        ['currentWorkingPlace', 'Current working place is required.'],
        ['mobileNumber', 'Mobile number is required.'],
        ['emailAddress', 'Email address is required.'],
        ['slncRegistrationNumber', 'SLNC registration number is required.'],
        ['designation', 'Designation is required.'],
        ['paymentReference', 'Bank transfer reference is required.'],
        ['transferDate', 'Bank transfer date is required.'],
        ['declaration', 'You must confirm the declaration.']
    ];

    const errors = [];

    requiredFields.forEach(function ([field, message]) {
        if (!cleanText(body[field])) {
            errors.push(message);
        }
    });

    if (
        cleanText(body.sex) !== 'Male' &&
        cleanText(body.sex) !== 'Female'
    ) {
        errors.push('Please select Male or Female.');
    }

    if (
        cleanText(body.declaration).toLowerCase() !== 'true'
    ) {
        errors.push(
            'You must confirm that the information is accurate.'
        );
    }

    const email = cleanText(body.emailAddress);

    if (
        email &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        errors.push('Please enter a valid email address.');
    }

    if (!safeDate(body.dateOfBirth)) {
        errors.push('Please provide a valid date of birth.');
    }

    if (!safeDate(body.transferDate)) {
        errors.push('Please provide a valid bank transfer date.');
    }

    if (
        body.slncRegistrationDate &&
        !safeDate(body.slncRegistrationDate)
    ) {
        errors.push('Please provide a valid SLNC registration date.');
    }

    if (
        body.firstAppointmentDate &&
        !safeDate(body.firstAppointmentDate)
    ) {
        errors.push('Please provide a valid first appointment date.');
    }

    if (errors.length > 0) {
        throw validationError(
            'Please correct the application details below.',
            errors
        );
    }
}

function requireUploadedFiles(files) {
    const missingFiles = [];

    if (!files.paymentReceipt || !files.paymentReceipt[0]) {
        missingFiles.push('Bank receipt is required.');
    }

    if (!files.idPhoto || !files.idPhoto[0]) {
        missingFiles.push('Passport-size photograph is required.');
    }

    if (!files.signaturePhoto || !files.signaturePhoto[0]) {
        missingFiles.push('Signature image is required.');
    }

    if (missingFiles.length > 0) {
        throw validationError(
            'Please upload all required documents.',
            missingFiles
        );
    }
}

router.post(
    '/applications',

    upload.fields([
        { name: 'paymentReceipt', maxCount: 1 },
        { name: 'idPhoto', maxCount: 1 },
        { name: 'signaturePhoto', maxCount: 1 }
    ]),

    async function (req, res, next) {
        try {
            validateRequiredFields(req.body);
            requireUploadedFiles(req.files);

            const referenceNumber = await createUniqueReferenceNumber();

            const receipt = req.files.paymentReceipt[0];
            const photo = req.files.idPhoto[0];
            const signature = req.files.signaturePhoto[0];

            const result = await pool.query(
                `
                    INSERT INTO membership_applications (
                        reference_number,
                        membership_type,
                        application_status,

                        full_name,
                        name_with_initials,
                        title,
                        nic_number,
                        date_of_birth,
                        sex,
                        marital_status,

                        permanent_address,
                        current_working_place,
                        official_address,
                        mobile_number,
                        whatsapp_number,
                        residential_number,
                        office_number,
                        email_address,

                        slnc_registration_number,
                        slnc_registration_date,
                        designation,
                        first_appointment_date,
                        first_appointment_place,
                        nursing_school,
                        batch,
                        higher_educational_qualification,

                        payment_reference,
                        transfer_date,
                        payment_receipt_path,
                        payment_receipt_original_name,

                        id_photo_path,
                        id_photo_original_name,

                        signature_photo_path,
                        signature_photo_original_name,

                        declaration_confirmed
                    )
                    VALUES (
                               $1, 'lifetime', 'pending',

                               $2, $3, $4, $5, $6, $7, $8,

                               $9, $10, $11, $12, $13, $14, $15,

                               $16, $17, $18, $19, $20, $21, $22,

                               $23, $24, $25, $26,

                               $27, $28,

                               $29, $30,

                               $31, $32,

                               TRUE
                           )
                        RETURNING
            reference_number,
            application_status,
            created_at
                `,
                [
                    referenceNumber,

                    cleanText(req.body.fullName),
                    cleanText(req.body.nameWithInitials),
                    cleanText(req.body.title),
                    cleanText(req.body.nicNumber),
                    safeDate(req.body.dateOfBirth),
                    cleanText(req.body.sex),
                    cleanText(req.body.maritalStatus),

                    cleanText(req.body.permanentAddress),
                    cleanText(req.body.currentWorkingPlace),
                    cleanText(req.body.officialAddress) || null,
                    cleanText(req.body.mobileNumber),
                    cleanText(req.body.whatsappNumber) || null,
                    cleanText(req.body.residentialNumber) || null,
                    cleanText(req.body.officeNumber) || null,
                    cleanText(req.body.emailAddress).toLowerCase(),

                    cleanText(req.body.slncRegistrationNumber),
                    safeDate(req.body.slncRegistrationDate),
                    cleanText(req.body.designation),
                    safeDate(req.body.firstAppointmentDate),
                    cleanText(req.body.firstAppointmentPlace) || null,
                    cleanText(req.body.nursingSchool) || null,
                    cleanText(req.body.batch) || null,
                    cleanText(req.body.higherEducationalQualification) || null,

                    cleanText(req.body.paymentReference),
                    safeDate(req.body.transferDate),

                    privateStorageKey(receipt),
                    receipt.originalname,

                    privateStorageKey(photo),
                    photo.originalname,

                    privateStorageKey(signature),
                    signature.originalname
                ]
            );

            return res.status(201).json({
                success: true,
                message:
                    'Your lifetime membership application has been received and is awaiting review.',
                referenceNumber: result.rows[0].reference_number,
                status: result.rows[0].application_status,
                submittedAt: result.rows[0].created_at
            });
        } catch (error) {
            deleteUploadedFiles(req.files);
            return next(error);
        }
    }
);

/*
 * Admin: list every membership application.
 *
 * GET /api/membership/admin/applications
 */
router.get(
    '/admin/applications',

    requireAuth,

    async function (req, res, next) {
        try {
            const result = await pool.query(
                `
                    SELECT
                        id,

                        reference_number,
                        membership_type,
                        application_status,
                        membership_number,
                        id_application_status,
                        id_application_created_at,
                        id_application_created_by,

                        full_name,
                        name_with_initials,
                        title,

                        nic_number,
                        date_of_birth,
                        sex,
                        marital_status,

                        permanent_address,
                        current_working_place,
                        official_address,

                        mobile_number,
                        whatsapp_number,
                        residential_number,
                        office_number,
                        email_address,

                        slnc_registration_number,
                        slnc_registration_date,
                        designation,

                        first_appointment_date,
                        first_appointment_place,

                        nursing_school,
                        batch,
                        higher_educational_qualification,

                        payment_reference,
                        transfer_date,

                        status_note,
                        admin_note,

                        created_at,
                        updated_at,
                        reviewed_at,
                        approved_at,
                        rejected_at
                    FROM membership_applications
                    ORDER BY
                        CASE application_status
                            WHEN 'pending' THEN 1
                            WHEN 'under_review' THEN 2
                            WHEN 'more_information_required' THEN 3
                            WHEN 'approved' THEN 4
                            WHEN 'rejected' THEN 5
                            ELSE 6
                        END,
                        created_at DESC
                `
            );

            return res.json({
                success: true,
                applications: result.rows.map(
                    applicationToAdminJson
                )
            });
        } catch (error) {
            return next(error);
        }
    }
);

/*
 * Admin: update application workflow status.
 *
 * PATCH /api/membership/admin/applications/:referenceNumber/status
 *
 * Body:
 * {
 *   "status": "approved" | "rejected" | "more_information_required" | "under_review",
 *   "membershipNumber": "LT-000001",
 *   "statusNote": "Optional message visible to applicant",
 *   "adminNote": "Optional internal note"
 * }
 */
router.patch(
    '/admin/applications/:referenceNumber/status',

    requireAuth,

    async function (req, res, next) {
        try {
            const referenceNumber = normaliseReferenceNumber(
                req.params.referenceNumber
            );

            const allowedStatuses = [
                'pending',
                'under_review',
                'more_information_required',
                'approved',
                'rejected'
            ];

            const status = cleanText(req.body.status).toLowerCase();
            const membershipNumber = cleanText(
                req.body.membershipNumber
            );

            const statusNote = cleanText(req.body.statusNote);
            const adminNote = cleanText(req.body.adminNote);

            if (!referenceNumber) {
                throw validationError(
                    'Application reference number is required.'
                );
            }

            if (!allowedStatuses.includes(status)) {
                throw validationError(
                    'Please provide a valid membership application status.'
                );
            }

            if (status === 'approved' && !membershipNumber) {
                throw validationError(
                    'A membership number is required when approving an application.'
                );
            }

            const existingResult = await pool.query(
                `
                    SELECT
                        id,
                        application_status,
                        membership_number
                    FROM membership_applications
                    WHERE reference_number = $1
                `,
                [referenceNumber]
            );

            if (existingResult.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Membership application not found.'
                });
            }

            const existingApplication = existingResult.rows[0];

            /*
             * A membership number cannot be silently replaced after approval.
             * If a correction is necessary, handle it intentionally in a future
             * dedicated admin action.
             */
            if (
                existingApplication.membership_number &&
                membershipNumber &&
                existingApplication.membership_number !==
                membershipNumber
            ) {
                throw validationError(
                    'This application already has a different membership number assigned.'
                );
            }

            /*
             * Use the supplied number during approval. For other statuses,
             * preserve the existing number instead of clearing it.
             */
            const finalMembershipNumber =
                status === 'approved'
                    ? membershipNumber
                    : existingApplication.membership_number;

            /*
             * req.user is expected to be set by requireAuth.
             * Adjust req.user.id if your auth middleware uses another property,
             * such as req.user.userId.
             */
            const reviewedBy =
                req.user && req.user.id
                    ? req.user.id
                    : null;

            const result = await pool.query(
                `
                    UPDATE membership_applications
                    SET
                        application_status = $1::varchar,
                        membership_number = $2::varchar,
                        status_note = $3::text,
                        admin_note = $4::text,

                        reviewed_by = $5::bigint,
                        reviewed_at = NOW(),

                        approved_at = CASE
                        WHEN $1::varchar = 'approved' THEN NOW()
                        ELSE approved_at
                    END,

                    rejected_at = CASE
                    WHEN $1::varchar = 'rejected' THEN NOW()
                    ELSE rejected_at
                    END,

                    updated_at = NOW()
                    WHERE reference_number = $6::varchar
                    RETURNING
                        id,

                        reference_number,
                        membership_type,
                        application_status,
                        membership_number,

                        full_name,
                        name_with_initials,
                        title,

                        nic_number,
                        date_of_birth,
                        sex,
                        marital_status,

                        permanent_address,
                        current_working_place,
                        official_address,

                        mobile_number,
                        whatsapp_number,
                        residential_number,
                        office_number,
                        email_address,

                        slnc_registration_number,
                        slnc_registration_date,
                        designation,

                        first_appointment_date,
                        first_appointment_place,

                        nursing_school,
                        batch,
                        higher_educational_qualification,

                        payment_reference,
                        transfer_date,

                        status_note,
                        admin_note,

                        created_at,
                        updated_at,
                        reviewed_at,
                        approved_at,
                        rejected_at
                `,
                [
                    status,
                    finalMembershipNumber || null,
                    statusNote || null,
                    adminNote || null,
                    reviewedBy,
                    referenceNumber
                ]
            );

            return res.json({
                success: true,
                message:
                    'Membership application status updated successfully.',
                application: applicationToAdminJson(result.rows[0])
            });
        } catch (error) {
            return next(error);
        }
    }
);

router.get(
    '/applications/status/:referenceNumber',

    async function (req, res, next) {
        try {
            const referenceNumber = cleanText(
                req.params.referenceNumber
            ).toUpperCase();

            if (!referenceNumber) {
                throw validationError(
                    'Application reference number is required.'
                );
            }

            const result = await pool.query(
                `
                    SELECT
                        reference_number,
                        membership_type,
                        application_status,
                        membership_number,
                        status_note,
                        created_at,
                        reviewed_at,
                        approved_at,
                        rejected_at
                    FROM membership_applications
                    WHERE reference_number = $1
                `,
                [referenceNumber]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    message:
                        'No membership application was found for that reference number.'
                });
            }

            const application = result.rows[0];

            return res.json({
                success: true,
                application: {
                    referenceNumber: application.reference_number,
                    membershipType: application.membership_type,
                    status: application.application_status,
                    membershipNumber: application.membership_number,
                    statusNote: application.status_note,
                    submittedAt: application.created_at,
                    reviewedAt: application.reviewed_at,
                    approvedAt: application.approved_at,
                    rejectedAt: application.rejected_at
                }
            });
        } catch (error) {
            return next(error);
        }
    }
);

router.get(
    '/admin/applications/:referenceNumber/id-application.pdf',
    requireAuth,
    async function (req, res, next) {
        try {
            const referenceNumber = normaliseReferenceNumber(
                req.params.referenceNumber
            );

            if (!referenceNumber) {
                throw validationError(
                    'Application reference number is required.'
                );
            }

            const result = await pool.query(
                `
                    SELECT
                        reference_number,
                        membership_number,
                        application_status,

                        full_name,
                        name_with_initials,
                        title,

                        nic_number,
                        date_of_birth,
                        sex,
                        marital_status,

                        permanent_address,
                        current_working_place,
                        official_address,

                        mobile_number,
                        whatsapp_number,
                        residential_number,
                        office_number,
                        email_address,

                        slnc_registration_number,
                        slnc_registration_date,
                        designation
                    FROM membership_applications
                    WHERE reference_number = $1::varchar
                `,
                [referenceNumber]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Membership application not found.'
                });
            }

            const application = result.rows[0];

            if (application.application_status !== 'approved') {
                return res.status(409).json({
                    success: false,
                    message:
                        'The ID application PDF can only be generated after membership approval.'
                });
            }

            if (!application.membership_number) {
                return res.status(409).json({
                    success: false,
                    message:
                        'A membership number must be assigned before generating the ID application PDF.'
                });
            }

            const filename = createIdApplicationFilename(
                application
            );

            res.status(200);

            res.setHeader(
                'Content-Type',
                'application/pdf'
            );

            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${filename}"`
            );

            res.setHeader(
                'Cache-Control',
                'private, no-store, max-age=0'
            );

            res.setHeader(
                'X-Content-Type-Options',
                'nosniff'
            );

            const doc = new PDFDocument({
                size: 'A4',
                margins: {
                    top: 26,
                    bottom: 26,
                    left: 34,
                    right: 34
                },
                autoFirstPage: true
            });

            doc.pipe(res);

            const pageWidth = 527;
            const left = 34;
            const labelWidth = 172;
            const valueWidth = 355;

            function drawCompactField(label, value, rowHeight) {
                const currentY = doc.y;

                doc
                    .lineWidth(0.45)
                    .strokeColor('#222222')
                    .rect(left, currentY, labelWidth, rowHeight)
                    .stroke()
                    .rect(
                        left + labelWidth,
                        currentY,
                        valueWidth,
                        rowHeight
                    )
                    .stroke();

                doc
                    .font('Helvetica-Bold')
                    .fontSize(8.5)
                    .fillColor('#111111')
                    .text(label, left + 7, currentY + 8, {
                        width: labelWidth - 14
                    });

                doc
                    .font('Helvetica')
                    .fontSize(8.5)
                    .fillColor('#111111')
                    .text(pdfText(value), left + labelWidth + 7, currentY + 8, {
                        width: valueWidth - 14,
                        height: rowHeight - 12,
                        ellipsis: true
                    });

                doc.y = currentY + rowHeight;
            }

            function drawCompactTwoColumnField(
                leftLabel,
                leftValue,
                rightLabel,
                rightValue,
                rowHeight
            ) {
                const currentY = doc.y;

                const leftHalf = 263.5;
                const rightHalf = 263.5;

                const smallLabelWidth = 112;
                const smallValueWidth = leftHalf - smallLabelWidth;

                doc
                    .lineWidth(0.45)
                    .strokeColor('#222222')
                    .rect(left, currentY, smallLabelWidth, rowHeight)
                    .stroke()
                    .rect(
                        left + smallLabelWidth,
                        currentY,
                        smallValueWidth,
                        rowHeight
                    )
                    .stroke()
                    .rect(
                        left + leftHalf,
                        currentY,
                        smallLabelWidth,
                        rowHeight
                    )
                    .stroke()
                    .rect(
                        left + leftHalf + smallLabelWidth,
                        currentY,
                        rightHalf - smallLabelWidth,
                        rowHeight
                    )
                    .stroke();

                doc
                    .font('Helvetica-Bold')
                    .fontSize(8.2)
                    .fillColor('#111111')
                    .text(leftLabel, left + 6, currentY + 8, {
                        width: smallLabelWidth - 12
                    });

                doc
                    .font('Helvetica')
                    .fontSize(8.2)
                    .text(leftValue || '', left + smallLabelWidth + 6, currentY + 8, {
                        width: smallValueWidth - 12,
                        height: rowHeight - 12,
                        ellipsis: true
                    });

                doc
                    .font('Helvetica-Bold')
                    .fontSize(8.2)
                    .text(
                        rightLabel,
                        left + leftHalf + 6,
                        currentY + 8,
                        {
                            width: smallLabelWidth - 12
                        }
                    );

                doc
                    .font('Helvetica')
                    .fontSize(8.2)
                    .text(
                        rightValue || '',
                        left + leftHalf + smallLabelWidth + 6,
                        currentY + 8,
                        {
                            width: rightHalf - smallLabelWidth - 12,
                            height: rowHeight - 12,
                            ellipsis: true
                        }
                    );

                doc.y = currentY + rowHeight;
            }

            /* -------------------------------------------------------
               Association heading
            ------------------------------------------------------- */

            doc
                .font('Helvetica-Bold')
                .fontSize(16)
                .fillColor('#073f73')
                .text(
                    'The Sri Lanka Nurses Association',
                    left,
                    28,
                    {
                        width: pageWidth,
                        align: 'center'
                    }
                );

            doc
                .font('Helvetica-Bold')
                .fontSize(9.5)
                .fillColor('#073f73')
                .text(
                    '(Professional Nurses’ Association)',
                    left,
                    49,
                    {
                        width: pageWidth,
                        align: 'center'
                    }
                );

            doc
                .font('Helvetica-Oblique')
                .fontSize(7)
                .fillColor('#111111')
                .text(
                    'Member of: International Council of Nurses, Commonwealth Nurses Federation, All Ceylon Women’s Conference',
                    left,
                    66,
                    {
                        width: pageWidth,
                        align: 'center'
                    }
                );

            doc
                .font('Helvetica')
                .fontSize(7.5)
                .text(
                    'Room No 123, Nurses’ Quarters, No 93, Regent Street, Colombo 10',
                    left,
                    80,
                    {
                        width: pageWidth,
                        align: 'center'
                    }
                );

            doc
                .font('Helvetica')
                .fontSize(7.5)
                .text(
                    'Phone: +94 112 693 662   |   Web: www.slnurse.lk   |   Email: srilankanursesassociation@gmail.com',
                    left,
                    92,
                    {
                        width: pageWidth,
                        align: 'center'
                    }
                );

            doc
                .moveTo(left, 108)
                .lineTo(left + pageWidth, 108)
                .lineWidth(1.2)
                .strokeColor('#073f73')
                .stroke();

            doc
                .font('Helvetica-Bold')
                .fontSize(14)
                .fillColor('#111111')
                .text(
                    'ID Application Form',
                    left,
                    120,
                    {
                        width: pageWidth,
                        align: 'center'
                    }
                );

            /* -------------------------------------------------------
               Compact ID application fields
            ------------------------------------------------------- */

            doc.y = 153;

            drawCompactField(
                'Membership Number',
                application.membership_number,
                26
            );

            drawCompactField(
                'Name in Full',
                application.full_name,
                30
            );

            drawCompactField(
                'Name with Initials',
                `${pdfText(application.title)} ${pdfText(application.name_with_initials)}`.trim(),
                26
            );

            drawCompactTwoColumnField(
                'National ID Number',
                application.nic_number,
                'Date of Birth',
                formatPdfDate(application.date_of_birth),
                26
            );

            drawCompactTwoColumnField(
                'Sex',
                application.sex,
                'Marital Status',
                application.marital_status,
                26
            );

            drawCompactTwoColumnField(
                'SLNC Reg. No.',
                application.slnc_registration_number,
                'SLNC Reg. Date',
                formatPdfDate(application.slnc_registration_date),
                26
            );

            drawCompactField(
                'Permanent Address',
                application.permanent_address,
                38
            );

            drawCompactField(
                'Current Working Place',
                application.current_working_place,
                28
            );

            drawCompactField(
                'Official Address',
                application.official_address,
                38
            );

            drawCompactField(
                'Designation',
                application.designation,
                28
            );

            /* -------------------------------------------------------
               Contact details: last section of the one-page form
            ------------------------------------------------------- */

            drawCompactTwoColumnField(
                'Mobile',
                application.mobile_number,
                'WhatsApp',
                application.whatsapp_number,
                27
            );

            drawCompactField(
                'Email',
                application.email_address,
                28
            );

            /* -------------------------------------------------------
               Footer
            ------------------------------------------------------- */

            doc
                .font('Helvetica')
                .fontSize(7)
                .fillColor('#555555')
                .text(
                    'Generated for SLNA administrative ID application processing. ' +
                    'Passport photograph and signature are maintained separately.',
                    left,
                    770,
                    {
                        width: pageWidth,
                        align: 'center'
                    }
                );

            doc.end();
        } catch (error) {
            return next(error);
        }
    }
);

/*
 * Admin: download the passport-size ID photograph using an
 * SLNA-friendly file name.
 *
 * GET /api/membership/admin/applications/:referenceNumber/id-photo
 */
router.get(
    '/admin/applications/:referenceNumber/id-photo',

    requireAuth,

    async function (req, res, next) {
        try {
            const referenceNumber = normaliseReferenceNumber(
                req.params.referenceNumber
            );

            if (!referenceNumber) {
                throw validationError(
                    'Application reference number is required.'
                );
            }

            const result = await pool.query(
                `
                    SELECT
                        reference_number,
                        membership_number,
                        name_with_initials,
                        full_name,
                        application_status,

                        id_photo_path,
                        id_photo_original_name
                    FROM membership_applications
                    WHERE reference_number = $1::varchar
                `,
                [referenceNumber]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Membership application not found.'
                });
            }

            const application = result.rows[0];

            if (application.application_status !== 'approved') {
                return res.status(409).json({
                    success: false,
                    message:
                        'The ID photograph can only be downloaded after membership approval.'
                });
            }

            if (!application.membership_number) {
                return res.status(409).json({
                    success: false,
                    message:
                        'A membership number must be assigned before downloading the ID photograph.'
                });
            }

            if (!application.id_photo_path) {
                return res.status(404).json({
                    success: false,
                    message: 'Passport photograph is unavailable.'
                });
            }

            const photoPath = getPrivateFilePath(
                application.id_photo_path
            );

            if (!photoPath) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid stored photograph path.'
                });
            }

            if (!fs.existsSync(photoPath)) {
                return res.status(404).json({
                    success: false,
                    message:
                        'The passport photograph file could not be found.'
                });
            }

            const filename = createIdPhotoFilename(
                application,
                application.id_photo_original_name
            );

            res.setHeader(
                'Cache-Control',
                'private, no-store, max-age=0'
            );

            res.setHeader(
                'X-Content-Type-Options',
                'nosniff'
            );

            return res.download(
                photoPath,
                filename,
                function (error) {
                    if (error && !res.headersSent) {
                        return next(error);
                    }
                }
            );
        } catch (error) {
            return next(error);
        }
    }
);

/*
 * Admin: confirm that the ID application form has been generated.
 *
 * PATCH /api/membership/admin/applications/:referenceNumber/id-application
 */
router.patch(
    '/admin/applications/:referenceNumber/id-application',

    requireAuth,

    async function (req, res, next) {
        try {
            const referenceNumber = normaliseReferenceNumber(
                req.params.referenceNumber
            );

            if (!referenceNumber) {
                throw validationError(
                    'Application reference number is required.'
                );
            }

            const result = await pool.query(
                `
                    UPDATE membership_applications
                    SET
                        id_application_status = 'created',
                        id_application_created_at = NOW(),
                        id_application_created_by = $1::bigint,
                        updated_at = NOW()
                    WHERE
                        reference_number = $2::varchar
                        AND application_status = 'approved'
                    RETURNING
                        id,
                        reference_number,
                        membership_number,
                        application_status,

                        id_application_status,
                        id_application_created_at,
                        id_application_created_by,

                        updated_at
                `,
                [
                    req.user.id,
                    referenceNumber
                ]
            );

            if (result.rowCount === 0) {
                const existing = await pool.query(
                    `
                        SELECT
                            reference_number,
                            application_status,
                            membership_number
                        FROM membership_applications
                        WHERE reference_number = $1::varchar
                    `,
                    [referenceNumber]
                );

                if (existing.rowCount === 0) {
                    return res.status(404).json({
                        success: false,
                        message: 'Membership application not found.'
                    });
                }

                return res.status(409).json({
                    success: false,
                    message:
                        'The ID application can only be confirmed for an approved membership application.'
                });
            }

            const application = result.rows[0];

            return res.json({
                success: true,
                message:
                    'ID application generation has been confirmed.',
                application: {
                    referenceNumber: application.reference_number,
                    membershipNumber: application.membership_number,
                    applicationStatus: application.application_status,
                    idApplicationStatus:
                    application.id_application_status,
                    idApplicationCreatedAt:
                    application.id_application_created_at,
                    idApplicationCreatedBy:
                    application.id_application_created_by,
                    updatedAt: application.updated_at
                }
            });
        } catch (error) {
            return next(error);
        }
    }
);

/*
 * Admin: stream one protected private application document.
 *
 * GET /api/membership/admin/applications/:referenceNumber/files/receipt
 * GET /api/membership/admin/applications/:referenceNumber/files/photo
 * GET /api/membership/admin/applications/:referenceNumber/files/signature
 */
router.get(
    '/admin/applications/:referenceNumber/files/:fileType',

    requireAuth,

    async function (req, res, next) {
        try {
            const referenceNumber = normaliseReferenceNumber(
                req.params.referenceNumber
            );

            const fileType = cleanText(
                req.params.fileType
            ).toLowerCase();

            const documentColumns = {
                receipt: {
                    pathColumn: 'payment_receipt_path',
                    originalNameColumn:
                        'payment_receipt_original_name'
                },

                photo: {
                    pathColumn: 'id_photo_path',
                    originalNameColumn:
                        'id_photo_original_name'
                },

                signature: {
                    pathColumn: 'signature_photo_path',
                    originalNameColumn:
                        'signature_photo_original_name'
                }
            };

            const documentConfig = documentColumns[fileType];

            if (!referenceNumber) {
                throw validationError(
                    'Application reference number is required.'
                );
            }

            if (!documentConfig) {
                throw validationError(
                    'Invalid protected document type.'
                );
            }

            /*
             * The column name comes only from our fixed documentColumns map.
             * It is never passed by the user directly, so this query remains safe.
             */
            const result = await pool.query(
                `
                    SELECT
                        ${documentConfig.pathColumn} AS storage_key,
                        ${documentConfig.originalNameColumn} AS original_name
                    FROM membership_applications
                    WHERE reference_number = $1
                `,
                [referenceNumber]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'Membership application not found.'
                });
            }

            const document = result.rows[0];

            if (!document.storage_key) {
                return res.status(404).json({
                    success: false,
                    message: 'The requested document is unavailable.'
                });
            }

            const filePath = getPrivateFilePath(
                document.storage_key
            );

            if (!filePath) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid stored document path.'
                });
            }

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    success: false,
                    message:
                        'The requested document file could not be found.'
                });
            }

            res.setHeader(
                'Cache-Control',
                'private, no-store, max-age=0'
            );

            res.setHeader(
                'X-Content-Type-Options',
                'nosniff'
            );

            return res.sendFile(filePath, {
                headers: {
                    'Content-Disposition':
                        'inline; filename="' +
                        safeOriginalFilename(
                            document.original_name
                        ) +
                        '"'
                }
            });
        } catch (error) {
            return next(error);
        }
    }
);

router.use(function (error, req, res, next) {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: 'Each uploaded file must be 5 MB or smaller.'
            });
        }

        return res.status(400).json({
            success: false,
            message: 'There was a problem uploading the application files.'
        });
    }

    if (error.message === 'Unexpected upload field.') {
        return res.status(400).json({
            success: false,
            message: 'An unexpected file field was submitted.'
        });
    }

    if (
        error.message &&
        error.message.startsWith('Invalid file type')
    ) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    return next(error);
});

module.exports = router;